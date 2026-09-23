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

  // --- Email marketing (replaces Mailchimp/SendGrid; sends via Resend) -----
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
    if (!env.RESEND_API_KEY) return json({ error: "email not configured" }, 503);
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
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: "Lazynext <support@lazynext.com>",
            to: [c.email],
            subject: String(camp.subject),
            html: String(camp.html),
          }),
        });
        if (r.ok) sent++;
      } catch {}
    }
    await env.DB.prepare(
      "UPDATE email_campaigns SET status='sent', sent_count=?, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).bind(sent, id).run();
    return json({ ok: true, id, sent, total: contacts.length });
  }

  // --- E-sign (replaces DocuSign for basic signing; not ESIGN-certified) ---
  if (path === "/api/v1/sign/requests" && req.method === "GET")
    return list(env, "signature_requests");
  if (path === "/api/v1/sign/requests" && req.method === "POST") {
    if (!b.title) return json({ error: "title required" }, 400);
    return insert(env, "signature_requests",
      ["title", "doc_text", "signer_name", "signer_email"],
      [b.title, str(b.doc_text), str(b.signer_name), str(b.signer_email)]);
  }
  if (path.match(/^\/api\/v1\/sign\/requests\/\d+\/sign$/) && req.method === "POST" && id) {
    if (!b.signature_text) return json({ error: "signature_text required" }, 400);
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
    await env.DB.prepare(
      `UPDATE signature_requests SET status='signed', signature_text=?, signer_ip=?,
       signed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=?`,
    ).bind(str(b.signature_text), ip, id).run();
    return json({ ok: true, id, status: "signed" });
  }
  if (path.match(/^\/api\/v1\/sign\/requests\/\d+$/) && req.method === "GET" && id) {
    const r = await env.DB.prepare("SELECT * FROM signature_requests WHERE id=?").bind(id).first();
    return r ? json({ row: r }) : json({ error: "not found" }, 404);
  }

  return json({ error: "not found" }, 404);
}
