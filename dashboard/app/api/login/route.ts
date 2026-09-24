import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";
import { rateLimited } from "@/lib/auth";
import * as OTPAuth from "otpauth";

export const dynamic = "force-dynamic";

async function env() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return (await getCloudflareContext({ async: true })).env as Record<string, string | undefined>;
  } catch {
    return process.env as Record<string, string | undefined>;
  }
}

async function kvGet(key: string): Promise<string | null> {
  const r = await workerFetch("/kv/get", { key });
  const d = await r.json();
  return d.value ?? null;
}

export async function POST(req: NextRequest) {
  if (await rateLimited(req, "owner-login", 10))
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const { passphrase, code } = await req.json();
  const e = await env();
  const expected = e.DASHBOARD_PASSPHRASE || process.env.DASHBOARD_PASSPHRASE;
  const token = e.DASHBOARD_SESSION_TOKEN || process.env.DASHBOARD_SESSION_TOKEN;
  if (!expected || !token || passphrase !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Real TOTP second factor — when enabled, the passphrase alone isn't enough.
  const twoFactorOn = (await kvGet("flag:two_factor")) === "true";
  const secret = await kvGet("2fa:secret");
  if (twoFactorOn && secret) {
    if (!code) return NextResponse.json({ totp: true });
    const t = new OTPAuth.TOTP({
      issuer: "Lazynext", label: "founder", algorithm: "SHA1",
      digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret),
    });
    if (t.validate({ token: String(code), window: 1 }) === null) {
      return NextResponse.json({ error: "invalid authenticator code" }, { status: 401 });
    }
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
