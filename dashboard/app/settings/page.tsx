"use client";

import { PageHeader, Card } from "@/components/ui";
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

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Company configuration and connected services." />

      <div className="grid grid-cols-2 gap-5 max-w-5xl">
        <Card className="p-0 overflow-hidden col-span-2">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Integrations</div>
          {INTEGRATIONS.map((i) => (
            <div key={i.name} className="flex items-center gap-3.5 px-5 py-3.5 border-b border-border last:border-0">
              <div className="w-9 h-9 rounded-[10px] bg-accentBg flex items-center justify-center">
                <i.icon className="w-4 h-4 text-accentSoft" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-zinc-50">{i.name}</div>
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
              <div className="text-zinc-50">Lazynext — The Autonomous AI Company OS</div>
            </div>
            <div>
              <div className="text-xs text-muted">Runtime</div>
              <div className="text-zinc-50">Local agents → Cloudflare Workers/D1</div>
            </div>
            <div>
              <div className="text-xs text-muted">API</div>
              <a href="https://ai-company.lazynext.com/api/v1/docs" className="text-accentSoft hover:underline">
                ai-company.lazynext.com/api/v1
              </a>
            </div>
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
