import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function e2b(path: string, method = "GET", body?: unknown) {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const key = (env as any).E2B_API_KEY || process.env.E2B_API_KEY;
    if (!key) return NextResponse.json({ error: "E2B_API_KEY not set" }, { status: 503 });
    const res = await fetch(`https://api.e2b.dev${path}`, {
      method,
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return NextResponse.json({ raw: text }, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function GET() {
  return e2b("/sandboxes");
}

export async function POST() {
  return e2b("/sandboxes", "POST", { templateID: "base", timeout: 300, metadata: { source: "lazynext-dashboard" } });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return e2b(`/sandboxes/${id}`, "DELETE");
}
