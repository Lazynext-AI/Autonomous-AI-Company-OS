import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";
import * as OTPAuth from "otpauth";

export const dynamic = "force-dynamic";

async function kvGet(key: string) {
  const r = await workerFetch("/kv/get", { key });
  const d = await r.json();
  return d.value as string | null;
}
async function kvPut(key: string, value: string, ttl?: number) {
  await workerFetch("/kv/put", { key, value, ...(ttl === undefined ? {} : { ttl }) });
}
async function kvDel(key: string) {
  await workerFetch("/kv/delete", { key }).catch(() => {});
}

function totp(secret: string) {
  return new OTPAuth.TOTP({
    issuer: "Lazynext",
    label: "founder",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export async function POST(req: NextRequest) {
  const { action, code } = await req.json();

  if (action === "status") {
    const enabled = (await kvGet("flag:two_factor")) === "true" && !!(await kvGet("2fa:secret"));
    return NextResponse.json({ enabled });
  }

  // Generate a fresh pending secret — NOT enabled until a code confirms.
  if (action === "setup") {
    const secret = new OTPAuth.Secret({ size: 20 });
    await kvPut("2fa:pending", secret.base32, 300);
    const uri = totp(secret.base32).toString();
    return NextResponse.json({ secret: secret.base32, uri });
  }

  // First-code confirm → enable 2FA.
  if (action === "confirm") {
    const pending = await kvGet("2fa:pending");
    if (!pending) return NextResponse.json({ error: "no pending setup" }, { status: 400 });
    const valid = totp(pending).validate({ token: String(code ?? ""), window: 1 }) !== null;
    if (!valid) return NextResponse.json({ error: "invalid code" }, { status: 401 });
    await kvPut("2fa:secret", pending, 0);
    await kvPut("flag:two_factor", "true", 0);
    await kvDel("2fa:pending");
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    const secret = await kvGet("2fa:secret");
    if (secret) {
      const valid = totp(secret).validate({ token: String(code ?? ""), window: 1 }) !== null;
      if (!valid) return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }
    await kvPut("flag:two_factor", "false", 0);
    await kvDel("2fa:secret");
    return NextResponse.json({ ok: true });
  }

  // Verify a code at login.
  if (action === "verify") {
    const secret = await kvGet("2fa:secret");
    if (!secret) return NextResponse.json({ error: "2fa not enabled" }, { status: 400 });
    const valid = totp(secret).validate({ token: String(code ?? ""), window: 1 }) !== null;
    if (!valid) return NextResponse.json({ error: "invalid code" }, { status: 401 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
