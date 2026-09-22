"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset", token: params.get("token"), password }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) router.push("/login");
    else setError(d.error ?? "Reset failed");
  };

  return (
    <form onSubmit={submit} className="bg-card border border-border rounded-[14px] p-6 space-y-4">
      <div>
        <label className="text-xs text-muted">New password</label>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-input border border-border rounded-lg px-3.5 py-2.5 mt-1.5 text-sm text-fg outline-none focus:border-accent transition"
          placeholder="8+ characters" />
      </div>
      {error && <div className="text-xs text-bad">{error}</div>}
      <button type="submit" disabled={busy}
        className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition">
        {busy ? "Resetting…" : "Reset password"}
      </button>
      <p className="text-center text-xs text-muted">
        <Link href="/login" className="text-accentSoft">Back to sign in</Link>
      </p>
    </form>
  );
}

export default function ResetPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold"><span className="text-accentSoft">◆</span> Lazynext</div>
          <p className="text-sm text-muted mt-2">Set a new password</p>
        </div>
        <Suspense fallback={<div className="bg-card border border-border rounded-[14px] p-8 text-center text-sm text-muted">Loading…</div>}>
          <ResetInner />
        </Suspense>
      </div>
    </div>
  );
}
