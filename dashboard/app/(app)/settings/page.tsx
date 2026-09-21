"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { toast } from "@/components/Toast";
import Link from "next/link";
import {
  GitBranch, Mail, TerminalSquare, Globe, Database, Palette, Cpu,
} from "lucide-react";

const INTEGRATIONS = [
  { name: "GitHub", desc: "Lazynext-Platform org — repos + CI", icon: GitBranch, ok: true },
  { name: "Resend", desc: "Transactional email — briefings, alerts", icon: Mail, ok: true },
  { name: "E2B", desc: "Code sandboxes for agents", icon: TerminalSquare, ok: true },
  { name: "Atlas Cloud", desc: "LLM inference — needs credits", icon: Cpu, ok: false },
  { name: "Cloudflare", desc: "Workers + D1 + KV + Vectorize", icon: Globe, ok: true },
  { name: "Penpot", desc: "Design system — penpot.lazynext.com", icon: Palette, ok: true },
  { name: "Firecrawl", desc: "Market + competitor research", icon: Database, ok: true },
];

const FLAGS = [
  { key: "flag:briefing_emails", label: "Briefing emails", desc: "Weekly founder report to your inbox" },
  { key: "flag:auto_deploy", label: "Auto-deploy", desc: "DevOps ships products without approval" },
  { key: "flag:knowledge_ingestion", label: "Knowledge ingestion", desc: "Firecrawl + RAG on new sources" },
  { key: "flag:webhook_alerts", label: "Webhook alerts", desc: "Signed events on deploys + failures" },
  { key: "flag:auto_code_review", label: "Auto code review", desc: "Review agent scores every PR" },
  { key: "flag:maintenance", label: "Maintenance mode", desc: "Show the maintenance screen across the dashboard" },
];

function kv(action: string, key: string, value?: string) {
  return fetch("/api/kv", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, key, value }),
  }).then((r) => r.json());
}

export default function SettingsPage() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [integration, setIntegration] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  useEffect(() => {
    Promise.all(FLAGS.map((f) => kv("get", f.key).then((r) => [f.key, r.value === "true"])))
      .then((pairs) => setFlags(Object.fromEntries(pairs as [string, boolean][])))
      .finally(() => setLoading(false));
    const d = (localStorage.getItem("lz_density") as "compact") || "comfortable";
    setDensity(d);
  }, []);

  const setD = (d: "comfortable" | "compact") => {
    setDensity(d);
    localStorage.setItem("lz_density", d);
    document.documentElement.dataset.density = d;
  };

  const toggle = async (key: string) => {
    const next = !flags[key];
    setFlags((f) => ({ ...f, [key]: next }));
    await kv("put", key, String(next));
    const label = FLAGS.find((f) => f.key === key)?.label;
    toast(`${label} ${next ? "enabled" : "disabled"}`);
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Company configuration and connected services." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl">
        <Card className="p-0 overflow-hidden col-span-2">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Integrations</div>
          {INTEGRATIONS.map((i) => (
            <div key={i.name} className="flex items-center gap-3.5 px-5 py-3.5 border-b border-border last:border-0">
              <div className="w-9 h-9 rounded-[10px] bg-accentBg flex items-center justify-center">
                <i.icon className="w-4 h-4 text-accentSoft" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-fg">{i.name}</div>
                <div className="text-xs text-muted">{i.desc}</div>
              </div>
              <span className={`text-xs font-semibold ${i.ok ? "text-ok" : "text-warn"}`}>
                {i.ok ? "connected" : "needs credits"}
              </span>
              <button
                onClick={() => setIntegration(i.name)}
                className="text-xs text-accentSoft hover:underline"
              >
                configure
              </button>
            </div>
          ))}
        </Card>

        {integration && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIntegration(null)}>
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-fg mb-1">{integration} config</h2>
              <p className="text-xs text-muted mb-5">Set via environment variables in `.env` — stored server-side.</p>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Status</span>
                  <span className="text-ok font-semibold">
                    {INTEGRATIONS.find((i) => i.name === integration)?.ok ? "connected" : "needs credits"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Credential</span>
                  <span className="text-fg font-mono text-xs">
                    {integration === "GitHub" && "GITHUB_TOKEN"}
                    {integration === "Resend" && "RESEND_API_KEY"}
                    {integration === "E2B" && "E2B_API_KEY"}
                    {integration === "Firecrawl" && "FIRECRAWL_API_KEY"}
                    {integration === "Atlas Cloud" && "ATLASCLOUD_API_KEY"}
                    {integration === "Cloudflare" && "CLOUDFLARE_DEPLOY_TOKEN"}
                    {integration === "Penpot" && "penpot.lazynext.com"}
                  </span>
                </div>
                <p className="text-xs text-muted pt-2 border-t border-border">
                  {integration === "Atlas Cloud"
                    ? "Add credits at atlascloud.ai — the client auto-uses Atlas once funded."
                    : `Rotate by updating ${integration.toUpperCase().replace(" ", "_")} env vars, then redeploy.`}
                </p>
              </div>
              <button onClick={() => setIntegration(null)} className="mt-5 w-full bg-input text-muted hover:text-fg text-sm font-medium py-2.5 rounded-lg transition">
                Close
              </button>
            </div>
          </div>
        )}

        <Card>
          <h2 className="text-sm font-semibold mb-3">Company</h2>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted">Platform</div>
              <div className="text-fg">Lazynext — The Autonomous AI Company OS</div>
            </div>
            <div>
              <div className="text-xs text-muted">Runtime</div>
              <div className="text-fg">Local agents → Cloudflare Workers/D1</div>
            </div>
            <div>
              <div className="text-xs text-muted">API</div>
              <a href="https://ai-company.lazynext.com/api/v1/docs" className="text-accentSoft hover:underline">
                ai-company.lazynext.com/api/v1
              </a>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden col-span-2">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Feature flags</div>
          {FLAGS.map((f) => (
            <div key={f.key} className="flex items-center gap-3.5 px-5 py-3.5 border-b border-border last:border-0">
              <div className="flex-1">
                <div className="text-sm font-semibold text-fg">{f.label}</div>
                <div className="text-xs text-muted">{f.desc}</div>
              </div>
              <button
                onClick={() => toggle(f.key)}
                disabled={loading}
                aria-label={`Toggle ${f.label}`}
                className={`w-11 h-6 rounded-full transition relative ${
                  flags[f.key] ? "bg-accent" : "bg-input border border-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                    flags[f.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
          <p className="px-5 py-3 text-xs text-muted">
            Stored in Cloudflare KV — agents read these at runtime via kv_get.
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-3">Density</h2>
          <div className="flex gap-2">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setD(d)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium capitalize transition ${
                  density === d ? "bg-accent text-white" : "bg-input text-muted border border-border"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Card>

        <Card className="border-badDim">
          <h2 className="text-sm font-semibold mb-1 text-bad">Danger zone</h2>
          <p className="text-xs text-muted mb-4">
            Seeded demo rows (agents, tasks, product, messages) — clear before Atlas goes live.
          </p>
          <button
            onClick={async () => {
              if (!confirm("Delete all demo data? Agents, tasks, product info, and demo bus messages will be removed.")) return;
              const stmts = [
                "DELETE FROM task_log WHERE task_id LIKE 'demo-%'",
                "DELETE FROM agent_memories",
                "DELETE FROM bus_messages WHERE payload LIKE '%demo%'",
                "DELETE FROM milestone_log WHERE description LIKE '%demo%'",
                "UPDATE company_brain SET product_name = NULL, product_description = NULL, shipped_features = '[]', live_urls = '{}', agent_statuses = '{}'",
              ];
              let ok = true;
              for (const sql of stmts) {
                const r = await fetch("/api/query", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ sql, params: [] }),
                });
                if (!r.ok) ok = false;
              }
              toast(ok ? "Demo data cleared" : "Some deletions failed");
            }}
            className="bg-badBg hover:bg-bad hover:text-white text-bad text-sm font-semibold px-4 py-2.5 rounded-lg transition"
          >
            Clear demo data
          </button>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-3">More</h2>
          <div className="space-y-2.5">
            <button
              onClick={async () => {
                const tables = ["company_brain", "agent_memories", "task_log", "milestone_log", "knowledge_chunks"];
                const dump: Record<string, unknown[]> = {};
                for (const t of tables) {
                  const r = await fetch("/api/query", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ sql: `SELECT * FROM ${t} LIMIT 500`, params: [] }),
                  });
                  const d = await r.json();
                  dump[t] = d.results || [];
                }
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }));
                a.download = `lazynext-export-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                toast("Export downloaded");
              }}
              className="block text-sm text-accentSoft hover:underline"
            >
              Export data →
            </button>
            <Link href="/webhooks" className="block text-sm text-accentSoft hover:underline">
              Webhooks →
            </Link>
            <a href="https://penpot.lazynext.com" className="block text-sm text-accentSoft hover:underline">
              Design system →
            </a>
            <a href="https://github.com/Lazynext-Platform" className="block text-sm text-accentSoft hover:underline">
              GitHub org →
            </a>
          </div>
        </Card>
      </div>
    </>
  );
}
