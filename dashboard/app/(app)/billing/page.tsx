"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { CreditCard, Activity, Key, Rocket, BookOpen } from "lucide-react";

export default function BillingPage() {
  const [m, setM] = useState({ tasks: 0, keys: 0, deploys: 0, chunks: 0, messages: 0 });
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
  }, []);

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
            <span className="text-2xl font-bold text-fg">Founder</span>
            <span className="text-xs font-semibold text-accentSoft bg-accentBg px-2 py-1 rounded-md">current</span>
          </div>
          <p className="text-xs text-muted mt-2">
            Self-hosted runtime on your own credentials — Atlas Cloud (LLM), Cloudflare (infra),
            E2B (sandboxes), Resend (email). Costs are your provider usage.
          </p>
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
    </>
  );
}
