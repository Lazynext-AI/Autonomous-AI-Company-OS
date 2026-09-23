/**
 * AI Company OS - Cloudflare Worker API layer.
 * D1: relational state + message bus emulation (consumer-group semantics).
 * KV: hot-path cache (company brain). Vectorize: knowledge embeddings.
 * Auth: Authorization: Bearer <API_TOKEN secret> (internal) or lzk_ API key
 * (public /api/v1/* + /mcp).
 */

import { Env, json, cors, preflight } from "./gateway";
import { handlePublicApi } from "./public_api";
import { handleMcp } from "./mcp";
import { handleA2a } from "./a2a";
import { handleBilling } from "./billing";
import { handleOAuth } from "./oauth";
import { handleWebSearch } from "./websearch";
import { handleScrape } from "./scrape";
import { getContainer } from "@cloudflare/containers";
export { CodeExecContainer } from "./exec_container";
import { handleWidget } from "./widget";
import { fanOut, handleWebhooks, publishToBus } from "./webhooks";
import { handleServices, handleInklessWebhook, brevoSend } from "./services";

export { Env };

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401);
}

async function readBody<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function isReadQuery(sql: string): boolean {
  const head = sql.trimStart().slice(0, 6).toLowerCase();
  return (
    head.startsWith("select") ||
    head.startsWith("pragma") ||
    head.startsWith("with") ||
    head.startsWith("explain")
  );
}

async function handleQuery(env: Env, ctx: ExecutionContext, body: { sql: string; params?: unknown[] }) {
  const stmt = env.DB.prepare(body.sql).bind(...(body.params ?? []));
  if (isReadQuery(body.sql)) {
    const res = await stmt.all();
    return json({ results: res.results ?? [] });
  }
  const res = await stmt.run();
  // Briefing inserts double as events for webhook subscribers.
  if (/insert\s+into\s+briefings/i.test(body.sql) && res.success) {
    ctx.waitUntil(
      fanOut(env, ctx, "briefings", String(res.meta.last_row_id ?? ""), JSON.stringify(body.params ?? [])),
    );
  }
  return json({ success: res.success, meta: res.meta });
}

async function handleBatch(env: Env, body: { statements: { sql: string; params?: unknown[] }[] }) {
  const stmts = body.statements.map((s) => env.DB.prepare(s.sql).bind(...(s.params ?? [])));
  const results = await env.DB.batch(stmts);
  return json({
    results: results.map((r) => ({
      success: r.success,
      results: r.results ?? [],
      meta: r.meta,
    })),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handleBusPoll(
  env: Env,
  body: { channel: string; group: string; consumer: string; count?: number; wait_ms?: number },
): Promise<Response> {
  const { channel, group, consumer } = body;
  const count = Math.min(body.count ?? 10, 100);
  const deadline = Date.now() + Math.min(body.wait_ms ?? 3000, 5000);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO bus_offsets (channel, group_name, last_id) VALUES (?, ?, 0)",
  )
    .bind(channel, group)
    .run();

  while (true) {
    const offsetRow = await env.DB.prepare(
      "SELECT last_id FROM bus_offsets WHERE channel = ? AND group_name = ?",
    )
      .bind(channel, group)
      .first<{ last_id: number }>();
    const lastId = offsetRow?.last_id ?? 0;

    const { results: msgs } = await env.DB.prepare(
      `SELECT m.id, m.payload FROM bus_messages m
       WHERE m.channel = ? AND m.id > ?
         AND NOT EXISTS (
           SELECT 1 FROM bus_deliveries d
           WHERE d.message_id = m.id AND d.group_name = ?
         )
       ORDER BY m.id LIMIT ?`,
    )
      .bind(channel, lastId, group, count)
      .all<{ id: number; payload: string }>();

    if (msgs.length > 0) {
      const now = new Date().toISOString();
      const maxId = msgs[msgs.length - 1].id;
      const writes: D1PreparedStatement[] = msgs.map((m) =>
        env.DB.prepare(
          "INSERT INTO bus_deliveries (message_id, channel, group_name, consumer, delivered_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(m.id, channel, group, consumer, now),
      );
      writes.push(
        env.DB.prepare(
          "UPDATE bus_offsets SET last_id = ? WHERE channel = ? AND group_name = ?",
        ).bind(maxId, channel, group),
      );
      await env.DB.batch(writes);
      return json({ messages: msgs.map((m) => ({ id: String(m.id), payload: m.payload })) });
    }

    if (Date.now() >= deadline) return json({ messages: [] });
    await sleep(400);
  }
}

async function route(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (path === "/health") {
    await env.DB.prepare("SELECT 1").all();
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ error: "not found" }, 404);

  switch (path) {
    case "/query":
      return handleQuery(env, ctx, await readBody(req));
    case "/batch":
      return handleBatch(env, await readBody(req));

    case "/bus/publish": {
      const b = await readBody<{ channel: string; payload: string }>(req);
      const id = await publishToBus(env, ctx, b.channel, b.payload);
      return json({ id });
    }
    case "/bus/poll":
      return handleBusPoll(env, await readBody(req));

    case "/agent/tick": {
      const out = await agentTick(env, ctx);
      if ("error" in out) return json(out, 502);
      return json(out);
    }

    case "/agent/generate": {
      // Stand-in codegen: Workers AI generates an artifact .
      if (!env.AI) return json({ error: "AI binding not configured" }, 503);
      const b = await readBody<{ system: string; prompt: string; max_tokens?: number }>(req);
      const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: b.system },
          { role: "user", content: b.prompt },
        ],
        max_tokens: b.max_tokens ?? 2048,
      });
      const raw = (res as { response?: unknown }).response;
      const text =
        (typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw)).trim();
      if (!text) return json({ error: "empty model response" }, 502);
      return json({ text });
    }

    case "/email/send": {
      // Real transactional email via Brevo — founder flows (verify, reset, alerts).
      const b = await readBody<{ to: string; subject: string; html: string }>(req);
      if (!b.to || !b.subject || !b.html) return json({ error: "to, subject, html required" }, 400);
      const r = await brevoSend(env, b.to, b.subject, b.html);
      if (!r.ok) return json({ error: r.error ?? "send failed" }, r.status);
      return json({ ok: true, id: r.messageId });
    }

    case "/bus/ack": {
      const b = await readBody<{ channel: string; group: string; ids: (string | number)[] }>(req);
      if (!b.ids?.length) return json({ ok: true });
      const marks = b.ids.map(() => "?").join(",");
      await env.DB.prepare(
        `DELETE FROM bus_deliveries WHERE channel = ? AND group_name = ? AND message_id IN (${marks})`,
      )
        .bind(b.channel, b.group, ...b.ids.map(Number))
        .run();
      return json({ ok: true });
    }
    case "/bus/pending": {
      const b = await readBody<{ channel: string; group?: string }>(req);
      const sql = b.group
        ? "SELECT message_id, consumer, delivered_at FROM bus_deliveries WHERE channel = ? AND group_name = ?"
        : "SELECT message_id, group_name, consumer, delivered_at FROM bus_deliveries WHERE channel = ?";
      const stmt = b.group
        ? env.DB.prepare(sql).bind(b.channel, b.group)
        : env.DB.prepare(sql).bind(b.channel);
      const { results } = await stmt.all();
      return json({ count: results.length, pending: results });
    }
    case "/bus/ensure": {
      const b = await readBody<{ channels: string[]; group: string }>(req);
      const stmts = b.channels.map((c) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO bus_offsets (channel, group_name, last_id) VALUES (?, ?, 0)",
        ).bind(c, b.group),
      );
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true });
    }

    case "/kv/get": {
      const b = await readBody<{ key: string }>(req);
      const value = await env.EPHEMERAL.get(b.key);
      return json({ value });
    }
    case "/kv/put": {
      const b = await readBody<{ key: string; value: string; ttl?: number }>(req);
      await env.EPHEMERAL.put(b.key, b.value, {
        expirationTtl: Math.max(b.ttl ?? 60, 60),
      });
      return json({ ok: true });
    }
    case "/kv/delete": {
      const b = await readBody<{ key: string }>(req);
      await env.EPHEMERAL.delete(b.key);
      return json({ ok: true });
    }

    case "/vectorize/upsert": {
      const b = await readBody<{
        vectors: { id: string; values: number[]; metadata?: Record<string, VectorizeVectorMetadata> }[];
      }>(req);
      const inserted = await env.VECTORS.upsert(
        b.vectors.map((v) => ({ id: v.id, values: v.values, metadata: v.metadata ?? {} })),
      );
      return json({ count: inserted.count });
    }
    case "/vectorize/query": {
      const b = await readBody<{
        vector: number[];
        topK?: number;
        filter?: VectorizeVectorMetadataFilter;
      }>(req);
      const matches = await env.VECTORS.query(b.vector, {
        topK: b.topK ?? 5,
        filter: b.filter,
        returnMetadata: "all",
      });
      return json({ matches: matches.matches });
    }
    case "/vectorize/delete": {
      const b = await readBody<{ ids: string[] }>(req);
      const res = await env.VECTORS.deleteByIds(b.ids);
      return json(res);
    }
    case "/websearch": {
      return handleWebSearch(req, env);
    }
    case "/scrape": {
      return handleScrape(req, env);
    }
    case "/exec": {
      if (!env.CODE_EXEC) return json({ error: "exec container not configured" }, 503);
      const container = getContainer(env.CODE_EXEC);
      return container.fetch(req);
    }

    default:
      return json({ error: "not found" }, 404);
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      // Public surface: API-key gateway (own auth) + CORS
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      if (req.method === "OPTIONS") return preflight();
      if (path === "/mcp") return cors(req, await handleMcp(req, env, ctx));
      if (path === "/a2a" || path === "/.well-known/agent.json")
        return cors(req, await handleA2a(req, env, ctx, path));
      if (path.startsWith("/oauth/"))
        return cors(req, await handleOAuth(req, env, path, url));
      if (path === "/widget.js" || path === "/api/v1/widget/chat")
        return cors(req, await handleWidget(req, env, ctx, path));
      if (path.startsWith("/api/v1/billing"))
        return cors(req, await handleBilling(req, env, ctx, path));
      if (path.startsWith("/api/v1/webhooks"))
        return cors(req, await handleWebhooks(req, env, ctx, path));
      if (path.startsWith("/api/v1/inkless/webhook/"))
        return cors(req, await handleInklessWebhook(req, env, path));
      if (path.startsWith("/api/v1/crm") || path.startsWith("/api/v1/support") ||
          path.startsWith("/api/v1/booking") || path.startsWith("/api/v1/store") ||
          path.startsWith("/api/v1/marketing") || path.startsWith("/api/v1/inkless"))
        return cors(req, await handleServices(req, env, ctx, path));
      if (path.startsWith("/api/")) return cors(req, await handlePublicApi(req, env, ctx, path));

      // Internal surface: shared-secret auth as before
      if (env.API_TOKEN) {
        const auth = req.headers.get("authorization") ?? "";
        if (auth !== `Bearer ${env.API_TOKEN}`) return unauthorized();
      }
      return await route(req, env, ctx, path);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },

  // Continuous agent loop: a Cloudflare cron tick makes agents act
  // autonomously on a schedule .
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(agentTick(env, ctx).then(() => undefined).catch(() => {}));
  },
};

// Stand-in brain: free-tier Workers AI Llama generates a real agent
// message .
const TICK_AGENTS = [
  { id: "ceo_agent", persona: "the CEO prioritising the product sprint" },
  { id: "builder_agent", persona: "an engineer who just shipped a feature" },
  { id: "market_researcher_agent", persona: "a researcher with fresh competitor intel" },
  { id: "marketing_agent", persona: "a growth lead planning a Product Hunt launch" },
];

async function agentTick(env: Env, ctx: ExecutionContext) {
  if (!env.AI) return { error: "AI binding not configured" };
  const a = TICK_AGENTS[Math.floor(Math.random() * TICK_AGENTS.length)];
  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content:
          "You are an agent inside an autonomous AI company building a product called LaunchDeck (AI landing-page generator on Cloudflare). Reply with ONE short status line, first person, under 25 words. No prefix, no quotes.",
      },
      { role: "user", content: `You are ${a.persona}. What are you doing right now?` },
    ],
    max_tokens: 60,
  });
  const text = (res as { response?: string }).response?.trim() ?? "";
  if (!text) return { error: "empty model response" };
  const payload = JSON.stringify({ from: a.id, agent: a.id, text, model: "workers-ai/llama-3.3-70b", demo: true });
  const id = await publishToBus(env, ctx, "conversations", payload);
  return { id, agent: a.id, text };
}
