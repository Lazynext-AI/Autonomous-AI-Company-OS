"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Key, Plus, X, Copy } from "lucide-react";

interface ApiKey {
  id: number;
  key_prefix: string;
  name: string;
  scopes: string;
  rate_limit_rpm: number;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("read");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = async () => {
    try {
      setKeys(await queryApi<ApiKey>("SELECT * FROM api_keys ORDER BY id DESC"));
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
    const r = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    const d = await r.json();
    setBusy(false);
    if (r.ok && d.api_key) {
      setNewKey(d.api_key);
      load();
    } else {
      toast("Failed to create key");
    }
  };

  const revoke = async (id: number) => {
    const r = await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
    toast(r.ok ? "Key revoked" : "Revoke failed");
    load();
  };

  const active = keys.filter((k) => !k.revoked_at);

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle={`${active.length} active · hashed lzk_* keys with scopes + rate limits`}
      >
        <button
          onClick={() => { setModal(true); setNewKey(null); setName(""); }}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Create key
        </button>
      </PageHeader>

      {keys.length === 0 && !loading ? (
        <Empty title="No API keys" hint="Create one above — it shows once, then stores as a hash." />
      ) : (
        <Card className="p-0 overflow-x-auto max-w-4xl">
          <div className="min-w-[720px]">
          <div className="grid grid-cols-[1fr_140px_110px_130px_90px_80px] px-5 py-3 border-b border-border text-[11px] font-bold text-muted uppercase tracking-wide">
            <span>Key</span><span>Scopes</span><span>Limit</span><span>Last used</span><span>Status</span><span></span>
          </div>
          {keys.map((k) => (
            <div
              key={k.id}
              className="grid grid-cols-[1fr_140px_110px_130px_90px_80px] px-5 py-3.5 border-b border-border last:border-0 items-center hover:bg-cardHover transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Key className="w-3.5 h-3.5 text-accentSoft shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-fg font-mono truncate">{k.key_prefix}…</div>
                  <div className="text-xs text-muted truncate">{k.name}</div>
                </div>
              </div>
              <span className="text-xs text-accentSoft font-medium">{k.scopes}</span>
              <span className="text-xs text-muted">{k.rate_limit_rpm}/min</span>
              <span className="text-xs text-muted">{timeAgo(k.last_used_at)}</span>
              <span className={`text-xs font-semibold ${k.revoked_at ? "text-bad" : "text-ok"}`}>
                {k.revoked_at ? "revoked" : "active"}
              </span>
              {!k.revoked_at && (
                <button onClick={() => revoke(k.id)} className="text-xs text-bad hover:underline">
                  revoke
                </button>
              )}
            </div>
          ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-muted mt-4 max-w-4xl">
        Keys are shown once at creation and stored as SHA-256 hashes. Docs:{" "}
        <a href="https://ai-company.lazynext.com/api/v1/docs" className="text-accentSoft hover:underline">
          ai-company.lazynext.com/api/v1/docs
        </a>
      </p>

      {modal && (
        <div className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-card border border-border rounded-[14px] p-6 relative">
            <button onClick={() => setModal(false)} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            {newKey ? (
              <>
                <h2 className="text-lg font-bold text-fg mb-1">Key created</h2>
                <p className="text-xs text-muted mb-4">Copy it now — it won't be shown again.</p>
                <div className="flex items-center gap-2 bg-input border border-border rounded-lg px-3.5 py-3">
                  <code className="flex-1 text-xs text-accentSoft font-mono break-all">{newKey}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(newKey); toast("Copied"); }}
                    className="text-muted hover:text-fg shrink-0"
                    aria-label="Copy"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => setModal(false)}
                  className="mt-5 w-full bg-accent hover:bg-accentSoft text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={create}>
                <h2 className="text-lg font-bold text-fg mb-1">Create API key</h2>
                <p className="text-xs text-muted mb-5">Hashed storage — shown once.</p>
                <label className="text-xs text-muted">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. ci-pipeline"
                  className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
                />
                <label className="text-xs text-muted">Scopes</label>
                <select
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  className="mt-1.5 mb-5 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="read">read</option>
                  <option value="read,write">read + write</option>
                  <option value="read,write,admin">read + write + admin</option>
                </select>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {busy ? "Creating…" : "Create key"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
