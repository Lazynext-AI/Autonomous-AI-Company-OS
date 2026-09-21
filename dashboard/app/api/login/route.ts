import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function env() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return (await getCloudflareContext({ async: true })).env as Record<string, string | undefined>;
  } catch {
    return process.env as Record<string, string | undefined>;
  }
}

export async function POST(req: NextRequest) {
  const { passphrase } = await req.json();
  const e = await env();
  const expected = e.DASHBOARD_PASSPHRASE || process.env.DASHBOARD_PASSPHRASE;
  const token = e.DASHBOARD_SESSION_TOKEN || process.env.DASHBOARD_SESSION_TOKEN;
  if (!expected || !token || passphrase !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("lazynext_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
