import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Proxy for the native services (CRM / tickets / bookings / store) plus the
// SignWell signing connector on the worker. Reads happen via queryApi straight
// to D1; this route is only for writes so they go through the worker's
// validation + auth.
const ALLOWED = /^\/api\/v1\/(crm\/leads|support\/tickets|booking|store\/products|store\/orders|marketing\/contacts|marketing\/campaigns|signwell\/documents|signwell\/send|signwell\/events)(\/\d+(\/send)?)?$|^\/api\/v1\/connectors(\/[a-z]+)?$|^\/api\/v1\/sign\/requests(\/[0-9a-f-]{36}(\/remind)?)?$/;

export async function POST(req: NextRequest) {
  const { path, method = "POST", body } = await req.json();
  if (!path || !ALLOWED.test(path)) {
    return NextResponse.json({ error: "invalid service path" }, { status: 400 });
  }
  return workerFetch(path, body, method);
}
