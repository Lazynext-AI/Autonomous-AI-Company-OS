import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Runs Python code in the Cloudflare exec container (POST /exec on the worker).
// The container is a sandboxed subprocess — returns stdout/stderr/result/error.
export async function POST(req: NextRequest) {
  const { code, timeout } = await req.json();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  return workerFetch("/exec", { code, timeout: timeout ?? 60 });
}
