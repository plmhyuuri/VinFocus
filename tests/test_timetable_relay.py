import base64

import pytest
import requests

import timetable


class _FakeRelayResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def _relay_payload(
    status=200,
    body=b"",
    headers=None,
    set_cookie=None,
    url="https://lms-lti-timetables.vinschool.edu.vn/login",
):
    return {
        "status": status,
        "url": url,
        "headers": headers or {},
        "setCookie": set_cookie or [],
        "bodyEncoding": "base64",
        "body": base64.b64encode(body).decode("ascii"),
    }


def _fake_post_factory(responses, calls):
    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        if not responses:
            raise AssertionError("unexpected relay call")
        return responses.pop(0)

    return fake_post


def test_tool_relay_reads_env(monkeypatch):
    monkeypatch.setenv(timetable.TOOL_RELAY_URL_ENV, "https://relay.example/relay")
    monkeypatch.setenv(timetable.TOOL_RELAY_KEY_ENV, "secret")

    assert timetable._tool_relay() == ("https://relay.example/relay", "secret")


def test_tool_relay_disabled_without_url(monkeypatch):
    monkeypatch.delenv(timetable.TOOL_RELAY_URL_ENV, raising=False)
    monkeypatch.delenv(timetable.TOOL_RELAY_KEY_ENV, raising=False)

    assert timetable._tool_relay() is None


def test_tool_relay_rejects_invalid_url(monkeypatch):
    monkeypatch.setenv(timetable.TOOL_RELAY_URL_ENV, "relay.example/relay")

    assert timetable._tool_relay() is None


def test_relay_label():
    assert timetable._relay_label(("https://relay.example/relay", "secret")) == "relay.example"
    assert timetable._relay_label(None) == "disabled"


def test_build_session_mounts_relay_only_for_tool_host():
    session = timetable._build_session(("https://relay.example/relay", "secret"))

    assert isinstance(
        session.adapters[f"https://{timetable.TIMETABLE_TOOL_HOST}"],
        timetable._RelayAdapter,
    )
    assert not isinstance(session.adapters["https://"], timetable._RelayAdapter)


def test_relay_adapter_forwards_get_and_extracts_cookies(monkeypatch):
    calls = []
    responses = [
        _FakeRelayResponse(
            _relay_payload(
                body=b"<html>ok</html>",
                headers={"content-type": "text/html; charset=utf-8"},
                set_cookie=["session=abc; Path=/", "csrf=xyz; Path=/"],
            )
        )
    ]
    monkeypatch.setattr(requests, "post", _fake_post_factory(responses, calls))

    session = timetable._build_session(("https://relay.example/relay", "secret"))
    response = session.get("https://lms-lti-timetables.vinschool.edu.vn/login")

    assert response.status_code == 200
    assert response.text == "<html>ok</html>"
    assert session.cookies.get("session") == "abc"
    assert session.cookies.get("csrf") == "xyz"
    assert calls[0]["url"] == "https://relay.example/relay"
    assert calls[0]["headers"]["X-Relay-Key"] == "secret"
    assert calls[0]["json"]["method"] == "GET"
    assert calls[0]["json"]["url"] == "https://lms-lti-timetables.vinschool.edu.vn/login"


def test_relay_adapter_follows_redirect_and_reuses_cookies(monkeypatch):
    calls = []
    responses = [
        _FakeRelayResponse(
            _relay_payload(
                status=302,
                headers={"location": "/next", "content-type": "text/html"},
                set_cookie=["session=abc; Path=/"],
            )
        ),
        _FakeRelayResponse(
            _relay_payload(
                body=b"<html>next</html>",
                headers={"content-type": "text/html; charset=utf-8"},
                url="https://lms-lti-timetables.vinschool.edu.vn/next",
            )
        ),
    ]
    monkeypatch.setattr(requests, "post", _fake_post_factory(responses, calls))

    session = timetable._build_session(("https://relay.example/relay", "secret"))
    response = session.get("https://lms-lti-timetables.vinschool.edu.vn/login")

    assert response.url == "https://lms-lti-timetables.vinschool.edu.vn/next"
    assert response.text == "<html>next</html>"
    assert calls[1]["json"]["headers"]["Cookie"] == "session=abc"


def test_relay_adapter_forwards_form_body(monkeypatch):
    calls = []
    responses = [_FakeRelayResponse(_relay_payload(body=b"ok"))]
    monkeypatch.setattr(requests, "post", _fake_post_factory(responses, calls))

    session = timetable._build_session(("https://relay.example/relay", "secret"))
    session.post(
        "https://lms-lti-timetables.vinschool.edu.vn/login",
        data={"a": "b"},
    )

    assert calls[0]["json"]["method"] == "POST"
    assert calls[0]["json"]["body"] == "a=b"
    assert "bodyEncoding" not in calls[0]["json"]


def test_relay_adapter_forwards_bytes_body(monkeypatch):
    calls = []
    responses = [_FakeRelayResponse(_relay_payload(body=b"ok"))]
    monkeypatch.setattr(requests, "post", _fake_post_factory(responses, calls))

    session = timetable._build_session(("https://relay.example/relay", "secret"))
    session.post(
        "https://lms-lti-timetables.vinschool.edu.vn/login",
        data=b"\x00\x01",
    )

    assert calls[0]["json"]["bodyEncoding"] == "base64"
    assert base64.b64decode(calls[0]["json"]["body"]) == b"\x00\x01"


def test_relay_adapter_raises_on_relay_failure(monkeypatch):
    calls = []
    responses = [_FakeRelayResponse({"error": "unauthorized"}, status_code=401)]
    monkeypatch.setattr(requests, "post", _fake_post_factory(responses, calls))

    session = timetable._build_session(("https://relay.example/relay", "bad"))

    with pytest.raises(requests.HTTPError):
        session.get("https://lms-lti-timetables.vinschool.edu.vn/login")
