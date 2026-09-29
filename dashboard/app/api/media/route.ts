import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Media library proxy — KV-backed asset store on the worker. Uploads and
// deletes go through the worker's scoped-key auth; this route only ever
// touches the /api/v1/media namespace, nothing else.
const MEDIA_ID = /^[0-9a-f-]{36}$/;

export async function GET() {
  return workerFetch("/api/v1/media", undefined, "GET");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.data_b64 || !body?.type) {
    return NextResponse.json({ error: "type and data_b64 required" }, { status: 400 });
  }
  return workerFetch("/api/v1/media", {
    name: typeof body.name === "string" ? body.name.slice(0, 200) : undefined,
    type: String(body.type),
    data_b64: String(body.data_b64),
  });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!MEDIA_ID.test(id)) {
    return NextResponse.json({ error: "valid id required" }, { status: 400 });
  }
  return workerFetch(`/api/v1/media/${id}`, undefined, "DELETE");
}
