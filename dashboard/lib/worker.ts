import { NextResponse } from "next/server";

async function workerEnv(): Promise<Record<string, string | undefined>> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    return ctx.env as Record<string, string | undefined>;
  } catch {
    return process.env as Record<string, string | undefined>;
  }
}

export async function workerFetch(path: string, body: unknown, method = "POST", internal = false) {
  const env = await workerEnv();
  const url = env.CLOUDFLARE_API_URL || process.env.CLOUDFLARE_API_URL;
  // /api/v1/* is the public API gateway — it requires an lzk_ key, not the
  // internal shared secret. Internal routes (/query, /kv/*) use API_TOKEN —
  // and admin-only /api/v1/* routes (billing subscriptions etc.) can force it.
  const isPublicApi = path.startsWith("/api/v1/") && !internal;
  const token = isPublicApi
    ? env.LAZYNEXT_API_KEY || process.env.LAZYNEXT_API_KEY
    : env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: "worker not configured" }, { status: 503 });
  }
  const init = {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const svc = env.COMPANY_API as { fetch: typeof fetch } | undefined;
  const res = svc?.fetch
    ? await svc.fetch(`${url.replace(/\/$/, "")}${path}`, init)
    : await fetch(`${url.replace(/\/$/, "")}${path}`, { ...init, cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function queryWorker(sql: string, params: unknown[] = []) {
  const env = await workerEnv();
  const url = env.CLOUDFLARE_API_URL || process.env.CLOUDFLARE_API_URL;
  const token = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

  if (!url || !token) {
    return NextResponse.json(
      { error: "CLOUDFLARE_API_URL / CLOUDFLARE_API_TOKEN not set" },
      { status: 503 }
    );
  }
  const reqInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sql, params }),
  };
  // In production use the service binding (same-account worker fetch is blocked)
  const svc = env.COMPANY_API as { fetch: typeof fetch } | undefined;
  const res = svc?.fetch
    ? await svc.fetch(`${url.replace(/\/$/, "")}/query`, reqInit)
    : await fetch(`${url.replace(/\/$/, "")}/query`, { ...reqInit, cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
