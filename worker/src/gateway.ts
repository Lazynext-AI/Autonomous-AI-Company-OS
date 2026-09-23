/**
 * Gateway layer for the public Lazynext API + MCP endpoint.
 * API keys (lzk_*) hashed with SHA-256 in D1, per-minute rate limit in KV.
 * Scopes: read (query), write (mutations). Internal admin uses env.API_TOKEN.
 */

export interface Env {
  DB: D1Database;
  EPHEMERAL: KVNamespace;
  VECTORS: VectorizeIndex;
  AI?: Ai;
  BROWSER?: Fetcher;
  CODE_EXEC?: DurableObjectNamespace<import("./exec_container").CodeExecContainer>;
  API_TOKEN?: string;
  BREVO_API_KEY?: string;
  DODO_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  SERPER_API_KEY?: string;
  GITHUB_TOKEN?: string;
}

export interface ApiKey {
  id: number;
  key_hash: string;
  key_prefix: string;
  name: string;
  scopes: string;
  rate_limit_rpm: number;
  revoked_at: string | null;
}

export const JSON_HEADERS = { "content-type": "application/json" };

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...(extra ?? {}) },
  });
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, x-api-key",
};

export function cors(req: Request, res: Response): Response {
  if (!req.headers.get("origin")) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return req.headers.get("x-api-key");
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "lzk_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Look up an API key, check revocation + scope + rate limit. */
export async function authorize(
  req: Request,
  env: Env,
  scope: "read" | "write",
): Promise<{ key?: ApiKey; res?: Response }> {
  const raw = extractKey(req);
  if (!raw || !raw.startsWith("lzk_")) {
    return {
      res: json({ error: "missing or invalid API key" }, 401, {
        "www-authenticate": 'Bearer realm="lazynext", resource_metadata_url="/.well-known/oauth-protected-resource"',
      }),
    };
  }
  const hash = await sha256(raw);
  const key = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
  )
    .bind(hash)
    .first<ApiKey>();
  if (!key) return { res: json({ error: "invalid or revoked API key" }, 401) };

  const scopes = key.scopes.split(",").map((s) => s.trim());
  if (!scopes.includes(scope) && !scopes.includes("admin")) {
    return { res: json({ error: `scope '${scope}' required` }, 403) };
  }

  // Fixed-window per-minute rate limit via KV
  const bucket = Math.floor(Date.now() / 60000);
  const rlKey = `rl:${hash.slice(0, 16)}:${bucket}`;
  const used = parseInt((await env.EPHEMERAL.get(rlKey)) ?? "0", 10);
  if (used >= key.rate_limit_rpm) {
    return {
      res: json({ error: "rate limit exceeded", limit: key.rate_limit_rpm }, 429, {
        "retry-after": String(60 - (Math.floor(Date.now() / 1000) % 60)),
      }),
    };
  }
  await env.EPHEMERAL.put(rlKey, String(used + 1), { expirationTtl: 120 });
  return { key };
}

export function touchKey(env: Env, ctx: ExecutionContext, id: number): void {
  ctx.waitUntil(
    env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
      .run(),
  );
}
