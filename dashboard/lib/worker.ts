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
