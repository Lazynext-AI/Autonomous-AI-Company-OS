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
  const id = parseInt(path.split("/").pop() ?? "", 10);

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

  return json({ error: "not found" }, 404);
}
