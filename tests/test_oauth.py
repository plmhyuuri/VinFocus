import os
import pytest
from unittest.mock import patch, MagicMock

# Generate a valid 32-byte base64url key for tests
import base64
_test_key = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode()
os.environ["ENCRYPTION_KEY"] = _test_key
os.environ["CANVAS_BASE_URL"] = "https://test.canvas.example.com"
os.environ["CANVAS_CLIENT_ID"] = "test_client_id"
os.environ["CANVAS_CLIENT_SECRET"] = "test_client_secret"
os.environ["DATABASE_URL"] = "postgresql://test:test@localhost/test"
os.environ["FLASK_SECRET_KEY"] = "test_secret_key"

# Reset crypto module globals before each test
@pytest.fixture(autouse=True)
def reset_crypto():
    import crypto
    crypto._ENCRYPTION_KEY = None
    crypto._FERNET = None
    yield
    crypto._ENCRYPTION_KEY = None
    crypto._FERNET = None


class TestCrypto:
    """Tests for crypto.py encryption helpers."""

    def test_encrypt_decrypt_roundtrip(self):
        from crypto import encrypt_token, decrypt_token

        token = "test-access-token-12345"
        encrypted = encrypt_token(token)
        decrypted = decrypt_token(encrypted)
        assert decrypted == token

    def test_encrypt_decrypt_different_tokens(self):
        from crypto import encrypt_token, decrypt_token

        tokens = [
            "short",
            "a" * 100,
            "special!@#$%^&*()chars",
            "unicode: 🎉🔑🔐",
        ]
        for token in tokens:
            encrypted = encrypt_token(token)
            decrypted = decrypt_token(encrypted)
            assert decrypted == token

    def test_encrypt_empty_raises(self):
        from crypto import encrypt_token

        with pytest.raises(ValueError):
            encrypt_token("")

    def test_decrypt_empty_raises(self):
        from crypto import decrypt_token

        with pytest.raises(ValueError):
            decrypt_token(b"")

    def test_decrypt_invalid_token_raises(self):
        from crypto import decrypt_token

        with pytest.raises(ValueError):
            decrypt_token(b"invalid-ciphertext")

    def test_generate_encryption_key(self):
        from crypto import generate_encryption_key

        key = generate_encryption_key()
        assert isinstance(key, str)
        assert len(key) > 0
        # Should be valid base64url
        import base64
        decoded = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
        assert len(decoded) == 32


class TestSessionStore:
    """Tests for session_store.py (mocked DB)."""

    @patch("session_store._DB_POOL")
    def test_create_session(self, mock_pool):
        from session_store import create_session

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = None

        session_id = create_session(
            canvas_user_id="12345",
            canvas_user_name="Test User",
            access_token="access-token-abc",
            refresh_token="refresh-token-xyz",
            expires_in=3600,
            scope="url:GET|/api/v1/courses",
        )

        assert session_id is not None
        assert len(session_id) == 32  # uuid4().hex
        mock_cur.execute.assert_called()
        mock_conn.commit.assert_called()

    @patch("session_store._DB_POOL")
    def test_get_session_found(self, mock_pool):
        from session_store import get_session
        from crypto import encrypt_token

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur

        enc_access = encrypt_token("access-token-abc")
        enc_refresh = encrypt_token("refresh-token-xyz")

        from datetime import datetime, timezone, timedelta
        future = datetime.now(timezone.utc) + timedelta(hours=1)

        mock_cur.fetchone.return_value = {
            "session_id": "test-session-id",
            "canvas_user_id": "12345",
            "canvas_user_name": "Test User",
            "access_token_encrypted": enc_access,
            "refresh_token_encrypted": enc_refresh,
            "token_expires_at": future,
            "scope": "url:GET|/api/v1/courses",
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "last_used_at": datetime.now(timezone.utc),
        }

        result = get_session("test-session-id")

        assert result is not None
        assert result["canvas_user_id"] == "12345"
        assert result["access_token"] == "access-token-abc"
        assert result["refresh_token"] == "refresh-token-xyz"

    @patch("session_store._DB_POOL")
    def test_get_session_not_found(self, mock_pool):
        from session_store import get_session

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = None

        result = get_session("nonexistent-session")
        assert result is None

    @patch("session_store._DB_POOL")
    def test_get_session_expired(self, mock_pool):
        from session_store import get_session
        from crypto import encrypt_token

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur

        # For expired sessions, the SQL query "WHERE token_expires_at > NOW()" 
        # would return no rows. The mock simulates this by returning None.
        mock_cur.fetchone.return_value = None

        result = get_session("expired-session-id")
        assert result is None
        # Verify the query was executed with the session_id
        mock_cur.execute.assert_called()
        call_args = mock_cur.execute.call_args[0]
        assert "token_expires_at > NOW()" in call_args[0]

    @patch("session_store._DB_POOL")
    def test_update_session_tokens(self, mock_pool):
        from session_store import update_session_tokens

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur
        mock_cur.rowcount = 1

        result = update_session_tokens(
            "test-session-id",
            "new-access-token",
            "new-refresh-token",
            7200,
        )

        assert result is True
        mock_cur.execute.assert_called()
        mock_conn.commit.assert_called()

    @patch("session_store._DB_POOL")
    def test_delete_session(self, mock_pool):
        from session_store import delete_session

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cur
        mock_cur.rowcount = 1

        result = delete_session("test-session-id")

        assert result is True
        mock_cur.execute.assert_called_with(
            "DELETE FROM user_sessions WHERE session_id = %s",
            ("test-session-id",),
        )


class TestOAuth:
    """Tests for oauth.py (mocked Flask app and Canvas)."""

    def test_is_oauth_configured_false(self):
        from oauth import is_oauth_configured, init_oauth
        from flask import Flask

        app = Flask(__name__)
        app.config["CANVAS_CLIENT_ID"] = ""
        app.config["CANVAS_CLIENT_SECRET"] = ""
        init_oauth(app)

        with app.app_context():
            assert is_oauth_configured() is False

    def test_is_oauth_configured_true(self):
        from oauth import is_oauth_configured
        from flask import Flask

        app = Flask(__name__)
        app.config["CANVAS_CLIENT_ID"] = "test_id"
        app.config["CANVAS_CLIENT_SECRET"] = "test_secret"

        with app.app_context():
            # Need to initialize oauth first
            from oauth import init_oauth
            init_oauth(app)
            assert is_oauth_configured() is True

    def test_get_oauth_error_message(self):
        from oauth import get_oauth_error_message

        assert get_oauth_error_message("access_denied") == "Canvas authorization was cancelled."
        assert get_oauth_error_message("invalid_request") == "The Canvas authorization request was invalid."
        assert get_oauth_error_message("server_error") == "Canvas couldn't complete the authorization."
        assert get_oauth_error_message("unknown_error") == "An unknown error occurred during authorization."

    @patch("oauth.requests.get")
    def test_validate_canvas_token_valid(self, mock_get):
        from oauth import validate_canvas_token
        from flask import Flask

        app = Flask(__name__)
        app.config["CANVAS_BASE_URL"] = "https://test.canvas.example.com"

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "12345", "name": "Test User"}
        mock_get.return_value = mock_resp

        with app.app_context():
            valid, user_info = validate_canvas_token("valid-token")
            assert valid is True
            assert user_info["id"] == "12345"
            assert user_info["name"] == "Test User"

    @patch("oauth.requests.get")
    def test_validate_canvas_token_invalid(self, mock_get):
        from oauth import validate_canvas_token
        from flask import Flask

        app = Flask(__name__)
        app.config["CANVAS_BASE_URL"] = "https://test.canvas.example.com"

        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_get.return_value = mock_resp

        with app.app_context():
            valid, user_info = validate_canvas_token("invalid-token")
            assert valid is False
            assert user_info is None

    @patch("oauth.requests.get")
    def test_validate_canvas_token_network_error(self, mock_get):
        from oauth import validate_canvas_token
        from flask import Flask
        import requests

        app = Flask(__name__)
        app.config["CANVAS_BASE_URL"] = "https://test.canvas.example.com"

        mock_get.side_effect = requests.exceptions.RequestException("Connection failed")

        with app.app_context():
            valid, user_info = validate_canvas_token("any-token")
            assert valid is False
            assert user_info is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])