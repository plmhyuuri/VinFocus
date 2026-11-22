import base64
import email.message
import http.client
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

BASE_URL = "https://lms.vinschool.edu.vn"
TIMETABLE_TOOL_URL = "https://lms-lti-timetables.vinschool.edu.vn/gettimetable"
TIMETABLE_TOOL_HOST = urlparse(TIMETABLE_TOOL_URL).hostname or ""
TOOL_PROXY_ENV = "TIMETABLE_PROXY_URL"
TOOL_RELAY_URL_ENV = "TIMETABLE_RELAY_URL"
TOOL_RELAY_KEY_ENV = "TIMETABLE_RELAY_KEY"
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
    """Strip credentials, query strings, and fragments so signed params are never logged."""
    parsed = urlparse(url or "")
    netloc = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse((parsed.scheme, netloc, parsed.path, "", "", ""))


def _origin(url: str) -> str:
    parsed = urlparse(url or "")
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""


def _tool_proxies() -> Optional[Dict[str, str]]:
    proxy_url = (os.getenv(TOOL_PROXY_ENV) or "").strip()
    if not proxy_url:
        return None
    parsed = urlparse(proxy_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        logger.warning("Ignoring invalid %s value", TOOL_PROXY_ENV)
        return None
    return {"http": proxy_url, "https": proxy_url}


def _proxy_label(proxies: Optional[Dict[str, str]]) -> str:
    if not proxies:
        return "disabled"
    parsed = urlparse(proxies.get("https") or proxies.get("http") or "")
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    return f"{host}{port}" if host else "configured"


def _proxies_for_url(url: str, proxies: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    """Use the relay only for the VSC tool host, never for Canvas."""
    if not proxies:
        return None
    return proxies if urlparse(url or "").hostname == TIMETABLE_TOOL_HOST else None


def _tool_relay() -> Optional[Tuple[str, str]]:
    """Return (relay_url, relay_key) when the Worker relay is configured."""
    relay_url = (os.getenv(TOOL_RELAY_URL_ENV) or "").strip()
    if not relay_url:
        return None
    parsed = urlparse(relay_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        logger.warning("Ignoring invalid %s value", TOOL_RELAY_URL_ENV)
        return None
    relay_key = (os.getenv(TOOL_RELAY_KEY_ENV) or "").strip()
    return relay_url, relay_key


def _relay_label(relay: Optional[Tuple[str, str]]) -> str:
    if not relay:
        return "disabled"
    parsed = urlparse(relay[0])
    return parsed.hostname or "configured"


class _RelayOriginalResponse:
    """Minimal urllib3-style original response used for cookie extraction."""

    def __init__(self, set_cookie_headers: List[str]):
        self.msg = email.message.Message()
        for header in set_cookie_headers:
            self.msg.add_header("Set-Cookie", header)


class _RelayRaw:
    """Minimal urllib3-style raw response backed by bytes from the Worker."""

    def __init__(
        self,
        status: int,
        headers: Dict[str, str],
        body: bytes,
        set_cookie_headers: List[str],
    ):
        self.status = status
        self.headers = headers
        self.reason = http.client.responses.get(status, "")
        self._body = body
        self._offset = 0
        self._original_response = _RelayOriginalResponse(set_cookie_headers)
        self.closed = False

    def read(self, amt: Optional[int] = None, decode_content: Optional[bool] = None) -> bytes:
        if amt is None:
            data = self._body[self._offset:]
            self._offset = len(self._body)
            return data
        data = self._body[self._offset:self._offset + amt]
        self._offset += len(data)
        return data

    def stream(self, amt: int = 2 ** 16, decode_content: Optional[bool] = None):
        while True:
            chunk = self.read(amt, decode_content=decode_content)
            if not chunk:
                break
            yield chunk

    def release_conn(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True

    def isclosed(self) -> bool:
        return self.closed


class _RelayAdapter(HTTPAdapter):
    """Send requests for the VSC tool host through the Cloudflare Worker relay."""

    def __init__(self, relay_url: str, relay_key: str = ""):
        super().__init__()
        self.relay_url = relay_url
        self.relay_key = relay_key

    def send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        payload: Dict[str, Any] = {
            "url": request.url,
            "method": request.method,
            "headers": dict(request.headers),
        }
        body = request.body
        if hasattr(body, "read"):
            body = body.read()
        if body is not None:
            if isinstance(body, bytes):
                payload["body"] = base64.b64encode(body).decode("ascii")
                payload["bodyEncoding"] = "base64"
            else:
                payload["body"] = str(body)

        relay_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.relay_key:
            relay_headers["X-Relay-Key"] = self.relay_key

        try:
            relay_response = requests.post(
                self.relay_url,
                json=payload,
                headers=relay_headers,
                timeout=timeout or DEFAULT_TIMEOUT,
                allow_redirects=False,
                proxies={"http": None, "https": None},
            )
        except requests.RequestException as exc:
            raise requests.ConnectionError(
                f"Timetable relay request failed: {type(exc).__name__}"
            ) from exc

        if relay_response.status_code != 200:
            detail = ""
            try:
                error_data = relay_response.json()
                if isinstance(error_data, dict) and error_data.get("error"):
                    detail = f": {error_data['error']}"
            except ValueError:
                pass
            raise requests.HTTPError(
                f"Timetable relay returned status {relay_response.status_code}{detail}",
                response=relay_response,
            )

        try:
            data = relay_response.json()
        except ValueError as exc:
            raise requests.ConnectionError("Timetable relay returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise requests.ConnectionError("Timetable relay returned an unexpected response")

        status = data.get("status")
        if not isinstance(status, int):
            raise requests.ConnectionError("Timetable relay returned no status")

        body_value = data.get("body") or ""
        if data.get("bodyEncoding") == "base64":
            try:
                body_bytes = base64.b64decode(body_value)
            except (TypeError, ValueError) as exc:
                raise requests.ConnectionError("Timetable relay returned invalid body") from exc
        else:
            body_bytes = str(body_value).encode("utf-8")

        headers = data.get("headers") or {}
        if not isinstance(headers, dict):
            headers = {}
        set_cookie = data.get("setCookie") or []
        if isinstance(set_cookie, str):
            set_cookie = [set_cookie]

        raw = _RelayRaw(status, headers, body_bytes, [str(item) for item in set_cookie])
        return self.build_response(request, raw)


def _build_session(relay: Optional[Tuple[str, str]] = None) -> requests.Session:
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
    if relay:
        relay_url, relay_key = relay
        session.mount(
            f"https://{TIMETABLE_TOOL_HOST}",
            _RelayAdapter(relay_url, relay_key),
        )
    return session


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


def _safe_error_detail(exc: Exception) -> str:
    """Keep proxy/network diagnostics without exposing credentials or signed URLs."""
    detail = re.sub(r"https?://[^\s)]+", lambda match: _redact_url(match.group(0)), str(exc))
    return re.sub(r"\s+", " ", detail)[:400]


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


def _is_cloudflare_challenge(response: requests.Response) -> bool:
    if response.status_code != 403:
        return False
    title, signals = _response_signals(response)
    return (
        "attention required" in title.lower()
        or "cloudflare" in signals
        or "captcha" in signals
    )


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

    relay = _tool_relay()
    tool_proxies = None if relay else _tool_proxies()
    if relay:
        logger.info("Timetable tool relay: %s", _relay_label(relay))
        if not relay[1]:
            logger.warning("Timetable relay key is not configured")
    else:
        logger.info("Timetable tool proxy: %s", _proxy_label(tool_proxies))

    session = _build_session(relay)
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
        logger.warning(
            "Timetable %s failed: %s: %s",
            step,
            type(exc).__name__,
            _safe_error_detail(exc),
        )
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

        if tool_proxies:
            logger.info("Timetable preflight GET skipped: proxy configured")
        else:
            try:
                step = "lti_preflight_get"
                preflight = session.get(
                    post1_url,
                    headers={"Referer": r1.url},
                    proxies=_proxies_for_url(post1_url, tool_proxies),
                    timeout=timeout,
                )
                _log_http_step(step, preflight, session)
            except requests.RequestException as exc:
                logger.warning(
                    "Timetable preflight GET skipped: %s: %s",
                    type(exc).__name__,
                    _safe_error_detail(exc),
                )

        post1_headers = {"Referer": r1.url, "Origin": _origin(r1.url)}
        step = "lti_form1_post"
        r2 = session.post(
            post1_url,
            data=payload1,
            headers=post1_headers,
            proxies=_proxies_for_url(post1_url, tool_proxies),
            timeout=timeout,
        )
        _log_http_step(step, r2, session)

        if _is_cloudflare_challenge(r2):
            logger.warning("Timetable form 1 POST hit a Cloudflare interstitial; retrying once")
            if tool_proxies:
                logger.info("Timetable preflight retry GET skipped: proxy configured")
            else:
                try:
                    step = "lti_preflight_get_retry"
                    preflight_retry = session.get(
                        post1_url,
                        headers={"Referer": r1.url},
                        proxies=_proxies_for_url(post1_url, tool_proxies),
                        timeout=timeout,
                    )
                    _log_http_step(step, preflight_retry, session)
                except requests.RequestException as exc:
                    logger.warning(
                        "Timetable preflight retry GET skipped: %s: %s",
                        type(exc).__name__,
                        _safe_error_detail(exc),
                    )

            step = "lti_form1_post_retry"
            r2 = session.post(
                post1_url,
                data=payload1,
                headers=post1_headers,
                proxies=_proxies_for_url(post1_url, tool_proxies),
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
            proxies=_proxies_for_url(post2_url, tool_proxies),
            timeout=timeout,
        )
        _log_http_step(step, final_resp, session)
        final_resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning(
            "Timetable %s failed: %s: %s",
            step,
            type(exc).__name__,
            _safe_error_detail(exc),
        )
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
    relay = _tool_relay()
    tool_proxies = None if relay else _tool_proxies()
    try:
        response = session.get(
            TIMETABLE_TOOL_URL,
            params={"date": date},
            headers={"Authorization": f"Bearer {ltik}"},
            proxies=_proxies_for_url(TIMETABLE_TOOL_URL, tool_proxies),
            timeout=timeout,
        )
        _log_http_step("vsc_timetable_fetch", response, session)
    except requests.RequestException as exc:
        logger.warning(
            "Timetable vsc_timetable_fetch failed: %s: %s",
            type(exc).__name__,
            _safe_error_detail(exc),
        )
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
