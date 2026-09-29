"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { PenTool, Plus, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { queryApi } from "@/lib/api";

interface Recipient { name?: string; email?: string; status?: string; }
interface Doc {
  id: string; name?: string; status?: string; embedded_preview_url?: string | null;
  recipients?: Recipient[];
}

interface SignReq {
  id: number; public_id: string; signer_email: string; signer_name?: string | null;
  title: string; status: string; signed_name?: string | null; signed_at?: number | null;
  decline_reason?: string | null; created_at: number;
}

export default function SignaturesPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [modal, setModal] = useState(false);
  const [nativeModal, setNativeModal] = useState(false);
  const [native, setNative] = useState<SignReq[]>([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ template_id: "", signer_name: "", signer_email: "", subject: "" });
  const [nf, setNf] = useState({ title: "", signer_name: "", signer_email: "", doc_text: "" });

  const svc = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch("/api/svc", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, method, body }),
    });
    return r.json().catch(() => ({}));
  };

  const load = async () => {
    const d = await svc("/api/v1/signwell/documents");
    if (d.connected === false) { setConnected(false); return; }
    setConnected(true);
    setDocs(Array.isArray(d.documents) ? d.documents : []);
    const ev = await svc("/api/v1/signwell/events");
    if (Array.isArray(ev.events)) setEvents(ev.events);
    try {
      setNative(await queryApi<SignReq>("SELECT id, public_id, signer_email, signer_name, title, status, signed_name, signed_at, decline_reason, created_at FROM sign_requests ORDER BY id DESC LIMIT 100"));
    } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const d = await svc("/api/v1/signwell/send", "POST", f);
    if (d.ok || d.id) {
      toast("Signature request sent via SignWell");
      setModal(false); setF({ template_id: "", signer_name: "", signer_email: "", subject: "" }); load();
    } else toast(d.error || d.message || "Send failed");
    setBusy(false);
  };

  const sendNative = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const d = await svc("/api/v1/sign/requests", "POST", {
      title: nf.title, signer_name: nf.signer_name, signer_email: nf.signer_email, doc_text: nf.doc_text,
    });
    if (d.public_id) {
      toast(d.emailed ? "Signature request sent — signer emailed a signing link" : "Created, but the signer email failed");
      setNativeModal(false); setNf({ title: "", signer_name: "", signer_email: "", doc_text: "" }); load();
    } else toast(d.error || "Send failed");
    setBusy(false);
  };

  const remind = async (pid: string) => {
    const d = await svc(`/api/v1/sign/requests/${pid}/remind`, "POST", {});
    toast(d.reminded ? "Reminder sent" : (d.error || "Remind failed"));
  };

  return (
    <>
      <PageHeader title="Signatures" subtitle="Native e-sign on Cloudflare (default) + SignWell connector for template flows — both with audit trail.">
        <div className="flex gap-2">
          <button onClick={() => setNativeModal(true)} className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            <Plus className="w-4 h-4" /> Native request
          </button>
          <button onClick={() => setModal(true)} disabled={connected === false} className="inline-flex items-center gap-2 bg-input hover:bg-border disabled:opacity-50 text-fg text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            <Plus className="w-4 h-4" /> Via SignWell
          </button>
        </div>
      </PageHeader>

      {connected === false ? (
        <Card className="max-w-3xl">
          <div className="text-sm font-semibold text-fg mb-1">SignWell not connected</div>
          <p className="text-xs text-muted mb-3">
            Add your API key in Settings (free plan includes the production API — 25 docs/month free;
            prefix <code className="text-accentSoft">test:</code> for unlimited test sends).{" "}
            Get the key at signwell.com/app → Settings → API.
          </p>
          <Link href="/settings" className="text-xs font-semibold text-accentSoft hover:underline">
            Open Settings → Connector library → Legal signing
          </Link>
        </Card>
      ) : docs.length === 0 && connected ? (
        <Empty title="No signature requests" hint="Send a template for signing — recipients sign in SignWell and you get the audit trail." />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {docs.map((d) => (
            <Card key={d.id} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <PenTool className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{d.name || d.id}</div>
                <div className="text-xs text-muted truncate">
                  {(d.recipients ?? []).map((r) => r.name || r.email).filter(Boolean).join(", ") || "no recipients"}
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  <span className={d.status === "signed" || d.status === "completed" ? "text-ok" : "text-warn"}>
                    {d.status || "pending"}
                  </span>
                </div>
              </div>
              {d.embedded_preview_url && (
                <a href={d.embedded_preview_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accentSoft border border-accent/40 hover:bg-accentBg px-3 py-2 rounded-lg transition shrink-0 inline-flex items-center gap-1">
                  View <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted mt-5 max-w-3xl">
        Templates are created once in the SignWell webapp (signwell.com/app) — the template&apos;s
        recipient id maps to the signer fields above. Signed documents carry the SignWell audit trail.
      </p>

      <div className="text-xs font-semibold text-muted mt-8 mb-2">Native e-sign requests</div>
      {native.length === 0 ? (
        <Empty title="No native requests" hint="Send a native request — the signer gets a token-gated link, signs with a typed signature, and a frozen certificate is stored." />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {native.map((r) => (
            <Card key={r.public_id} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <PenTool className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{r.title}</div>
                <div className="text-xs text-muted truncate">
                  {r.signer_name ? `${r.signer_name} · ` : ""}{r.signer_email}
                  {r.signed_name ? ` — signed by ${r.signed_name}` : ""}
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  <span className={r.status === "completed" ? "text-ok" : r.status === "declined" || r.status === "voided" ? "text-bad" : "text-warn"}>
                    {r.status}
                  </span>
                  {" · "}{timeAgo(new Date(r.created_at).toISOString())}
                  {r.decline_reason ? ` · "${r.decline_reason}"` : ""}
                </div>
              </div>
              {(r.status === "pending" || r.status === "viewed") && (
                <button onClick={() => remind(r.public_id)} className="text-xs font-semibold text-accentSoft border border-accent/40 hover:bg-accentBg px-3 py-2 rounded-lg transition shrink-0">
                  Remind
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-5 max-w-3xl">
          <div className="text-xs font-semibold text-muted mb-2">Recent signing events</div>
          <div className="space-y-1.5">
            {events.slice(0, 10).map((e, i) => {
              const ev = (typeof e.event === "object" && e.event ? e.event : e) as Record<string, unknown>;
              const obj = (((e.data ?? {}) as Record<string, unknown>).object ?? {}) as Record<string, unknown>;
              return (
                <div key={i} className="text-xs text-muted flex items-center gap-2">
                  <span className="text-ok">{String(ev.type ?? e.eventType ?? "event")}</span>
                  <span className="truncate">{String(obj.name ?? obj.id ?? e.pdf_id ?? "")}</span>
                  <span className="ml-auto shrink-0">{timeAgo(e.received_at as string)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(false)}>
          <Card className="w-full max-w-md">
            <form onSubmit={send} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">Send for signature</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })} placeholder="SignWell template ID" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input required value={f.signer_name} onChange={(e) => setF({ ...f, signer_name: e.target.value })} placeholder="Signer name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input required type="email" value={f.signer_email} onChange={(e) => setF({ ...f, signer_email: e.target.value })} placeholder="Signer email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Email subject (optional)" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Sending…" : "Send signature request"}
              </button>
            </form>
          </Card>
        </div>
      )}

      {nativeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNativeModal(false)}>
          <Card className="w-full max-w-md">
            <form onSubmit={sendNative} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">Native signature request</h3>
                <button type="button" onClick={() => setNativeModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder="Document title" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input required value={nf.signer_name} onChange={(e) => setNf({ ...nf, signer_name: e.target.value })} placeholder="Signer name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input required type="email" value={nf.signer_email} onChange={(e) => setNf({ ...nf, signer_email: e.target.value })} placeholder="Signer email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <textarea required value={nf.doc_text} onChange={(e) => setNf({ ...nf, doc_text: e.target.value })} placeholder="Document text — frozen as the signing snapshot" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-32" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Sending…" : "Send signature request"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
