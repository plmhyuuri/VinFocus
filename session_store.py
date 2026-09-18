import os
import uuid
import time
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

from crypto import encrypt_token, decrypt_token

logger = logging.getLogger(__name__)

_DB_POOL: Optional[SimpleConnectionPool] = None


def init_session_store() -> None:
    global _DB_POOL
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL not set - session store disabled")
        return

    try:
        _DB_POOL = SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            dsn=database_url,
            cursor_factory=RealDictCursor,
        )
        logger.info("Session store connection pool initialized")
    except Exception as e:
        logger.error(f"Failed to initialize session store pool: {e}")
        _DB_POOL = None


def _get_conn():
    if _DB_POOL is None:
        raise RuntimeError("Session store not initialized (DATABASE_URL missing)")
    return _DB_POOL.getconn()


def _put_conn(conn):
    if _DB_POOL:
        _DB_POOL.putconn(conn)


def create_session(
    canvas_user_id: str,
    canvas_user_name: str,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
    scope: str,
) -> str:
    """Store encrypted tokens, return session_id."""
    session_id = uuid.uuid4().hex
    expires_at = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)

    enc_access = encrypt_token(access_token)
    enc_refresh = encrypt_token(refresh_token) if refresh_token else None

    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO user_sessions
            (session_id, canvas_user_id, canvas_user_name, access_token_encrypted,
             refresh_token_encrypted, token_expires_at, scope)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                session_id,
                canvas_user_id,
                canvas_user_name,
                enc_access,
                enc_refresh,
                expires_at,
                scope,
            ),
        )
        conn.commit()
        logger.info(f"Created session {session_id} for user {canvas_user_id}")
        return session_id
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to create session: {e}")
        raise
    finally:
        cur.close()
        _put_conn(conn)


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve and decrypt session. Returns None if not found or expired."""
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT session_id, canvas_user_id, canvas_user_name,
                   access_token_encrypted, refresh_token_encrypted,
                   token_expires_at, scope, created_at, updated_at, last_used_at
            FROM user_sessions
            WHERE session_id = %s AND token_expires_at > NOW()
            """,
            (session_id,),
        )
        row = cur.fetchone()
        if not row:
            return None

        access_token = decrypt_token(row["access_token_encrypted"])
        refresh_token = (
            decrypt_token(row["refresh_token_encrypted"])
            if row["refresh_token_encrypted"]
            else None
        )

        # Update last_used_at
        cur.execute(
            "UPDATE user_sessions SET last_used_at = NOW() WHERE session_id = %s",
            (session_id,),
        )
        conn.commit()

        return {
            "session_id": row["session_id"],
            "canvas_user_id": row["canvas_user_id"],
            "canvas_user_name": row["canvas_user_name"],
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_expires_at": row["token_expires_at"],
            "scope": row["scope"],
        }
    except Exception as e:
        logger.error(f"Failed to get session {session_id}: {e}")
        return None
    finally:
        cur.close()
        _put_conn(conn)


def update_session_tokens(
    session_id: str,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
) -> bool:
    """Rotate tokens on refresh. Returns True if updated."""
    expires_at = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
    enc_access = encrypt_token(access_token)
    enc_refresh = encrypt_token(refresh_token) if refresh_token else None

    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE user_sessions
            SET access_token_encrypted = %s,
                refresh_token_encrypted = %s,
                token_expires_at = %s,
                updated_at = NOW()
            WHERE session_id = %s
            """,
            (enc_access, enc_refresh, expires_at, session_id),
        )
        conn.commit()
        updated = cur.rowcount > 0
        if updated:
            logger.info(f"Rotated tokens for session {session_id}")
        return updated
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to update session tokens: {e}")
        return False
    finally:
        cur.close()
        _put_conn(conn)


def delete_session(session_id: str) -> bool:
    """Delete a session. Returns True if deleted."""
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM user_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        deleted = cur.rowcount > 0
        if deleted:
            logger.info(f"Deleted session {session_id}")
        return deleted
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to delete session: {e}")
        return False
    finally:
        cur.close()
        _put_conn(conn)


def cleanup_expired_sessions() -> int:
    """Remove expired sessions. Returns count deleted."""
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM user_sessions WHERE token_expires_at <= NOW()")
        conn.commit()
        count = cur.rowcount
        if count:
            logger.info(f"Cleaned up {count} expired sessions")
        return count
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to cleanup sessions: {e}")
        return 0
    finally:
        cur.close()
        _put_conn(conn)