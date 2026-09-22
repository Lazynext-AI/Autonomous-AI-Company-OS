/**
 * Public Lazynext REST API - /api/v1/*.
 * Thin facade over D1/KV/bus - reuses the same internals as the internal worker
 * endpoints and the Python agents. No duplicated business logic.
 */
import { Env, json, authorize, touchKey, extractKey, sha256, generateKey } from "./gateway";
import { OPENAPI_SPEC, DOCS_HTML } from "./openapi";
import { publishToBus } from "./webhooks";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

async function listBriefings(env: Env, limit: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, subject, substr(content, 1, 300) AS preview, created_at FROM briefings ORDER BY id DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return json({ briefings: results ?? [] });
}

async function getBriefing(env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM briefings WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  return json({ briefing: row });
}

async function listTasks(env: Env, url: URL): Promise<Response> {
  const limit = clamp(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1, 200);
  const { results } = await env.DB.prepare(
    "SELECT * FROM task_log ORDER BY created_at DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return json({ tasks: results ?? [] });
}

async function createTask(env: Env, ctx: ExecutionContext, req: Request): Promise<Response> {
  const b = (await req.json()) as {
    description?: string;
    channel?: string;
    priority?: number;
    acceptance_criteria?: string[];
  };
  if (!b.description?.trim()) return json({ error: "description required" }, 400);
  const channel = b.channel?.trim() || "cto.tasks";
  if (!/^[a-z0-9._-]+$/i.test(channel) || channel.length > 100) {
    return json({ error: "invalid channel" }, 400);
  }
  const taskId = crypto.randomUUID();
  const msg = {
    message_id: crypto.randomUUID(),
    from_agent: "public-api",
    to_agent: "",
    channel,
    priority: b.priority ?? 0,
    timestamp: new Date().toISOString(),
    task_id: taskId,
    description: b.description.trim(),
    acceptance_criteria: b.acceptance_criteria ?? [],
    context: { source: "public-api" },
  };
  const messageId = await publishToBus(env, ctx, channel, JSON.stringify(msg));
  return json({ task_id: taskId, message_id: messageId, channel }, 201);
}

async function companyStatus(env: Env): Promise<Response> {
  const [tasks, briefings, chunks, pending] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM task_log"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM briefings"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM bus_deliveries"),
  ]);
  return json({
    tasks_logged: tasks.results?.[0]?.n ?? 0,
    briefings: briefings.results?.[0]?.n ?? 0,
    knowledge_chunks: chunks.results?.[0]?.n ?? 0,
    pending_deliveries: pending.results?.[0]?.n ?? 0,
  });
}

async function knowledgeSearch(env: Env, req: Request): Promise<Response> {
  const b = (await req.json()) as {
    query?: string;
    vector?: number[];
    topK?: number;
    category?: string;
  };
  const topK = clamp(b.topK ?? 5, 1, 20);

  // Semantic path: caller supplies an embedding vector (agents embed locally).
  if (Array.isArray(b.vector) && b.vector.length > 0) {
    const matches = await env.VECTORS.query(b.vector, {
      topK,
      filter: b.category ? { category: b.category } : undefined,
      returnMetadata: "all",
    });
    const rows = await Promise.all(
      matches.matches.map((m) =>
        env.DB.prepare(
          "SELECT id, filename, category, content FROM knowledge_chunks WHERE id = ?",
        )
          .bind(m.id)
          .first(),
      ),
    );
    return json({
      results: matches.matches.map((m, i) => ({ score: m.score, chunk: rows[i] })),
    });
  }

  if (!b.query?.trim()) return json({ error: "query or vector required" }, 400);
  const like = `%${b.query.trim().replace(/[%_]/g, "")}%`;
  const sql = b.category
    ? "SELECT id, filename, category, substr(content, 1, 800) AS content FROM knowledge_chunks WHERE content LIKE ? AND category = ? LIMIT ?"
    : "SELECT id, filename, category, substr(content, 1, 800) AS content FROM knowledge_chunks WHERE content LIKE ? LIMIT ?";
  const stmt = b.category
    ? env.DB.prepare(sql).bind(like, b.category, topK)
    : env.DB.prepare(sql).bind(like, topK);
  const { results } = await stmt.all();
  return json({ results: results ?? [] });
}

/** Admin key management - authenticated with the internal API_TOKEN, not lzk keys. */
async function handleKeyAdmin(req: Request, env: Env, path: string): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) {
    return json({ error: "admin token required" }, 401);
  }
  const url = new URL(req.url);

  if (req.method === "POST" && path === "/api/v1/keys") {
    const b = (await req.json()) as { name?: string; scopes?: string; rate_limit_rpm?: number };
    if (!b.name?.trim()) return json({ error: "name required" }, 400);
    const scopes = (b.scopes ?? "read")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ["read", "write", "admin"].includes(s));
    if (!scopes.length) return json({ error: "invalid scopes" }, 400);
    const raw = generateKey();
    await env.DB.prepare(
      "INSERT INTO api_keys (key_hash, key_prefix, name, scopes, rate_limit_rpm) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(sha256 ? await sha256(raw) : raw, raw.slice(0, 12), b.name.trim(), scopes.join(","), clamp(b.rate_limit_rpm ?? 60, 1, 10000))
      .run();
    return json({ api_key: raw, name: b.name.trim(), scopes, note: "Store this key - it will not be shown again." }, 201);
  }

  if (req.method === "GET" && path === "/api/v1/keys") {
    const { results } = await env.DB.prepare(
      "SELECT id, key_prefix, name, scopes, rate_limit_rpm, created_at, last_used_at, revoked_at FROM api_keys ORDER BY id",
    ).all();
    return json({ keys: results ?? [] });
  }

  if (req.method === "DELETE" && path.startsWith("/api/v1/keys/")) {
    const id = parseInt(path.split("/").pop() ?? "", 10);
    if (!id) return json({ error: "invalid id" }, 400);
    await env.DB.prepare(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
      .bind(new Date().toISOString(), id)
      .run();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

export async function handlePublicApi(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const url = new URL(req.url);

  if (path === "/api/v1/health") {
    return json({ ok: true, service: "lazynext-api", version: "1.0.0" });
  }

  // Public waitlist — no API key needed; the marketing form posts here.
  if (req.method === "POST" && path === "/api/v1/waitlist") {
    try {
      const b = (await req.json()) as { email?: string };
      const email = (b.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return json({ error: "valid email required" }, 400);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)",
      ).bind(email, "landing").run();
      return json({ ok: true });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (path === "/api/v1/openapi.json") return json(OPENAPI_SPEC);
  if (path === "/api/v1/docs") {
    return new Response(DOCS_HTML, { headers: { "content-type": "text/html" } });
  }

  if (path.startsWith("/api/v1/keys")) return handleKeyAdmin(req, env, path);

  // Everything below needs an API key. Mutations need write scope.
  const needsWrite = req.method === "POST" && path === "/api/v1/tasks";
  const { key, res } = await authorize(req, env, needsWrite ? "write" : "read");
  if (res) return res;
  touchKey(env, ctx, key!.id);

  if (req.method === "GET" && path === "/api/v1/status") return companyStatus(env);
  if (req.method === "GET" && path === "/api/v1/briefings") {
    return listBriefings(env, clamp(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1, 100));
  }
  if (req.method === "GET" && path.startsWith("/api/v1/briefings/")) {
    return getBriefing(env, parseInt(path.split("/").pop() ?? "", 10));
  }
  if (req.method === "GET" && path === "/api/v1/tasks") return listTasks(env, url);
  if (req.method === "POST" && path === "/api/v1/tasks") return createTask(env, ctx, req);
  if (req.method === "POST" && path === "/api/v1/knowledge/search") return knowledgeSearch(env, req);
  if (req.method === "GET" && path === "/api/v1/agents") {
    const { results } = await env.DB.prepare(
      "SELECT agent_id, COUNT(*) AS tasks, MAX(created_at) AS last_seen FROM task_log GROUP BY agent_id ORDER BY last_seen DESC",
    ).all();
    return json({ agents: results ?? [] });
  }

  return json({ error: "not found" }, 404);
}
