import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { action, key, value } = await req.json();
  if (!key || !action) return NextResponse.json({ error: "key + action required" }, { status: 400 });
  if (action === "get") return workerFetch("/kv/get", { key });
  if (action === "put") return workerFetch("/kv/put", { key, value, ttl: 31536000 });
  if (action === "delete") return workerFetch("/kv/delete", { key });
  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
