import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse

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


def launch_timetable(canvas_token: str, timeout: int = DEFAULT_TIMEOUT) -> Tuple[str, requests.Session]:
    """Run the full LTI launch and return (ltik, session)."""
    if not canvas_token:
        raise TimetableFetchError("Missing Canvas token")

    session = requests.Session()
    headers = {"Authorization": f"Bearer {canvas_token}"}

    try:
        launch_res = session.get(
            f"{BASE_URL}/api/v1/accounts/1/external_tools/sessionless_launch",
            params={"id": EXTERNAL_TOOL_ID, "launch_type": "global_navigation"},
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise TimetableFetchError(f"Failed to start timetable launch: {exc}") from exc

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

    try:
        # form 1 (Canvas -> LTI tool)
        r1 = session.get(launch_url, timeout=timeout)
        r1.raise_for_status()
        form1 = BeautifulSoup(r1.text, "html.parser").find("form")
        if not form1:
            raise TimetableFetchError("Timetable launch step 1 did not return a form")
        action1, payload1 = _form_payload(form1)
        r2 = session.post(urljoin(r1.url, action1), data=payload1, timeout=timeout)
        r2.raise_for_status()

        # form 2 (LTI tool -> tool's own login/redirect)
        form2 = BeautifulSoup(r2.text, "html.parser").find("form")
        if not form2:
            raise TimetableFetchError("Timetable launch step 2 did not return a form")
        action2, payload2 = _form_payload(form2)
        final_resp = session.post(urljoin(r2.url, action2), data=payload2, timeout=timeout)
        final_resp.raise_for_status()
    except requests.RequestException as exc:
        raise TimetableFetchError(f"Timetable launch failed: {exc}") from exc

    ltik = parse_qs(urlparse(final_resp.url).query).get("ltik", [None])[0]
    if not ltik:
        raise TimetableFetchError("Timetable launch did not produce an access token")

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
    except requests.RequestException as exc:
        raise TimetableFetchError(f"Failed to fetch timetable: {exc}") from exc

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
