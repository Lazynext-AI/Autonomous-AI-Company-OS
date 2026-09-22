"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function VerifyInner() {
  const params = useSearchParams();
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");

  useEffect(() => {
    fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify", token: params.get("token") }),
    }).then((r) => setState(r.ok ? "ok" : "fail")).catch(() => setState("fail"));
  }, [params]);

  return (
    <div className="bg-card border border-border rounded-[14px] p-8 text-center">
      {state === "loading" && <p className="text-sm text-muted">Verifying…</p>}
      {state === "ok" && (
        <>
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-sm font-semibold text-fg mb-2">Email verified</h2>
          <Link href="/login" className="text-sm text-accentSoft hover:underline">Sign in →</Link>
        </>
      )}
      {state === "fail" && (
        <>
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-sm font-semibold text-fg mb-2">Invalid or used link</h2>
          <Link href="/signup" className="text-sm text-accentSoft hover:underline">Sign up again</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold"><span className="text-accentSoft">◆</span> Lazynext</div>
        </div>
        <Suspense fallback={<div className="bg-card border border-border rounded-[14px] p-8 text-center text-sm text-muted">Loading…</div>}>
          <VerifyInner />
        </Suspense>
      </div>
    </div>
  );
}
