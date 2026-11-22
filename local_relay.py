"""Local VSC timetable relay for hosted VinFocus.

Vercel cannot reach the VSC timetable tool directly because Cloudflare blocks
its egress IPs. This relay runs on your machine and is exposed through a
Cloudflare Tunnel. The hosted app calls the tunnel; the relay calls the VSC
tool from your home IP.

Only VSC timetable tool requests are forwarded. Canvas requests stay direct in
the hosted app, so the Canvas API token never reaches this relay.

Run it with:

    RELAY_KEY=<shared-secret> RELAY_PORT=8787 python local_relay.py

Then expose it with:

    cloudflared tunnel --url http://127.0.0.1:8787
"""

import base64
import hmac
import logging
import os
import re
from typing import Any, Dict, List
from urllib.parse import urlparse, urlunparse

import requests
from flask import Flask, jsonify, request

logger = logging.getLogger("local_relay")

ALLOWED_HOST = "lms-lti-timetables.vinschool.edu.vn"
ALLOWED_METHODS = {"GET", "POST", "HEAD"}
DEFAULT_PORT = 8787
DEFAULT_TIMEOUT = 20.0

DROP_REQUEST_HEADERS = {
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "accept-encoding",
}

DROP_RESPONSE_HEADERS = {
    "content-encoding",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024


def _redact_url(url: str) -> str:
    """Keep scheme/host/path, drop credentials, query strings, and fragments."""
    parsed = urlparse(url or "")
    netloc = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse((parsed.scheme, netloc, parsed.path, "", "", ""))


def _safe_error_detail(exc: Exception) -> str:
    detail = re.sub(r"https?://[^\s)]+", lambda match: _redact_url(match.group(0)), str(exc))
    return re.sub(r"\s+", " ", detail)[:400]


def _relay_timeout() -> float:
    try:
        return float(os.getenv("RELAY_TIMEOUT", str(DEFAULT_TIMEOUT)))
    except ValueError:
        return DEFAULT_TIMEOUT


def _filter_request_headers(input_headers: Any) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not isinstance(input_headers, dict):
        return result
    for name, value in input_headers.items():
        lower = str(name).lower()
        if lower in DROP_REQUEST_HEADERS:
            continue
        if lower.startswith("cf-") or lower.startswith("x-forwarded-"):
            continue
        result[str(name)] = str(value)
    return result


def _filter_response_headers(input_headers: Any) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for name, value in input_headers.items():
        lower = str(name).lower()
        if lower in DROP_RESPONSE_HEADERS:
            continue
        result[lower] = str(value)
    return result


def _set_cookie_headers(upstream: requests.Response) -> List[str]:
    raw_headers = getattr(getattr(upstream, "raw", None), "headers", None)
    if raw_headers is not None and hasattr(raw_headers, "getlist"):
        values = raw_headers.getlist("Set-Cookie")
        if values:
            return [str(value) for value in values]
    value = upstream.headers.get("Set-Cookie")
    return [value] if value else []


def _error(message: str, status: int = 400, detail: str = ""):
    payload = {"error": message}
    if detail:
        payload["detail"] = detail
    return jsonify(payload), status


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/")
@app.post("/relay")
def relay():
    expected_key = os.getenv("RELAY_KEY", "")
    if not expected_key:
        return _error("relay_key_not_configured", 500)

    provided_key = request.headers.get("X-Relay-Key", "")
    if not hmac.compare_digest(provided_key, expected_key):
        return _error("unauthorized", 401)

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _error("invalid_json")

    target_url = str(payload.get("url") or "")
    parsed = urlparse(target_url)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        return _error("target_not_allowed", 403)

    method = str(payload.get("method") or "GET").upper()
    if method not in ALLOWED_METHODS:
        return _error("method_not_allowed", 405)

    headers = _filter_request_headers(payload.get("headers"))

    body: Any = payload.get("body")
    if method in {"GET", "HEAD"}:
        body = None
    elif payload.get("bodyEncoding") == "base64":
        try:
            body = base64.b64decode(str(body or ""))
        except (TypeError, ValueError):
            return _error("invalid_body")
    elif body is not None:
        body = str(body)

    try:
        with requests.Session() as session:
            session.trust_env = False
            upstream = session.request(
                method,
                target_url,
                headers=headers,
                data=body,
                allow_redirects=False,
                timeout=_relay_timeout(),
            )
    except requests.RequestException as exc:
        logger.warning(
            "Relay upstream failed: %s: %s",
            type(exc).__name__,
            _safe_error_detail(exc),
        )
        return _error("upstream_fetch_failed", 502, _safe_error_detail(exc))

    response_headers = _filter_response_headers(upstream.headers)
    set_cookie = _set_cookie_headers(upstream)
    encoded_body = base64.b64encode(upstream.content or b"").decode("ascii")

    logger.info(
        "Relay %s %s -> %s",
        method,
        _redact_url(target_url),
        upstream.status_code,
    )

    return jsonify({
        "status": upstream.status_code,
        "url": upstream.url,
        "headers": response_headers,
        "setCookie": set_cookie,
        "bodyEncoding": "base64",
        "body": encoded_body,
    })


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if not os.getenv("RELAY_KEY"):
        raise SystemExit(
            "RELAY_KEY is not set. Run with: RELAY_KEY=<shared-secret> python local_relay.py"
        )

    host = os.getenv("RELAY_HOST", "127.0.0.1")
    try:
        port = int(os.getenv("RELAY_PORT", str(DEFAULT_PORT)))
    except ValueError:
        port = DEFAULT_PORT

    logger.info("Local timetable relay listening on http://%s:%s", host, port)
    app.run(host=host, port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
