// A2A (Agent-to-Agent) interface — other AI agents can delegate work to
// Lazynext agents. Follows the agent-card + tasks/send/get shape.
import { Env, json, authorize, touchKey } from "./gateway";
import { publishToBus } from "./webhooks";

const AGENT_CARD = {
  name: "Lazynext — The Autonomous AI Company",
  description:
    "An autonomous company of 13 agents that research, build, test and ship software products.",
  url: "https://ai-company.lazynext.com",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  // tasks/send requires write scope, tasks/get requires read scope — Bearer lzk_ key.
  securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
  security: [{ bearerAuth: [] }],
  skills: [
    { id: "research", name: "Market research", description: "Research markets and pick products" },
    { id: "build", name: "Build software", description: "Write and commit code to GitHub" },
    { id: "test", name: "Test in sandboxes", description: "Run code in Cloudflare sandboxes" },
    { id: "deploy", name: "Deploy products", description: "Ship to Cloudflare" },
  ],
};

// task_log status → A2A task state. Rows move pending → in_progress →
// completed/failed; agentTick requeues failed (attempts<3) and sweeps stale
// in_progress claims to failed, so no state wedges forever.
const A2A_STATES: Record<string, string> = {
  pending: "submitted",
  in_progress: "working",
  completed: "completed",
  failed: "failed",
  escalated: "failed",
};

const A2A_ID = /^a2a-[0-9a-f]{8}$/i;

export async function handleA2a(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  if (path === "/.well-known/agent.json") return json(AGENT_CARD);

  if (req.method === "POST" && path === "/a2a") {
    const body = (await req.json()) as {
      jsonrpc?: string;
      method?: string;
      params?: { id?: string; message?: { parts?: { text?: string }[] } };
      id?: unknown;
    };
    const m = body.method ?? "";

    // tasks/send — delegate a task to the company (write scope required)
    if (m === "tasks/send" || m === "sendTask") {
      const { key, res } = await authorize(req, env, "write");
      if (!key) return res!;
      const text = (body.params?.message?.parts?.[0]?.text ?? "").trim();
      if (!text) return json({ error: "message text required" }, 400);
      const id = `a2a-${crypto.randomUUID().slice(0, 8)}`;
      // The real queue: agentTick executes the oldest pending task_log row
      // every cron tick. The unassigned cto.tasks bus channel has no
      // subscribers, so a bus publish alone would be a dead letter — the row
      // is what makes the task actually run (and what tasks/get reads).
      await env.DB.prepare(
        "INSERT INTO task_log (task_id, agent_id, description, status, created_at) VALUES (?, 'a2a-peer', ?, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      )
        .bind(id, text.slice(0, 4000))
        .run();
      const msg = {
        _type: "TaskMessage",
        message_id: crypto.randomUUID(),
        from_agent: "a2a-peer",
        channel: "cto.tasks",
        priority: 0,
        timestamp: new Date().toISOString(),
        task_id: id,
        description: text.slice(0, 4000),
        acceptance_criteria: [],
        context: { source: "a2a" },
      };
      await publishToBus(env, ctx, "cto.tasks", JSON.stringify(msg));
      touchKey(env, ctx, key.id);
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { id, status: { state: "submitted" } },
      });
    }

    // tasks/get — poll a task's real state from task_log (read scope required)
    if (m === "tasks/get" || m === "getTask") {
      const { key, res } = await authorize(req, env, "read");
      if (!key) return res!;
      const id = String(body.params?.id ?? "");
      // Issued ids are strictly a2a-<8 hex>.
      if (!A2A_ID.test(id)) {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "task not found" },
        });
      }
      const row = await env.DB.prepare(
        "SELECT status, result, error_log FROM task_log WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      )
        .bind(id)
        .first<{ status?: string; result?: string; error_log?: string }>();
      touchKey(env, ctx, key.id);
      if (!row) {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "task not found" },
        });
      }
      const state = A2A_STATES[row.status ?? ""] ?? "submitted";
      const artifacts = row.result
        ? [{ parts: [{ type: "text", text: String(row.result).slice(0, 4000) }] }]
        : [];
      let message;
      if (state === "failed" && row.error_log) {
        try {
          const errs = JSON.parse(row.error_log) as { error?: string }[];
          const last = errs[errs.length - 1]?.error;
          if (last) message = { parts: [{ type: "text", text: last.slice(0, 2000) }] };
        } catch {}
      }
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { id, status: { state, ...(message ? { message } : {}) }, artifacts },
      });
    }

    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } }, 404);
  }

  return json({ error: "not found" }, 404);
}
