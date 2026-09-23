/**
 * Native services replacing third-party SaaS — all on D1.
 * CRM (HubSpot/Salesforce), support tickets (Intercom/Zendesk),
 * scheduling (Calendly), and a storefront (Shopify; checkout via Dodo).
 */
import { Env, json, authorize, touchKey } from "./gateway";

async function list(env: Env, table: string, extra = ""): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} ${extra} ORDER BY id DESC LIMIT 200`,
  ).all();
  return json({ rows: results ?? [] });
}

async function insert(env: Env, table: string, cols: string[], vals: unknown[]): Promise<Response> {
  const ph = cols.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph})`,
  ).bind(...vals).run();
  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

async function update(env: Env, table: string, id: number, fields: Record<string, unknown>): Promise<Response> {
  const keys = Object.keys(fields);
  if (!keys.length) return json({ error: "no fields" }, 400);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await env.DB.prepare(
    `UPDATE ${table} SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).bind(...keys.map((k) => fields[k]), id).run();
  return json({ ok: true, id });
}

const str = (v: unknown) => (v == null ? null : String(v));

export async function handleServices(
  req: Request, env: Env, ctx: ExecutionContext, path: string,
): Promise<Response> {
  const { key, res } = await authorize(req, env, req.method === "GET" ? "read" : "write");
  if (res) return res;
  touchKey(env, ctx, key!.id);
  const b = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  // id is the last numeric segment — for ".../{id}/send" or ".../{id}/sign" the
  // id is second-to-last, not last.
  const segs = path.split("/").filter(Boolean);
  const idSeg = /^\d+$/.test(segs[segs.length - 1] ?? "") ? segs[segs.length - 1]
    : /^\d+$/.test(segs[segs.length - 2] ?? "") ? segs[segs.length - 2] : "";
  const id = parseInt(idSeg, 10);

  // --- CRM ----------------------------------------------------------------
  if (path === "/api/v1/crm/leads" && req.method === "GET")
    return list(env, "crm_leads");
  if (path === "/api/v1/crm/leads" && req.method === "POST") {
    if (!b.name) return json({ error: "name required" }, 400);
    return insert(env, "crm_leads",
      ["name", "email", "company", "status", "source", "notes", "value_cents"],
      [b.name, str(b.email), str(b.company), str(b.status) ?? "lead", str(b.source), str(b.notes), Number(b.value_cents ?? 0)]);
  }
  if (path.startsWith("/api/v1/crm/leads/") && (req.method === "PATCH" || req.method === "PUT") && id) {
    const f: Record<string, unknown> = {};
    if (b.status) f.status = b.status;
    if (b.notes) f.notes = b.notes;
    if (b.value_cents != null) f.value_cents = Number(b.value_cents);
    return update(env, "crm_leads", id, f);
  }

  // --- Support tickets ------------------------------------------------------
  if (path === "/api/v1/support/tickets" && req.method === "GET")
    return list(env, "support_tickets");
  if (path === "/api/v1/support/tickets" && req.method === "POST") {
    if (!b.subject) return json({ error: "subject required" }, 400);
    return insert(env, "support_tickets",
      ["subject", "email", "body", "status", "priority"],
      [b.subject, str(b.email), str(b.body), str(b.status) ?? "open", str(b.priority) ?? "normal"]);
  }
  if (path.startsWith("/api/v1/support/tickets/") && (req.method === "PATCH" || req.method === "PUT") && id) {
    const f: Record<string, unknown> = {};
    if (b.status) f.status = b.status;
    if (b.priority) f.priority = b.priority;
    return update(env, "support_tickets", id, f);
  }

  // --- Scheduling (bookings) ------------------------------------------------
  if (path === "/api/v1/booking" && req.method === "GET")
    return list(env, "bookings");
  if (path === "/api/v1/booking" && req.method === "POST") {
    if (!b.title || !b.starts_at || !b.ends_at)
      return json({ error: "title + starts_at + ends_at required" }, 400);
    return insert(env, "bookings",
      ["title", "guest_name", "guest_email", "starts_at", "ends_at", "notes"],
      [b.title, str(b.guest_name), str(b.guest_email), b.starts_at, b.ends_at, str(b.notes)]);
  }
  if (path.startsWith("/api/v1/booking/") && (req.method === "PATCH" || req.method === "DELETE") && id)
    return update(env, "bookings", id, { status: "cancelled" });

  // --- Storefront -----------------------------------------------------------
  if (path === "/api/v1/store/products" && req.method === "GET")
    return list(env, "store_products", "WHERE active = 1");
  if (path === "/api/v1/store/products" && req.method === "POST") {
    if (!b.name) return json({ error: "name required" }, 400);
    return insert(env, "store_products",
      ["name", "description", "price_cents", "currency", "dodo_product_id"],
      [b.name, str(b.description), Number(b.price_cents ?? 0), str(b.currency) ?? "usd", str(b.dodo_product_id)]);
  }
  if (path === "/api/v1/store/orders" && req.method === "GET")
    return list(env, "store_orders");
  if (path === "/api/v1/store/orders" && req.method === "POST") {
    if (!b.product_id) return json({ error: "product_id required" }, 400);
    return insert(env, "store_orders",
      ["product_id", "customer_email", "amount_cents", "currency", "dodo_session_id"],
      [Number(b.product_id), str(b.customer_email), Number(b.amount_cents ?? 0), str(b.currency) ?? "usd", str(b.dodo_session_id)]);
  }

  // --- Email marketing (replaces Mailchimp/SendGrid; sends via Brevo) ------
  if (path === "/api/v1/marketing/contacts" && req.method === "GET")
    return list(env, "email_contacts");
  if (path === "/api/v1/marketing/contacts" && req.method === "POST") {
    if (!b.email) return json({ error: "email required" }, 400);
    return insert(env, "email_contacts",
      ["email", "name", "subscribed", "source"],
      [str(b.email), str(b.name), b.subscribed === false ? 0 : 1, str(b.source)]);
  }
  if (path.startsWith("/api/v1/marketing/contacts/") && (req.method === "PATCH" || req.method === "PUT") && id) {
    const f: Record<string, unknown> = {};
    if (b.subscribed != null) f.subscribed = b.subscribed ? 1 : 0;
    if (b.name) f.name = b.name;
    return update(env, "email_contacts", id, f);
  }
  if (path === "/api/v1/marketing/campaigns" && req.method === "GET")
    return list(env, "email_campaigns");
  if (path === "/api/v1/marketing/campaigns" && req.method === "POST") {
    if (!b.name || !b.subject || !b.html) return json({ error: "name + subject + html required" }, 400);
    return insert(env, "email_campaigns",
      ["name", "subject", "html"],
      [b.name, b.subject, b.html]);
  }
  if (path.match(/^\/api\/v1\/marketing\/campaigns\/\d+\/send$/) && req.method === "POST" && id) {
    if (!(await brevoCred(env))) return json({ error: "brevo not connected — set it in Settings → Connector library" }, 503);
    const camp = await env.DB.prepare(
      "SELECT * FROM email_campaigns WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!camp) return json({ error: "campaign not found" }, 404);
    const { results: contacts } = await env.DB.prepare(
      "SELECT email FROM email_contacts WHERE subscribed = 1").all();
    if (!contacts?.length) return json({ error: "no subscribed contacts" }, 400);
    await update(env, "email_campaigns", id, { status: "sending" });
    let sent = 0;
    for (const c of contacts as { email: string }[]) {
      try {
        const r = await brevoSend(env, c.email, String(camp.subject), String(camp.html));
        if (r.ok) sent++;
      } catch {}
    }
    await env.DB.prepare(
      "UPDATE email_campaigns SET status='sent', sent_count=?, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).bind(sent, id).run();
    return json({ ok: true, id, sent, total: contacts.length });
  }

  // --- SignWell e-sign ------------------------------------------------------
  // The only signing path — credential lives in KV as conn:signwell (bare API
  // key from signwell.com/app → API; prefix "test:" for unlimited free
  // test-mode sends). SignWell's free plan includes a legal production API.
  if (path === "/api/v1/signwell/documents" && req.method === "GET") {
    ctx.waitUntil(ensureSignwellSecret(env));
    return signwell(env, "GET", "/documents/");
  }
  if (path === "/api/v1/signwell/send" && req.method === "POST") {
    if (!b.template_id || !b.signer_email)
      return json({ error: "template_id and signer_email required" }, 400);
    // SignWell requires each recipient's placeholder_name to match a named
    // placeholder on the template — fetch the template and map the signer to
    // the first placeholder (or an explicit placeholder_name if provided).
    const t = await signwellFetch(env, "GET", `/document_templates/${b.template_id}/`);
    if (!t.connected) return json(t, 503);
    if (!t.ok) return json({ connected: true, ...t.data }, t.status);
    const phs = ((t.data.placeholders ?? []) as { name?: string }[]);
    return signwell(env, "POST", "/document_templates/documents/", {
      template_id: String(b.template_id),
      subject: b.subject ? String(b.subject) : undefined,
      recipients: [{
        id: String(b.recipient_id ?? "1"),
        placeholder_name: String(b.placeholder_name ?? phs[0]?.name ?? "signer"),
        email: String(b.signer_email),
        name: String(b.signer_name ?? b.signer_email),
      }],
    });
  }
  if (path === "/api/v1/signwell/events" && req.method === "GET") {
    const sec = await env.EPHEMERAL.get("signwell:whsec");
    return json({
      events: JSON.parse((await env.EPHEMERAL.get("signwell:events")) ?? "[]"),
      webhook_url: sec ? `${new URL(req.url).origin}/api/v1/signwell/webhook/${sec}` : null,
    });
  }

  return json({ error: "not found" }, 404);
}

// Public receiver for SignWell webhook events (document_completed etc.).
// The secret path segment is generated once; paste the webhook URL (shown by
// GET /signwell/events) into SignWell → API → your application's webhook.
export async function handleSignwellWebhook(
  req: Request, env: Env, path: string,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const sec = path.split("/").pop() ?? "";
  const expected = await env.EPHEMERAL.get("signwell:whsec");
  if (!expected || sec !== expected) return json({ error: "forbidden" }, 403);
  const event = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const list = JSON.parse((await env.EPHEMERAL.get("signwell:events")) ?? "[]") as unknown[];
  list.unshift({ ...event, received_at: new Date().toISOString() });
  await env.EPHEMERAL.put("signwell:events", JSON.stringify(list.slice(0, 50)));
  return json({ ok: true });
}

// Generates the webhook secret once so the receiver URL is stable — SignWell
// webhooks are configured in their app, not via API, so we just expose the URL.
async function ensureSignwellSecret(env: Env): Promise<void> {
  const cred = await env.EPHEMERAL.get("conn:signwell");
  if (!cred || (await env.EPHEMERAL.get("signwell:whsec"))) return;
  await env.EPHEMERAL.put("signwell:whsec", crypto.randomUUID());
}

// --- Transactional + campaign email (Brevo — the only email path) ----------
// Credential lives in KV as conn:brevo in "sender@domain.com:api_key" form
// (bare key → support@lazynext.com sender), falling back to the
// BREVO_API_KEY worker secret. Free tier: 300 emails/day.
async function brevoCred(env: Env): Promise<{ from: string; key: string } | null> {
  const cred = (await env.EPHEMERAL.get("conn:brevo")) ?? env.BREVO_API_KEY;
  if (!cred) return null;
  const i = cred.lastIndexOf(":");
  const maybeFrom = i > 0 ? cred.slice(0, i) : "";
  return maybeFrom.includes("@")
    ? { from: maybeFrom, key: cred.slice(i + 1) }
    : { from: "support@lazynext.com", key: cred };
}

export async function brevoSend(
  env: Env, to: string, subject: string, html: string, name?: string,
): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const cred = await brevoCred(env);
  if (!cred)
    return { ok: false, status: 503, error: "brevo not connected — set it in Settings → Connector library" };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": cred.key, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { email: cred.from, name: "Lazynext" },
      to: [{ email: to, ...(name ? { name } : {}) }],
      subject,
      htmlContent: html,
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { messageId?: string; message?: string };
  return { ok: r.ok, status: r.status, messageId: d.messageId, error: d.message };
}

// Reads conn:signwell from KV (bare API key; "test:" prefix → test_mode sends
// are free, unlimited and not legally binding), then calls the SignWell API.
// Returns {connected:false} when no credential is set.
async function signwellFetch(
  env: Env, method: string, endpoint: string, body?: Record<string, unknown>,
): Promise<{ connected: boolean; ok: boolean; status: number; data: Record<string, unknown> }> {
  const cred = await env.EPHEMERAL.get("conn:signwell");
  if (!cred) return { connected: false, ok: false, status: 503, data: { error: "signwell not connected — set it in Settings → Connector library" } };
  const test = cred.startsWith("test:");
  const key = test ? cred.slice(5) : cred;
  if (test && body) body = { ...body, test_mode: true };
  const r = await fetch(`https://www.signwell.com/api/v1${endpoint}`, {
    method,
    headers: { "X-Api-Key": key, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { connected: true, ok: r.ok, status: r.status, data };
}

async function signwell(
  env: Env, method: string, endpoint: string, body?: Record<string, unknown>,
): Promise<Response> {
  const r = await signwellFetch(env, method, endpoint, body);
  if (!r.connected) return json({ connected: false, ...r.data }, 503);
  return json({ connected: true, ok: r.ok, status: r.status, ...r.data }, r.ok ? 200 : r.status);
}
