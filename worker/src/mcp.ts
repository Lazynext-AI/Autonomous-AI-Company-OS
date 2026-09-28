/**
 * Lazynext MCP Server - implements MCP specification 2026-07-28
 * (streamable HTTP transport, JSON-RPC 2.0).
 *
 * Stateless POST /mcp endpoint: JSON responses (allowed by spec when the
 * server doesn't stream). Tools map onto the same D1/KV/bus internals the
 * Python agents use - no duplicated business logic.
 *
 * Auth: Authorization: Bearer <lzk_...> API key (shared with /api/v1).
 *   read scope: tools/list + read tools + resources
 *   write scope: create_task, publish_message
 */
import { Env, ApiKey, json, authorize, touchKey, extractKey } from "./gateway";
import { publishToBus } from "./webhooks";

const PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = new Set([
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

const SERVER_INFO = { name: "lazynext", version: "1.0.0", title: "Lazynext AI Company" };
const INSTRUCTIONS =
  "Lazynext AI Company server. Tools expose the autonomous company's task log, " +
  "briefings, knowledge base, and message bus. create_task queues work for agents.";

type Json = Record<string, unknown>;

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

const text = (t: string) => ({ type: "text", text: t });
const result = (id: RpcRequest["id"], r: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: r });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------- tools ----

const TOOLS = [
  {
    name: "company_status",
    description: "Company snapshot: task/briefing/knowledge counts and bus delivery receipts.",
    inputSchema: { type: "object", properties: {} },
    scope: "read",
  },
  {
    name: "list_briefings",
    description: "List founder/agent briefings (newest first).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max rows (1-100, default 20)" } },
    },
    scope: "read",
  },
  {
    name: "get_briefing",
    description: "Fetch a full briefing by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    scope: "read",
  },
  {
    name: "list_tasks",
    description: "List agent task log entries (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (1-200, default 50)" },
        status: { type: "string", description: "pending|in_progress|completed|failed|escalated" },
      },
    },
    scope: "read",
  },
  {
    name: "search_knowledge",
    description:
      "Search the company knowledge base. Provide 'vector' (embedding array) for semantic " +
      "search, or 'query' for text match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        vector: { type: "array", items: { type: "number" } },
        topK: { type: "number" },
        category: { type: "string" },
      },
    },
    scope: "read",
  },
  {
    name: "list_agents",
    description: "Agent activity summary (task counts + last seen) from the task log.",
    inputSchema: { type: "object", properties: {} },
    scope: "read",
  },
  {
    name: "create_task",
    description:
      "Queue a task for company agents on the message bus (default channel cto.tasks). " +
      "Returns task_id.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        channel: { type: "string", description: "Bus channel, default cto.tasks" },
        priority: { type: "number" },
        acceptance_criteria: { type: "array", items: { type: "string" } },
      },
      required: ["description"],
    },
    scope: "write",
  },
  {
    name: "publish_message",
    description: "Publish a raw JSON payload to a bus channel (advanced).",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        payload: { type: "string", description: "JSON string payload" },
      },
      required: ["channel", "payload"],
    },
    scope: "write",
  },
] as const;

async function callTool(env: Env, ctx: ExecutionContext, name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "company_status": {
      const [tasks, briefings, chunks, pending] = await env.DB.batch<{ n: number }>([
        env.DB.prepare("SELECT COUNT(*) AS n FROM task_log"),
        env.DB.prepare("SELECT COUNT(*) AS n FROM briefings"),
        env.DB.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks"),
        env.DB.prepare("SELECT COUNT(*) AS n FROM bus_deliveries"),
      ]);
      return {
        tasks_logged: tasks.results?.[0]?.n ?? 0,
        briefings: briefings.results?.[0]?.n ?? 0,
        knowledge_chunks: chunks.results?.[0]?.n ?? 0,
        deliveries_logged: pending.results?.[0]?.n ?? 0,
      };
    }
    case "list_briefings": {
      const limit = clamp(Number(args.limit ?? 20), 1, 100);
      const { results } = await env.DB.prepare(
        "SELECT id, kind, subject, substr(content,1,300) AS preview, created_at FROM briefings ORDER BY id DESC LIMIT ?",
      )
        .bind(limit)
        .all();
      return { briefings: results ?? [] };
    }
    case "get_briefing": {
      const row = await env.DB.prepare("SELECT * FROM briefings WHERE id = ?")
        .bind(Number(args.id))
        .first();
      if (!row) throw new Error("briefing not found");
      return row;
    }
    case "list_tasks": {
      const limit = clamp(Number(args.limit ?? 50), 1, 200);
      const status = typeof args.status === "string" ? args.status : null;
      const sql = status
        ? "SELECT * FROM task_log WHERE status = ? ORDER BY created_at DESC LIMIT ?"
        : "SELECT * FROM task_log ORDER BY created_at DESC LIMIT ?";
      const stmt = status
        ? env.DB.prepare(sql).bind(status, limit)
        : env.DB.prepare(sql).bind(limit);
      const { results } = await stmt.all();
      return { tasks: results ?? [] };
    }
    case "list_agents": {
      const { results } = await env.DB.prepare(
        "SELECT agent_id, COUNT(*) AS tasks, MAX(created_at) AS last_seen FROM task_log GROUP BY agent_id ORDER BY last_seen DESC",
      ).all();
      return { agents: results ?? [] };
    }
    case "search_knowledge": {
      const topK = clamp(Number(args.topK ?? 5), 1, 20);
      if (Array.isArray(args.vector) && args.vector.length) {
        const matches = await env.VECTORS.query(args.vector as number[], {
          topK,
          filter: typeof args.category === "string" ? { category: args.category } : undefined,
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
        return { results: matches.matches.map((m, i) => ({ score: m.score, chunk: rows[i] })) };
      }
      const q = typeof args.query === "string" ? args.query.trim().replace(/[%_]/g, "") : "";
      if (!q) throw new Error("query or vector required");
      const like = `%${q}%`;
      const { results } = await env.DB.prepare(
        "SELECT id, filename, category, substr(content,1,800) AS content FROM knowledge_chunks WHERE content LIKE ? LIMIT ?",
      )
        .bind(like, topK)
        .all();
      return { results: results ?? [] };
    }
    case "create_task": {
      const desc = typeof args.description === "string" ? args.description.trim() : "";
      if (!desc) throw new Error("description required");
      const channel =
        typeof args.channel === "string" && /^[a-z0-9._-]+$/i.test(args.channel)
          ? args.channel
          : "cto.tasks";
      const taskId = crypto.randomUUID();
      // task_log is the real queue — agentTick executes the oldest pending
      // row every cron tick. The default cto.tasks bus channel has no
      // subscribers (only role channels like cto.tasks.backend do), so a
      // bus publish alone was a dead letter; the row guarantees execution.
      await env.DB.prepare(
        "INSERT INTO task_log (task_id, agent_id, description, status, created_at) VALUES (?, 'mcp-client', ?, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      )
        .bind(taskId, desc.slice(0, 4000))
        .run();
      const msg = {
        // Python bus deserializes on _type; without it messages decode to
        // BaseMessage and agents drop them as unsupported.
        _type: "TaskMessage",
        message_id: crypto.randomUUID(),
        from_agent: "mcp-client",
        channel,
        priority: Number(args.priority ?? 0),
        timestamp: new Date().toISOString(),
        task_id: taskId,
        description: desc,
        acceptance_criteria: Array.isArray(args.acceptance_criteria)
          ? args.acceptance_criteria
          : [],
        context: { source: "mcp" },
      };
      const messageId = await publishToBus(env, ctx, channel, JSON.stringify(msg));
      return { task_id: taskId, message_id: messageId, channel };
    }
    case "publish_message": {
      const channel = String(args.channel ?? "");
      const payload = String(args.payload ?? "");
      if (!/^[a-z0-9._-]+$/i.test(channel) || channel.length > 100) {
        throw new Error("invalid channel");
      }
      try {
        JSON.parse(payload);
      } catch {
        throw new Error("payload must be valid JSON");
      }
      const messageId = await publishToBus(env, ctx, channel, payload);
      return { message_id: messageId, channel };
    }
    default:
      throw Object.assign(new Error("unknown tool"), { code: -32602 });
  }
}

// ------------------------------------------------------------ resources ----

async function listResources(env: Env): Promise<unknown> {
  const { results } = await env.DB.prepare(
    "SELECT id, subject, created_at FROM briefings ORDER BY id DESC LIMIT 50",
  ).all();
  return {
    resources: (results ?? []).map((r) => ({
      uri: `lazynext://briefing/${r.id}`,
      name: `briefing-${r.id}`,
      title: String(r.subject),
      mimeType: "text/markdown",
      annotations: { audience: ["user"], lastModified: String(r.created_at) },
    })),
  };
}

async function readResource(env: Env, uri: string): Promise<unknown> {
  const m = /^lazynext:\/\/briefing\/(\d+)$/.exec(uri);
  if (!m) throw Object.assign(new Error("unknown resource uri"), { code: -32602 });
  const row = await env.DB.prepare("SELECT * FROM briefings WHERE id = ?")
    .bind(Number(m[1]))
    .first<{ content: string; subject: string; created_at: string }>();
  if (!row) throw Object.assign(new Error("resource not found"), { code: -32002 });
  return {
    contents: [
      { uri, mimeType: "text/markdown", text: `# ${row.subject}\n\n${row.content}` },
    ],
  };
}

// ------------------------------------------------------------- dispatch ----

async function dispatch(env: Env, ctx: ExecutionContext, key: ApiKey, req: RpcRequest): Promise<unknown> {
  const scopes = key.scopes.split(",").map((s) => s.trim());
  const canWrite = scopes.includes("write") || scopes.includes("admin");

  switch (req.method) {
    case "initialize": {
      const clientVersion = (req.params?.protocolVersion as string) ?? "";
      const negotiated = SUPPORTED_VERSIONS.has(clientVersion)
        ? clientVersion
        : PROTOCOL_VERSION;
      return {
        protocolVersion: negotiated,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.filter((t) => t.scope === "read" || canWrite).map(
          ({ scope: _s, ...t }) => t,
        ),
      };
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) throw Object.assign(new Error("unknown tool"), { code: -32602 });
      if (tool.scope === "write" && !canWrite) {
        return { content: [text(`Tool '${name}' requires a write-scoped API key`)], isError: true };
      }
      const out = await callTool(env, ctx, name, (req.params?.arguments as Json) ?? {});
      return {
        content: [text(typeof out === "string" ? out : JSON.stringify(out, null, 2))],
        structuredContent: typeof out === "object" ? out : undefined,
      };
    }
    case "resources/list":
      return listResources(env);
    case "resources/read":
      return readResource(env, String(req.params?.uri ?? ""));
    default:
      throw Object.assign(new Error(`method not found: ${req.method}`), { code: -32601 });
  }
}

// ---------------------------------------------------------------- entry ----

export async function handleMcp(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Streamable HTTP: this server serves POST only (no SSE streams).
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return json({ error: "POST only - this server does not offer SSE streams" }, 405, {
      allow: "POST",
    });
  }

  // Auth runs before method dispatch so 401/403 aren't wrapped in JSON-RPC.
  const raw = extractKey(req);
  if (!raw) {
    return json({ error: "missing API key" }, 401, {
      "www-authenticate": 'Bearer realm="lazynext"',
    });
  }
  const { key, res } = await authorize(req, env, "read");
  if (res) return res;
  touchKey(env, ctx, key!.id);

  let body: RpcRequest | RpcRequest[];
  try {
    body = (await req.json()) as RpcRequest | RpcRequest[];
  } catch {
    return json(rpcError(null, -32700, "parse error"), 400, {
      "mcp-protocol-version": PROTOCOL_VERSION,
    });
  }

  const headers = { "mcp-protocol-version": PROTOCOL_VERSION };

  // Notifications: no id -> no response body (spec: 202 Accepted).
  const isNotification = (r: RpcRequest) => r.id === undefined || r.id === null;

  const handleOne = async (r: RpcRequest): Promise<unknown | null> => {
    if (r.jsonrpc !== "2.0" || typeof r.method !== "string") {
      return isNotification(r) ? null : rpcError(r.id, -32600, "invalid request");
    }
    if (isNotification(r)) return null; // notifications/initialized etc.
    try {
      return result(r.id, await dispatch(env, ctx, key!, r));
    } catch (e) {
      const code = (e as { code?: number }).code ?? -32603;
      return rpcError(r.id, code, e instanceof Error ? e.message : String(e));
    }
  };

  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "invalid request"), 400, headers);
    const outs = (await Promise.all(body.map(handleOne))).filter((o) => o !== null);
    if (!outs.length) return new Response(null, { status: 202, headers });
    return json(outs, 200, headers);
  }

  if (isNotification(body)) return new Response(null, { status: 202, headers });
  const out = await handleOne(body);
  return json(out, 200, headers);
}
