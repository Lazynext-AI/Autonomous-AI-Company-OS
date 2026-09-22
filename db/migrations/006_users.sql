-- Multi-user auth — real accounts, email verification, password reset.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT DEFAULT 'member',          -- owner | member
  email_verified INTEGER DEFAULT 0,
  verify_token TEXT,
  reset_token TEXT,
  reset_expires TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_verify ON users(verify_token);
CREATE INDEX IF NOT EXISTS idx_users_reset ON users(reset_token);
