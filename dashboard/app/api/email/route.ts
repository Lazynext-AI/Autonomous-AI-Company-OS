import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { to, subject, html } = await req.json();
  if (!to || !subject || !html)
    return NextResponse.json({ error: "to, subject, html required" }, { status: 400 });
  const r = await workerFetch("/email/send", { to, subject, html });
  return NextResponse.json(await r.json(), { status: r.status });
}
