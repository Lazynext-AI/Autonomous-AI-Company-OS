-- Public waitlist signups from the marketing site.
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'landing',
  created_at TEXT DEFAULT (datetime('now'))
);
