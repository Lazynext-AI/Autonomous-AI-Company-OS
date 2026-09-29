/**
 * Native e-signature — SignWell replacement, all-Cloudflare.
 *
 * Flow: POST /api/v1/sign/requests (scoped key) snapshots the document into
 * KV (frozen — the signer must see exactly what was sent) and emails the
 * signer a token-gated link via Brevo. GET /sign/{pid}?t=… is the public
 * signing page; POST the same path records the typed signature, signer IP,
 * UA, and doc hash, then freezes a completion certificate into KV. Decline
 * is first-class — an audit trail that only records assent is weaker.
 *
 * ESIGN/UETA-shaped: intent (explicit button), consent (checkbox), record
 * retention (KV cert + D1 audit), attribution (token link + typed name +
 * IP/UA). Not a notary service — high-assurance use cases still warrant one.
 */
import { Env, json, authorize, touchKey } from "./gateway";
import { brevoSend } from "./services";
import { publishToBus } from "./webhooks";

const SIGN_BASE = "https://ai-company.lazynext.com";
const DOC_MAX_BYTES = 500 * 1024;
const DOC_TYPES = new Set(["text/html", "text/plain"]);

interface SignRow {
  id: number;
  public_id: string;
  token: string;
  signer_email: string;
  signer_name: string | null;
  requester_email: string | null;
  title: string;
  doc_hash: string | null;
  status: string;
  signed_name: string | null;
  signed_at: number | null;
  signer_ip: string | null;
  signer_ua: string | null;
  decline_reason: string | null;
  audit: string;
  created_at: number;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const sha256Hex = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function auditAppend(env: Env, row: SignRow, event: string, extra?: Record<string, unknown>) {
  let audit: Record<string, unknown>[] = [];
  try {
    audit = JSON.parse(row.audit || "[]") as Record<string, unknown>[];
  } catch {}
  audit.push({ at: Date.now(), event, ...(extra ?? {}) });
  row.audit = JSON.stringify(audit.slice(-50));
  await env.DB.prepare("UPDATE sign_requests SET audit = ? WHERE id = ?").bind(row.audit, row.id).run();
}

async function snapshotDoc(env: Env, pid: string, docUrl: string, docHtml: string, docText: string): Promise<{ hash?: string; error?: string }> {
  let bytes: Uint8Array | null = null;
  if (docHtml) {
    bytes = new TextEncoder().encode(docHtml);
  } else if (docText) {
    bytes = new TextEncoder().encode(`<pre style="font-family:system-ui;white-space:pre-wrap;padding:2rem">${esc(docText)}</pre>`);
  } else if (docUrl) {
    const r = await fetch(docUrl, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r?.ok) return { error: `could not fetch doc_url (${r?.status ?? "unreachable"})` };
    if (!DOC_TYPES.has((r.headers.get("content-type") ?? "").split(";")[0].trim()))
      return { error: "doc_url must serve text/html or text/plain" };
    const ab = await r.arrayBuffer();
    if (ab.byteLength > DOC_MAX_BYTES) return { error: "document too large (500KB max)" };
    bytes = new Uint8Array(ab);
  }
  if (!bytes) return { error: "provide doc_html, doc_text, or doc_url" };
  if (bytes.length > DOC_MAX_BYTES) return { error: "document too large (500KB max)" };
  const hash = await sha256Hex(bytes.buffer as ArrayBuffer);
  await env.EPHEMERAL.put(`sign:${pid}:doc`, bytes);
  return { hash };
}

async function notifySigner(env: Env, row: SignRow) {
  const link = `${SIGN_BASE}/sign/${row.public_id}?t=${row.token}`;
  return brevoSend(
    env,
    row.signer_email,
    `Signature requested: ${row.title}`,
    `<p>You've been asked to sign <b>${esc(row.title)}</b>.</p><p><a href="${link}">Review and sign</a> — the link is unique to you; please don't forward it.</p><p style="color:#6b7280;font-size:.85em">Lazynext e-sign · request ${row.public_id}</p>`,
    row.signer_name ?? undefined,
    undefined,
    "sign:request",
  );
}

/** Shared creation path — the scoped API and the internal fleet route both land here. */
export async function createSignRequest(
  env: Env, ctx: ExecutionContext, b: Record<string, unknown>, createdBy: string,
): Promise<Response> {
  const email = String(b.signer_email ?? "").trim().toLowerCase();
  const title = String(b.title ?? "").trim().slice(0, 200);
  if (!email.includes("@")) return json({ error: "signer_email required" }, 400);
  if (!title) return json({ error: "title required" }, 400);
  const pid = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const snap = await snapshotDoc(env, pid, String(b.doc_url ?? ""), String(b.doc_html ?? ""), String(b.doc_text ?? ""));
  if (snap.error) return json({ error: snap.error }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO sign_requests (public_id, token, signer_email, signer_name, requester_email, title, doc_ref, doc_hash, status, audit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?)`,
  ).bind(
    pid, token, email,
    b.signer_name ? String(b.signer_name).slice(0, 200) : null,
    b.requester_email && String(b.requester_email).includes("@") ? String(b.requester_email) : null,
    title,
    b.doc_url ? String(b.doc_url).slice(0, 500) : null,
    snap.hash ?? null,
    Date.now(),
  ).run();
  const row = (await env.DB.prepare("SELECT * FROM sign_requests WHERE id = ?").bind(r.meta.last_row_id).first()) as unknown as SignRow;
  await auditAppend(env, row, "created", { by: createdBy });
  const sent = await notifySigner(env, row);
  await auditAppend(env, row, sent.ok ? "emailed" : "email_failed", { status: sent.status });
  await publishToBus(env, ctx, "sign", JSON.stringify({ event: "requested", public_id: pid, title, signer_email: email }));
  return json(
    { id: row.id, public_id: pid, status: "pending", url: `${SIGN_BASE}/sign/${pid}?t=${token}`, emailed: sent.ok },
    sent.ok ? 201 : 502,
  );
}

/** Authenticated /api/v1/sign/* surface (scoped API keys). */
export async function handleSignApi(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const { key, res } = await authorize(req, env, req.method === "GET" ? "read" : "write");
  if (res) return res;
  touchKey(env, ctx, key!.id);
  const b = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

  if (path === "/api/v1/sign/requests" && req.method === "POST")
    return createSignRequest(env, ctx, b, `api:${key!.name}`);

  if (path === "/api/v1/sign/requests" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, public_id, signer_email, signer_name, requester_email, title, doc_ref, doc_hash, status,
              signed_name, signed_at, decline_reason, created_at FROM sign_requests ORDER BY id DESC LIMIT 200`,
    ).all();
    return json({ requests: results ?? [] });
  }

  const detail = path.match(/^\/api\/v1\/sign\/requests\/([0-9a-f-]{36})(\/remind)?$/);
  if (!detail) return json({ error: "not found" }, 404);
  const row = (await env.DB.prepare("SELECT * FROM sign_requests WHERE public_id = ?").bind(detail[1]).first()) as unknown as SignRow | null;
  if (!row) return json({ error: "not found" }, 404);

  if (req.method === "GET" && !detail[2]) {
    const { token, ...rest } = row;
    return json({ request: { ...rest, audit: JSON.parse(row.audit || "[]") } });
  }
  if (detail[2] === "/remind" && req.method === "POST") {
    if (row.status !== "pending" && row.status !== "viewed") return json({ error: `cannot remind a ${row.status} request` }, 400);
    const sent = await notifySigner(env, row);
    await auditAppend(env, row, sent.ok ? "reminded" : "email_failed", { status: sent.status });
    return sent.ok ? json({ ok: true, reminded: true }) : json({ error: "email send failed" }, 502);
  }
  if (req.method === "DELETE" && !detail[2]) {
    if (row.status === "completed") return json({ error: "a signed request cannot be voided — the record stands" }, 400);
    await env.DB.prepare("UPDATE sign_requests SET status = 'voided' WHERE id = ?").bind(row.id).run();
    await auditAppend(env, { ...row, status: "voided" }, "voided", { by: key!.name });
    return json({ ok: true, voided: true });
  }
  return json({ error: "not found" }, 404);
}

const SIGN_PAGE = (title: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — Lazynext e-sign</title>
<style>
body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}
iframe.doc{width:100%;height:420px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
.row{margin:1rem 0}.btn{padding:.7rem 1.4rem;border:0;border-radius:8px;background:#4338ca;color:#fff;font-size:1rem;cursor:pointer}
.decline{background:none;color:#6b7280;border:1px solid #d1d5db}.muted{color:#6b7280;font-size:.85rem}
input[type=text]{width:100%;padding:.7rem;border:1px solid #9ca3af;border-radius:8px;font-size:1.1rem;font-style:italic}
label{display:flex;gap:.5rem;align-items:flex-start;font-size:.9rem}
</style></head><body>${inner}</body></html>`;

/** Public /sign/{pid}[?t=…] surface — token-gated, no session. */
export async function handleSignPublic(req: Request, env: Env, ctx: ExecutionContext, path: string, url: URL): Promise<Response> {
  const m = path.match(/^\/sign\/([0-9a-f-]{36})(\/certificate)?$/);
  if (!m) return json({ error: "not found" }, 404);
  const row = (await env.DB.prepare("SELECT * FROM sign_requests WHERE public_id = ?").bind(m[1]).first()) as unknown as SignRow | null;
  if (!row) return new Response(SIGN_PAGE("Not found", "<h1>Request not found</h1><p class='muted'>This signature link is invalid.</p>"), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const html = (body: string, status = 200) => new Response(SIGN_PAGE(row.title, body), { status, headers: { "content-type": "text/html; charset=utf-8" } });

  // The request body can only be read once — parse it up front for POST.
  const postBody = req.method === "POST" ? ((await req.json().catch(() => ({}))) as { t?: string; name?: string; consent?: boolean; decline?: boolean; reason?: string }) : {};
  const token = req.method === "GET" ? (url.searchParams.get("t") ?? "") : String(postBody.t ?? "");
  if (token !== row.token) return html("<h1>Invalid link</h1><p class='muted'>This signature link is missing or wrong — use the exact link from your email.</p>", 403);

  if (m[2] === "/certificate") {
    if (row.status !== "completed") return html("<h1>Not signed yet</h1><p class='muted'>A completion certificate exists only after signing.</p>", 404);
    const cert = await env.EPHEMERAL.get(`sign:${row.public_id}:cert`);
    return cert
      ? new Response(cert, { headers: { "content-type": "text/html; charset=utf-8" } })
      : html("<h1>Certificate unavailable</h1>", 404);
  }

  if (req.method === "GET") {
    if (row.status === "completed")
      return html(`<h1>Already signed</h1><p class="muted">Signed by <b>${esc(row.signed_name)}</b> on ${new Date(row.signed_at ?? 0).toISOString()}.</p><p><a href="/sign/${row.public_id}/certificate?t=${esc(row.token)}">View certificate</a></p>`);
    if (row.status !== "pending" && row.status !== "viewed")
      return html(`<h1>Request ${esc(row.status)}</h1><p class="muted">This signature request is ${esc(row.status)} and can no longer be signed.</p>`);
    if (row.status === "pending") {
      await env.DB.prepare("UPDATE sign_requests SET status = 'viewed' WHERE id = ? AND status = 'pending'").bind(row.id).run();
      row.status = "viewed";
      await auditAppend(env, row, "viewed", { ip: req.headers.get("cf-connecting-ip") ?? undefined });
    }
    return html(`<h1>Sign: ${esc(row.title)}</h1>
<iframe class="doc" sandbox srcdoc="${esc(await env.EPHEMERAL.get(`sign:${row.public_id}:doc`) ?? "<p>Document unavailable</p>")}"></iframe>
<form method="POST" action="/sign/${row.public_id}" id="f">
<div class="row"><label><input type="checkbox" id="consent" required> <span>I agree to sign this document electronically and understand my typed signature is legally binding.</span></label></div>
<div class="row"><input type="text" id="name" required maxlength="100" placeholder="Type your full legal name" aria-label="Full legal name"></div>
<div class="row"><button class="btn" type="submit">Sign document</button> <button class="btn decline" type="button" id="declineBtn">Decline</button></div>
<input type="hidden" name="t" value="${esc(row.token)}">
</form>
<script>
document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:${JSON.stringify(row.token)},name:document.getElementById('name').value,consent:document.getElementById('consent').checked})});
const d=await r.json().catch(()=>({}));document.body.innerHTML=r.ok?'<h1>Signed ✓</h1><p>You signed <b>${esc(row.title)}</b>. A copy of the completion certificate was emailed to you.</p>':'<h1>Signing failed</h1><p>'+(d.error||r.status)+'</p>';});
document.getElementById('declineBtn').onclick=async()=>{const reason=prompt('Optional: tell the requester why you are declining')||'';
await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:${JSON.stringify(row.token)},decline:true,reason})});
document.body.innerHTML='<h1>Declined</h1><p class="muted">The requester has been notified.</p>';};
</script>`);
  }

  if (req.method === "POST") {
    const b = postBody;
    if (row.status !== "pending" && row.status !== "viewed")
      return json({ error: `this request is already ${row.status}` }, 409);
    const ip = req.headers.get("cf-connecting-ip") ?? "";
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
    // Cheap abuse bound — token is unguessable, this just stops replay storms.
    const rlKey = `rl:sign:${ip}`;
    const used = parseInt((await env.EPHEMERAL.get(rlKey)) ?? "0", 10);
    if (used >= 20) return json({ error: "too many attempts — try again tomorrow" }, 429);
    await env.EPHEMERAL.put(rlKey, String(used + 1), { expirationTtl: 86400 });

    if (b.decline) {
      await env.DB.prepare("UPDATE sign_requests SET status = 'declined', decline_reason = ? WHERE id = ?")
        .bind(String(b.reason ?? "").slice(0, 500) || null, row.id).run();
      await auditAppend(env, { ...row, status: "declined" }, "declined", { ip, reason: b.reason });
      if (row.requester_email)
        await brevoSend(env, row.requester_email, `Declined: ${row.title}`,
          `<p><b>${esc(row.signer_email)}</b> declined to sign <b>${esc(row.title)}</b>.</p>${b.reason ? `<p>Reason: ${esc(b.reason)}</p>` : ""}`,
          undefined, undefined, "sign:declined").catch(() => {});
      await publishToBus(env, ctx, "sign", JSON.stringify({ event: "declined", public_id: row.public_id, signer_email: row.signer_email }));
      return json({ ok: true, status: "declined" });
    }

    const name = String(b.name ?? "").trim();
    if (!b.consent) return json({ error: "consent required — check the box" }, 400);
    if (name.length < 2 || name.length > 100) return json({ error: "type your full legal name" }, 400);
    const now = Date.now();
    const doc = (await env.EPHEMERAL.get(`sign:${row.public_id}:doc`)) ?? "";
    const cert = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Certificate — ${esc(row.title)}</title>
<style>body{font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}.cert{border:2px solid #4338ca;border-radius:10px;padding:1.5rem;margin:1.5rem 0}.sig{font-family:'Brush Script MT',cursive;font-size:2rem;color:#4338ca}table{border-collapse:collapse}td{padding:.3rem .8rem .3rem 0;font-size:.9rem}iframe{width:100%;height:380px;border:1px solid #d1d5db;border-radius:8px}.muted{color:#6b7280;font-size:.8rem}</style></head><body>
<h1>Signature certificate</h1>
<div class="cert"><table>
<tr><td><b>Document</b></td><td>${esc(row.title)}</td></tr>
<tr><td><b>Request</b></td><td>${esc(row.public_id)}</td></tr>
<tr><td><b>Signed by</b></td><td><span class="sig">${esc(name)}</span> &lt;${esc(row.signer_email)}&gt;</td></tr>
<tr><td><b>Signed at</b></td><td>${new Date(now).toISOString()}</td></tr>
<tr><td><b>Doc SHA-256</b></td><td><code>${esc(row.doc_hash ?? "n/a")}</code></td></tr>
<tr><td><b>Signer IP</b></td><td>${esc(ip)}</td></tr>
<tr><td><b>Signer UA</b></td><td>${esc(ua)}</td></tr>
</table></div>
<iframe class="doc" sandbox srcdoc="${esc(doc)}"></iframe>
<p class="muted">Electronic record generated by Lazynext e-sign. Typed signature + affirmative consent recorded with signer IP and timestamp; document snapshot hash matches the version presented.</p>
</body></html>`;
    await env.EPHEMERAL.put(`sign:${row.public_id}:cert`, cert);
    await env.DB.prepare(
      "UPDATE sign_requests SET status = 'completed', signed_name = ?, signed_at = ?, signer_ip = ?, signer_ua = ? WHERE id = ?",
    ).bind(name, now, ip, ua, row.id).run();
    await auditAppend(env, { ...row, status: "completed" }, "signed", { ip, name });
    const certLink = `${SIGN_BASE}/sign/${row.public_id}/certificate?t=${row.token}`;
    await brevoSend(env, row.signer_email, `Signed: ${row.title}`,
      `<p>Thank you — you signed <b>${esc(row.title)}</b> on ${new Date(now).toISOString()}.</p><p>Your copy: <a href="${certLink}">signature certificate</a> (includes the exact document and signing record).</p>`,
      name, undefined, "sign:completed").catch(() => {});
    if (row.requester_email)
      await brevoSend(env, row.requester_email, `Signed: ${row.title}`,
        `<p><b>${esc(name)}</b> &lt;${esc(row.signer_email)}&gt; signed <b>${esc(row.title)}</b>.</p><p><a href="${certLink}">View certificate</a></p>`,
        undefined, undefined, "sign:completed").catch(() => {});
    await publishToBus(env, ctx, "sign", JSON.stringify({ event: "completed", public_id: row.public_id, signer_email: row.signer_email, signed_name: name }));
    return json({ ok: true, status: "completed", certificate: certLink });
  }
  return json({ error: "method not allowed" }, 405);
}
