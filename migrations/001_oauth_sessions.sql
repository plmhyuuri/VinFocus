-- Migration: 001_oauth_sessions.sql
-- Create user_sessions table for OAuth token storage

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
    canvas_user_id VARCHAR(100) NOT NULL,
    canvas_user_name VARCHAR(255),
    access_token_encrypted BYTEA NOT NULL,
    refresh_token_encrypted BYTEA,
    token_expires_at TIMESTAMPTZ NOT NULL,
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(token_expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_canvas_user ON user_sessions(canvas_user_id);