"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Send, Plus, X, Users, Mail } from "lucide-react";

interface Contact { id: number; email: string; name?: string; subscribed: number; created_at: string }
interface Campaign { id: number; name: string; subject: string; status: string; sent_count: number; created_at: string }

export default function CampaignsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"contact" | "campaign" | null>(null);
  const [busy, setBusy] = useState(false);
  const [cf, setCf] = useState({ email: "", name: "" });
  const [kf, setKf] = useState({ name: "", subject: "", html: "" });

  const load = async () => {
    try {
      setContacts(await queryApi<Contact>("SELECT * FROM email_contacts ORDER BY id DESC LIMIT 200"));
      setCampaigns(await queryApi<Campaign>("SELECT * FROM email_campaigns ORDER BY id DESC LIMIT 100"));
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const svc = async (path: string, body?: unknown, method = "POST") =>
    fetch("/api/svc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, body, method }) });

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = await svc("/api/v1/marketing/contacts", cf);
    if (r.ok) { toast("Contact added"); setModal(null); setCf({ email: "", name: "" }); load(); } else toast("Failed");
    setBusy(false);
  };
  const addCampaign = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = await svc("/api/v1/marketing/campaigns", kf);
    if (r.ok) { toast("Campaign created"); setModal(null); setKf({ name: "", subject: "", html: "" }); load(); } else toast("Failed");
    setBusy(false);
  };
  const send = async (id: number) => {
    const r = await svc(`/api/v1/marketing/campaigns/${id}/send`);
    const d = await r.json();
    toast(r.ok ? `Sent to ${d.sent} contacts` : (d.error || "Send failed"));
    load();
  };

  const sub = contacts.filter(c => c.subscribed).length;

  return (
    <>
      <PageHeader title="Marketing" subtitle={`Native email campaigns — ${sub} subscribed contacts, sends via Brevo.`}>
        <div className="flex gap-2">
          <button onClick={() => setModal("contact")} className="inline-flex items-center gap-2 border border-border hover:border-accent text-fg text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            <Users className="w-4 h-4" /> Add contact
          </button>
          <button onClick={() => setModal("campaign")} className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            <Plus className="w-4 h-4" /> New campaign
          </button>
        </div>
      </PageHeader>

      <h3 className="text-sm font-semibold text-fg mb-3">Campaigns</h3>
      {campaigns.length === 0 && !loading ? (
        <Empty title="No campaigns" hint="Create a campaign — it sends to all subscribed contacts via Brevo." />
      ) : (
        <div className="space-y-3 max-w-3xl mb-8">
          {campaigns.map((c) => (
            <Card key={c.id} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{c.name}</div>
                <div className="text-xs text-muted truncate">{c.subject}</div>
                <div className="text-[10px] text-muted mt-0.5">
                  <span className={c.status === "sent" ? "text-ok" : "text-warn"}>{c.status}</span>
                  {c.sent_count > 0 && ` · sent to ${c.sent_count}`} · {timeAgo(c.created_at)}
                </div>
              </div>
              {c.status !== "sent" && (
                <button onClick={() => send(c.id)} className="inline-flex items-center gap-1.5 bg-accent hover:bg-accentSoft text-white text-xs font-semibold px-3 py-2 rounded-lg transition shrink-0">
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <h3 className="text-sm font-semibold text-fg mb-3">Contacts ({sub} subscribed / {contacts.length} total)</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl">
        {contacts.slice(0, 40).map((c) => (
          <Card key={c.id} className="py-3 px-4">
            <div className="text-xs font-semibold text-fg truncate">{c.name || c.email}</div>
            <div className="text-[10px] text-muted truncate">{c.email}</div>
            <div className={`text-[9px] mt-1 ${c.subscribed ? "text-ok" : "text-muted"}`}>{c.subscribed ? "subscribed" : "unsubscribed"}</div>
          </Card>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(null)}>
          <Card className="w-full max-w-md">
            <form onSubmit={modal === "contact" ? addContact : addCampaign} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">{modal === "contact" ? "Add contact" : "New campaign"}</h3>
                <button type="button" onClick={() => setModal(null)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              {modal === "contact" ? (
                <>
                  <input required type="email" value={cf.email} onChange={(e) => setCf({ ...cf, email: e.target.value })} placeholder="Email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
                  <input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} placeholder="Name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
                </>
              ) : (
                <>
                  <input required value={kf.name} onChange={(e) => setKf({ ...kf, name: e.target.value })} placeholder="Campaign name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
                  <input required value={kf.subject} onChange={(e) => setKf({ ...kf, subject: e.target.value })} placeholder="Subject line" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
                  <textarea required value={kf.html} onChange={(e) => setKf({ ...kf, html: e.target.value })} placeholder="Email HTML" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-28 font-mono" />
                </>
              )}
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Saving…" : modal === "contact" ? "Add contact" : "Create campaign"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
