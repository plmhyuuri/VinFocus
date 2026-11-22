import base64
from unittest.mock import Mock

import pytest
import requests

import local_relay


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RELAY_KEY", "secret")
    return local_relay.app.test_client()


def _payload(**overrides):
    payload = {
        "url": "https://lms-lti-timetables.vinschool.edu.vn/login",
        "method": "GET",
        "headers": {"Accept": "text/html"},
    }
    payload.update(overrides)
    return payload


def _upstream(status=200, content=b"<html>ok</html>", headers=None, set_cookie=None):
    upstream = Mock()
    upstream.status_code = status
    upstream.url = "https://lms-lti-timetables.vinschool.edu.vn/login"
    upstream.headers = headers or {"Content-Type": "text/html; charset=utf-8"}
    upstream.content = content
    upstream.raw.headers.getlist.return_value = set_cookie or []
    return upstream


def _patch_request(monkeypatch, upstream, calls):
    def fake_request(self, method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return upstream

    monkeypatch.setattr(requests.Session, "request", fake_request)


def test_requires_configured_key(client, monkeypatch):
    monkeypatch.delenv("RELAY_KEY", raising=False)

    response = client.post("/", json=_payload(), headers={"X-Relay-Key": "secret"})

    assert response.status_code == 500
    assert response.get_json()["error"] == "relay_key_not_configured"


def test_rejects_missing_key(client):
    response = client.post("/", json=_payload())

    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"


def test_rejects_wrong_key(client):
    response = client.post("/", json=_payload(), headers={"X-Relay-Key": "wrong"})

    assert response.status_code == 401


def test_rejects_non_tool_host(client):
    response = client.post(
        "/",
        json=_payload(url="https://example.com/"),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 403
    assert response.get_json()["error"] == "target_not_allowed"


def test_rejects_disallowed_method(client):
    response = client.post(
        "/",
        json=_payload(method="DELETE"),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 405
    assert response.get_json()["error"] == "method_not_allowed"


def test_forwards_get_and_returns_response(client, monkeypatch):
    calls = []
    upstream = _upstream(
        content=b"<html>ok</html>",
        headers={
            "Content-Type": "text/html; charset=utf-8",
            "Content-Encoding": "gzip",
        },
        set_cookie=["session=abc; Path=/", "csrf=xyz; Path=/"],
    )
    _patch_request(monkeypatch, upstream, calls)

    response = client.post(
        "/",
        json=_payload(headers={
            "Accept": "text/html",
            "Host": "should-be-dropped",
            "Content-Length": "999",
            "Accept-Encoding": "gzip",
            "Cookie": "session=abc",
        }),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == 200
    assert base64.b64decode(data["body"]) == b"<html>ok</html>"
    assert data["setCookie"] == ["session=abc; Path=/", "csrf=xyz; Path=/"]
    assert "set-cookie" not in data["headers"]
    assert "content-encoding" not in data["headers"]
    assert calls[0]["method"] == "GET"
    assert calls[0]["url"] == "https://lms-lti-timetables.vinschool.edu.vn/login"
    assert calls[0]["allow_redirects"] is False
    assert calls[0]["headers"] == {"Accept": "text/html", "Cookie": "session=abc"}
    assert calls[0]["data"] is None


def test_forwards_form_body(client, monkeypatch):
    calls = []
    _patch_request(monkeypatch, _upstream(), calls)

    response = client.post(
        "/",
        json=_payload(
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body="a=b",
        ),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 200
    assert calls[0]["method"] == "POST"
    assert calls[0]["data"] == "a=b"


def test_forwards_base64_body(client, monkeypatch):
    calls = []
    _patch_request(monkeypatch, _upstream(), calls)
    encoded = base64.b64encode(b"\x00\x01").decode("ascii")

    response = client.post(
        "/",
        json=_payload(method="POST", body=encoded, bodyEncoding="base64"),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 200
    assert calls[0]["data"] == b"\x00\x01"


def test_does_not_follow_redirects(client, monkeypatch):
    calls = []
    upstream = _upstream(
        status=302,
        content=b"",
        headers={"Location": "/next", "Content-Type": "text/html"},
    )
    _patch_request(monkeypatch, upstream, calls)

    response = client.post(
        "/",
        json=_payload(),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == 302
    assert data["headers"]["location"] == "/next"
    assert calls[0]["allow_redirects"] is False


def test_returns_upstream_error_without_signed_url(client, monkeypatch):
    def fake_request(self, method, url, **kwargs):
        raise requests.ConnectionError(
            "connection failed for https://host/login?ltik=SECRET"
        )

    monkeypatch.setattr(requests.Session, "request", fake_request)

    response = client.post(
        "/",
        json=_payload(),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 502
    data = response.get_json()
    assert data["error"] == "upstream_fetch_failed"
    assert "SECRET" not in data["detail"]
    assert "https://host/login" in data["detail"]


def test_disables_environment_proxies(client, monkeypatch):
    seen = {}

    def fake_request(self, method, url, **kwargs):
        seen["trust_env"] = self.trust_env
        return _upstream()

    monkeypatch.setattr(requests.Session, "request", fake_request)

    response = client.post(
        "/",
        json=_payload(),
        headers={"X-Relay-Key": "secret"},
    )

    assert response.status_code == 200
    assert seen["trust_env"] is False


def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json() == {"ok": True}
