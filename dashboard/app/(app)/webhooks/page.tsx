"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Webhook, Plus, X, Copy } from "lucide-react";

interface Endpoint {
  id: number;
  url: string;
  channels: string;
  active: number;
  created_at: string;
}
interface Delivery {
  id: number;
  endpoint_id: number;
  channel: string;
  status_code?: number;
  error?: string;
  attempted_at: string;
}

const CHANNELS = ["tasks", "deploys", "alerts", "milestones", "briefings"];

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [url, setUrl] = useState("");
  const [chans, setChans] = useState<string[]>(["tasks"]);
  const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = async () => {
    try {
      setEndpoints(await queryApi<Endpoint>("SELECT * FROM webhook_endpoints ORDER BY id DESC"));
      setDeliveries(
        await queryApi<Delivery>("SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 30")
      );
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
    const r = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, channels: chans.join(","), secret }),
    });
    setBusy(false);
    if (r.ok) {
      setNewSecret(secret);
      load();
    } else {
      toast("Failed to create endpoint");
    }
  };

  const del = async (id: number) => {
    const r = await fetch(`/api/webhooks?id=${id}`, { method: "DELETE" });
    toast(r.ok ? "Endpoint disabled" : "Disable failed");
    load();
  };

  const toggleChan = (c: string) =>
    setChans((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  return (
    <>
      <PageHeader title="Webhooks" subtitle="Signed outbound events — bus → your endpoints.">
        <button
          onClick={() => { setModal(true); setNewSecret(null); setUrl(""); }}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Add endpoint
        </button>
      </PageHeader>

      {endpoints.length === 0 && !loading ? (
        <Empty title="No endpoints" hint="Add one above — events sign + deliver when the bus moves." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">Endpoints</div>
            {endpoints.map((e) => (
              <div key={e.id} className="px-5 py-3.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <Webhook className="w-3.5 h-3.5 text-accentSoft" />
                  <span className="text-sm text-fg font-mono truncate">{e.url}</span>
                  <span className={`ml-auto text-xs font-semibold ${e.active ? "text-ok" : "text-muted"}`}>
                    {e.active ? "on" : "off"}
                  </span>
                  {e.active ? (
                    <>
                      <button
                        onClick={async () => {
                          const r = await fetch("/api/publish", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              channel: e.channels.split(",")[0].trim(),
                              payload: { type: "webhook_test", by: "founder", at: new Date().toISOString() },
                            }),
                          });
                          toast(r.ok ? "Test fired — check deliveries" : "Test failed");
                        }}
                        className="text-xs text-accentSoft hover:underline ml-2"
                      >
                        test
                      </button>
                      <button onClick={() => del(e.id)} className="text-xs text-bad hover:underline ml-2">
                        disable
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="text-xs text-muted mt-1">
                  channels: {e.channels} · added {timeAgo(e.created_at)}
                </div>
              </div>
            ))}
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">Deliveries</div>
            {deliveries.length === 0 ? (
              <div className="p-5 text-sm text-muted">No deliveries yet.</div>
            ) : (
              deliveries.map((d) => (
                <div key={d.id} className="px-5 py-3 border-b border-border last:border-0 flex items-center gap-3">
                  <span
                    className={`text-xs font-mono font-bold ${
                      d.status_code && d.status_code < 300 ? "text-ok" : "text-bad"
                    }`}
                  >
                    {d.status_code || "ERR"}
                  </span>
                  <span className="text-xs text-accentSoft">{d.channel}</span>
                  <span className="text-xs text-muted ml-auto">{timeAgo(d.attempted_at)}</span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-card border border-border rounded-[14px] p-6 relative">
            <button onClick={() => setModal(false)} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            {newSecret ? (
              <>
                <h2 className="text-lg font-bold text-fg mb-1">Endpoint added</h2>
                <p className="text-xs text-muted mb-4">Signing secret — copy now, shown once.</p>
                <div className="flex items-center gap-2 bg-input border border-border rounded-lg px-3.5 py-3">
                  <code className="flex-1 text-xs text-accentSoft font-mono break-all">{newSecret}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(newSecret); toast("Copied"); }}
                    className="text-muted hover:text-fg shrink-0" aria-label="Copy"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <button onClick={() => setModal(false)} className="mt-5 w-full bg-accent hover:bg-accentSoft text-white text-sm font-semibold py-2.5 rounded-lg transition">
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={create}>
                <h2 className="text-lg font-bold text-fg mb-1">Add webhook</h2>
                <p className="text-xs text-muted mb-5">HMAC-signed deliveries on these channels.</p>
                <label className="text-xs text-muted">Endpoint URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  type="url"
                  placeholder="https://example.com/hook"
                  className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
                />
                <label className="text-xs text-muted">Channels</label>
                <div className="flex flex-wrap gap-2 mt-1.5 mb-5">
                  {CHANNELS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleChan(c)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        chans.includes(c)
                          ? "bg-accent text-white"
                          : "bg-input text-muted border border-border"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={busy || !url.trim() || chans.length === 0}
                  className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {busy ? "Adding…" : "Add endpoint"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
