"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { PenTool, Plus, X, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Recipient { name?: string; email?: string; status?: string; }
interface Doc {
  id: string; name?: string; status?: string; publicUrl?: string | null;
  recipients?: Recipient[];
}

export default function SignaturesPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ template_id: "", signer_name: "", signer_email: "", subject: "" });

  const svc = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch("/api/svc", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, method, body }),
    });
    return r.json().catch(() => ({}));
  };

  const load = async () => {
    const d = await svc("/api/v1/inkless/documents");
    if (d.connected === false) { setConnected(false); return; }
    setConnected(true);
    setDocs(Array.isArray(d.documents) ? d.documents : []);
    const ev = await svc("/api/v1/inkless/events");
    if (Array.isArray(ev.events)) setEvents(ev.events);
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const d = await svc("/api/v1/inkless/send", "POST", f);
    if (d.ok || d.pdf_id) {
      toast("Signature request sent via Inkless");
      setModal(false); setF({ template_id: "", signer_name: "", signer_email: "", subject: "" }); load();
    } else toast(d.error || d.message || "Send failed");
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Signatures" subtitle="Legal-grade e-sign powered by Inkless — ESIGN/UETA with audit trail.">
        <button onClick={() => setModal(true)} disabled={connected === false} className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
          <Plus className="w-4 h-4" /> Send for signature
        </button>
      </PageHeader>

      {connected === false ? (
        <Card className="max-w-3xl">
          <div className="text-sm font-semibold text-fg mb-1">Inkless not connected</div>
          <p className="text-xs text-muted mb-3">
            Add your credential as <code className="text-accentSoft">url:api_key</code> (e.g.{" "}
            <code className="text-accentSoft">https://api.useinkless.com:YOUR_KEY</code>) — a bare key
            defaults to the hosted API. Request a key via hello@useinkless.com.
          </p>
          <Link href="/settings" className="text-xs font-semibold text-accentSoft hover:underline">
            Open Settings → Connector library → Legal signing
          </Link>
        </Card>
      ) : docs.length === 0 && connected ? (
        <Empty title="No signature requests" hint="Send a template for signing — recipients sign in Inkless and you get the audit trail." />
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
              {d.publicUrl && (
                <a href={d.publicUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accentSoft border border-accent/40 hover:bg-accentBg px-3 py-2 rounded-lg transition shrink-0 inline-flex items-center gap-1">
                  View <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted mt-5 max-w-3xl">
        Templates are created once in the Inkless webapp (app.useinkless.com) — enable
        &ldquo;Auto-release signatures when complete&rdquo; so the signed PDF is delivered automatically.
        Signed documents carry the Inkless audit trail.
      </p>

      {events.length > 0 && (
        <div className="mt-5 max-w-3xl">
          <div className="text-xs font-semibold text-muted mb-2">Recent signing events</div>
          <div className="space-y-1.5">
            {events.slice(0, 10).map((e, i) => (
              <div key={i} className="text-xs text-muted flex items-center gap-2">
                <span className="text-ok">{(e.eventType ?? e.event ?? e.type ?? "event") as string}</span>
                <span className="truncate">{(e.pdf_id ?? e.documentId ?? "") as string}</span>
                <span className="ml-auto shrink-0">{timeAgo(e.received_at as string)}</span>
              </div>
            ))}
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
              <input required value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })} placeholder="Inkless template ID" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
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
    </>
  );
}
