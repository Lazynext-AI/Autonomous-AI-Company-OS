import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function workerFetch(path: string, body: unknown) {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const svc = (env as any).COMPANY_API;
    const res = await svc.fetch(`https://worker.internal${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${(env as any).WORKER_API_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const { action, key, value } = await req.json();
  if (!key || !action) return NextResponse.json({ error: "key + action required" }, { status: 400 });
  if (action === "get") return workerFetch("/kv/get", { key });
  if (action === "put") return workerFetch("/kv/put", { key, value, ttl: 31536000 });
  if (action === "delete") return workerFetch("/kv/delete", { key });
  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
