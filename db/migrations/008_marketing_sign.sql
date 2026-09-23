-- Native marketing (contacts + campaigns via Resend) and e-sign (signature
-- requests) — replacing Mailchimp/SendGrid and DocuSign for basic use.

CREATE TABLE IF NOT EXISTS email_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  subscribed INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON email_contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_subscribed ON email_contacts(subscribed);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | sending | sent
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS signature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  doc_text TEXT,                          -- the agreement/body text to sign
  signer_name TEXT,
  signer_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | signed | declined
  signature_text TEXT,                    -- the typed signature
  signer_ip TEXT,
  signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sign_status ON signature_requests(status);
