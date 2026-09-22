-- The tables behind the Salman.D.Life login. No passwords and no secrets are in this file:
-- it only describes the shape of the database. Run it once in Cloudflare's D1 console.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,   -- scrambled password, cannot be turned back into the password
  password_salt TEXT    NOT NULL,   -- random extra text mixed in, different for every person
  iterations    INTEGER NOT NULL DEFAULT 12000,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,   -- scrambled copy of the sign-in cookie
  user_id    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Used to slow down anyone guessing passwords over and over.
CREATE TABLE IF NOT EXISTS login_attempts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  who   TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_who ON login_attempts(who, at);
