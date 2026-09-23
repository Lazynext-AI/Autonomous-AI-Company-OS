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
import { handleWebSearch, serper } from "./websearch";
import { handleScrape } from "./scrape";
import { getContainer } from "@cloudflare/containers";
export { CodeExecContainer } from "./exec_container";
import { handleWidget } from "./widget";
import { fanOut, handleWebhooks, publishToBus } from "./webhooks";
import { handleServices, handleSignwellWebhook, brevoSend } from "./services";

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
      if (path.startsWith("/api/v1/signwell/webhook/"))
        return cors(req, await handleSignwellWebhook(req, env, path));
      if (path.startsWith("/api/v1/crm") || path.startsWith("/api/v1/support") ||
          path.startsWith("/api/v1/booking") || path.startsWith("/api/v1/store") ||
          path.startsWith("/api/v1/marketing") || path.startsWith("/api/v1/signwell"))
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

// Autonomous agent loop: a Cloudflare cron tick makes the company act
// continuously. Phase 1 — no product picked yet: the CEO agent does real
// market research (Serper + Workers AI) and writes the pick to
// company_brain. Phase 2 — product exists: agents generate concrete sprint
// tasks against real company state.
const TICK_AGENTS = [
  { id: "ceo_1", persona: "the CEO prioritising the sprint" },
  { id: "product_manager_1", persona: "the PM shaping the roadmap" },
  { id: "backend_1", persona: "a backend engineer" },
  { id: "frontend_1", persona: "a frontend engineer" },
  { id: "market_researcher_1", persona: "a researcher with fresh competitor intel" },
  { id: "marketing_1", persona: "a growth lead" },
  { id: "sales_1", persona: "a sales lead working outbound" },
  { id: "devops_1", persona: "a devops engineer keeping the deploys green" },
];

interface Brain {
  product_name?: string | null;
  product_description?: string | null;
  mission?: string | null;
  metrics?: string | null;
  live_urls?: string | null;
}

interface Task {
  id: string;
  task_id: string;
  agent_id: string;
  description: string;
  attempts: number;
}

async function agentTick(env: Env, ctx: ExecutionContext) {
  if (!env.AI) return { error: "AI binding not configured" };
  const brain = await env.DB.prepare("SELECT * FROM company_brain LIMIT 1")
    .first<Brain>()
    .catch(() => null);
  if (!brain?.product_name) return pickProduct(env, ctx);

  // Product picked but no repo yet — bootstrap it before anything else.
  const urls = safeJson<Record<string, string>>(brain.live_urls) ?? {};
  if (!urls.repo) return bootstrapRepo(env, ctx, brain);

  // Execute the oldest pending task (real work: GitHub commit), and keep the
  // queue topped up by generating a task when it's running shallow.
  const pending = await env.DB.prepare(
    "SELECT id, task_id, agent_id, description, attempts FROM task_log WHERE status='pending' ORDER BY created_at LIMIT 1",
  )
    .first<Task>()
    .catch(() => null);
  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) c FROM task_log WHERE status IN ('pending','in_progress')",
  )
    .first<{ c: number }>()
    .catch(() => ({ c: 0 }));

  const out: Record<string, unknown> = { phase: "operating" };
  if (pending) out.executed = await executeTask(env, ctx, brain, urls, pending);
  if ((remaining?.c ?? 0) < 5) out.generated = await operate(env, ctx, brain);
  return out;
}

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

// Phase 1: pick a real product. Real Serper market research feeds the model,
// the pick lands in company_brain, and the decision is published to the bus.
async function pickProduct(env: Env, ctx: ExecutionContext) {
  if (!env.AI) return { error: "AI binding not configured" };
  const queries = [
    "underserved small business software needs 2026",
    "SaaS ideas with proven demand low competition",
    "tools indie hackers and agencies pay for monthly",
  ];
  const snippets: string[] = [];
  for (const q of queries) {
    const hits = await serper(env, q, 5).catch(() => null);
    if (hits) snippets.push(...hits.map((h) => `${h.title} — ${h.snippet}`));
  }
  const research = snippets.slice(0, 15).join("\n");
  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content:
          "You are the CEO of an autonomous software company. Using the market research below, pick ONE software product to build and sell. It must be small enough for AI agents to ship in weeks but valuable enough that businesses pay monthly. Reply with ONLY a JSON object: {\"name\": string, \"description\": string (one sentence), \"target_user\": string, \"why_now\": string (one sentence), \"tech\": string}. No markdown, no explanation.",
      },
      { role: "user", content: `Market research:\n${research || "no results — rely on general knowledge"}` },
    ],
    max_tokens: 300,
  });
  const pickRaw = (res as { response?: unknown }).response;
  const raw = (typeof pickRaw === "string" ? pickRaw : JSON.stringify(pickRaw ?? "")).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { error: "product pick not parseable", raw: raw.slice(0, 200) };
  let pick: { name?: string; description?: string; target_user?: string; why_now?: string; tech?: string };
  try {
    pick = JSON.parse(m[0]);
  } catch {
    return { error: "product pick not parseable", raw: raw.slice(0, 200) };
  }
  if (!pick.name) return { error: "product pick missing name" };

  await env.DB.prepare(
    `UPDATE company_brain SET product_name=?, product_description=?, tech_stack=?, metrics=?, shipped_features='[]', open_bugs='[]', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(
      pick.name,
      `${pick.description ?? ""} Target: ${pick.target_user ?? "small businesses"}. Why now: ${pick.why_now ?? ""}`.trim(),
      JSON.stringify({ stack: pick.tech ?? "Cloudflare Workers + D1" }),
      JSON.stringify({ users: 0, revenue: 0, mrr: 0, uptime_pct: 100, error_rate: 0, deploy_count: 0 }),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO milestone_log (milestone_type, description) VALUES ('product_selected', ?)",
  )
    .bind(`CEO picked product: ${pick.name} — ${pick.description ?? ""}`)
    .run();
  const text = `Picked our product: ${pick.name}. ${pick.why_now ?? pick.description ?? ""}`;
  const payload = JSON.stringify({ from: "ceo_1", agent: "ceo_1", text, model: "workers-ai/llama-3.3-70b", event: "product_selected" });
  await publishToBus(env, ctx, "conversations", payload);
  return { phase: "product_selected", product: pick.name, description: pick.description };
}

// Phase 2: operate — an agent generates one concrete sprint task for the real
// product and posts a status line. Skips task creation when the queue is deep.
async function operate(env: Env, ctx: ExecutionContext, brain: Brain) {
  if (!env.AI) return { error: "AI binding not configured" };
  const a = TICK_AGENTS[Math.floor(Math.random() * TICK_AGENTS.length)];
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) c FROM task_log WHERE status IN ('pending','in_progress')",
  )
    .first<{ c: number }>()
    .catch(() => ({ c: 0 }));

  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content: `You are ${a.persona} at an autonomous software company building "${brain.product_name}" (${brain.product_description ?? ""}). Mission: ${brain.mission ?? "build and launch a valuable product"}. Reply with ONLY JSON: {"status": "one line, first person, under 25 words", "task": "one concrete deliverable for the sprint or null if nothing new is needed"}. No markdown.`,
      },
      { role: "user", content: "What are you doing right now, and what single task most needs doing next?" },
    ],
    max_tokens: 120,
  });
  const opRaw = (res as { response?: unknown }).response;
  const raw = (typeof opRaw === "string" ? opRaw : JSON.stringify(opRaw ?? "")).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  let status = raw.slice(0, 200);
  let task: string | null = null;
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { status?: string; task?: string | null };
      status = (parsed.status ?? status).slice(0, 200);
      task = parsed.task || null;
    } catch {}
  }

  if (task && (pending?.c ?? 0) < 25) {
    await env.DB.prepare(
      "INSERT INTO task_log (task_id, agent_id, description, status, created_at) VALUES (lower(hex(randomblob(4))), ?, ?, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
      .bind(a.id, task)
      .run();
  }
  const payload = JSON.stringify({ from: a.id, agent: a.id, text: status, model: "workers-ai/llama-3.3-70b", ...(task ? { task } : {}) });
  const id = await publishToBus(env, ctx, "conversations", payload);
  return { phase: "operating", id, agent: a.id, text: status, task };
}

// --- GitHub execution -------------------------------------------------------
// The company's build output lands in the product repo on GitHub. Token lives
// in KV as conn:github (Settings → Connect or seeded), env fallback.
async function githubCred(env: Env): Promise<string | null> {
  return (await env.EPHEMERAL.get("conn:github")) ?? env.GITHUB_TOKEN ?? null;
}

async function gh(env: Env, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const token = await githubCred(env);
  if (!token) return { ok: false, status: 503, data: { error: "github not connected" } };
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "lazynext-worker",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, data };
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function ghPutFile(env: Env, repo: string, path: string, content: string, message: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const existing = await gh(env, "GET", `/repos/${repo}/contents/${path}`);
  const body: Record<string, unknown> = { message, content: b64(content) };
  if (existing.ok && existing.data.sha) body.sha = existing.data.sha;
  const r = await gh(env, "PUT", `/repos/${repo}/contents/${path}`, body);
  if (!r.ok) return { ok: false, error: JSON.stringify(r.data).slice(0, 300) };
  return { ok: true, url: (r.data.content as { html_url?: string } | undefined)?.html_url };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
}

function sanitizePath(p: string | undefined): string {
  const clean = (p ?? "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.+/g, "").slice(0, 200);
  return clean || `docs/output-${Date.now()}.md`;
}

// Phase 2a: product picked but no repo — create it on GitHub with a generated
// README + landing page, record it in company_brain.live_urls.
async function bootstrapRepo(env: Env, ctx: ExecutionContext, brain: Brain) {
  if (!env.AI) return { error: "AI binding not configured" };
  const owner = await gh(env, "GET", "/user");
  if (!owner.ok || !owner.data.login) return { phase: "bootstrap", error: "github not connected", detail: owner.data };
  const login = String(owner.data.login);
  const repo = `${login}/${slugify(brain.product_name!)}`;

  const created = await gh(env, "POST", "/user/repos", {
    name: slugify(brain.product_name!),
    private: false,
    description: `${brain.product_name} — ${(brain.product_description ?? "").slice(0, 200)}`,
    auto_init: false,
  });
  // 422 = repo already exists — that's fine, we use it.
  if (!created.ok && created.status !== 422) {
    return { phase: "bootstrap", error: "repo create failed", detail: created.data };
  }

  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content: `You are the founding engineer of "${brain.product_name}" (${brain.product_description ?? ""}). Reply with ONLY JSON: {"files": [{"path": "README.md", "content": "..."}, {"path": "index.html", "content": "a minimal landing page"}]}. Markdown for README, full standalone HTML for index.html. No markdown fences.`,
      },
      { role: "user", content: "Generate the repo's initial files." },
    ],
    max_tokens: 3000,
  });
  const raw0 = (res as { response?: unknown }).response;
  const raw = (typeof raw0 === "string" ? raw0 : JSON.stringify(raw0 ?? "")).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  let files: { path: string; content: string }[] = [];
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { files?: { path: string; content: string }[] };
      files = (parsed.files ?? []).filter((f) => f.path && f.content).slice(0, 4);
    } catch {}
  }
  if (!files.length) files = [{ path: "README.md", content: `# ${brain.product_name}\n\n${brain.product_description ?? ""}\n` }];

  const committed: string[] = [];
  for (const f of files) {
    const p = sanitizePath(f.path);
    const r = await ghPutFile(env, repo, p, f.content, `bootstrap: add ${p}`);
    if (r.ok) committed.push(p);
  }

  const repoUrl = `https://github.com/${repo}`;
  const newUrls = { ...(safeJson<Record<string, string>>(brain.live_urls) ?? {}), repo: repoUrl };
  await env.DB.prepare("UPDATE company_brain SET live_urls=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .bind(JSON.stringify(newUrls)).run();
  await env.DB.prepare("INSERT INTO milestone_log (milestone_type, description) VALUES ('repo_created', ?)")
    .bind(`Created GitHub repo ${repoUrl} for ${brain.product_name} (${committed.length} files)`).run();
  const text = `Created our repo: ${repoUrl} — committed ${committed.join(", ") || "nothing (exists)"}`;
  await publishToBus(env, ctx, "conversations", JSON.stringify({ from: "devops_1", agent: "devops_1", text, model: "workers-ai/llama-3.3-70b", event: "repo_created" }));
  return { phase: "repo_created", repo: repoUrl, committed };
}

// Phase 2b: execute one pending task — Workers AI produces a file artifact
// which is verified (real syntax check via the exec container where the file
// type allows, plus an LLM task-fit review), retried once on failure, then
// committed to the product repo and the task marked completed.
async function executeTask(env: Env, ctx: ExecutionContext, brain: Brain, urls: Record<string, string>, task: Task) {
  if (!env.AI) return { error: "AI binding not configured" };
  const repo = (urls.repo ?? "").replace("https://github.com/", "").replace(/\.git$/, "");
  if (!repo.includes("/")) return { task: task.task_id, error: "no repo" };

  await env.DB.prepare("UPDATE task_log SET status='in_progress', attempts=attempts+1, started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
    .bind(task.id).run();

  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // Two-step generation: a tiny JSON for path+summary (always parses), then
    // the raw file contents (no envelope — can't be truncated mid-JSON).
    const metaRes = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: `You are ${task.agent_id} at a software company building "${brain.product_name}". Choose where this task's deliverable belongs in the repo — code under src/, docs under docs/, marketing under marketing/, research under docs/research/. Reply with ONLY JSON: {"path": "relative/file/path", "summary": "one line"}.`,
        },
        { role: "user", content: `Task: ${task.description}` },
      ],
      max_tokens: 80,
    });
    const metaRaw0 = (metaRes as { response?: unknown }).response;
    const metaRaw = (typeof metaRaw0 === "string" ? metaRaw0 : JSON.stringify(metaRaw0 ?? "")).trim();
    const mm = metaRaw.match(/\{[\s\S]*\}/);
    let meta: { path?: string; summary?: string } | null = null;
    if (mm) { try { meta = JSON.parse(mm[0]); } catch {} }

    const ext = meta?.path?.split(".").pop()?.toLowerCase();
    const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: `You are ${task.agent_id} at a software company building "${brain.product_name}" (${brain.product_description ?? ""}). Write the complete contents of the file "${meta?.path ?? "docs/output.md"}" for this task — real, working content, no placeholders. Reply with ONLY the file contents — no JSON wrapper, no preamble, no markdown fences.${feedback ? ` Previous attempt was rejected: ${feedback}. Fix it.` : ""}`,
        },
        { role: "user", content: `Task: ${task.description}` },
      ],
      max_tokens: 3000,
    });
    const cRaw = (res as { response?: unknown }).response;
    const content = (typeof cRaw === "string" ? cRaw : JSON.stringify(cRaw ?? "")).trim();
    if (!content || content.length < 20) {
      await env.DB.prepare("UPDATE task_log SET status='failed', error_log=json_insert(error_log,'$[#]',?), completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind("no artifact produced", task.id).run();
      return { task: task.task_id, error: "no artifact produced" };
    }

    const path = sanitizePath(meta?.path ?? (ext ? `docs/output.${ext}` : `docs/output-${Date.now()}.md`));
    const v = await verifyArtifact(env, brain, task, path, content);
    if (v.ok) {
      const put = await ghPutFile(env, repo, path, content, `${task.agent_id}: ${(meta?.summary ?? task.description).slice(0, 60)}`);
      if (!put.ok) {
        await env.DB.prepare("UPDATE task_log SET status='failed', error_log=json_insert(error_log,'$[#]',?), completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
          .bind(put.error ?? "github commit failed", task.id).run();
        return { task: task.task_id, error: put.error };
      }
      await env.DB.prepare("UPDATE task_log SET status='completed', result=?, completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(put.url ?? `https://github.com/${repo}/blob/main/${path}`, task.id).run();
      const text = `Done: ${task.description.slice(0, 80)} → ${put.url ?? path}`;
      await publishToBus(env, ctx, "conversations", JSON.stringify({ from: task.agent_id, agent: task.agent_id, text, model: "workers-ai/llama-3.3-70b", event: "task_completed", task: task.task_id }));
      return { task: task.task_id, agent: task.agent_id, path, url: put.url, verified: v.how, attempts: attempt + 1 };
    }
    feedback = v.issue ?? "verification failed";
  }

  await env.DB.prepare("UPDATE task_log SET status='failed', error_log=json_insert(error_log,'$[#]',?), completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
    .bind(`verification failed: ${feedback}`.slice(0, 400), task.id).run();
  return { task: task.task_id, error: `verification failed: ${feedback}` };
}

// Verify an artifact before it touches the repo. Deterministic syntax checks
// run inside the exec container (Python) when the file type allows; otherwise
// an LLM review judges task fit. Returns the failure reason when rejected.
async function verifyArtifact(
  env: Env, brain: Brain, task: Task, path: string, content: string,
): Promise<{ ok: boolean; how?: string; issue?: string }> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const encoded = b64(content);
  const checks: Record<string, string> = {
    py: `import base64\ncompile(base64.b64decode("${encoded}").decode("utf-8","replace"),"a.py","exec")\nprint("ok")`,
    json: `import base64,json\njson.loads(base64.b64decode("${encoded}").decode("utf-8","replace"))\nprint("ok")`,
    html: `import base64\nfrom html.parser import HTMLParser\np=HTMLParser()\np.feed(base64.b64decode("${encoded}").decode("utf-8","replace"))\nassert "<" in base64.b64decode("${encoded}").decode("utf-8","replace")\nprint("ok")`,
    md: `import base64\nassert len(base64.b64decode("${encoded}").decode("utf-8","replace").strip())>20,"empty"\nprint("ok")`,
  };
  const check = checks[ext];
  if (check && env.CODE_EXEC) {
    try {
      const container = getContainer(env.CODE_EXEC);
      const r = await container.fetch(new Request("https://exec.local/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: check, timeout: 30 }),
      }));
      const out = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; stderr?: string };
      if (r.ok && out.success === false) {
        return { ok: false, how: "exec", issue: (out.error ?? out.stderr ?? "syntax check failed").slice(0, 300) };
      }
      if (r.ok && out.success) return { ok: true, how: "exec" };
      // Container unavailable → fall through to LLM review.
    } catch {}
  }

  const res = await env.AI!.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content: `You are a reviewer at a software company building "${brain.product_name}". Reject ONLY for clear problems: empty/stub content, placeholder text (TODO, "implement this"), wrong file type for its extension, malformed syntax, or content unrelated to the task. Cross-module references are fine — files may import helpers defined elsewhere in the repo. Reply with ONLY JSON: {"ok": true} or {"ok": false, "issue": "one line"}.`,
      },
      { role: "user", content: `Task: ${task.description}\nFile: ${path}\n\n${content.slice(0, 4000)}` },
    ],
    max_tokens: 100,
  });
  const raw0 = (res as { response?: unknown }).response;
  const raw = (typeof raw0 === "string" ? raw0 : JSON.stringify(raw0 ?? "")).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const v = JSON.parse(m[0]) as { ok?: boolean; issue?: string };
      return v.ok ? { ok: true, how: "llm" } : { ok: false, how: "llm", issue: (v.issue ?? "review failed").slice(0, 300) };
    } catch {}
  }
  return { ok: false, how: "llm", issue: "review not parseable" };
}
