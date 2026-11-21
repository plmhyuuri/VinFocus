import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://lms.vinschool.edu.vn"
TIMETABLE_TOOL_URL = "https://lms-lti-timetables.vinschool.edu.vn/gettimetable"
EXTERNAL_TOOL_ID = 236
DEFAULT_TIMEOUT = 20


class TimetableFetchError(Exception):
    """Raised when the VSC timetable cannot be fetched or parsed."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def _form_payload(form) -> Tuple[str, Dict[str, str]]:
    action = form.get("action")
    if not action:
        raise TimetableFetchError("Timetable launch form is missing an action URL")
    payload = {
        input_tag.get("name"): input_tag.get("value", "")
        for input_tag in form.find_all("input")
        if input_tag.get("name")
    }
    return action, payload


def _redact_url(url: str) -> str:
    """Strip query strings and fragments so signed LTI params are never logged."""
    parsed = urlparse(url or "")
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))


def _origin(url: str) -> str:
    parsed = urlparse(url or "")
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""


def _http_error(
    step: str,
    exc: requests.RequestException,
    action: str = "Timetable launch",
) -> TimetableFetchError:
    """Build a sanitized error; HTTPError strings include signed launch URLs."""
    response = getattr(exc, "response", None)
    status = response.status_code if response is not None else None
    url = _redact_url(response.url) if response is not None else ""
    parts = [f"{action} failed at {step}", type(exc).__name__]
    if status is not None:
        parts.append(f"status {status}")
    if url:
        parts.append(f"url {url}")
    return TimetableFetchError(" ".join(parts), status_code=status)


def _response_signals(response: requests.Response) -> Tuple[str, List[str]]:
    """Extract safe title + keyword flags from an error page; never raw HTML."""
    text = (response.text or "")[:200_000]
    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
    title = re.sub(r"[A-Za-z0-9_-]{32,}", "<redacted>", title)[:120]

    lowered = re.sub(r"\s+", " ", text).lower()
    checks = [
        ("csrf", r"csrf|authenticity.token|token mismatch"),
        ("forbidden", r"forbidden|\b403\b"),
        ("access_denied", r"access denied|not authorized|unauthorized"),
        ("ip_blocked", r"ip address|your ip|blocked|not allowed"),
        ("cloudflare", r"cloudflare|attention required"),
        ("captcha", r"captcha|challenge"),
        ("rate_limited", r"rate limit|too many requests"),
        ("invalid_session", r"invalid session|session expired|expired"),
    ]
    signals = [name for name, pattern in checks if re.search(pattern, lowered)]
    return title or "-", signals


def _log_http_step(step: str, response: requests.Response, session: Optional[requests.Session] = None) -> None:
    cookie_names = ",".join(sorted(session.cookies.get_dict().keys())) if session else ""
    extra = ""
    if response.status_code >= 400:
        title, signals = _response_signals(response)
        extra = f" title={title!r} signals={','.join(signals) or '-'}"
    logger.info(
        "Timetable %s: status=%s url=%s type=%s bytes=%s server=%s cf_ray=%s cf_mitigated=%s cookies=%s%s",
        step,
        response.status_code,
        _redact_url(response.url),
        response.headers.get("Content-Type", ""),
        len(response.content or b""),
        response.headers.get("Server", ""),
        response.headers.get("Cf-Ray", ""),
        response.headers.get("Cf-Mitigated", ""),
        cookie_names,
        extra,
    )


def launch_timetable(canvas_token: str, timeout: int = DEFAULT_TIMEOUT) -> Tuple[str, requests.Session]:
    """Run the full LTI launch and return (ltik, session)."""
    if not canvas_token:
        raise TimetableFetchError("Missing Canvas token")

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1",
    })
    headers = {"Authorization": f"Bearer {canvas_token}"}

    step = "canvas_sessionless_launch"
    try:
        launch_res = session.get(
            f"{BASE_URL}/api/v1/accounts/1/external_tools/sessionless_launch",
            params={"id": EXTERNAL_TOOL_ID, "launch_type": "global_navigation"},
            headers=headers,
            timeout=timeout,
        )
        _log_http_step(step, launch_res, session)
    except requests.RequestException as exc:
        raise _http_error(step, exc, "Canvas launch") from exc

    if launch_res.status_code != 200:
        raise TimetableFetchError(
            f"Failed to start timetable launch (status {launch_res.status_code})",
            status_code=launch_res.status_code,
        )

    try:
        launch_url = launch_res.json().get("url")
    except ValueError as exc:
        raise TimetableFetchError("Invalid launch response from Canvas") from exc
    if not launch_url:
        raise TimetableFetchError("Canvas did not return a timetable launch URL")
    logger.info("Timetable launch URL: %s", _redact_url(launch_url))

    try:
        # form 1 (Canvas -> LTI tool)
        step = "lti_form1_get"
        r1 = session.get(launch_url, timeout=timeout)
        _log_http_step(step, r1, session)
        r1.raise_for_status()
        form1 = BeautifulSoup(r1.text, "html.parser").find("form")
        if not form1:
            raise TimetableFetchError("Timetable launch step 1 did not return a form")
        action1, payload1 = _form_payload(form1)
        post1_url = urljoin(r1.url, action1)
        logger.info("Timetable form 1 action: %s", _redact_url(post1_url))

        step = "lti_form1_post"
        r2 = session.post(
            post1_url,
            data=payload1,
            headers={"Referer": r1.url, "Origin": _origin(r1.url)},
            timeout=timeout,
        )
        _log_http_step(step, r2, session)
        r2.raise_for_status()

        # form 2 (LTI tool -> tool's own login/redirect)
        form2 = BeautifulSoup(r2.text, "html.parser").find("form")
        if not form2:
            raise TimetableFetchError("Timetable launch step 2 did not return a form")
        action2, payload2 = _form_payload(form2)
        post2_url = urljoin(r2.url, action2)
        logger.info("Timetable form 2 action: %s", _redact_url(post2_url))

        step = "lti_form2_post"
        final_resp = session.post(
            post2_url,
            data=payload2,
            headers={"Referer": r2.url, "Origin": _origin(r2.url)},
            timeout=timeout,
        )
        _log_http_step(step, final_resp, session)
        final_resp.raise_for_status()
    except requests.RequestException as exc:
        raise _http_error(step, exc) from exc

    ltik = parse_qs(urlparse(final_resp.url).query).get("ltik", [None])[0]
    if not ltik:
        logger.warning("Timetable launch produced no ltik: %s", _redact_url(final_resp.url))
        raise TimetableFetchError("Timetable launch did not produce an access token")

    logger.info("Timetable launch completed: %s", _redact_url(final_resp.url))
    return ltik, session


def get_timetable(canvas_token: str, date: str, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    """Fetch timetable JSON for a single date (DD/MM/YYYY)."""
    ltik, session = launch_timetable(canvas_token, timeout=timeout)
    try:
        response = session.get(
            TIMETABLE_TOOL_URL,
            params={"date": date},
            headers={"Authorization": f"Bearer {ltik}"},
            timeout=timeout,
        )
        _log_http_step("vsc_timetable_fetch", response, session)
    except requests.RequestException as exc:
        raise _http_error("vsc_timetable_fetch", exc, "Timetable fetch") from exc

    if response.status_code != 200:
        raise TimetableFetchError(
            f"Failed to fetch timetable (status {response.status_code})",
            status_code=response.status_code,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise TimetableFetchError("Timetable service returned invalid JSON") from exc

    if not isinstance(data, dict):
        raise TimetableFetchError("Timetable service returned an unexpected response")
    return data


def week_dates_for(date_str: str) -> List[Tuple[str, str]]:
    """Return [(day_key, DD/MM/YYYY), ...] for Mon-Fri of the week containing date_str (YYYY-MM-DD)."""
    try:
        anchor = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        anchor = datetime.utcnow().date()

    monday = anchor - timedelta(days=anchor.weekday())
    day_keys = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    return [(key, (monday + timedelta(days=i)).strftime("%d/%m/%Y")) for i, key in enumerate(day_keys)]


if __name__ == "__main__":
    day = input("Day (DD): ").strip()
    month = input("Month (MM): ").strip()
    token = input("Canvas token: ").strip()
    year = input("Year (YYYY, default 2026): ").strip() or "2026"
    print(get_timetable(token, f"{day}/{month}/{year}"))
