// A2A (Agent-to-Agent) interface — other AI agents can delegate work to
// Lazynext agents. Follows the agent-card + tasks/send/get shape.
import { Env, json } from "./gateway";
import { publishToBus } from "./webhooks";

const AGENT_CARD = {
  name: "Lazynext — The Autonomous AI Company",
  description:
    "An autonomous company of 13 agents that research, build, test and ship software products.",
  url: "https://ai-company.lazynext.com",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: true },
  skills: [
    { id: "research", name: "Market research", description: "Research markets and pick products" },
    { id: "build", name: "Build software", description: "Write and commit code to GitHub" },
    { id: "test", name: "Test in sandboxes", description: "Run code in E2B sandboxes" },
    { id: "deploy", name: "Deploy products", description: "Ship to Cloudflare" },
  ],
};

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

    // tasks/send — delegate a task to the company
    if (m === "tasks/send" || m === "sendTask") {
      const text = body.params?.message?.parts?.[0]?.text ?? "";
      if (!text) return json({ error: "message text required" }, 400);
      const id = `a2a-${crypto.randomUUID().slice(0, 8)}`;
      // Goes through publishToBus — fans out to webhooks like any message.
      await publishToBus(env, ctx, "a2a.tasks", JSON.stringify({ id, task: text, source: "a2a" }));
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { id, status: { state: "submitted" } },
      });
    }

    // tasks/get — poll a task's state
    if (m === "tasks/get" || m === "getTask") {
      const id = body.params?.id ?? "";
      const { results } = await env.DB.prepare(
        "SELECT payload, created_at FROM bus_messages WHERE channel = 'a2a.tasks' AND payload LIKE ? ORDER BY id DESC LIMIT 1",
      )
        .bind(`%"id":"${id}"%`)
        .all();
      const row = results?.[0] as { payload?: string } | undefined;
      if (!row) return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "task not found" } });
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: { id, status: { state: "working" }, history: [row.payload] },
      });
    }

    return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } }, 404);
  }

  return json({ error: "not found" }, 404);
}
