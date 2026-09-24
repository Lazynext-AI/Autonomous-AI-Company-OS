"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { CreditCard, Activity, Key, Rocket, BookOpen, TrendingUp } from "lucide-react";
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
  const [subs, setSubs] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<any>(null);

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
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.subscriptions)) setSubs(d.subscriptions); })
      .catch(() => {});
    fetch("/api/funnel")
      .then((r) => r.json())
      .then((d) => { if (d && !d.error) setFunnel(d); })
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
            Cloudflare containers (sandboxes), Brevo (email). Costs are your provider usage.
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

        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Active subscriptions</h2>
          {subs.length === 0 ? (
            <p className="text-xs text-muted">None active.</p>
          ) : (
            <div className="space-y-2.5">
              {subs.map((s: any) => (
                <div key={s.subscription_id} className="flex items-center gap-3 text-xs">
                  <span className="font-semibold text-fg flex-1 truncate">{s.customer?.email ?? "—"}</span>
                  <span className="text-muted">{s.product_name ?? s.product_id}</span>
                  {s.trial_period_days > 0 && (
                    <span className="text-accentSoft bg-accentBg px-1.5 py-0.5 rounded">{s.trial_period_days}d trial</span>
                  )}
                  <span className="text-muted">renews {s.next_billing_date ? new Date(s.next_billing_date).toLocaleDateString() : "—"}</span>
                  <span className="text-accentSoft font-semibold">{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accentSoft" /> Conversion funnel
          </h2>
          {!funnel ? (
            <p className="text-xs text-muted">Loading funnel…</p>
          ) : (
            <>
              <div className="space-y-2">
                {(() => {
                  const stages = [
                    { label: "Scans (30d)", value: funnel.scans_30d ?? 0 },
                    { label: "Leads", value: funnel.leads ?? 0 },
                    { label: "In trial", value: funnel.trials_active ?? 0 },
                    { label: "Customers", value: funnel.subscriptions_active ?? 0 },
                  ];
                  const top = Math.max(stages[0].value, 1);
                  return stages.map((s, i) => {
                    const prev = i > 0 ? stages[i - 1].value : null;
                    const pct = prev != null && prev > 0 ? Math.round((s.value / prev) * 100) : null;
                    return (
                      <div key={s.label} className="flex items-center gap-3">
                        <span className="text-xs text-muted w-24 shrink-0">{s.label}</span>
                        <div className="flex-1 h-5 bg-input rounded-md overflow-hidden">
                          <div
                            className="h-full bg-accent/70 rounded-md"
                            style={{ width: `${s.value > 0 ? Math.max((s.value / top) * 100, 4) : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-fg w-12 text-right">{s.value}</span>
                        <span className="text-[10px] text-muted w-10 text-right">
                          {pct != null ? `${pct}%` : ""}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-[10px] text-muted">
                <span>Licenses: <b className="text-fg">{funnel.licenses_pro ?? 0} pro</b> / {funnel.licenses_free ?? 0} free</span>
                <span>Waitlist: <b className="text-fg">{funnel.waitlist ?? 0}</b></span>
                <span>Email contacts: <b className="text-fg">{funnel.email_contacts ?? 0}</b></span>
                <span>CRM leads: <b className="text-fg">{funnel.crm_leads ?? 0}</b></span>
                <span>Monitors: <b className="text-fg">{funnel.monitors ?? 0}</b></span>
              </div>
              <p className="text-[10px] text-muted mt-2">
                Current-state counts — KV records decay by TTL, so scans cover the stored-report window (30d).
              </p>
            </>
          )}
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
