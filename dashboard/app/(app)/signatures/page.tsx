"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { PenTool, Plus, X } from "lucide-react";

interface Req {
  id: number; title: string; doc_text?: string; signer_name?: string; signer_email?: string;
  status: string; signature_text?: string; signer_ip?: string; signed_at?: string; created_at: string;
}

export default function SignaturesPage() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [signing, setSigning] = useState<Req | null>(null);
  const [sigText, setSigText] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", doc_text: "", signer_name: "", signer_email: "" });

  const load = async () => {
    try { setRows(await queryApi<Req>("SELECT * FROM signature_requests ORDER BY id DESC LIMIT 100")); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const svc = async (path: string, body?: unknown) =>
    fetch("/api/svc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, body }) });

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = await svc("/api/v1/sign/requests", f);
    if (r.ok) { toast("Signature request created"); setModal(false); setF({ title: "", doc_text: "", signer_name: "", signer_email: "" }); load(); } else toast("Failed");
    setBusy(false);
  };
  const doSign = async (e: React.FormEvent) => {
    e.preventDefault(); if (!signing) return; setBusy(true);
    const r = await svc(`/api/v1/sign/requests/${signing.id}/sign`, { signature_text: sigText });
    if (r.ok) { toast("Signed"); setSigning(null); setSigText(""); load(); } else toast("Sign failed");
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Signatures" subtitle="Native e-sign — signature requests + typed signing on D1.">
        <button onClick={() => setModal(true)} className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
          <Plus className="w-4 h-4" /> New request
        </button>
      </PageHeader>

      {rows.length === 0 && !loading ? (
        <Empty title="No signature requests" hint="Request a signature — the signer types their name to sign." />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <PenTool className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{r.title}</div>
                <div className="text-xs text-muted truncate">
                  {r.signer_name || r.signer_email || "anyone"}
                  {r.status === "signed" && ` · signed "${r.signature_text}" · ${r.signer_ip}`}
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  <span className={r.status === "signed" ? "text-ok" : "text-warn"}>{r.status}</span>
                  {" · "}{timeAgo(r.signed_at || r.created_at)}
                </div>
              </div>
              {r.status === "pending" && (
                <button onClick={() => setSigning(r)} className="text-xs font-semibold text-accentSoft border border-accent/40 hover:bg-accentBg px-3 py-2 rounded-lg transition shrink-0">
                  Sign
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted mt-5 max-w-3xl">
        Typed signatures are recorded with the signer's IP + timestamp. For legally-binding e-signature
        with an ESIGN/eIDAS audit trail, use a certified provider — this is for basic agreements.
      </p>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(false)}>
          <Card className="w-full max-w-md">
            <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">New signature request</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Document title (e.g. NDA)" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <textarea value={f.doc_text} onChange={(e) => setF({ ...f, doc_text: e.target.value })} placeholder="Agreement text" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-24" />
              <input value={f.signer_name} onChange={(e) => setF({ ...f, signer_name: e.target.value })} placeholder="Signer name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.signer_email} onChange={(e) => setF({ ...f, signer_email: e.target.value })} placeholder="Signer email" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Creating…" : "Create request"}
              </button>
            </form>
          </Card>
        </div>
      )}

      {signing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSigning(null)}>
          <Card className="w-full max-w-md">
            <form onSubmit={doSign} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">Sign: {signing.title}</h3>
                <button type="button" onClick={() => setSigning(null)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              {signing.doc_text && <p className="text-xs text-muted whitespace-pre-wrap max-h-32 overflow-y-auto border border-border rounded-lg p-3">{signing.doc_text}</p>}
              <label className="block text-xs text-muted">Type your full name to sign</label>
              <input required value={sigText} onChange={(e) => setSigText(e.target.value)} placeholder="Your signature (typed name)" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none font-serif italic" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Signing…" : "Sign document"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
