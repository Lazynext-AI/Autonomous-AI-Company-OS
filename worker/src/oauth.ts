// Minimal OAuth 2.0 provider — client_credentials + authorization_code.
// Third-party apps get scoped access tokens backed by lzk_* API keys.
import { Env, json } from "./gateway";

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleOAuth(
  req: Request,
  env: Env,
  path: string,
  url: URL,
): Promise<Response> {
  // Token endpoint — exchange credentials for a bearer token.
  if (req.method === "POST" && path === "/oauth/token") {
    // Dispatch on content-type — req.formData() on a JSON body consumes the
    // stream before throwing, so the .json() fallback would read a used body.
    const ct = req.headers.get("content-type") ?? "";
    const body: Record<string, string> =
      ct.includes("form-urlencoded") || ct.includes("multipart/form-data")
        ? Object.fromEntries(
            (await req.formData().catch(() => new FormData())) as unknown as Iterable<[string, string]>,
          )
        : ((await req.json().catch(() => ({}))) as Record<string, string>);

    const grant = body.grant_type;

    // client_credentials: client_id + client_secret → token
    if (grant === "client_credentials") {
      const key = body.client_secret ?? "";
      if (!key.startsWith("lzk_"))
        return json({ error: "invalid_client" }, 401);
      const hash = await sha256(key);
      const { results } = await env.DB.prepare(
        "SELECT id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
      ).bind(hash).all();
      const row = results?.[0] as { id: number; scopes: string } | undefined;
      if (!row) return json({ error: "invalid_client" }, 401);
      // OAuth token = the lzk key itself (already scoped + rate-limited).
      return json({ access_token: key, token_type: "Bearer", scope: row.scopes });
    }

    // authorization_code: code → token
    if (grant === "authorization_code") {
      const code = body.code ?? "";
      const stored = await env.EPHEMERAL.get(`oauth_code:${code}`);
      if (!stored) return json({ error: "invalid_grant" }, 400);
      await env.EPHEMERAL.delete(`oauth_code:${code}`);
      const { key, scopes } = JSON.parse(stored) as { key: string; scopes: string };
      return json({ access_token: key, token_type: "Bearer", scope: scopes });
    }

    return json({ error: "unsupported_grant_type" }, 400);
  }

  // Authorize — mints a code the owner can hand to a third party.
  if (req.method === "POST" && path === "/oauth/authorize") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "admin token required" }, 401);
    const b = (await req.json()) as { scopes?: string };
    const code = crypto.randomUUID();
    // Generate a fresh lzk_ key for the third party.
    const key = `lzk_${crypto.randomUUID().replace(/-/g, "")}`;
    const hash = await sha256(key);
    await env.DB.prepare(
      "INSERT INTO api_keys (key_hash, key_prefix, name, scopes, rate_limit_rpm) VALUES (?, ?, 'oauth-app', ?, 60)",
    ).bind(hash, key.slice(0, 8), b.scopes ?? "read").run();
    await env.EPHEMERAL.put(
      `oauth_code:${code}`,
      JSON.stringify({ key, scopes: b.scopes ?? "read" }),
      { expirationTtl: 300 },
    );
    return json({ code, redirect_uri: url.searchParams.get("redirect_uri") ?? null });
  }

  return json({ error: "not found" }, 404);
}
