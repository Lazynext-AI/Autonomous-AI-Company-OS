"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "forgot", email }),
    });
    setBusy(false);
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold"><span className="text-accentSoft">◆</span> Lazynext</div>
          <p className="text-sm text-muted mt-2">Reset your password</p>
        </div>
        {done ? (
          <div className="bg-card border border-border rounded-[14px] p-6 text-center">
            <div className="text-4xl mb-3">📧</div>
            <p className="text-xs text-muted mb-4">If that email has an account, a reset link is on its way.</p>
            <Link href="/login" className="text-sm text-accentSoft hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-card border border-border rounded-[14px] p-6 space-y-4">
            <div>
              <label className="text-xs text-muted">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-3.5 py-2.5 mt-1.5 text-sm text-fg outline-none focus:border-accent transition"
                placeholder="you@company.com" />
            </div>
            <button type="submit" disabled={busy}
              className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition">
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-xs text-muted">
              <Link href="/login" className="text-accentSoft">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
