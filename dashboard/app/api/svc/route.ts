import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Proxy for the native services (CRM / tickets / bookings / store) plus the
// Inkless signing connector on the worker. Reads happen via queryApi straight
// to D1; this route is only for writes so they go through the worker's
// validation + auth.
const ALLOWED = /^\/api\/v1\/(crm\/leads|support\/tickets|booking|store\/products|store\/orders|marketing\/contacts|marketing\/campaigns|inkless\/documents|inkless\/send|inkless\/events)(\/\d+(\/send)?)?$/;

export async function POST(req: NextRequest) {
  const { path, method = "POST", body } = await req.json();
  if (!path || !ALLOWED.test(path)) {
    return NextResponse.json({ error: "invalid service path" }, { status: 400 });
  }
  return workerFetch(path, body, method);
}
