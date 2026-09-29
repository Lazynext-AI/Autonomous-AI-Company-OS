/**
 * Native services replacing third-party SaaS — all on D1.
 * CRM (HubSpot/Salesforce), support tickets (Intercom/Zendesk),
 * scheduling (Calendly), and a storefront (Shopify; checkout via Dodo).
 */
import { Env, json, authorize, touchKey, listAll } from "./gateway";
import { publishToBus } from "./webhooks";

// Media library — the Postiz piece the native scheduler lacked. Bytes live
// in R2 (media/{id}) when the MEDIA binding is bound — video-capable up to
// 64MB — else KV at media:{id} (25MiB value max; capped 5MB). Metadata stays
// at media:{id}:meta either way so the list route is store-agnostic. The
// public /media/:id route in index.ts serves them so external platforms can
// fetch media payloads server-side when publishing (Instagram/Pinterest
// require an image_url; TikTok/YouTube require video — KV was too small).
const MEDIA_TYPES_IMG = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const MEDIA_TYPES_VIDEO = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MEDIA_MAX_KV = 5 * 1024 * 1024;
const MEDIA_MAX_R2 = 64 * 1024 * 1024; // b64 request body still fits the 100MB worker limit
const MEDIA_BASE = "https://ai-company.lazynext.com";

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

// Campaign audience routing. 'subscribed' broadcasts to opted-in
// email_contacts (the default, and the only pre-existing behavior);
// 'engaged' targets crm_leads the Brevo click→engaged promotion pipeline
// flagged, so a warm follow-up can go to clickers only instead of the
// whole cold list. Unsub suppression still applies on top of either.
export function campaignSegment(segment: unknown): { seg: string; sql?: string; error?: string } {
  const seg = (typeof segment === "string" && segment.trim()) || "subscribed";
  if (seg === "subscribed")
    return { seg, sql: "SELECT email FROM email_contacts WHERE subscribed = 1" };
  if (seg === "engaged")
    return { seg, sql: "SELECT email FROM crm_leads WHERE status = 'engaged'" };
  return { seg, error: `unknown segment '${seg}' (subscribed|engaged)` };
}

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
  // Agent reply → real email to the ticket's sender. The subject re-carries
  // the [#id] tag so the customer's reply threads back via inbound parse
  // (same contract the auto-ack uses). This sends company-branded mail, so
  // it is admin-scoped like connector dispatch — a plain 'write' key minted
  // for CRM work must not be able to email our customers.
  if (/^\/api\/v1\/support\/tickets\/\d+\/reply$/.test(path) && req.method === "POST" && id) {
    if (!(key!.scopes ?? "").split(",").map((s) => s.trim()).includes("admin"))
      return json({ error: "scope 'admin' required — ticket replies send company-branded email" }, 403);
    const body = str(b.body);
    if (!body) return json({ error: "body required" }, 400);
    const t = await env.DB.prepare(
      "SELECT email, subject FROM support_tickets WHERE id = ?",
    ).bind(id).first<{ email: string; subject: string }>();
    if (!t) return json({ error: "ticket not found" }, 404);
    const subject = `Re: ${t.subject.replace(/\s*\[#\d+\]/g, "").trim().slice(0, 100)} [#${id}]`;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sent = await brevoSend(
      env, t.email, subject,
      `<p>${esc(body).replace(/\n/g, "<br>")}</p><p style="color:#888;font-size:12px">Ticket #${id} — reply to this email to continue the thread.</p>`,
      undefined, undefined, `ticket:${id}`);
    if (!sent.ok) return json({ error: sent.error ?? "send failed" }, 502);
    await env.DB.prepare(
      "UPDATE support_tickets SET body = substr(body || '\n\n--- agent reply ' || datetime('now') || ' ---\n' || ?, 1, 20000), status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).bind(body, id).run();
    return json({ ok: true, ticket: id, messageId: sent.messageId });
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
    const s = campaignSegment(b.segment);
    if (s.error) return json({ error: s.error }, 400);
    return insert(env, "email_campaigns",
      ["name", "subject", "html", "segment"],
      [b.name, b.subject, b.html, s.seg]);
  }
  if (path.match(/^\/api\/v1\/marketing\/campaigns\/\d+\/send$/) && req.method === "POST" && id) {
    if (!(await brevoCred(env))) return json({ error: "brevo not connected — set it in Settings → Connector library" }, 503);
    const camp = await env.DB.prepare(
      "SELECT * FROM email_campaigns WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!camp) return json({ error: "campaign not found" }, 404);
    // Send-time body segment overrides the stored one; the stored default
    // is 'subscribed'. A draft created for a warm audience can't drift into
    // a cold blast unless the operator says so explicitly.
    const s = campaignSegment(b.segment ?? camp.segment);
    if (s.error) return json({ error: s.error }, 400);
    const { results: contacts } = await env.DB.prepare(s.sql!).all();
    if (!contacts?.length) return json({ error: `no recipients in segment '${s.seg}'` }, 400);
    await update(env, "email_campaigns", id, { status: "sending" });
    let sent = 0;
    for (const c of contacts as { email: string }[]) {
      if (await env.EPHEMERAL.get(`unsub:${c.email.toLowerCase()}`)) continue;
      try {
        const r = await brevoSend(
          env, c.email, String(camp.subject),
          String(camp.html) + await marketingFooter(env, c.email),
          undefined, await unsubHeaders(env, c.email), `campaign:${id}`);
        if (r.ok) sent++;
      } catch {}
    }
    await env.DB.prepare(
      "UPDATE email_campaigns SET status='sent', sent_count=?, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).bind(sent, id).run();
    return json({ ok: true, id, sent, total: contacts.length, segment: s.seg });
  }
  // Engagement roll-up over email_events — every Brevo transactional webhook
  // callback lands there, tagged by the send path (campaign:<id>, seq:<stage>,
  // ticket:<id>, trial:reminder, monitor:alert, manual). Unique recipients
  // dedup repeated opens by the same address.
  if (path === "/api/v1/marketing/stats" && req.method === "GET") {
    const { results: totals } = await env.DB.prepare(
      "SELECT event, COUNT(*) c, COUNT(DISTINCT email) uniq FROM email_events GROUP BY event",
    ).all();
    const { results: byTag } = await env.DB.prepare(
      "SELECT COALESCE(tag,'(untagged)') tag, event, COUNT(*) c, COUNT(DISTINCT email) uniq FROM email_events GROUP BY tag, event ORDER BY tag, event",
    ).all();
    const { results: recent } = await env.DB.prepare(
      "SELECT event, email, tag, ts_epoch, link, created_at FROM email_events ORDER BY id DESC LIMIT 20",
    ).all();
    return json({ totals, by_tag: byTag, recent });
  }

  // --- Connector invocation -------------------------------------------------
  // Worker-side dispatch for the Connector library — Settings → Connector
  // library writes conn:<id> to KV; core/tools/connectors.py mirrors this for
  // the local fleet. Nothing runs until a credential is connected.
  if (path === "/api/v1/connectors" && req.method === "GET") {
    const status: Record<string, boolean> = {};
    // brevo reports actual send capability (conn:brevo OR BREVO_API_KEY
    // secret), not just whether the connector-library key exists.
    for (const id of CONNECTOR_IDS)
      status[id] = id === "brevo" ? Boolean(await brevoCred(env)) : Boolean(await connCred(env, id));
    return json({ connectors: status });
  }
  const connMatch = path.match(/^\/api\/v1\/connectors\/([a-z]+)$/);
  if (connMatch && req.method === "POST") {
    const id = connMatch[1];
    if (!CONNECTOR_IDS.includes(id)) return json({ error: `unknown connector '${id}'` }, 404);
    // Dispatch acts AS the company on external networks (post to our X,
    // send Brevo mail via our verified sender to any address). An ordinary
    // 'write' key minted for CRM/store work must not get that — admin only.
    if (!(key!.scopes ?? "").split(",").map((s) => s.trim()).includes("admin"))
      return json({ error: "scope 'admin' required — connector dispatch acts as the company" }, 403);
    // brevoSend resolves conn:brevo then the BREVO_API_KEY secret — the
    // connector is "connected" whenever either exists.
    const cred = await connCred(env, id);
    if (!cred && !(id === "brevo" && (await brevoCred(env))))
      return json({ error: `'${id}' not connected — set it in Settings → Connector library` }, 503);
    const out = await callConnector(env, id, cred ?? "", b);
    ctx.waitUntil(
      env.DB.prepare("INSERT INTO episodic_events (scope, payload) VALUES ('connector', ?)")
        .bind(JSON.stringify({ id, ok: out.ok, status: out.status })).run().catch(() => undefined),
    );
    return json(out, out.ok ? 200 : out.status ?? 502);
  }

  // --- Social scheduler (Postiz replacement) --------------------------------
  // Postiz's core job — queue a post, publish it at time T — runs natively
  // here: D1 `social_posts` + cron dispatch through callConnector, no 20Gi
  // self-host. Postiz's other value (OAuth UX, media library, analytics UI)
  // is already covered by the conn:* credential library + agent pipeline.
  // Scheduling IS acting-as-the-company → same admin rule as direct dispatch.
  if (path === "/api/v1/social/posts" && req.method === "POST") {
    if (!(key!.scopes ?? "").split(",").map((s) => s.trim()).includes("admin"))
      return json({ error: "scope 'admin' required — scheduled posts publish as the company" }, 403);
    const id = String(b.connector ?? "").toLowerCase();
    if (!CONNECTOR_IDS.includes(id)) return json({ error: `unknown connector '${id}'` }, 400);
    const payload: Record<string, unknown> = { text: String(b.text ?? "").slice(0, 10000) };
    for (const k of ["image_url", "to", "subject", "title", "body", "visibility", "share_now"])
      if (b[k] !== undefined) payload[k] = b[k];
    if (!payload.text && !b.to) return json({ error: "text (or a to/subject pair) required" }, 400);
    const runAt = b.at ? Date.parse(String(b.at)) : Date.now();
    if (!Number.isFinite(runAt)) return json({ error: "at must be an ISO-8601 timestamp" }, 400);
    const r = await env.DB.prepare(
      "INSERT INTO social_posts (connector, payload, run_at, status, attempts, created_at) VALUES (?, ?, ?, 'queued', 0, ?)",
    ).bind(id, JSON.stringify(payload), runAt, Date.now()).run();
    // Queue hot path — second-precision delivery for run_at ≤ 12h; the cron
    // sweep enqueues anything this misses (far-future or failed send).
    ctx.waitUntil(queueSocialPost(env, Number(r.meta.last_row_id), runAt));
    return json({ id: r.meta.last_row_id, connector: id, run_at: runAt, status: "queued" }, 201);
  }
  if (path === "/api/v1/social/posts" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, connector, payload, run_at, status, attempts, last_error, created_at, posted_at FROM social_posts ORDER BY id DESC LIMIT 100",
    ).all();
    return json({ posts: results });
  }
  const postDel = path.match(/^\/api\/v1\/social\/posts\/(\d+)$/);
  if (postDel && req.method === "DELETE") {
    if (!(key!.scopes ?? "").split(",").map((s) => s.trim()).includes("admin"))
      return json({ error: "scope 'admin' required" }, 403);
    const r = await env.DB.prepare(
      "UPDATE social_posts SET status = 'cancelled' WHERE id = ? AND status = 'queued'",
    ).bind(Number(postDel[1])).run();
    return r.meta.changes
      ? json({ cancelled: true, id: Number(postDel[1]) })
      : json({ error: "post not queued or already dispatched" }, 404);
  }

  // --- Media library --------------------------------------------------------
  // Upload needs 'write' (it only stores bytes — publishing still requires
  // the admin scope on /social/posts); list reads; delete writes.
  if (path === "/api/v1/media" && req.method === "POST") {
    const type = String(b.type ?? "").toLowerCase();
    const isVideo = MEDIA_TYPES_VIDEO.has(type);
    if (!MEDIA_TYPES_IMG.has(type) && !isVideo)
      return json({ error: `unsupported type '${type}' — png, jpeg, webp, gif, avif${env.MEDIA ? ", mp4, mov or webm" : ""}` }, 400);
    if (isVideo && !env.MEDIA)
      return json({ error: "video uploads need R2 media storage — not bound on this deploy" }, 400);
    const dataB64 = String(b.data_b64 ?? "");
    if (!dataB64) return json({ error: "data_b64 required" }, 400);
    const maxBytes = env.MEDIA ? MEDIA_MAX_R2 : MEDIA_MAX_KV;
    if (dataB64.length > Math.ceil((maxBytes * 4) / 3) + 64)
      return json({ error: `file too large (${Math.round(maxBytes / 1048576)}MB max)` }, 413);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "data_b64 is not valid base64" }, 400);
    }
    if (!bytes.length || bytes.length > maxBytes)
      return json({ error: bytes.length ? `file too large (${Math.round(maxBytes / 1048576)}MB max)` : "empty file" }, bytes.length ? 413 : 400);
    const id = crypto.randomUUID();
    const name = String(b.name ?? "").slice(0, 200) || id;
    if (env.MEDIA) {
      await env.MEDIA.put(`media/${id}`, bytes, { httpMetadata: { contentType: type } });
    } else {
      await env.EPHEMERAL.put(`media:${id}`, bytes);
    }
    await env.EPHEMERAL.put(`media:${id}:meta`, JSON.stringify({ name, type, size: bytes.length, created: Date.now(), store: env.MEDIA ? "r2" : "kv" }));
    return json({ id, name, type, size: bytes.length, url: `${MEDIA_BASE}/media/${id}` }, 201);
  }
  if (path === "/api/v1/media" && req.method === "GET") {
    const keys = await listAll(env.EPHEMERAL, "media:");
    const items: Record<string, unknown>[] = [];
    for (const k of keys) {
      if (!k.name.endsWith(":meta")) continue;
      const raw = await env.EPHEMERAL.get(k.name);
      if (!raw) continue;
      try {
        const id = k.name.slice(6, -5);
        items.push({ id, url: `${MEDIA_BASE}/media/${id}`, ...(JSON.parse(raw) as object) });
      } catch {}
    }
    return json({ media: items.sort((a, z) => Number((z as { created?: number }).created ?? 0) - Number((a as { created?: number }).created ?? 0)) });
  }
  const mediaDel = path.match(/^\/api\/v1\/media\/([0-9a-f-]{36})$/);
  if (mediaDel && req.method === "DELETE") {
    await env.MEDIA?.delete(`media/${mediaDel[1]}`);
    await env.EPHEMERAL.delete(`media:${mediaDel[1]}`);
    await env.EPHEMERAL.delete(`media:${mediaDel[1]}:meta`);
    return json({ deleted: true, id: mediaDel[1] });
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
    const r = await signwellSendFromTemplate(env, {
      template_id: String(b.template_id),
      signer_email: String(b.signer_email),
      signer_name: b.signer_name ? String(b.signer_name) : undefined,
      subject: b.subject ? String(b.subject) : undefined,
      recipient_id: b.recipient_id ? String(b.recipient_id) : undefined,
      placeholder_name: b.placeholder_name ? String(b.placeholder_name) : undefined,
    });
    if (!r.connected) return json({ connected: false, ...r.data }, 503);
    return json({ connected: true, ok: r.ok, status: r.status, ...r.data }, r.ok ? 200 : r.status);
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
  headers?: Record<string, string>, tag?: string,
): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const cred = await brevoCred(env);
  if (!cred)
    return { ok: false, status: 503, error: "brevo not connected — set it in Settings → Connector library" };
  // config:inbound_addr (e.g. support@reply.lazynext.com) routes every reply
  // through Brevo inbound parse → tickets. Left unset until the receiving
  // subdomain's MX records exist — setting it early would blackhole replies.
  const inboundAddr = (await env.EPHEMERAL.get("config:inbound_addr")) ?? undefined;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": cred.key, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { email: cred.from, name: "Lazynext" },
      to: [{ email: to, ...(name ? { name } : {}) }],
      subject,
      htmlContent: html,
      ...(headers ? { headers } : {}),
      // tags echo back on every transactional webhook event — the only way a
      // delivered/opened/click event can be attributed to the campaign,
      // sequence stage, or ticket that minted the send.
      ...(tag ? { tags: [tag] } : {}),
      ...(inboundAddr ? { replyTo: { email: inboundAddr, name: "Lazynext Support" } } : {}),
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { messageId?: string; message?: string };
  return { ok: r.ok, status: r.status, messageId: d.messageId, error: d.message };
}

// Hard-blacklist a recipient in Brevo itself (PUT /v3/contacts/{email}) so a
// suppressed address can't be mailed even if our own KV/D1 flags are missed.
// Brevo rejects SMTP sends to blacklisted contacts before they hit the wire.
export async function brevoBlacklist(
  env: Env, email: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const cred = await brevoCred(env);
  if (!cred) return { ok: false, status: 503, error: "brevo not connected" };
  const r = await fetch(
    `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
    {
      method: "PUT",
      headers: { "api-key": cred.key, "content-type": "application/json" },
      body: JSON.stringify({ emailBlacklisted: true }),
    },
  );
  const d = (await r.json().catch(() => ({}))) as { message?: string };
  return { ok: r.ok || r.status === 204, status: r.status, error: d.message };
}

// Add/update a Brevo contact — lead capture for product outbound.
export async function brevoAddContact(
  env: Env, email: string, attrs?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const cred = await brevoCred(env);
  if (!cred)
    return { ok: false, status: 503, error: "brevo not connected" };
  const r = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": cred.key, "content-type": "application/json" },
    body: JSON.stringify({ email, updateEnabled: true, attributes: attrs ?? {} }),
  });
  const d = (await r.json().catch(() => ({}))) as { message?: string };
  return { ok: r.ok || r.status === 204, status: r.status, error: d.message };
}

// --- Marketing-email unsubscribe (CAN-SPAM / GDPR / RFC 8058) ----------------
// Every marketing send (lead sequence + campaigns) carries an HMAC-signed
// per-recipient unsubscribe link. Signing key is API_TOKEN — the product
// worker's PLATFORM_TOKEN holds the same secret, so checker.lazynext.com's
// public /unsubscribe route can verify links this worker minted. A wrong or
// missing sig means the link can't silence anyone but its real recipient.
export async function unsubSig(env: Env, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.API_TOKEN ?? ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function unsubUrl(env: Env, email: string): Promise<string> {
  return `https://checker.lazynext.com/unsubscribe?email=${
    encodeURIComponent(email.toLowerCase())}&sig=${await unsubSig(env, email)}`;
}

// Footer appended to marketing html — opt-out mechanism + why-they-got-it
// disclosure + sender identity/physical postal address (CAN-SPAM). The
// address comes from the COMPANY_ADDRESS worker secret or KV
// config:company_address — ops sets the real value, we never invent one.
// Transactional mail (confirm/verify/reset/report/alerts/trial notices) is
// exempt and deliberately does NOT get this.
export async function marketingFooter(env: Env, email: string): Promise<string> {
  const url = await unsubUrl(env, email);
  const addr = env.COMPANY_ADDRESS ??
    await env.EPHEMERAL.get("config:company_address");
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#64748b;line-height:1.5">You're receiving ` +
    `this because you signed up at Accessibility Checker for product updates ` +
    `and a discount code. <a href="${url}">Unsubscribe</a> anytime — these ` +
    `emails stop immediately.<br>Lazynext${addr ? ` · ${addr}` : ""}</p>`;
}

// List-Unsubscribe headers give mail clients a native unsubscribe affordance;
// the Post header is RFC 8058 one-click (Gmail/Yahoo bulk-sender requirement).
// Precedence: bulk classifies the mail so providers treat it as bulk (auto-
// responders suppress replies, filters bucket it correctly).
export async function unsubHeaders(
  env: Env, email: string,
): Promise<Record<string, string>> {
  return {
    "List-Unsubscribe": `<${await unsubUrl(env, email)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Precedence": "bulk",
  };
}

// Single mutation path for every unsubscribe surface: KV suppression flag
// (sequence/campaign loops check it), D1 opt-out (campaign recipient query),
// and the Brevo-side blacklist (last-resort wire block). Idempotent.
export async function unsubscribeEmail(env: Env, email: string): Promise<void> {
  email = email.toLowerCase();
  await env.EPHEMERAL.put(`unsub:${email}`, "1", { expirationTtl: 31_536_000 });
  await env.DB.prepare(
    "UPDATE email_contacts SET subscribed = 0 WHERE email = ?").bind(email).run();
  await brevoBlacklist(env, email).catch(() => {});
}

// --- Lead enrollment + Pro conversion sequence -----------------------------
// Shared intake for every lead-capture surface (/leads, /api/v1/waitlist):
// suppression check -> KV lead records -> Brevo contact -> sequence email 1
// immediately -> stage stamp -> bus event. The daily advanceLeadSequence
// sweep sends emails 2 and 3 at +3d/+7d.
// Sequence drafted by sales_1 (marketing/pro_sequence.md): email 1 at
// capture, email 2 at +3d, email 3 at +7d.
export const CHECKOUT_URL = "https://checker.lazynext.com/checkout";
export const SEQUENCE = [
  {
    subject: "Unlock full accessibility scanning — your discount inside",
    html: `<p>Thanks for trying Accessibility Checker — you ran a real rendered-page WCAG scan.</p><p><b>Pro ($9/mo)</b> removes the 3-scans-a-day limit: unlimited rendered scans, site-wide crawls, daily monitoring with alerts, and reports delivered to your inbox. It starts with a 14-day free trial (card up front, cancel any time).</p><p>As promised — <b>20% off</b> your subscription: use code <b>WELCOME20</b> at checkout.</p><p><a href="${CHECKOUT_URL}">Start your free trial →</a></p>`,
  },
  {
    subject: "What teams fix first after their first scan",
    html: `<p>The most common issues our rendered scans surface: missing landmarks, keyboard-inaccessible pages, and contrast that looks fine in the stylesheet but fails once CSS actually paints.</p><p>Pro runs unlimited scans — iterate on fixes and watch your score climb. Your <b>WELCOME20</b> code still works for 20% off.</p><p><a href="${CHECKOUT_URL}">Go Pro →</a></p>`,
  },
  {
    subject: "Last call: unlimited scans for $9/mo",
    html: `<p>Your free tier is capped at 3 rendered scans a day. Pro is $9/month, cancels anytime, and every report is shareable with your team.</p><p>Last reminder — <b>WELCOME20</b> takes 20% off: <a href="${CHECKOUT_URL}">start your 14-day free trial →</a></p>`,
  },
];
export const SEQ_DAYS = [0, 3, 7];

export async function enrollLead(
  env: Env, email: string, source = "unknown",
): Promise<{ ok: boolean; suppressed?: boolean; brevo?: boolean; seq_sent?: boolean }> {
  email = email.toLowerCase();
  // Suppressed addresses don't get re-added — an unsubscribe survives a
  // fresh capture (opt-out beats a new signup until the recipient
  // explicitly re-opts-in through support).
  if (await env.EPHEMERAL.get(`unsub:${email}`)) return { ok: true, suppressed: true };
  const existing = await env.EPHEMERAL.get(`lead:${email}:stage`);
  await env.EPHEMERAL.put(`lead:${email}`, source, { expirationTtl: 31_536_000 });
  // Mirror into email_contacts — the campaign send loop reads subscribed
  // rows from this table; without it leads never become broadcast
  // recipients. WHERE NOT EXISTS keeps a prior row (and its subscribed
  // state) intact. Suppressed addresses already early-returned above.
  await env.DB.prepare(
    "INSERT INTO email_contacts (email, subscribed, source) SELECT ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM email_contacts WHERE email = ?)",
  ).bind(email, source, email).run();
  const br = await brevoAddContact(env, email, { SOURCE: source });
  let sent = false;
  if (!existing) {
    await env.EPHEMERAL.put(`lead:${email}:joined`, String(Date.now()), { expirationTtl: 31_536_000 });
    const s = await brevoSend(env, email, SEQUENCE[0].subject,
      SEQUENCE[0].html + await marketingFooter(env, email),
      undefined, await unsubHeaders(env, email), "seq:0");
    sent = s.ok;
    await env.EPHEMERAL.put(`lead:${email}:stage`, s.ok ? "1" : "0", { expirationTtl: 31_536_000 });
  }
  await env.DB.prepare(
    "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('leads.events', ?, datetime('now'))",
  ).bind(JSON.stringify({ email, source, brevo: br.ok, seq_sent: sent })).run();
  return { ok: true, brevo: br.ok, seq_sent: sent };
}

// --- Brevo inbound event webhook ------------------------------------------
// Closes the deliverability loop: when a recipient hits "Report spam", an
// address hard-bounces, or Brevo marks it blocked/invalid, Brevo POSTs the
// event here and we run the SAME suppression as our own unsubscribe — KV
// flag + D1 opt-out + Brevo blacklist. Path secret (brevo:webhook_secret in
// KV) is the auth: Brevo sends no credentials, so the URL itself is the
// credential. Soft bounces/deferrals are transient and deliberately ignored.
// NOTE on event names: the *registration* enum uses camelCase ("hardBounce",
// "invalid") but the actual POST payloads carry snake_case values
// ("hard_bounce", "invalid_email") — so we normalize before matching.
const BREVO_SUPPRESS_EVENTS = new Set([
  "spam", "complaint", "hardbounce", "invalidemail", "invalid",
  "blocked", "unsubscribed",
]);

// Lead promotion from raw Brevo events — click is the only high-intent
// signal worth acting on (opens are Apple-MPP inflated). Returns the
// crm_leads notes stamp or null. The stamp mirrors the format ops used when
// this ran manually ("clicked-trial:<date>"), so old and new rows read the
// same; non-trial links get plain "clicked:<date>".
export function leadEngagement(
  ev: { event?: string; link?: string | null }, date?: string,
): string | null {
  const name = (ev.event ?? "").toLowerCase().replace(/[_-]/g, "");
  if (name !== "click") return null;
  const day = (date ?? new Date().toISOString()).slice(0, 10);
  return /trial|checkout/i.test(ev.link ?? "")
    ? `clicked-trial:${day}` : `clicked:${day}`;
}

export async function handleBrevoWebhook(
  req: Request, env: Env, path: string,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const sec = path.split("/").pop() ?? "";
  const expected = await env.EPHEMERAL.get("brevo:webhook_secret");
  if (!expected || sec !== expected) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as
    { event?: string; email?: string; tag?: string; tags?: string[] | string;
      ts_epoch?: number; link?: string;
      events?: { event?: string; email?: string; tag?: string; tags?: string[] | string;
        ts_epoch?: number; link?: string }[] }
    | { event?: string; email?: string; tag?: string; tags?: string[] | string;
        ts_epoch?: number; link?: string }[];
  // Brevo sends one object per event; a `batched` webhook (not enabled today)
  // would deliver an array or {events:[...]} — handle all shapes.
  const events: { event?: string; email?: string; tag?: string;
    tags?: string[] | string; ts_epoch?: number; link?: string }[] =
    Array.isArray(body)
      ? body
      : Array.isArray(body?.events) ? body.events : [body];
  const list = JSON.parse(
    (await env.EPHEMERAL.get("brevo:events")) ?? "[]") as unknown[];
  let suppressedAny = false;
  for (const ev of events) {
    const email = (ev.email ?? "").trim().toLowerCase();
    const name = (ev.event ?? "").toLowerCase().replace(/[_-]/g, "");
    const suppress = BREVO_SUPPRESS_EVENTS.has(name) && email.includes("@");
    if (suppress) { await unsubscribeEmail(env, email); suppressedAny = true; }
    // Engagement log — suppress events land here too, so email_events is the
    // single queryable record of every Brevo callback (deliverability AND
    // engagement). tag comes from brevoSend's tags[] — campaign:<id>,
    // seq:<stage>, ticket:<id>, trial:reminder, monitor:alert, manual.
    const tag = ev.tag
      ?? (Array.isArray(ev.tags) ? ev.tags[0] : ev.tags) ?? null;
    await env.DB.prepare(
      "INSERT INTO email_events (event, email, tag, ts_epoch, link) VALUES (?, ?, ?, ?, ?)",
    ).bind(ev.event ?? "unknown", email || null, tag,
      typeof ev.ts_epoch === "number" ? ev.ts_epoch : null,
      ev.link ?? null).run().catch(() => {});
    // Clickers are hot leads — promote them in crm_leads so the funnel +
    // briefings see engagement without a manual stamp. Guarded so a late
    // click can't demote a converted/customer/unsubscribed row and a second
    // click on the same lead doesn't double-stamp the notes.
    const stamp = email ? leadEngagement(ev) : null;
    if (stamp) {
      const promoted = await env.DB.prepare(
        "UPDATE crm_leads SET status='engaged', "
        + "notes = COALESCE(notes,'') || ? WHERE email = ? "
        + "AND status NOT IN ('engaged','customer','converted',"
        + "'disqualified','unsubscribed')",
      ).bind(` | ${stamp}`, email).run().catch(() => null);
      if (promoted?.meta?.changes) {
        await env.DB.prepare(
          "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('leads.events', ?, datetime('now'))",
        ).bind(JSON.stringify({
          type: "lead_engaged", email, stamp, tag,
          link: ev.link ?? null,
        })).run().catch(() => {});
      }
    }
    list.unshift({ event: ev.event, email, tag, suppressed: suppress,
      received_at: new Date().toISOString() });
  }
  await env.EPHEMERAL.put("brevo:events", JSON.stringify(list.slice(0, 50)));
  return json({ ok: true, suppressed: suppressedAny });
}

// --- Brevo inbound parse → support tickets -----------------------------------
// A dedicated receiving subdomain (e.g. reply.lazynext.com, MX →
// inbound1/2.sendinblue.com) delivers every parsed message to this webhook as
// {items:[...]}. New mail → new ticket + ONE ack carrying [#id]; a reply whose
// subject carries [#id] appends to that ticket and gets NO ack — that asymmetry
// is what keeps the ack loop bounded. Path secret is the same
// brevo:webhook_secret as /brevo/events/.
type InboundParsed = {
  id: string | null;
  from: string;
  subject: string;
  body: string;
  auto: boolean;
  spamScore: number;
  ticketRef: number | null;
};

export function parseInboundItem(item: Record<string, unknown>): InboundParsed {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const pick = (o: unknown, ...ks: string[]) => {
    const r = (o ?? {}) as Record<string, unknown>;
    for (const k of ks) {
      const v = str(r[k]).trim();
      if (v) return v;
    }
    return "";
  };
  const from = pick(item.From, "Address", "address", "Email", "email")
    || pick(item, "From", "from", "Sender", "sender");
  const subject = pick(item, "Subject", "subject");
  const html = pick(item, "RawHtmlBody", "HtmlBody", "rawHtmlBody");
  const body = (
    pick(item, "ExtractedMarkdownMessage", "extractedMarkdownMessage")
    || pick(item, "RawTextBody", "TextBody", "rawTextBody")
    || html.replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim().slice(0, 8000);
  const headers = (() => {
    const h = item.Headers ?? item.headers;
    const out: Record<string, string> = {};
    if (Array.isArray(h))
      for (const e of h) {
        const n = String((e as Record<string, unknown>)?.Name ?? (e as Record<string, unknown>)?.name ?? "").toLowerCase();
        const v = String((e as Record<string, unknown>)?.Value ?? (e as Record<string, unknown>)?.value ?? "");
        if (n) out[n] = v;
      }
    else if (h && typeof h === "object")
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k.toLowerCase()] = String(v);
    return out;
  })();
  const auto =
    /mailer[-_.]?daemon|postmaster|no[-_.]?reply|donotreply|bounce/i.test(from)
    || (!!headers["auto-submitted"] && headers["auto-submitted"] !== "no")
    || /^(bulk|list|junk)$/i.test(headers["precedence"] ?? "");
  const ref = /\[#(\d{1,9})\]/.exec(subject);
  const rawSpam = item.SpamScore ?? item.spamScore;
  return {
    id: pick(item, "MessageId", "messageId", "Uuid", "uuid") || null,
    from: from.toLowerCase(),
    subject: subject.slice(0, 200),
    body,
    auto,
    spamScore: typeof rawSpam === "number" && isFinite(rawSpam) ? rawSpam : Number(rawSpam) || 0,
    ticketRef: ref ? Number(ref[1]) : null,
  };
}

export function classifyInbound(p: InboundParsed): { action: "skip" | "thread" | "ticket"; priority: string } {
  if (!p.from.includes("@") || p.auto) return { action: "skip", priority: "normal" };
  if (p.ticketRef != null) return { action: "thread", priority: "normal" };
  return { action: "ticket", priority: p.spamScore >= 5 ? "low" : "normal" };
}

export async function handleBrevoInbound(
  req: Request, env: Env, ctx: ExecutionContext, path: string,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const sec = path.split("/").pop() ?? "";
  const expected = await env.EPHEMERAL.get("brevo:webhook_secret");
  if (!expected || sec !== expected) return json({ error: "forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const items = Array.isArray(body?.items)
    ? (body.items as Record<string, unknown>[])
    : body && typeof body === "object" && (body.Subject || body.From) ? [body] : [];
  let processed = 0;
  const results: Record<string, unknown>[] = [];
  for (const raw of items.slice(0, 50)) {
    const p = parseInboundItem(raw);
    const d = classifyInbound(p);
    if (d.action === "skip") { results.push({ from: p.from, skipped: true }); continue; }
    // Dedup before the write: Brevo retries a non-2xx webhook, so an
    // at-least-once delivery must not mint duplicate tickets.
    if (p.id) {
      const seen = `brevo:inseen:${p.id}`;
      if (await env.EPHEMERAL.get(seen)) { results.push({ from: p.from, duplicate: true }); continue; }
      await env.EPHEMERAL.put(seen, "1", { expirationTtl: 172800 });
    }
    let ticketId: number | null = p.ticketRef;
    if (d.action === "thread" && ticketId != null) {
      const hit = await env.DB.prepare("SELECT id FROM support_tickets WHERE id = ?")
        .bind(ticketId).first<{ id: number }>().catch(() => null);
      if (hit) {
        await env.DB.prepare(
          "UPDATE support_tickets SET body = substr(body || '\n\n--- reply ' || datetime('now') || ' ---\n' || ?, 1, 20000), status = 'open', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        ).bind(p.body, ticketId).run();
      } else ticketId = null;
    }
    if (ticketId == null) {
      const res = await env.DB.prepare(
        "INSERT INTO support_tickets (subject, email, body, status, priority) VALUES (?, ?, ?, 'open', ?)",
      ).bind(p.subject || "(no subject)", p.from, p.body, d.priority).run();
      ticketId = Number(res.meta.last_row_id);
      // One ack, carrying the thread tag — a reply to it lands in the
      // thread branch and gets no ack of its own. Reply-To routing into the
      // inbound domain only happens once config:inbound_addr is set.
      await brevoSend(
        env, p.from,
        `Re: ${p.subject.slice(0, 120) || "your message"} [#${ticketId}]`,
        `<p>Thanks for writing in — this is ticket <b>#${ticketId}</b>. An agent is on it; replying to this email adds to the thread.</p>`,
        undefined, undefined, `ticket:${ticketId}`,
      );
    }
    processed++;
    results.push({ from: p.from, ticket: ticketId, threaded: d.action === "thread" });
    await publishToBus(
      env, ctx, "support.inbound",
      JSON.stringify({ from: p.from, subject: p.subject, ticket_id: ticketId, threaded: d.action === "thread" }),
    ).catch(() => {});
  }
  return json({ ok: true, processed, results });
}
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

// Send a template document for signature — shared by /api/v1/signwell/send and
// the billing activation hook (config:signwell_template). SignWell requires
// each recipient's placeholder_name to match a named placeholder on the
// template, so the template is fetched and the signer maps to the first
// placeholder unless an explicit placeholder_name is given.
export async function signwellSendFromTemplate(
  env: Env,
  opts: {
    template_id: string; signer_email: string; signer_name?: string;
    subject?: string; recipient_id?: string; placeholder_name?: string;
  },
): Promise<{ connected: boolean; ok: boolean; status: number; data: Record<string, unknown> }> {
  const t = await signwellFetch(env, "GET", `/document_templates/${opts.template_id}/`);
  if (!t.connected || !t.ok) return t;
  const phs = ((t.data.placeholders ?? []) as { name?: string }[]);
  return signwellFetch(env, "POST", "/document_templates/documents/", {
    template_id: String(opts.template_id),
    subject: opts.subject,
    recipients: [{
      id: String(opts.recipient_id ?? "1"),
      placeholder_name: String(opts.placeholder_name ?? phs[0]?.name ?? "signer"),
      email: String(opts.signer_email),
      name: String(opts.signer_name ?? opts.signer_email),
    }],
  });
}

// --- Connector dispatch -------------------------------------------------------
// The ids the dashboard Connector library offers. brevo/signwell have their own
// dedicated routes but still report status here; POST dispatch covers the
// connectors that have no other invocation path.
export const CONNECTOR_IDS = [
  "x", "linkedin", "meta", "facebook", "instagram", "threads",
  "bluesky", "mastodon", "reddit", "pinterest", "vk",
  "youtube", "tiktok", "gmb", "snapchat",
  "discord", "slack", "telegram", "matrix",
  "teams", "mattermost", "zulip", "viber", "line",
  "devto", "hashnode", "medium", "wordpress", "github", "gitlab",
  "tumblr", "ghost", "beehiiv", "lemmy", "listmonk", "nostr",
  "webhook", "ayrshare", "postiz", "buffer", "letmepost",
  "twilio", "whatsapp",
  "brevo", "signwell",
];

// KV conn:<id> first — the dashboard write path is the runtime source of
// truth — then a CONN_<ID> worker secret as static fallback. The local fleet
// (core/tools/connectors.py) deliberately resolves the other way (env → KV)
// so a local override wins on the dev host; each order suits its runtime.
async function connCred(env: Env, id: string): Promise<string | null> {
  return (await env.EPHEMERAL.get(`conn:${id}`))
    ?? ((env as unknown as Record<string, unknown>)[`CONN_${id.toUpperCase()}`] as string | undefined)
    ?? null;
}

async function connPost(
  url: string, init: RequestInit,
): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
  const r = await fetch(url, init);
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, body: data,
    error: r.ok ? undefined : String(data.message ?? data.error ?? r.status) };
}

// Worker-side mirror of connectors.py's _DISPATCH. Social connectors take
// {text}; messaging connectors take {to, text}; brevo takes {to, subject, html}.
async function callConnector(
  env: Env, id: string, cred: string, b: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const text = String(b.text ?? "").slice(0, 10000);
  switch (id) {
    case "x": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      return connPost("https://api.x.com/2/tweets", {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    }
    case "linkedin": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>" or "<access_token>:<author>" where author is a
      // full urn ("urn:li:person:x" from the OAuth flow, "urn:li:organization:x")
      // or a bare numeric org id. Urns contain colons, so split on the FIRST.
      const i = cred.indexOf(":");
      const token = i === -1 ? cred : cred.slice(0, i);
      const suffix = i === -1 ? "" : cred.slice(i + 1);
      const author = suffix.startsWith("urn:") ? suffix : `urn:li:organization:${suffix || "lazynext"}`;
      // Posts API (the ugcPosts replacement) — versioned, requires the
      // Linkedin-Version pin + Rest.li protocol header.
      return connPost("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`, "content-type": "application/json",
          "x-restli-protocol-version": "2.0.0", "linkedin-version": "202609",
        },
        body: JSON.stringify({
          author,
          commentary: text,
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
        }),
      });
    }
    case "meta": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<ad_account_id>"
      const [token, acct = ""] = cred.split(":", 2);
      if (!acct) return { ok: false, status: 500, error: "conn:meta must be '<access_token>:<ad_account_id>'" };
      return connPost(`https://graph.facebook.com/v25.0/act_${acct}/ads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: text.slice(0, 120), access_token: token }),
      });
    }
    case "twilio": {
      // cred: "<account_sid>:<auth_token>:<from_number>"
      const [sid = "", token = "", from = ""] = cred.split(":", 3);
      const to = String(b.to ?? "");
      if (!to || !text) return { ok: false, status: 400, error: "to + text required" };
      if (!sid || !token || !from)
        return { ok: false, status: 500, error: "conn:twilio must be '<account_sid>:<auth_token>:<from_number>'" };
      return connPost(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }).toString(),
      });
    }
    case "whatsapp": {
      // cred: "<access_token>:<phone_number_id>"
      const [token, pid = ""] = cred.split(":", 2);
      const to = String(b.to ?? "");
      if (!to || !text) return { ok: false, status: 400, error: "to + text required" };
      if (!pid) return { ok: false, status: 500, error: "conn:whatsapp must be '<access_token>:<phone_number_id>'" };
      return connPost(`https://graph.facebook.com/v25.0/${pid}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "text", text: { body: text },
        }),
      });
    }
    case "facebook": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<page_access_token>:<page_id>" — organic Page post (unpaid reach,
      // unlike conn:meta which is the paid Ads API).
      const [token, page = ""] = cred.split(":", 2);
      if (!page) return { ok: false, status: 500, error: "conn:facebook must be '<page_access_token>:<page_id>'" };
      return connPost(`https://graph.facebook.com/v25.0/${page}/feed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, access_token: token }),
      });
    }
    case "instagram": {
      // cred: "<access_token>:<ig_user_id>" — IG can only publish media:
      // payload needs {text: caption, image_url: <public https image>}.
      const [token, uid = ""] = cred.split(":", 2);
      const image = String(b.image_url ?? "");
      if (!uid || !image)
        return { ok: false, status: 400, error: "instagram requires image_url in payload — IG has no text-only posts" };
      const c = await connPost(`https://graph.facebook.com/v25.0/${uid}/media`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_url: image, caption: text, access_token: token }),
      });
      if (!c.ok) return c;
      const cid = (c.body as { id?: string }).id;
      return connPost(`https://graph.facebook.com/v25.0/${uid}/media_publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creation_id: cid, access_token: token }),
      });
    }
    case "threads": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<threads_user_id>" — create container, then publish.
      const [token, uid = ""] = cred.split(":", 2);
      if (!uid) return { ok: false, status: 500, error: "conn:threads must be '<access_token>:<threads_user_id>'" };
      const c = await connPost(`https://graph.threads.net/v1.0/${uid}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_type: "TEXT", text, access_token: token }),
      });
      if (!c.ok) return c;
      const cid = (c.body as { id?: string }).id;
      return connPost(`https://graph.threads.net/v1.0/${uid}/threads_publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creation_id: cid, access_token: token }),
      });
    }
    case "bluesky": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<handle.bsky.social>:<app_password>" — session token then post.
      const [handle, appPw = ""] = cred.split(":", 2);
      const sess = await connPost("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: handle, password: appPw }),
      });
      if (!sess.ok) return sess;
      const s = (sess.body ?? {}) as { accessJwt?: string; did?: string };
      return connPost("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
        method: "POST",
        headers: { authorization: `Bearer ${s.accessJwt}`, "content-type": "application/json" },
        body: JSON.stringify({
          repo: s.did, collection: "app.bsky.feed.post",
          record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() },
        }),
      });
    }
    case "mastodon": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<instance_host>:<access_token>" — host without scheme.
      const [host, token = ""] = cred.split(":", 2);
      if (!host || !token)
        return { ok: false, status: 500, error: "conn:mastodon must be '<instance_host>:<access_token>'" };
      return connPost(`https://${host}/api/v1/statuses`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ status: text, visibility: "public" }),
      });
    }
    case "reddit": {
      // cred: "<client_id>:<client_secret>:<username>:<password>:<subreddit>" —
      // script-app OAuth, then self-post. Payload 'to' overrides the subreddit,
      // 'body' overrides the post body (text is the title).
      const parts = cred.split(":");
      if (parts.length < 5)
        return { ok: false, status: 500, error: "conn:reddit must be '<client_id>:<client_secret>:<username>:<password>:<subreddit>'" };
      const [cid, secret, user, pass, sr] = parts;
      if (!text) return { ok: false, status: 400, error: "text required" };
      const tok = await connPost("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${cid}:${secret}`)}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "lazynext/1.0",
        },
        body: new URLSearchParams({ grant_type: "password", username: user, password: pass }).toString(),
      });
      if (!tok.ok) return tok;
      const at = ((tok.body ?? {}) as { access_token?: string }).access_token;
      return connPost("https://oauth.reddit.com/api/submit", {
        method: "POST",
        headers: {
          authorization: `Bearer ${at}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "lazynext/1.0",
        },
        body: new URLSearchParams({
          sr: String(b.to ?? sr), title: text.slice(0, 300),
          text: String(b.body ?? text), kind: "self", api_type: "json",
        }).toString(),
      });
    }
    case "pinterest": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<board_id>" — every pin requires media, so
      // image_url is mandatory (a bare link pin 400s at Pinterest).
      const [token, board = ""] = cred.split(":", 2);
      const image = String(b.image_url ?? "");
      if (!board) return { ok: false, status: 500, error: "conn:pinterest must be '<access_token>:<board_id>'" };
      if (!image) return { ok: false, status: 400, error: "pinterest requires image_url — every pin needs media_source" };
      const link = String(b.link ?? "https://checker.lazynext.com");
      return connPost("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          board_id: board, title: text.slice(0, 100), description: text, link,
          media_source: { source_type: "image_url", url: image },
        }),
      });
    }
    case "vk": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<owner_id>" — vk.com/dev standalone app token;
      // owner_id negative for communities ('-123456' posts to the group
      // wall), positive for a user wall.
      const [token, owner = ""] = cred.split(":", 2);
      if (!owner) return { ok: false, status: 500, error: "conn:vk must be '<access_token>:<owner_id>'" };
      return connPost("https://api.vk.com/method/wall.post", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: token, owner_id: owner, message: text,
          from_group: owner.startsWith("-") ? "1" : "0", v: "5.199",
        }).toString(),
      });
    }
    case "discord": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: full channel webhook URL — no app review needed.
      return connPost(cred, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
    }
    case "slack": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: full incoming-webhook URL.
      return connPost(cred, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    }
    case "telegram": {
      // cred: "<bot_token>:<chat_id>" — bot must be admin/member of the chat.
      const [token, chat = ""] = cred.split(":", 2);
      if (!text) return { ok: false, status: 400, error: "text required" };
      if (!chat) return { ok: false, status: 500, error: "conn:telegram must be '<bot_token>:<chat_id>'" };
      return connPost(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
      });
    }
    case "matrix": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<homeserver_base>|<room_id>|<access_token>" — room_id looks like
      // !abc:matrix.org, so '|' separates (the parts carry their own ':').
      const [hs, room = "", tok = ""] = cred.split("|");
      if (!hs || !room || !tok)
        return { ok: false, status: 500, error: "conn:matrix must be '<homeserver_base>|<room_id>|<access_token>'" };
      return connPost(
        `${hs.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${Date.now()}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
          body: JSON.stringify({ msgtype: "m.text", body: text }),
        },
      );
    }
    case "teams": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: Power Automate Workflows webhook URL — Teams channel → ⋯ →
      // Workflows → "Post to a channel when a webhook request is received".
      // Office 365 connector webhooks (*.webhook.office.com) were retired
      // May-2026; the workflow trigger accepts the Adaptive Card envelope.
      if (!cred.startsWith("https://"))
        return { ok: false, status: 500, error: "conn:teams must be a Power Automate webhook URL (*.api.powerplatform.com)" };
      return connPost(cred, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "message",
          attachments: [{
            contentType: "application/vnd.microsoft.card.adaptive",
            contentUrl: null,
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard", version: "1.2",
              body: [{ type: "TextBlock", text, wrap: true }],
            },
          }],
        }),
      });
    }
    case "mattermost": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: full incoming-webhook URL — Mattermost → Integrations →
      // Incoming Webhooks (…/hooks/<id>). Payload 'username'/'icon_url'
      // override sender.
      if (!cred.startsWith("https://"))
        return { ok: false, status: 500, error: "conn:mattermost must be an https:// incoming-webhook URL" };
      return connPost(cred, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          ...(b.username ? { username: String(b.username) } : {}),
          ...(b.icon_url ? { icon_url: String(b.icon_url) } : {}),
        }),
      });
    }
    case "zulip": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<base_url>|<bot_email>|<api_key>" — Zulip → Settings → Bots →
      // zuliprc (bot email + key). Payload 'to' = stream name, 'topic' =
      // thread.
      const [base, email = "", key = ""] = cred.split("|");
      if (!base || !email || !key)
        return { ok: false, status: 500, error: "conn:zulip must be '<base_url>|<bot_email>|<api_key>'" };
      const stream = String(b.to ?? "");
      if (!stream) return { ok: false, status: 400, error: "zulip needs payload.to — the stream name" };
      return connPost(`${base.replace(/\/+$/, "")}/api/v1/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${email}:${key}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          type: "stream", to: stream,
          topic: String(b.topic ?? "Lazynext"), content: text,
        }).toString(),
      });
    }
    case "viber": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<auth_token>" — partners.viber.com bot account token. Payload
      // 'broadcast_list' (≤300 subscribed user ids) → broadcast to all
      // (needs Viber approval); payload 'to' → send_message to one
      // subscriber.
      const sender = { name: String(b.sender ?? "Lazynext") };
      const bl = b.broadcast_list as string[] | undefined;
      const body = Array.isArray(bl) && bl.length
        ? { broadcast_list: bl, min_api_version: 7, sender, type: "text", text }
        : { receiver: String(b.to ?? ""), min_api_version: 7, sender, type: "text", text, tracking_data: "lazynext" };
      return connPost(`https://chatapi.viber.com/pa/${Array.isArray(bl) && bl.length ? "broadcast_message" : "send_message"}`, {
        method: "POST",
        headers: { "x-viber-auth-token": cred, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    case "line": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<channel_access_token>" — LINE Developers console → Messaging
      // API channel → long-lived token. Broadcasts to every friend of the
      // Official Account.
      return connPost("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ type: "text", text }] }),
      });
    }
    case "devto": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>" — dev.to → Settings → Extensions → DEV API Keys.
      // Payload 'title' overrides the default (first line); 'draft: true'
      // publishes silently for review instead of going live.
      return connPost("https://dev.to/api/articles", {
        method: "POST",
        headers: { "api-key": cred, "content-type": "application/json" },
        body: JSON.stringify({
          article: {
            title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
            body_markdown: text,
            published: b.draft !== true,
            tags: (b.tags as string[]) ?? ["webdev"],
          },
        }),
      });
    }
    case "hashnode": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<token>:<publication_id>" — hashnode.com → Account → Developer.
      const [token, pub = ""] = cred.split(":", 2);
      if (!pub) return { ok: false, status: 500, error: "conn:hashnode must be '<token>:<publication_id>'" };
      return connPost("https://gql.hashnode.com/", {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify({
          query: "mutation($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }",
          variables: {
            input: {
              title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
              contentMarkdown: text,
              publicationId: pub,
            },
          },
        }),
      });
    }
    case "medium": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<integration_token>" — medium.com → Settings → Integration
      // tokens. Medium's API is officially unsupported (no new integrations)
      // but integration tokens still work — treat as best-effort.
      // /v1/me resolves the user id at call time so the cred stays one value.
      const me = await connPost("https://api.medium.com/v1/me", {
        method: "GET",
        headers: { authorization: `Bearer ${cred}` },
      });
      if (!me.ok) return me;
      const uid = ((me.body ?? {}) as { data?: { id?: string } }).data?.id;
      if (!uid) return { ok: false, status: 500, error: "medium /v1/me returned no user id" };
      return connPost(`https://api.medium.com/v1/users/${uid}/posts`, {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
          contentFormat: "markdown", content: text, publishStatus: "public",
        }),
      });
    }
    case "wordpress": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<site_base>|<username>|<app_password>" — '|' because site_base
      // carries its own ':' (https://…). App passwords: WP Admin → Users →
      // Profile → Application Passwords (needs WP ≥5.6).
      const [site, user = "", app = ""] = cred.split("|");
      if (!site || !user || !app)
        return { ok: false, status: 500, error: "conn:wordpress must be '<site_base>|<username>|<app_password>'" };
      return connPost(`${site.replace(/\/+$/, "")}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${user}:${app}`)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
          content: text, status: "publish",
        }),
      });
    }
    case "github": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<pat>" — posts a public gist; the same PAT powers repo ops.
      return connPost("https://api.github.com/gists", {
        method: "POST",
        headers: {
          authorization: `Bearer ${cred}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          public: true,
          description: String(b.title ?? "Lazynext"),
          files: { "post.md": { content: text } },
        }),
      });
    }
    case "gitlab": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<pat>" (gitlab.com) or "<host>:<pat>" — PAT needs 'api' scope.
      const [first, maybeTok] = cred.split(":", 2);
      const host = maybeTok ? first : "gitlab.com";
      const tok = maybeTok || first;
      return connPost(`https://${host}/api/v4/snippets`, {
        method: "POST",
        headers: { "private-token": tok, "content-type": "application/json" },
        body: JSON.stringify({
          title: String(b.title ?? "Lazynext post"), visibility: "public",
          files: [{ file_path: "post.md", content: text }],
        }),
      });
    }
    case "tumblr": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<blog_name>" — tumblr.com/oauth app → OAuth2
      // token; blog_name is the tumblog subdomain ('lazynext' →
      // lazynext.tumblr.com). Posts in NPF: a single text content block.
      const [token, blog = ""] = cred.split(":", 2);
      if (!blog) return { ok: false, status: 500, error: "conn:tumblr must be '<access_token>:<blog_name>'" };
      return connPost(`https://api.tumblr.com/v2/blog/${blog}/posts`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ content: [{ type: "text", text }] }),
      });
    }
    case "ghost": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<site_base>|<key_id>:<secret_hex>" — Ghost Admin → Settings →
      // Integrations → custom integration (key shown as '<id>:<secret>').
      // We mint a 5-min HS256 JWT (kid = key id, aud '/admin/'); '?source=html'
      // converts the html field into the post body.
      const [site, key = ""] = cred.split("|");
      const [kid, secret = ""] = key.split(":");
      if (!site || !kid || !secret)
        return { ok: false, status: 500, error: "conn:ghost must be '<site_base>|<key_id>:<secret_hex>'" };
      const b64 = (input: string | ArrayBuffer): string => {
        const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
        let s = "";
        for (const c of bytes) s += String.fromCharCode(c);
        return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };
      const now = Math.floor(Date.now() / 1000);
      const signingInput = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT", kid }))}.${b64(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }))}`;
      const secretBytes = new Uint8Array((secret.match(/../g) ?? []).map((h) => parseInt(h, 16)));
      const ck = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", ck, new TextEncoder().encode(signingInput));
      return connPost(`${site.replace(/\/+$/, "")}/ghost/api/admin/posts/?source=html`, {
        method: "POST",
        headers: { authorization: `Ghost ${signingInput}.${b64(sig)}`, "content-type": "application/json" },
        body: JSON.stringify({
          posts: [{
            title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
            html: text, status: "published",
          }],
        }),
      });
    }
    case "beehiiv": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>:<publication_id>" — beehiiv → Settings → API
      // ('pub_…' id). Create-post is a Max/Enterprise endpoint; since
      // Aug-2026 it must carry status:'confirmed' to publish immediately.
      const [key, pub = ""] = cred.split(":", 2);
      if (!pub) return { ok: false, status: 500, error: "conn:beehiiv must be '<api_key>:<publication_id>'" };
      return connPost(`https://api.beehiiv.com/v2/publications/${pub}/posts`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: String(b.title ?? text.split("\n")[0].slice(0, 100)),
          status: "confirmed", content: { free_web: text },
        }),
      });
    }
    case "webhook": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<url>" or "<url>|<bearer>" — generic outbound bridge to
      // Zapier/Make/n8n/IFTTT/Pabbly, which fan out to every other network.
      const [url, bearer = ""] = cred.split("|");
      if (!url.startsWith("https://"))
        return { ok: false, status: 500, error: "conn:webhook must be an https:// url (|bearer optional)" };
      return connPost(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({
          text, source: "lazynext", ts: Date.now(),
          ...(typeof b.payload === "object" && b.payload !== null ? { payload: b.payload } : {}),
        }),
      });
    }
    case "ayrshare": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>" — ayrshare.com dashboard → API Key. One call fans
      // out to every linked network — incl. TikTok, YouTube, Snapchat and
      // GMB, which have no sane direct posting API. Omit 'platforms' to post
      // to all linked networks ("all" is not a documented platform value).
      return connPost("https://api.ayrshare.com/api/post", {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({
          post: text,
          ...(b.platforms ? { platforms: b.platforms as string[] } : {}),
        }),
      });
    }
    case "postiz": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>|<integration_id>[|<base_url>]" — Postiz → Settings →
      // Public API key; integration (= channel) ids from GET …/public/v1/
      // integrations. base_url defaults to cloud; self-hosted is
      // '<domain>/api'. The auth header takes the raw key — no Bearer prefix.
      const [key, integ = "", baseRaw = ""] = cred.split("|");
      if (!integ)
        return { ok: false, status: 500, error: "conn:postiz must be '<api_key>|<integration_id>[|<base_url>]'" };
      const base = (baseRaw || "https://api.postiz.com").replace(/\/+$/, "");
      // Every platform validates a settings.__type — resolve the
      // integration's provider so a bare text post passes schema checks
      // where possible.
      let provider = "";
      const il = await connPost(`${base}/public/v1/integrations`, {
        method: "GET", headers: { authorization: key },
      });
      if (il.ok) {
        const list = Array.isArray(il.body)
          ? (il.body as { id?: unknown; identifier?: string; provider?: string }[])
          : (((il.body as { integrations?: unknown[] })?.integrations ?? []) as { id?: unknown; identifier?: string; provider?: string }[]);
        for (const i of list)
          if (String(i.id) === integ) { provider = i.identifier ?? i.provider ?? ""; break; }
      }
      return connPost(`${base}/public/v1/posts`, {
        method: "POST",
        headers: { authorization: key, "content-type": "application/json" },
        body: JSON.stringify({
          type: "now", date: new Date().toISOString(), shortLink: false, tags: [],
          posts: [{
            integration: { id: integ },
            value: [{ content: text, image: [] }],
            settings: (b.settings as object) ?? (provider ? { __type: provider } : {}),
          }],
        }),
      });
    }
    case "buffer": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>:<channel_id>" — buffer.com → Settings → API key;
      // the channel id is in the channel's dashboard URL. GraphQL createPost
      // lands in the channel queue; payload 'share_now': true publishes
      // immediately.
      const [key, chan = ""] = cred.split(":", 2);
      if (!chan) return { ok: false, status: 500, error: "conn:buffer must be '<api_key>:<channel_id>'" };
      return connPost("https://api.buffer.com", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: "mutation($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }",
          variables: {
            input: {
              text, channelId: chan, schedulingType: "automatic",
              mode: b.share_now === true ? "shareNow" : "addToQueue",
            },
          },
        }),
      });
    }
    case "letmepost": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<api_key>|<account_ids_csv>[|<base_url>]" — letmepost.dev API
      // key; account ids from GET /v1/accounts. Base defaults to the hosted
      // API; self-hosted image takes '<domain>'. The key value: their
      // reviewed app-of-record posts to X/Bluesky/Pinterest today and
      // Meta/LinkedIn/TikTok as their platform reviews clear — no per-
      // platform developer approval needed on our side.
      const [key, accts = "", baseRaw = ""] = cred.split("|");
      if (!accts)
        return { ok: false, status: 500, error: "conn:letmepost must be '<api_key>|<account_ids>[|<base_url>]'" };
      const base = (baseRaw || "https://api.letmepost.dev").replace(/\/+$/, "");
      return connPost(`${base}/v1/posts`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          account_ids: accts.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
    }
    case "youtube": {
      // cred: "<access_token>" — video upload only; YouTube has no text-post
      // API. Resumable upload: init returns the upload URL in `location`.
      const media = String(b.media_url ?? "");
      if (!media) return { ok: false, status: 400, error: "youtube requires media_url — no text/community posts via API" };
      const init = await fetch("https://upload.youtube.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable", {
        method: "POST",
        headers: { authorization: `Bearer ${cred.split(":")[0]}`, "content-type": "application/json" },
        body: JSON.stringify({
          snippet: { title: (text || "Lazynext").slice(0, 100), description: String(b.body ?? text) },
          status: { privacyStatus: String(b.privacy ?? "public") },
        }),
      });
      const loc = init.headers.get("location");
      if (!init.ok || !loc) {
        const errBody = await init.text().catch(() => "");
        return { ok: false, status: init.status, error: `upload init failed: ${errBody.slice(0, 200)}` };
      }
      const vid = await fetch(media);
      if (!vid.ok || !vid.body) return { ok: false, status: 400, error: `media_url not fetchable (${vid.status})` };
      const up = await fetch(loc, {
        method: "PUT",
        headers: { "content-type": vid.headers.get("content-type") ?? "video/mp4" },
        body: vid.body,
      });
      const ud = (await up.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: up.ok, status: up.status, body: ud,
        error: up.ok ? undefined : String(((ud as { error?: { message?: string } }).error?.message) ?? up.status) };
    }
    case "tiktok": {
      // cred: "<access_token>" — PULL_FROM_URL lets TikTok fetch the video
      // itself; the video_url domain/prefix must be verified in the dev app
      // (else url_ownership_unverified). privacy_level is required for
      // direct post — unaudited apps may only post SELF_ONLY.
      const media = String(b.media_url ?? "");
      if (!media) return { ok: false, status: 400, error: "tiktok requires media_url (video) — no text posts via API" };
      return connPost("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: { authorization: `Bearer ${cred.split(":")[0]}`, "content-type": "application/json" },
        body: JSON.stringify({
          post_info: {
            title: (text || "Lazynext").slice(0, 150),
            privacy_level: String(b.privacy ?? "SELF_ONLY"),
          },
          source_info: { source: "PULL_FROM_URL", video_url: media },
        }),
      });
    }
    case "gmb": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<accounts/{a}/locations/{l}>" — Google Business
      // Profile local post (the "update" card on the listing).
      const [token, loc = ""] = cred.split(":", 2);
      if (!loc) return { ok: false, status: 500, error: "conn:gmb must be '<access_token>:<accounts/{a}/locations/{l}>'" };
      return connPost(`https://mybusiness.googleapis.com/v4/${loc}/localPosts`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          languageCode: "en", summary: text, topicType: "STANDARD",
          callToAction: { actionType: "LEARN_MORE", url: String(b.link ?? "https://lazynext.com") },
        }),
      });
    }
    case "lemmy": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<instance_base>|<username>|<password>" — password login per
      // call keeps the flat-cred contract (jwt rotates per login anyway).
      // Payload 'to' = community_id, 'body' = post body.
      const [inst = "", user = "", pass = ""] = cred.split("|");
      if (!inst || !user || !pass)
        return { ok: false, status: 500, error: "conn:lemmy must be '<instance_base>|<username>|<password>'" };
      const base = inst.replace(/\/+$/, "");
      const login = await connPost(`${base}/api/v3/user/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username_or_email: user, password: pass }),
      });
      const jwt = (login.body as { jwt?: string } | undefined)?.jwt;
      if (!login.ok || !jwt) return { ok: false, status: login.status ?? 401, error: "lemmy login failed" };
      return connPost(`${base}/api/v3/post`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          name: text.slice(0, 200), body: String(b.body ?? text),
          community_id: Number(b.to ?? 0) || undefined, auth: jwt,
        }),
      });
    }
    case "listmonk": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<base_url>|<user>|<pass>|<list_id>" — creates a draft campaign
      // (send:false) for review before broadcast.
      const [bs = "", user = "", pass = "", list = ""] = cred.split("|");
      if (!bs || !list)
        return { ok: false, status: 500, error: "conn:listmonk must be '<base_url>|<user>|<pass>|<list_id>'" };
      return connPost(`${bs.replace(/\/+$/, "")}/api/campaigns`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`${user}:${pass}`)}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: text.slice(0, 80), subject: String(b.subject ?? text.slice(0, 80)),
          lists: [Number(list)], type: "regular", content_type: "html",
          body: String(b.body ?? text), send_later: false,
        }),
      });
    }
    case "snapchat":
      return { ok: false, status: 400, error: "snapchat has no organic-post API — Marketing API is ads-only; use meta for ads" };
    case "nostr":
      return { ok: false, status: 400, error: "nostr publishes over relay websockets, not REST — no write endpoint to call from a Worker" };
    case "brevo": {
      const to = String(b.to ?? "");
      if (!to) return { ok: false, status: 400, error: "to required" };
      return brevoSend(env, to, String(b.subject ?? "Lazynext"), String(b.html ?? text),
        undefined, undefined, "connector:brevo");
    }
    case "signwell":
      return { ok: false, status: 400, error: "use /api/v1/signwell/send for signing" };
    default:
      return { ok: false, error: `unknown connector '${id}'` };
  }
}

// --- Scheduled-post dispatch ------------------------------------------------
// Queue-backed publisher for /api/v1/social/posts. D1 `social_posts` is the
// source of truth; Cloudflare Queue `social-posts` is the delivery layer:
//   - each insert sends {post_id} with delaySeconds (second-precision vs the
//     old ±10min cron latency) when run_at is inside Queues' 12h window
//   - the queue consumer claims + dispatches each message (index.ts `queue()`)
//   - the cron sweep enqueues any due 'queued' row — the cold path for
//     run_at > 12h and the safety net for a lost producer send
//   - transient failures requeue via run_at backoff; the sweep re-enqueues
// Claim-then-send: the UPDATE … WHERE status='queued' claim is atomic in D1,
// so at-least-once queue delivery + duplicate cron enqueues can never
// double-post (the second claimant's `changes` is 0).
const SOCIAL_MAX_ATTEMPTS = 6;
// 'posting' rows carry their claim deadline in run_at — a consumer invocation
// is wall-clock-capped by the runtime (~15min), so a row past a 20min deadline
// is by definition an orphan (its consumer is dead), never a live dispatch.
const SOCIAL_STUCK_MS = 20 * 60_000;
const QUEUE_DELAY_MAX = 43_200; // Queues delaySeconds cap (12h)

export type SocialPostOutcome = "posted" | "failed" | "requeued" | "skipped";

// One message = one row. 'skipped' covers cancelled rows and duplicate
// deliveries that arrive after the row already left 'queued'.
export async function dispatchSocialPost(env: Env, postId: number): Promise<SocialPostOutcome> {
  const claim = await env.DB.prepare(
    "UPDATE social_posts SET status = 'posting', attempts = attempts + 1, run_at = ? WHERE id = ? AND status = 'queued'",
  ).bind(Date.now() + SOCIAL_STUCK_MS, postId).run();
  if (!claim.meta.changes) return "skipped";
  const row = await env.DB.prepare(
    "SELECT connector, payload, attempts FROM social_posts WHERE id = ?",
  ).bind(postId).first<{ connector: string; payload: string; attempts: number }>();
  if (!row) return "skipped";

  // attempts is post-claim — the same count the old pre-claim `attempts+1`
  // comparisons used. Requeue keeps 'queued'+future run_at so the cron sweep
  // re-enqueues it; linear backoff gives a downed platform breathing room
  // (5/10/15/20/25min) instead of the old flat next-tick hammer.
  const failOrRequeue = async (errText: string): Promise<SocialPostOutcome> => {
    if (row.attempts >= SOCIAL_MAX_ATTEMPTS) {
      await env.DB.prepare(
        "UPDATE social_posts SET status = 'failed', last_error = ? WHERE id = ?",
      ).bind(errText, postId).run();
      return "failed";
    }
    await env.DB.prepare(
      "UPDATE social_posts SET status = 'queued', run_at = ?, last_error = ? WHERE id = ?",
    ).bind(Date.now() + row.attempts * 300_000, errText, postId).run();
    return "requeued";
  };

  try {
    // callConnector's brevo case ignores `cred` (brevoSend re-resolves
    // conn:brevo→BREVO_API_KEY itself) — gate on brevoCred presence instead.
    const cred = row.connector === "brevo"
      ? ((await brevoCred(env)) ? "brevo" : null)
      : await connCred(env, row.connector);
    if (!cred) {
      // Not connected isn't a dispatch error — park the row visibly instead
      // of burning retries on a credential nobody can mint from here.
      await env.DB.prepare(
        "UPDATE social_posts SET status = 'failed', last_error = ? WHERE id = ?",
      ).bind(`'${row.connector}' not connected — set it in Settings → Connector library`, postId).run();
      return "failed";
    }
    const out = await callConnector(env, row.connector, cred, JSON.parse(row.payload) as Record<string, unknown>);
    if (out.ok) {
      await env.DB.prepare(
        "UPDATE social_posts SET status = 'posted', last_error = NULL, posted_at = ? WHERE id = ?",
      ).bind(Date.now(), postId).run();
      return "posted";
    }
    return await failOrRequeue(String(out.error ?? out.status ?? "dispatch failed"));
  } catch (e) {
    return await failOrRequeue(e instanceof Error ? e.message : String(e));
  }
}

// Producer hot path — inserts send their own queue message when run_at is
// inside the 12h delaySeconds window. Beyond that (or on a send failure) the
// cron sweep enqueues at due time, so a missed send is latency, not loss.
export async function queueSocialPost(env: Env, postId: number, runAt: number): Promise<void> {
  if (!env.SOCIAL_QUEUE) return;
  const delay = Math.floor((runAt - Date.now()) / 1000);
  if (delay > QUEUE_DELAY_MAX) return;
  await env.SOCIAL_QUEUE.send(
    { post_id: postId },
    { delaySeconds: Math.max(0, delay) },
  ).catch(() => undefined);
}

export async function dispatchScheduledPosts(env: Env): Promise<{ posted: number; failed: number }> {
  // Self-heal the table — a fresh D1 or a dropped schema gets one cheap DDL
  // per sweep, which no-ops once the table exists.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS social_posts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       connector TEXT NOT NULL,
       payload TEXT NOT NULL,
       run_at INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'queued',
       attempts INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       created_at INTEGER NOT NULL,
       posted_at INTEGER
     )`,
  ).run();
  const now = Date.now();
  // Rescue claims orphaned by a dead consumer — 'posting' + claim deadline
  // (run_at) in the past means nobody owns the row. Rescue runs BEFORE the
  // due-select so a rescued row is enqueued in the same tick.
  await env.DB.prepare(
    "UPDATE social_posts SET status = 'queued', run_at = ? WHERE status = 'posting' AND run_at <= ?",
  ).bind(now, now).run();
  const { results: due } = await env.DB.prepare(
    "SELECT id FROM social_posts WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 20",
  ).bind(now).all<{ id: number }>();

  let posted = 0, failed = 0;
  for (const row of due ?? []) {
    if (env.SOCIAL_QUEUE) {
      // Queue path — the consumer claims + dispatches. Every due 'queued' row
      // gets one message per tick until claimed; the atomic claim dedupes.
      await env.SOCIAL_QUEUE.send({ post_id: row.id }).catch(() => undefined);
      continue;
    }
    // No queue bound (pre-migration deploys) — dispatch inline, same cadence
    // as the pre-Queues implementation.
    const outcome = await dispatchSocialPost(env, row.id);
    if (outcome === "posted") posted++;
    else if (outcome === "failed") failed++;
  }
  return { posted, failed };
}

// Public media serve — unguessable UUID keys, read-only, cache-immutable.
// External platforms (Instagram, Pinterest, …) fetch these URLs server-side
// when publishing an image_url post, so the route sits in front of the
// bearer gate in index.ts like /oauth and /widget.js.
export async function handleMediaServe(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/media\/([0-9a-f-]{36})$/);
  if (!m || (req.method !== "GET" && req.method !== "HEAD"))
    return json({ error: "not found" }, 404);
  const metaRaw = await env.EPHEMERAL.get(`media:${m[1]}:meta`);
  let bytes: ArrayBuffer | null = null;
  const obj = await env.MEDIA?.get(`media/${m[1]}`);
  if (obj) bytes = await obj.arrayBuffer();
  if (!bytes || !bytes.byteLength)
    bytes = await env.EPHEMERAL.get(`media:${m[1]}`, "arrayBuffer");
  if (!metaRaw || !bytes || !bytes.byteLength) return json({ error: "not found" }, 404);
  let meta: { name?: string; type?: string } = {};
  try {
    meta = JSON.parse(metaRaw) as { name?: string; type?: string };
  } catch {}
  const safeName = String(meta.name ?? "media").replace(/[^\w. -]/g, "_").slice(0, 120);
  return new Response(bytes, {
    headers: {
      "content-type": meta.type ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
