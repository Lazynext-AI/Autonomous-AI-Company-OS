-- Native services replacing third-party SaaS: CRM, support tickets,
-- scheduling, and a storefront — all on D1. Apply with: make worker-migrate

-- CRM — leads/contacts/deals (replaces HubSpot/Salesforce/Pipedrive/Attio)
CREATE TABLE IF NOT EXISTS crm_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    company TEXT,
    status TEXT NOT NULL DEFAULT 'lead',   -- lead, qualified, customer, lost
    source TEXT,
    notes TEXT,
    value_cents INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status);

-- Support tickets (replaces Intercom/Zendesk)
CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    email TEXT,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'open',   -- open, pending, resolved, closed
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- Scheduling — bookable slots + bookings (replaces Calendly)
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    guest_name TEXT,
    guest_email TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled
    notes TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);

-- Commerce — a storefront's products + orders (replaces Shopify; checkout via Dodo)
CREATE TABLE IF NOT EXISTS store_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    dodo_product_id TEXT,                  -- link to the Dodo product for checkout
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS store_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    customer_email TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, fulfilled, refunded
    dodo_session_id TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders(status);
