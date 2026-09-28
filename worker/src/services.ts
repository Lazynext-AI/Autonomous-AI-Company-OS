/**
 * Native services replacing third-party SaaS — all on D1.
 * CRM (HubSpot/Salesforce), support tickets (Intercom/Zendesk),
 * scheduling (Calendly), and a storefront (Shopify; checkout via Dodo).
 */
import { Env, json, authorize, touchKey } from "./gateway";
import { publishToBus } from "./webhooks";

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
    );
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
      if (await env.EPHEMERAL.get(`unsub:${c.email.toLowerCase()}`)) continue;
      try {
        const r = await brevoSend(
          env, c.email, String(camp.subject),
          String(camp.html) + await marketingFooter(env, c.email),
          undefined, await unsubHeaders(env, c.email));
        if (r.ok) sent++;
      } catch {}
    }
    await env.DB.prepare(
      "UPDATE email_campaigns SET status='sent', sent_count=?, sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).bind(sent, id).run();
    return json({ ok: true, id, sent, total: contacts.length });
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
  headers?: Record<string, string>,
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
      undefined, await unsubHeaders(env, email));
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

export async function handleBrevoWebhook(
  req: Request, env: Env, path: string,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const sec = path.split("/").pop() ?? "";
  const expected = await env.EPHEMERAL.get("brevo:webhook_secret");
  if (!expected || sec !== expected) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as
    { event?: string; email?: string; events?: { event?: string; email?: string }[] }
    | { event?: string; email?: string }[];
  // Brevo sends one object per event; a `batched` webhook (not enabled today)
  // would deliver an array or {events:[...]} — handle all shapes.
  const events: { event?: string; email?: string }[] = Array.isArray(body)
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
    list.unshift({ event: ev.event, email, suppressed: suppress,
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
const CONNECTOR_IDS = [
  "x", "linkedin", "meta", "facebook", "instagram", "threads",
  "bluesky", "mastodon", "reddit", "pinterest", "vk",
  "discord", "slack", "telegram", "matrix",
  "teams", "mattermost", "zulip", "viber", "line",
  "devto", "hashnode", "medium", "wordpress", "github", "gitlab",
  "tumblr", "ghost", "beehiiv",
  "webhook", "ayrshare", "postiz", "buffer",
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
      return connPost("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    }
    case "linkedin": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>" or "<access_token>:<numeric_org_id>" — the
      // author URN needs the org's numeric id; without it "lazynext" is a
      // best-effort default that LinkedIn may reject (invalid URN → 4xx).
      const [token, org = ""] = cred.split(":", 2);
      return connPost("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          author: `urn:li:organization:${org || "lazynext"}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "NONE",
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      });
    }
    case "meta": {
      if (!text) return { ok: false, status: 400, error: "text required" };
      // cred: "<access_token>:<ad_account_id>"
      const [token, acct = ""] = cred.split(":", 2);
      if (!acct) return { ok: false, status: 500, error: "conn:meta must be '<access_token>:<ad_account_id>'" };
      return connPost(`https://graph.facebook.com/v19.0/act_${acct}/ads`, {
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
      return connPost(`https://graph.facebook.com/v19.0/${pid}/messages`, {
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
      return connPost(`https://graph.facebook.com/v19.0/${page}/feed`, {
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
      const c = await connPost(`https://graph.facebook.com/v19.0/${uid}/media`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_url: image, caption: text, access_token: token }),
      });
      if (!c.ok) return c;
      const cid = (c.body as { id?: string }).id;
      return connPost(`https://graph.facebook.com/v19.0/${uid}/media_publish`, {
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
      // cred: "<access_token>:<board_id>" — link pin; attach {image_url} for an
      // image pin (pins display richer with media).
      const [token, board = ""] = cred.split(":", 2);
      if (!board) return { ok: false, status: 500, error: "conn:pinterest must be '<access_token>:<board_id>'" };
      const link = String(b.link ?? "https://checker.lazynext.com");
      const image = String(b.image_url ?? "");
      return connPost("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          board_id: board, title: text.slice(0, 100), description: text, link,
          ...(image ? { media_source: { source_type: "image_url", url: image } } : {}),
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
      // cred: full incoming-webhook URL — Teams channel → ⋯ → Connectors →
      // Incoming Webhook. Accepts the MessageCard-compatible {text} body.
      if (!cred.startsWith("https://"))
        return { ok: false, status: 500, error: "conn:teams must be an https:// incoming-webhook URL" };
      return connPost(cred, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
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
      // cred: "<integration_token>" — medium.com → Settings → Integration tokens.
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
      // GMB, which have no sane direct posting API. Payload 'platforms'
      // overrides the default all-linked list.
      return connPost("https://api.ayrshare.com/api/post", {
        method: "POST",
        headers: { authorization: `Bearer ${cred}`, "content-type": "application/json" },
        body: JSON.stringify({ post: text, platforms: (b.platforms as string[]) ?? ["all"] }),
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
    case "brevo": {
      const to = String(b.to ?? "");
      if (!to) return { ok: false, status: 400, error: "to required" };
      return brevoSend(env, to, String(b.subject ?? "Lazynext"), String(b.html ?? text));
    }
    case "signwell":
      return { ok: false, status: 400, error: "use /api/v1/signwell/send for signing" };
    default:
      return { ok: false, error: `unknown connector '${id}'` };
  }
}
