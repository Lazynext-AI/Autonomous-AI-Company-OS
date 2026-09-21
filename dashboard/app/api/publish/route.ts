import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { channel, payload } = await req.json();
  if (!channel || !payload) {
    return NextResponse.json({ error: "channel + payload required" }, { status: 400 });
  }
  return workerFetch("/bus/publish", {
    channel,
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}
