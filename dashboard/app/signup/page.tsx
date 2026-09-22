"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "signup", email, password }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(d.error ?? "Signup failed");
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold"><span className="text-accentSoft">◆</span> Lazynext</div>
          <p className="text-sm text-muted mt-2">Create your account</p>
        </div>
        {done ? (
          <div className="bg-card border border-border rounded-[14px] p-6 text-center">
            <div className="text-4xl mb-3">📧</div>
            <h2 className="text-sm font-semibold text-fg mb-2">Check your email</h2>
            <p className="text-xs text-muted mb-4">We sent a verification link to {email}.</p>
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
            <div>
              <label className="text-xs text-muted">Password</label>
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-3.5 py-2.5 mt-1.5 text-sm text-fg outline-none focus:border-accent transition"
                placeholder="8+ characters" />
            </div>
            {error && <div className="text-xs text-bad">{error}</div>}
            <button type="submit" disabled={busy}
              className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition">
              {busy ? "Creating…" : "Create account"}
            </button>
            <p className="text-center text-xs text-muted">
              Have an account? <Link href="/login" className="text-accentSoft">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
