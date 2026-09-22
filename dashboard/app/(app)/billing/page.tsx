"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { CreditCard, Activity, Key, Rocket, BookOpen } from "lucide-react";
import { toast } from "@/components/Toast";

const PLANS = [
  { name: "Founder", price: "$0", desc: "Self-hosted on your own credentials — current." },
  { name: "Team", price: "$49/mo", desc: "Multi-seat access, shared agents, priority support." },
  { name: "Scale", price: "$199/mo", desc: "Multi-company fleets, SLA, dedicated infra." },
];

export default function BillingPage() {
  const [m, setM] = useState({ tasks: 0, keys: 0, deploys: 0, chunks: 0, messages: 0 });
  const [plan, setPlan] = useState("Founder");
  const [planOpen, setPlanOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      queryApi<any>("SELECT COUNT(*) c FROM task_log"),
      queryApi<any>("SELECT COUNT(*) c FROM api_keys WHERE revoked_at IS NULL"),
      queryApi<any>("SELECT COUNT(*) c FROM milestone_log WHERE milestone_type LIKE '%deploy%' OR milestone_type LIKE '%ship%'"),
      queryApi<any>("SELECT COUNT(*) c FROM knowledge_chunks"),
      queryApi<any>("SELECT COUNT(*) c FROM bus_messages"),
    ])
      .then(([t, k, d, c, b]) =>
        setM({
          tasks: t[0]?.c ?? 0,
          keys: k[0]?.c ?? 0,
          deploys: d[0]?.c ?? 0,
          chunks: c[0]?.c ?? 0,
          messages: b[0]?.c ?? 0,
        })
      )
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/kv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "get", key: "plan" }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.value) setPlan(JSON.parse(d.value).name ?? "Founder"); })
      .catch(() => {});
  }, []);

  const changePlan = async (name: string) => {
    // Free plan → record locally. Paid plans → real Dodo checkout.
    if (name === "Founder") {
      const r = await fetch("/api/kv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "put", key: "plan", value: JSON.stringify({ name }) }),
      });
      if (r.ok) { setPlan(name); setPlanOpen(false); toast(`Plan → ${name}`); }
      else toast("Plan change failed");
      return;
    }
    const r = await fetch("/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: name }),
    });
    const d = await r.json();
    if (r.ok && d.checkout_url) {
      window.location.href = d.checkout_url; // real Dodo checkout
    } else {
      toast(d.error ?? "Billing not configured — set DODO_API_KEY + product IDs");
    }
  };

  const USAGE = [
    { icon: Activity, label: "Tasks run", value: m.tasks },
    { icon: Key, label: "Active API keys", value: m.keys },
    { icon: Rocket, label: "Deploys", value: m.deploys },
    { icon: BookOpen, label: "Knowledge chunks", value: m.chunks },
    { icon: CreditCard, label: "Bus messages", value: m.messages },
  ];

  return (
    <>
      <PageHeader title="Billing" subtitle="Plan and usage — the company runs on your infra credits." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl">
        <Card>
          <h2 className="text-sm font-semibold mb-3">Plan</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-fg">{plan}</span>
            <span className="text-xs font-semibold text-accentSoft bg-accentBg px-2 py-1 rounded-md">current</span>
          </div>
          <p className="text-xs text-muted mt-2">
            Self-hosted runtime on your own credentials — Cloudflare (brain + infra),
            E2B (sandboxes), Resend (email). Costs are your provider usage.
          </p>
          <button
            onClick={() => setPlanOpen(true)}
            className="mt-4 text-xs text-accentSoft hover:underline font-medium"
          >
            Change plan →
          </button>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-3">Usage</h2>
          <div className="space-y-2.5">
            {USAGE.map((u) => (
              <div key={u.label} className="flex items-center gap-2.5">
                <u.icon className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs text-muted flex-1">{u.label}</span>
                <span className="text-sm font-semibold text-fg">{loading ? "—" : u.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {planOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPlanOpen(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-fg mb-5">Change plan</h2>
            <div className="space-y-3">
              {PLANS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => changePlan(p.name)}
                  className={`w-full text-left p-4 rounded-xl border transition ${
                    plan === p.name
                      ? "border-accent bg-accentBg"
                      : "border-border bg-input hover:border-accentDim"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-fg">{p.name}</span>
                    <span className="text-sm font-bold text-accentSoft">{p.price}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{p.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted mt-4">Paid plans check out via <b>Dodo Payments</b> — merchant of record, tax handled.</p>
          </div>
        </div>
      )}
    </>
  );
}
