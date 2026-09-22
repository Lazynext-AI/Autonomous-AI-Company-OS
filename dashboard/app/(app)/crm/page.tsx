"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Users, Plus, X } from "lucide-react";

interface Lead {
  id: number;
  name: string;
  email?: string;
  company?: string;
  status: string;
  source?: string;
  notes?: string;
  value_cents: number;
  created_at: string;
}

const STATUSES = ["lead", "contacted", "qualified", "won", "lost"];

export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", email: "", company: "", source: "", notes: "" });

  const load = async () => {
    try {
      setLeads(await queryApi<Lead>("SELECT * FROM crm_leads ORDER BY id DESC LIMIT 100"));
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
      body: JSON.stringify({ path: "/api/v1/crm/leads", body: f }),
    });
    if (r.ok) {
      toast("Lead added");
      setModal(false);
      setF({ name: "", email: "", company: "", source: "", notes: "" });
      load();
    } else toast("Add failed");
    setBusy(false);
  };

  const setStatus = async (id: number, status: string) => {
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/api/v1/crm/leads/${id}`, method: "PATCH", body: { status } }),
    });
    if (r.ok) {
      setLeads((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    } else toast("Update failed");
  };

  return (
    <>
      <PageHeader title="CRM" subtitle="Native leads pipeline — built-in on D1, no external CRM needed.">
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New lead
        </button>
      </PageHeader>

      {leads.length === 0 && !loading ? (
        <Empty title="No leads yet" hint="Agents add leads automatically from research, or add one manually." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {leads.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-accentSoft" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg truncate">{l.name}</div>
                  <div className="text-xs text-muted truncate">
                    {l.company || l.email || "—"}
                  </div>
                  {l.value_cents > 0 && (
                    <div className="text-xs text-ok mt-0.5">${(l.value_cents / 100).toFixed(2)}</div>
                  )}
                  <div className="text-[10px] text-muted mt-1">
                    {l.source || "manual"} · {timeAgo(l.created_at)}
                  </div>
                </div>
              </div>
              <select
                value={l.status}
                onChange={(e) => setStatus(l.id, e.target.value)}
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
          <Card className="w-full max-w-md" onClick={undefined}>
            <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">New lead</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              {(["name", "email", "company", "source"] as const).map((k) => (
                <input
                  key={k}
                  required={k === "name"}
                  value={f[k]}
                  onChange={(e) => setF({ ...f, [k]: e.target.value })}
                  placeholder={k[0].toUpperCase() + k.slice(1)}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none"
                />
              ))}
              <textarea
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="Notes"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-16"
              />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Adding…" : "Add lead"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
