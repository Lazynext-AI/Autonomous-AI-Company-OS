import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  return workerFetch("/api/v1/webhooks", undefined, "GET");
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  return workerFetch("/api/v1/webhooks", b, "POST");
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return workerFetch(`/api/v1/webhooks/${id}`, undefined, "DELETE");
}
