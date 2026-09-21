import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { channel, payload } = await req.json();
    if (!channel || !payload) {
      return NextResponse.json({ error: "channel + payload required" }, { status: 400 });
    }
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const res = await (env as any).COMPANY_API.fetch("https://worker.internal/bus/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${(env as any).WORKER_API_TOKEN}`,
      },
      body: JSON.stringify({ channel, payload }),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
