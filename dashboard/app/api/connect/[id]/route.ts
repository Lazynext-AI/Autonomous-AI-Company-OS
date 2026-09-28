import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// OAuth connect entry — calls the worker's /connect/{id}/start with the
// admin key server-side (never exposed to the browser) and 302s to the
// provider's authorize URL. Requires conn:{id}:app in KV ("client_id[:secret]").
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await workerFetch(`/api/v1/connect/${encodeURIComponent(id)}/start`, undefined, "GET");
  const d = (await r.json()) as { authorize_url?: string; error?: string };
  if (!r.ok || !d.authorize_url) return NextResponse.json(d, { status: r.status });
  return NextResponse.redirect(d.authorize_url);
}
