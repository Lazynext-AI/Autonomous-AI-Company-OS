import { NextRequest, NextResponse } from "next/server";
import { workerFetch, queryWorker } from "@/lib/worker";
import { hashPassword, verifyPassword, genToken } from "@/lib/auth";
import * as OTPAuth from "otpauth";

export const dynamic = "force-dynamic";

const APP = "https://dashboard.lazynext.com";

async function email(to: string, subject: string, html: string) {
  await workerFetch("/email/send", { to, subject, html });
}

function branded(title: string, body: string, cta?: { href: string; label: string }) {
  return `<div style="font-family:sans-serif;background:#0A0A0B;color:#FAFAFA;padding:32px;border-radius:12px;max-width:480px">
    <h2 style="margin:0 0 12px"><span style="color:#A78BFA">◆</span> Lazynext</h2>
    <p style="color:#9C9CAA;line-height:1.5">${body}</p>
    ${cta ? `<a href="${cta.href}" style="display:inline-block;margin-top:16px;background:#8B5CF6;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">${cta.label}</a>` : ""}
  </div>`;
}

async function setSession(res: NextResponse, userId: number) {
  const token = genToken();
  await workerFetch("/kv/put", { key: `session:${token}`, value: String(userId), ttl: 60 * 60 * 24 * 30 });
  res.cookies.set("lz_user_session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
}

export async function POST(req: NextRequest) {
  const { action, email: rawEmail, password, code, token } = await req.json();
  const emailAddr = String(rawEmail ?? "").trim().toLowerCase();

  // ── Signup → create user + send verify link ─────────────────────────────
  if (action === "signup") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr))
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    if (!password || password.length < 8)
      return NextResponse.json({ error: "password must be 8+ chars" }, { status: 400 });
    const existing = await queryWorker("SELECT id FROM users WHERE email = ?", [emailAddr]);
    const rows = await existing.json();
    if (rows.results?.length) return NextResponse.json({ error: "account exists" }, { status: 409 });
    const { salt, hash } = await hashPassword(password);
    const verifyToken = genToken();
    await queryWorker(
      "INSERT INTO users (email, password_hash, salt, role, verify_token) VALUES (?, ?, ?, 'member', ?)",
      [emailAddr, hash, salt, verifyToken]
    );
    await email(emailAddr, "Verify your Lazynext account",
      branded("Welcome", "Confirm your email to activate your account.", { href: `${APP}/verify?token=${verifyToken}`, label: "Verify email" }));
    return NextResponse.json({ ok: true });
  }

  // ── Verify email link ───────────────────────────────────────────────────
  if (action === "verify") {
    const r = await queryWorker("UPDATE users SET email_verified = 1, verify_token = NULL WHERE verify_token = ?", [token]);
    const d = await r.json();
    if (!d.meta?.changes) return NextResponse.json({ error: "invalid or used link" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Login → password → optional TOTP → session ──────────────────────────
  if (action === "login") {
    const r = await queryWorker("SELECT id, password_hash, salt, email_verified FROM users WHERE email = ?", [emailAddr]);
    const d = await r.json();
    const u = d.results?.[0];
    if (!u || !(await verifyPassword(String(password ?? ""), u.salt, u.password_hash)))
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    if (!u.email_verified) return NextResponse.json({ error: "verify your email first" }, { status: 403 });
    const twoFa = (await (await workerFetch("/kv/get", { key: "flag:two_factor" })).json()).value === "true";
    const secret = (await (await workerFetch("/kv/get", { key: "2fa:secret" })).json()).value;
    if (twoFa && secret) {
      if (!code) return NextResponse.json({ totp: true });
      const t = new OTPAuth.TOTP({ issuer: "Lazynext", label: "founder", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
      if (t.validate({ token: String(code), window: 1 }) === null)
        return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    await setSession(res, u.id);
    return res;
  }

  // ── Forgot → send reset link ────────────────────────────────────────────
  if (action === "forgot") {
    const r = await queryWorker("SELECT id FROM users WHERE email = ?", [emailAddr]);
    const d = await r.json();
    if (d.results?.length) {
      const resetToken = genToken();
      const expires = new Date(Date.now() + 3600_000).toISOString();
      await queryWorker("UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?", [resetToken, expires, emailAddr]);
      await email(emailAddr, "Reset your Lazynext password",
        branded("Password reset", "This link expires in 1 hour.", { href: `${APP}/reset?token=${resetToken}`, label: "Reset password" }));
    }
    return NextResponse.json({ ok: true }); // always ok — don't leak accounts
  }

  // ── Reset → set new password via token ─────────────────────────────────
  if (action === "reset") {
    if (!password || password.length < 8)
      return NextResponse.json({ error: "password must be 8+ chars" }, { status: 400 });
    const r = await queryWorker("SELECT id, reset_expires FROM users WHERE reset_token = ?", [token]);
    const d = await r.json();
    const u = d.results?.[0];
    if (!u || new Date(u.reset_expires) < new Date())
      return NextResponse.json({ error: "invalid or expired link" }, { status: 400 });
    const { salt, hash } = await hashPassword(String(password));
    await queryWorker("UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?", [hash, salt, u.id]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
