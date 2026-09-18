import os
import time
import logging
from typing import Optional, Tuple, Dict, Any

import requests
from authlib.integrations.flask_client import OAuth
from flask import current_app, session

from session_store import create_session

logger = logging.getLogger(__name__)

OAUTH_SCOPES = " ".join([
    "url:GET|/api/v1/courses",
    "url:GET|/api/v1/users/self",
    "url:GET|/api/v1/courses/*/modules",
    "url:GET|/api/v1/courses/*/modules/*/items",
])

OAUTH_ERROR_MESSAGES = {
    "access_denied": "Canvas authorization was cancelled.",
    "invalid_request": "The Canvas authorization request was invalid.",
    "server_error": "Canvas couldn't complete the authorization.",
    "unsupported_response_type": "Canvas OAuth configuration error.",
    "invalid_scope": "Requested scopes are not allowed.",
    "temporarily_unavailable": "Canvas is temporarily unavailable. Please try again later.",
}


oauth = OAuth()


def init_oauth(app) -> None:
    oauth.init_app(app)

    client_id = app.config.get("CANVAS_CLIENT_ID")
    client_secret = app.config.get("CANVAS_CLIENT_SECRET")
    base_url = app.config.get("CANVAS_BASE_URL", "https://lms.vinschool.edu.vn")

    if not client_id or not client_secret:
        logger.warning("Canvas OAuth not configured (missing CANVAS_CLIENT_ID/SECRET)")
        app.canvas = None
        return

    canvas = oauth.register(
        name="canvas",
        client_id=client_id,
        client_secret=client_secret,
        authorize_url=f"{base_url}/login/oauth2/auth",
        access_token_url=f"{base_url}/login/oauth2/token",
        api_base_url=f"{base_url}/api/v1/",
        client_kwargs={"scope": OAUTH_SCOPES},
        code_challenge_method="S256",
    )
    app.canvas = canvas
    logger.info("Canvas OAuth client registered")


def is_oauth_configured() -> bool:
    return current_app.canvas is not None


def validate_canvas_token(access_token: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Validate a Canvas access token against /api/v1/users/self.
    Returns (is_valid, user_info_dict_or_none).
    Used by both PAT validation endpoint and OAuth token verification.
    """
    if not access_token:
        return False, None

    base_url = current_app.config.get("CANVAS_BASE_URL", "https://lms.vinschool.edu.vn")
    url = f"{base_url}/api/v1/users/self"
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.exceptions.RequestException as e:
        logger.error(f"Token validation request failed: {e}")
        return False, None

    if resp.status_code == 200:
        return True, resp.json()
    elif resp.status_code == 401:
        logger.info("Token validation failed: 401 Unauthorized")
        return False, None
    else:
        logger.warning(f"Token validation unexpected status: {resp.status_code}")
        return False, None


def refresh_access_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """Exchange refresh token for new access token. Returns token dict or None."""
    if not current_app.canvas:
        return None

    try:
        token = current_app.canvas.fetch_access_token(
            refresh_token=refresh_token,
            grant_type="refresh_token",
        )
        return {
            "access_token": token["access_token"],
            "refresh_token": token.get("refresh_token"),
            "expires_in": token.get("expires_in", 3600),
            "scope": token.get("scope", OAUTH_SCOPES),
        }
    except Exception as e:
        logger.error(f"Token refresh failed: {e}")
        return None


def exchange_code_for_tokens(code: str, code_verifier: str) -> Optional[Dict[str, Any]]:
    """Exchange authorization code for tokens using PKCE verifier."""
    if not current_app.canvas:
        return None

    try:
        token = current_app.canvas.fetch_access_token(
            code=code,
            code_verifier=code_verifier,
            grant_type="authorization_code",
        )
        return {
            "access_token": token["access_token"],
            "refresh_token": token.get("refresh_token"),
            "expires_in": token.get("expires_in", 3600),
            "scope": token.get("scope", OAUTH_SCOPES),
        }
    except Exception as e:
        logger.error(f"Code exchange failed: {e}")
        return None


def get_oauth_error_message(error: str) -> str:
    """Map Canvas OAuth error to safe user-facing message."""
    return OAUTH_ERROR_MESSAGES.get(error, "An unknown error occurred during authorization.")