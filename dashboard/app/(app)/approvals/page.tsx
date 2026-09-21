"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { ShieldCheck, Check, X } from "lucide-react";

interface Approval {
  id: number;
  channel: string;
  payload: any;
  created_at: string;
}

async function publish(payload: any) {
  return fetch("/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel: "approvals", payload }),
  });
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [decided, setDecided] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      // pending approvals = messages on 'approvals' channel asking for sign-off
      const rows = await queryApi<Approval>(
        "SELECT id, channel, payload, created_at FROM bus_messages WHERE channel = 'approvals' AND payload LIKE '%needs_approval%' ORDER BY id DESC LIMIT 50"
      );
      setItems(rows.map((r) => ({ ...r, payload: parseJson(r.payload, {}) })));
      // decided approvals = approval_decision events
      const hist = await queryApi<Approval>(
        "SELECT id, channel, payload, created_at FROM bus_messages WHERE channel = 'approvals' AND payload LIKE '%approval_decision%' ORDER BY id DESC LIMIT 20"
      );
      setHistory(hist.map((r) => ({ ...r, payload: parseJson(r.payload, {}) })));
      // mark already-decided refs
      const d: Record<number, string> = {};
      hist.forEach((h) => {
        const p = parseJson<any>(h.payload, {});
        if (p.ref) d[p.ref] = p.decision;
      });
      setDecided((prev) => ({ ...d, ...prev }));
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const decide = async (id: number, decision: "approved" | "rejected") => {
    const r = await publish({ type: "approval_decision", ref: id, decision, by: "founder" });
    if (r.ok) {
      setDecided((d) => ({ ...d, [id]: decision }));
      toast(`Request ${decision}`);
    } else {
      toast("Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Agents pause on sensitive actions — you approve or reject."
      />

      {items.length === 0 && !loading ? (
        <Empty
          title="No pending approvals"
          hint="When an agent hits a sensitive action (spend, deploy, email blast) it waits here for you."
        />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {items.map((a) => {
            const p = a.payload;
            const decidedAs = decided[a.id];
            return (
              <Card key={a.id} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-[10px] bg-warnBg flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-warn" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-fg capitalize">
                      {String(p.agent || "agent").replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted">{timeAgo(a.created_at)}</span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    {p.action || p.description || JSON.stringify(p)}
                  </p>
                </div>
                {decidedAs ? (
                  <span className={`text-xs font-semibold shrink-0 ${decidedAs === "approved" ? "text-ok" : "text-bad"}`}>
                    {decidedAs}
                  </span>
                ) : (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => decide(a.id, "approved")}
                      className="inline-flex items-center gap-1.5 bg-ok/90 hover:bg-ok text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => decide(a.id, "rejected")}
                      className="inline-flex items-center gap-1.5 bg-bad/90 hover:bg-bad text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-8 max-w-3xl">
          <h2 className="text-sm font-semibold text-fg mb-3">History</h2>
          <Card className="p-0 overflow-hidden">
            {history.map((h) => {
              const p = h.payload;
              return (
                <div key={h.id} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
                  <span
                    className={`text-xs font-semibold ${
                      p.decision === "approved" ? "text-ok" : "text-bad"
                    }`}
                  >
                    {p.decision}
                  </span>
                  <span className="text-xs text-muted">request #{p.ref}</span>
                  <span className="text-xs text-muted ml-auto">{timeAgo(h.created_at)}</span>
                </div>
              );
            })}
          </Card>
        </div>
      )}
    </>
  );
}
