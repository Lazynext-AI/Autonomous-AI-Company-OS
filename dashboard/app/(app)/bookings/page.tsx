"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { CalendarClock, Plus, X } from "lucide-react";

interface Booking {
  id: number;
  title: string;
  guest_name?: string;
  guest_email?: string;
  starts_at: string;
  ends_at?: string;
  status: string;
  created_at: string;
}

const STATUSES = ["confirmed", "pending", "cancelled", "done"];

export default function BookingsPage() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", guest_name: "", guest_email: "", starts_at: "", ends_at: "" });

  const load = async () => {
    try {
      setRows(await queryApi<Booking>("SELECT * FROM bookings ORDER BY starts_at DESC LIMIT 100"));
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/api/v1/booking", body: f }),
    });
    if (r.ok) {
      toast("Booked");
      setModal(false);
      setF({ title: "", guest_name: "", guest_email: "", starts_at: "", ends_at: "" });
      load();
    } else toast("Booking failed");
    setBusy(false);
  };

  const setStatus = async (id: number, status: string) => {
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/api/v1/booking/${id}`, method: "PATCH", body: { status } }),
    });
    if (r.ok) setRows((b) => b.map((x) => (x.id === id ? { ...x, status } : x)));
    else toast("Update failed");
  };

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <>
      <PageHeader title="Bookings" subtitle="Native scheduling — built-in on D1, no Calendly needed.">
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New booking
        </button>
      </PageHeader>

      {rows.length === 0 && !loading ? (
        <Empty title="No bookings" hint="Meetings agents schedule land here, or book one manually." />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {rows.map((b) => (
            <Card key={b.id} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <CalendarClock className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{b.title}</div>
                <div className="text-xs text-muted">
                  {b.guest_name || b.guest_email || "—"} · {fmt(b.starts_at)}{b.ends_at ? ` → ${fmt(b.ends_at)}` : ""}
                </div>
              </div>
              <select
                value={b.status}
                onChange={(e) => setStatus(b.id, e.target.value)}
                className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none shrink-0"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
                <h3 className="text-base font-semibold text-fg">New booking</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Meeting title" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.guest_name} onChange={(e) => setF({ ...f, guest_name: e.target.value })} placeholder="Guest name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.guest_email} onChange={(e) => setF({ ...f, guest_email: e.target.value })} placeholder="Guest email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <label className="block text-xs text-muted">Starts</label>
              <input required type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <label className="block text-xs text-muted">Ends</label>
              <input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Booking…" : "Book"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
