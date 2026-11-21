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
