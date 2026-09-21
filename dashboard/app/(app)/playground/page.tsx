"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { Play } from "lucide-react";

const ENDPOINTS = [
  "GET /api/v1/health",
  "GET /api/v1/agents",
  "GET /api/v1/tasks",
  "GET /api/v1/products",
  "POST /api/v1/tasks",
  "GET /api/v1/webhooks/deliveries",
];

export default function PlaygroundPage() {
  const [endpoint, setEndpoint] = useState(ENDPOINTS[0]);
  const [body, setBody] = useState("");
  const [key, setKey] = useState("");
  const [out, setOut] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setOut("");
    const [method, path] = endpoint.split(" ");
    try {
      const r = await fetch(`https://ai-company.lazynext.com${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: method === "POST" && body ? body : undefined,
      });
      setStatus(r.status);
      const text = await r.text();
      try {
        setOut(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setOut(text);
      }
    } catch (e) {
      setOut(String(e));
      setStatus(null);
    }
    setBusy(false);
  };

  return (
    <>
      <PageHeader
        title="API Playground"
        subtitle="Call the public API with an lzk_* key — live against ai-company.lazynext.com."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl">
        <Card>
          <h2 className="text-sm font-semibold mb-4">Request</h2>
          <label className="text-xs text-muted">Endpoint</label>
          <div className="space-y-1.5 mt-1.5 mb-4">
            {ENDPOINTS.map((ep) => (
              <button
                key={ep}
                onClick={() => setEndpoint(ep)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition ${
                  endpoint === ep
                    ? "bg-accentBg text-accentSoft font-semibold"
                    : "bg-input text-muted hover:text-fg"
                }`}
              >
                {ep}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted">API key (lzk_*)</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="lzk_…"
            className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg font-mono outline-none focus:border-accent"
          />
          {endpoint.startsWith("POST") && (
            <>
              <label className="text-xs text-muted">Body (JSON)</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder='{"description": "…", "agent_id": "builder_agent"}'
                className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-xs text-fg font-mono outline-none focus:border-accent resize-none"
              />
            </>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
          >
            <Play className="w-4 h-4" /> {busy ? "Sending…" : "Send"}
          </button>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Response</h2>
            {status != null && (
              <span className={`text-xs font-mono font-bold ${status < 300 ? "text-ok" : "text-bad"}`}>
                {status}
              </span>
            )}
          </div>
          <pre className="bg-input rounded-lg p-4 text-xs text-fg/80 whitespace-pre-wrap overflow-auto max-h-96 font-mono">
            {out || "Send a request — the real response renders here."}
          </pre>
        </Card>
      </div>
    </>
  );
}
