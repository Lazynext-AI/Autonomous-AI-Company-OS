"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { LifeBuoy, Plus, X } from "lucide-react";

interface Ticket {
  id: number;
  subject: string;
  body?: string;
  email?: string;
  status: string;
  priority: string;
  created_at: string;
}

const STATUSES = ["open", "pending", "resolved", "closed"];
const PRI_COLOR: Record<string, string> = {
  low: "text-muted", normal: "text-fg", high: "text-warn", urgent: "text-bad",
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ subject: "", body: "", email: "", priority: "normal" });

  const load = async () => {
    try {
      setTickets(await queryApi<Ticket>("SELECT * FROM support_tickets ORDER BY id DESC LIMIT 100"));
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/api/v1/support/tickets", body: f }),
    });
    if (r.ok) {
      toast("Ticket created");
      setModal(false);
      setF({ subject: "", body: "", email: "", priority: "normal" });
      load();
    } else toast("Create failed");
    setBusy(false);
  };

  const setStatus = async (id: number, status: string) => {
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/api/v1/support/tickets/${id}`, method: "PATCH", body: { status } }),
    });
    if (r.ok) setTickets((t) => t.map((x) => (x.id === id ? { ...x, status } : x)));
    else toast("Update failed");
  };

  return (
    <>
      <PageHeader title="Support" subtitle="Native helpdesk tickets — built-in on D1, no external helpdesk needed.">
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New ticket
        </button>
      </PageHeader>

      {tickets.length === 0 && !loading ? (
        <Empty title="No tickets" hint="Customer issues land here — from the widget, agents, or manually." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl">
          {tickets.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                  <LifeBuoy className="w-5 h-5 text-accentSoft" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg truncate">{t.subject}</div>
                  {t.body && <div className="text-xs text-muted mt-0.5 line-clamp-2">{t.body}</div>}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-[10px] font-semibold uppercase ${PRI_COLOR[t.priority] || "text-muted"}`}>
                      {t.priority}
                    </span>
                    <span className="text-[10px] text-muted">{t.email || "anonymous"} · {timeAgo(t.created_at)}</span>
                  </div>
                </div>
              </div>
              <select
                value={t.status}
                onChange={(e) => setStatus(t.id, e.target.value)}
                className="mt-3 w-full bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(false)}>
          <Card className="w-full max-w-md">
            <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">New ticket</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Subject" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Customer email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Describe the issue" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-20" />
              <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none">
                {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Creating…" : "Create ticket"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
