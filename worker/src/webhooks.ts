/**
 * Outbound webhooks - the bus is the company's event stream, so every
 * /bus/publish fans out to registered endpoints. Deliveries are logged.
 */
import { Env, json, authorize, touchKey } from "./gateway";

interface WebhookEndpoint {
  id: number;
  url: string;
  channels: string;
  secret: string | null;
  active: number;
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deliver(env: Env, ep: WebhookEndpoint, channel: string, messageId: string, payload: string) {
  // Platform-aware formatting: Slack/Discord/Teams/Google Chat accept
  // {content|text}, Telegram needs chat_id+text, everything else gets
  // the raw event.
  let body: string;
  const host = new URL(ep.url).hostname;
  const pretty = `[${channel}] ${payload}`.slice(0, 1800);
  if (host === "hooks.slack.com" || host.endsWith("slack.com")) {
    body = JSON.stringify({ text: `*Lazynext* · ${pretty}` });
  } else if (host.includes("discord.com") || host.includes("discordapp.com")) {
    body = JSON.stringify({ content: `**Lazynext** · ${pretty}` });
  } else if (host === "api.telegram.org") {
    const chatId = new URL(ep.url).searchParams.get("chat_id") ?? "";
    body = JSON.stringify({ chat_id: chatId, text: `Lazynext · ${pretty}` });
  } else if (host === "chat.googleapis.com") {
    body = JSON.stringify({ text: `*Lazynext* · ${pretty}` });
  } else if (host.includes("webhook.office.com") || host.includes("logic.azure.com")) {
    body = JSON.stringify({ text: `**Lazynext** · ${pretty}` });
  } else {
    body = JSON.stringify({
      event: "bus.message",
      channel,
      message_id: messageId,
      payload,
      timestamp: new Date().toISOString(),
    });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ep.secret) headers["x-lazynext-signature"] = "sha256=" + (await hmac(ep.secret, body));

  let status: number | null = null;
  let error: string | null = null;
  try {
    const r = await fetch(ep.url, { method: "POST", headers, body });
    status = r.status;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await env.DB.prepare(
    "INSERT INTO webhook_deliveries (endpoint_id, channel, message_id, status_code, error) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(ep.id, channel, messageId, status, error)
    .run();
}

/** The one place all bus writes go through - insert + webhook fan-out. */
export async function publishToBus(
  env: Env,
  ctx: ExecutionContext,
  channel: string,
  payload: string,
): Promise<string> {
  const res = await env.DB.prepare(
    "INSERT INTO bus_messages (channel, payload, created_at) VALUES (?, ?, ?)",
  )
    .bind(channel, payload, new Date().toISOString())
    .run();
  const id = String(res.meta.last_row_id);
  ctx.waitUntil(fanOut(env, ctx, channel, id, payload));
  return id;
}

/** Called from the internal /bus/publish handler. Fire-and-forget via ctx.waitUntil. */
export async function fanOut(
  env: Env,
  ctx: ExecutionContext,
  channel: string,
  messageId: string,
  payload: string,
): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM webhook_endpoints WHERE active = 1",
  ).all<WebhookEndpoint>();
  const targets = (results ?? []).filter(
    (e) => e.channels === "*" || e.channels.split(",").map((c) => c.trim()).includes(channel),
  );
  for (const ep of targets) ctx.waitUntil(deliver(env, ep, channel, messageId, payload));
}

// ------------------------------------------------------------- management ----

export async function handleWebhooks(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const { key, res } = await authorize(req, env, req.method === "GET" ? "read" : "write");
  if (res) return res;
  touchKey(env, ctx, key!.id);

  if (req.method === "POST" && path === "/api/v1/webhooks") {
    const b = (await req.json()) as { url?: string; channels?: string; secret?: string };
    const url = (b.url ?? "").trim();
    if (!/^https:\/\/.+/i.test(url) || url.length > 500) {
      return json({ error: "https url required" }, 400);
    }
    const channels = (b.channels ?? "*").trim() || "*";
    await env.DB.prepare(
      "INSERT INTO webhook_endpoints (url, channels, secret) VALUES (?, ?, ?)",
    )
      .bind(url, channels, b.secret ?? null)
      .run();
    return json({ ok: true, url, channels }, 201);
  }

  if (req.method === "GET" && path === "/api/v1/webhooks") {
    const { results } = await env.DB.prepare(
      "SELECT id, url, channels, active, created_at FROM webhook_endpoints ORDER BY id",
    ).all();
    return json({ webhooks: results ?? [] });
  }

  if (req.method === "GET" && path === "/api/v1/webhooks/deliveries") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 50",
    ).all();
    return json({ deliveries: results ?? [] });
  }

  if (req.method === "DELETE" && path.startsWith("/api/v1/webhooks/")) {
    const id = parseInt(path.split("/").pop() ?? "", 10);
    if (!id) return json({ error: "invalid id" }, 400);
    await env.DB.prepare("UPDATE webhook_endpoints SET active = 0 WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
