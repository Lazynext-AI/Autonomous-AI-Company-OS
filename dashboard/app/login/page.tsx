"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: pass }),
    });
    setBusy(false);
    if (r.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong passphrase");
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold">
            <span className="text-accentSoft">◆</span> Lazynext
          </div>
          <p className="text-sm text-muted mt-2">Sign in to your company</p>
        </div>
        <form
          onSubmit={submit}
          className="bg-card border border-border rounded-[14px] p-6 space-y-4"
        >
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted">Passphrase</label>
              <a href="/forgot" className="text-xs text-accentSoft hover:underline">Forgot?</a>
            </div>
            <div className="relative mt-1.5">
              <input
                type={show ? "text" : "password"}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoFocus
                className="w-full bg-input border border-border rounded-lg pl-3.5 pr-10 py-2.5 text-sm text-fg outline-none focus:border-accent transition"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? "Hide passphrase" : "Show passphrase"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <div className="text-xs text-bad">{error}</div>}
          <button
            type="submit"
            disabled={busy || !pass}
            className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-center text-xs text-muted mt-6">
          The autonomous AI company ·{" "}
          <a href="https://lazynext.com" className="text-accentSoft">
            lazynext.com
          </a>
        </p>
      </div>
    </div>
  );
}
