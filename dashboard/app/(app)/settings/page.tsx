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
            </div>
          ))}
        </Card>

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

        <Card>
          <h2 className="text-sm font-semibold mb-3">More</h2>
          <div className="space-y-2.5">
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
