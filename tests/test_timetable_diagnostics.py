import requests

import timetable


def test_redact_url_removes_query_and_fragment():
    url = "https://host/login?token=SECRET&ltik=ABC#fragment"
    assert timetable._redact_url(url) == "https://host/login"


def test_http_error_redacts_signed_url():
    response = requests.Response()
    response.status_code = 403
    response.url = "https://host/login?ltik=SECRET"
    exc = requests.HTTPError("403 Client Error: SECRET", response=response)

    message = str(timetable._http_error("lti_form1_post", exc))

    assert "SECRET" not in message
    assert "https://host/login" in message
    assert "status 403" in message


def test_response_signals_are_sanitized():
    response = requests.Response()
    response.encoding = "utf-8"
    response._content = (
        "<html><head><title>403 Forbidden abcdefghijklmnopqrstuvwxyz0123456789</title></head>"
        "<body>Access denied for your IP address. CSRF token mismatch.</body></html>"
    ).encode("utf-8")

    title, signals = timetable._response_signals(response)

    assert "abcdefghijklmnopqrstuvwxyz0123456789" not in title
    assert "<redacted>" in title
    assert title.startswith("403 Forbidden")
    assert {"forbidden", "access_denied", "ip_blocked", "csrf"}.issubset(set(signals))


def test_cloudflare_interstitial_is_detected():
    response = requests.Response()
    response.status_code = 403
    response.encoding = "utf-8"
    response._content = b"<html><head><title>Attention Required! | Cloudflare</title></head></html>"

    assert timetable._is_cloudflare_challenge(response)


def test_plain_forbidden_is_not_a_cloudflare_challenge():
    response = requests.Response()
    response.status_code = 403
    response.encoding = "utf-8"
    response._content = b"<html><head><title>403 Forbidden</title></head></html>"

    assert not timetable._is_cloudflare_challenge(response)


def test_tool_proxies_reads_env(monkeypatch):
    monkeypatch.setenv(timetable.TOOL_PROXY_ENV, "http://127.0.0.1:3128")

    assert timetable._tool_proxies() == {
        "http": "http://127.0.0.1:3128",
        "https": "http://127.0.0.1:3128",
    }


def test_tool_proxies_disabled_without_env(monkeypatch):
    monkeypatch.delenv(timetable.TOOL_PROXY_ENV, raising=False)

    assert timetable._tool_proxies() is None


def test_tool_proxies_rejects_invalid_url(monkeypatch):
    monkeypatch.setenv(timetable.TOOL_PROXY_ENV, "127.0.0.1:3128")

    assert timetable._tool_proxies() is None


def test_proxies_only_apply_to_tool_host():
    proxies = {"http": "http://127.0.0.1:3128", "https": "http://127.0.0.1:3128"}

    assert timetable._proxies_for_url(
        "https://lms-lti-timetables.vinschool.edu.vn/login",
        proxies,
    ) == proxies
    assert timetable._proxies_for_url(
        "https://lms.vinschool.edu.vn/accounts/1/external_tools/236",
        proxies,
    ) is None


def test_proxy_label_hides_credentials():
    label = timetable._proxy_label({
        "http": "http://user:secret@proxy.example:3128",
        "https": "http://user:secret@proxy.example:3128",
    })

    assert label == "proxy.example:3128"
    assert "secret" not in label
