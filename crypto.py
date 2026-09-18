import os
import base64
from cryptography.fernet import Fernet, InvalidToken
from typing import Optional

_ENCRYPTION_KEY: Optional[bytes] = None
_FERNET: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _ENCRYPTION_KEY, _FERNET
    if _FERNET is not None:
        return _FERNET

    key_b64 = os.getenv("ENCRYPTION_KEY")
    if not key_b64:
        raise RuntimeError("ENCRYPTION_KEY environment variable not set")

    try:
        _ENCRYPTION_KEY = base64.urlsafe_b64decode(key_b64)
    except Exception as e:
        raise RuntimeError(f"Invalid ENCRYPTION_KEY (must be 32-byte base64url): {e}")

    if len(_ENCRYPTION_KEY) != 32:
        raise RuntimeError("ENCRYPTION_KEY must decode to exactly 32 bytes")

    _FERNET = Fernet(base64.urlsafe_b64encode(_ENCRYPTION_KEY))
    return _FERNET


def encrypt_token(token: str) -> bytes:
    """Encrypt a token string. Returns base64-encoded ciphertext."""
    if not token:
        raise ValueError("Cannot encrypt empty token")
    f = _get_fernet()
    return f.encrypt(token.encode())


def decrypt_token(encrypted: bytes) -> str:
    """Decrypt a token. Returns plaintext string."""
    if not encrypted:
        raise ValueError("Cannot decrypt empty ciphertext")
    f = _get_fernet()
    try:
        return f.decrypt(encrypted).decode()
    except InvalidToken as e:
        raise ValueError("Token decryption failed (invalid key or corrupted data)") from e


def generate_encryption_key() -> str:
    """Generate a new ENCRYPTION_KEY. Run once and store in environment."""
    return base64.urlsafe_b64encode(os.urandom(32)).decode()