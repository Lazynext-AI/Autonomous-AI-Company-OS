"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { User, Bot, Key, Webhook, ListTodo, Rocket, ShieldCheck, Download } from "lucide-react";

interface AuditRow {
  id: number;
  channel: string;
  payload: any;
  created_at: string;
}

const ACTION_META: Record<string, { icon: any; label: string }> = {
  assign_task: { icon: ListTodo, label: "assigned a task" },
  deploy_request: { icon: Rocket, label: "requested a deploy" },
  approval_decision: { icon: ShieldCheck, label: "decided an approval" },
  needs_approval: { icon: ShieldCheck, label: "requested approval" },
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // audit trail = dashboard-sourced bus events + agent lifecycle events
        const data = await queryApi<AuditRow>(
          `SELECT id, channel, payload, created_at FROM bus_messages
           WHERE channel IN ('tasks','deploys','approvals','alerts','milestones')
           ORDER BY id DESC LIMIT 120`
        );
        setRows(data.map((r) => ({ ...r, payload: parseJson(r.payload, {}) })));
      } catch {}
      setLoading(false);
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader title="Audit" subtitle="Who did what — founder actions + agent events on the bus.">
        <button
          onClick={() => {
            const csv = [
              "id,channel,created_at,payload",
              ...rows.map((r) =>
                [r.id, r.channel, r.created_at, `"${JSON.stringify(r.payload).replace(/"/g, '""')}"`].join(",")
              ),
            ].join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
          }}
          className="inline-flex items-center gap-2 bg-card hover:bg-cardHover border border-border text-sm font-medium px-4 py-2.5 rounded-lg transition"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </PageHeader>

      {rows.length === 0 && !loading ? (
        <Empty title="No audit events" hint="Actions you take (assign task, deploy, approve) are logged here." />
      ) : (
        <Card className="p-0 overflow-hidden max-w-3xl">
          {rows.map((r) => {
            const p = r.payload;
            const isFounder = p.from === "dashboard" || p.by === "founder";
            const meta = ACTION_META[p.type] || { icon: Webhook, label: `event on #${r.channel}` };
            const Icon = isFounder ? User : (meta.icon || Bot);
            return (
              <div key={r.id} className="flex items-center gap-3.5 px-5 py-3.5 border-b border-border last:border-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isFounder ? "bg-accentBg" : "bg-input"}`}>
                  <Icon className={`w-4 h-4 ${isFounder ? "text-accentSoft" : "text-muted"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-semibold ${isFounder ? "text-accentSoft" : "text-fg"}`}>
                    {isFounder ? "You" : String(p.agent || p.agent_id || r.channel).replace(/_/g, " ")}
                  </span>
                  <span className="text-sm text-muted"> {meta.label}</span>
                  {p.description && (
                    <div className="text-xs text-muted truncate mt-0.5">{p.description}</div>
                  )}
                  {p.product && <div className="text-xs text-muted mt-0.5">{p.product}</div>}
                  {p.decision && <div className="text-xs text-muted mt-0.5">→ {p.decision}</div>}
                </div>
                <span className="text-xs text-muted shrink-0">{timeAgo(r.created_at)}</span>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
