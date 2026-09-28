"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { queryApi } from "@/lib/api";
import { toast } from "@/components/Toast";
import Link from "next/link";
import {
  GitBranch, Mail, TerminalSquare, Globe, Database, Palette, Cpu, CreditCard,
  Share2, Briefcase, ShoppingCart, Phone, LifeBuoy, Send, CalendarClock, MessageCircle,
  FileCheck2, BookOpen, Webhook,
} from "lucide-react";

const INTEGRATIONS = [
  { name: "GitHub", desc: "Lazynext-AI org — repos + CI", icon: GitBranch, ok: true },
  { name: "Brevo", desc: "Transactional + campaign email — briefings, alerts", icon: Mail, ok: true },
  { name: "Workers AI", desc: "LLM brain — Llama-3.3-70b, free", icon: Cpu, ok: true },
  { name: "Cloudflare", desc: "Workers + D1 + KV + Vectorize + Browser + Containers", icon: Globe, ok: true },
  { name: "Penpot", desc: "Design system — penpot.lazynext.com", icon: Palette, ok: true },
  { name: "Scraping", desc: "Cloudflare Browser Rendering — headless Chromium", icon: Database, ok: true },
  { name: "Web Search", desc: "Serper (Google results) — market research", icon: Globe, ok: true },
  { name: "Dodo Payments", desc: "Billing — merchant of record ($29/mo plan live)", icon: CreditCard, ok: true },
];

// Connector library — only genuinely-external services remain. CRM, support,
// scheduling, commerce, and email marketing are all native on D1 now.
// What's left are destination networks Cloudflare can't reach, Brevo for
// email delivery, plus SignWell for legal-grade e-signatures.
const CONNECTORS: { group: string; icon: typeof Share2; items: { id: string; name: string; hint: string; oauth?: boolean }[] }[] = [
  {
    group: "Social posting", icon: Share2,
    items: [
      { id: "x", name: "X / Twitter", hint: "OAuth2 bearer — agents post marketing tweets", oauth: true },
      { id: "linkedin", name: "LinkedIn", hint: "access_token[:urn] — agents post B2B content", oauth: true },
      { id: "meta", name: "Meta Ads", hint: "access_token:ad_account_id — run paid campaigns", oauth: true },
      { id: "facebook", name: "Facebook Page", hint: "page_access_token:page_id — organic page posts", oauth: true },
      { id: "instagram", name: "Instagram", hint: "access_token:ig_user_id — image+caption posts", oauth: true },
      { id: "threads", name: "Threads", hint: "access_token:threads_user_id — Meta text posts", oauth: true },
      { id: "bluesky", name: "Bluesky", hint: "handle:app_password — bsky.app → Settings → App passwords" },
      { id: "mastodon", name: "Mastodon", hint: "instance_host:access_token — any fediverse instance" },
      { id: "reddit", name: "Reddit", hint: "client_id:secret:user:pass:sub — script app OAuth" },
      { id: "pinterest", name: "Pinterest", hint: "access_token:board_id — image pins (image_url required)", oauth: true },
      { id: "vk", name: "VK", hint: "access_token:owner_id — vk.com/dev app; negative owner = community wall" },
      { id: "youtube", name: "YouTube", hint: "OAuth — video uploads only (media_url); no text posts via API", oauth: true },
      { id: "tiktok", name: "TikTok", hint: "OAuth — video via pull-from-url; media domain must be verified, unaudited apps post private", oauth: true },
      { id: "gmb", name: "Google Business", hint: "OAuth — local posts on the Maps/Search listing", oauth: true },
    ],
  },
  {
    group: "Chat / messaging", icon: MessageCircle,
    items: [
      { id: "discord", name: "Discord", hint: "channel webhook URL — server announcements" },
      { id: "slack", name: "Slack", hint: "incoming-webhook URL — workspace updates" },
      { id: "telegram", name: "Telegram", hint: "bot_token:chat_id — channel/group messages" },
      { id: "matrix", name: "Matrix", hint: "homeserver|room_id|access_token — Element etc." },
      { id: "teams", name: "MS Teams", hint: "Power Automate webhook URL — channel → Workflows (O365 connectors retired May-2026)" },
      { id: "mattermost", name: "Mattermost", hint: "incoming-webhook URL — Integrations → Incoming Webhooks" },
      { id: "zulip", name: "Zulip", hint: "base_url|bot_email|api_key — Settings → Bots → zuliprc" },
      { id: "viber", name: "Viber", hint: "auth_token — partners.viber.com bot; payload.to or broadcast_list" },
      { id: "line", name: "LINE", hint: "channel_access_token — Messaging API; broadcasts to all friends" },
    ],
  },
  {
    group: "Dev publishing", icon: BookOpen,
    items: [
      { id: "devto", name: "Dev.to", hint: "api_key — dev.to → Settings → Extensions → API keys" },
      { id: "hashnode", name: "Hashnode", hint: "token:publication_id — Account → Developer settings" },
      { id: "medium", name: "Medium", hint: "integration_token — API officially unsupported; tokens still work (best-effort)" },
      { id: "wordpress", name: "WordPress", hint: "site_base|user|app_password — WP ≥5.6 app passwords" },
      { id: "github", name: "GitHub", hint: "pat — posts public gists; PAT already powers repo ops" },
      { id: "gitlab", name: "GitLab", hint: "pat or host:pat — 'api' scope, posts public snippets" },
      { id: "tumblr", name: "Tumblr", hint: "access_token:blog_name — tumblr.com/oauth app" },
      { id: "ghost", name: "Ghost", hint: "site_base|key_id:key_secret — custom integration admin key" },
      { id: "beehiiv", name: "beehiiv", hint: "api_key:publication_id — Max/Enterprise plan only" },
      { id: "lemmy", name: "Lemmy", hint: "instance|user|pass — fediverse; 'to' = community_id" },
      { id: "listmonk", name: "Listmonk", hint: "base|user|pass|list_id — self-hosted newsletter campaigns" },
    ],
  },
  {
    group: "Bridges", icon: Webhook,
    items: [
      { id: "webhook", name: "Webhook", hint: "https:// url (|bearer) — Zapier/Make/n8n/IFTTT fan-out" },
      { id: "ayrshare", name: "Ayrshare", hint: "api_key — one call posts to TikTok/YouTube/Snapchat/GMB +10" },
      { id: "postiz", name: "Postiz", hint: "api_key|integration_id[|base_url] — open-source, 27 platforms" },
      { id: "buffer", name: "Buffer", hint: "api_key:channel_id — Settings → API key; queues to the channel" },
    ],
  },
  {
    group: "Phone / SMS", icon: Phone,
    items: [
      { id: "twilio", name: "Twilio", hint: "Account SID + auth token + number — SMS/voice" },
      { id: "whatsapp", name: "WhatsApp Business", hint: "API token + phone id — chat notifications" },
    ],
  },
  {
    group: "Email", icon: Mail,
    items: [
      { id: "brevo", name: "Brevo", hint: "api_key — or sender@domain.com:api_key (brevo.com → SMTP & API)" },
    ],
  },
  {
    group: "Legal signing", icon: FileCheck2,
    items: [
      { id: "signwell", name: "SignWell", hint: "api_key — free legal e-sign API, 25 docs/mo (signwell.com → Settings → API)" },
    ],
  },
];

const FLAGS = [
  { key: "flag:briefing_emails", label: "Briefing emails", desc: "Weekly founder report to your inbox" },
  { key: "flag:auto_deploy", label: "Auto-deploy", desc: "DevOps ships products without approval" },
  { key: "flag:knowledge_ingestion", label: "Knowledge ingestion", desc: "Web research + RAG on new sources" },
  { key: "flag:webhook_alerts", label: "Webhook alerts", desc: "Signed events on deploys + failures" },
  { key: "flag:auto_code_review", label: "Auto code review", desc: "Review agent scores every PR" },
  { key: "flag:maintenance", label: "Maintenance mode", desc: "Show the maintenance screen across the dashboard" },
  { key: "email:weekly_briefing", label: "Email: weekly briefing", desc: "Sunday founder report by email" },
  { key: "email:deploy_alerts", label: "Email: deploy alerts", desc: "Instant email when a product ships" },
  { key: "email:agent_failures", label: "Email: agent failures", desc: "Email when an agent fails 3x" },
  { key: "email:usage_digest", label: "Email: usage digest", desc: "Monthly API + spend digest" },
];

function ChatHook({ platform }: { platform: string }) {
  const [url, setUrl] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={`${platform.charAt(0).toUpperCase() + platform.slice(1)} webhook URL`}
        className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-xs text-fg outline-none focus:border-accent transition"
      />
      <button
        onClick={async () => {
          if (!url) return;
          const r = await fetch("/api/webhooks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url, channels: "*" }),
          });
          toast(r.ok ? `${platform} connected` : "Failed");
          if (r.ok) setUrl("");
        }}
        className="text-xs bg-accent hover:bg-accentSoft text-white font-semibold px-3.5 py-2 rounded-lg transition capitalize"
      >
        Connect
      </button>
    </div>
  );
}

function ConnectorHook({ id, name, hint, oauth }: { id: string; name: string; hint: string; oauth?: boolean }) {
  const [val, setVal] = useState("");
  const [appVal, setAppVal] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/kv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "get", key: `conn:${id}` }),
    })
      .then((r) => r.json())
      .then((d) => setSaved(Boolean(d.value)));
  }, [id]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-fg">{name}</div>
        <span className={`text-[11px] font-semibold ${saved ? "text-ok" : "text-muted"}`}>
          {saved ? "connected" : "not set"}
        </span>
      </div>
      <div className="text-xs text-muted mb-2">{hint}</div>
      <div className="flex gap-2">
        <input
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={saved ? "••••••• (saved — replace)" : "API key / token / URL"}
          className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-xs text-fg outline-none focus:border-accent transition"
        />
        <button
          onClick={async () => {
            if (!val) return;
            const r = await fetch("/api/kv", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "put", key: `conn:${id}`, value: val }),
            });
            toast(r.ok ? `${name} connected` : "Failed");
            if (r.ok) { setVal(""); setSaved(true); }
          }}
          className="text-xs bg-accent hover:bg-accentSoft text-white font-semibold px-3.5 py-2 rounded-lg transition shrink-0"
        >
          {saved ? "Update" : "Connect"}
        </button>
        {oauth && (
          <a
            href={`/api/connect/${id}`}
            className="text-xs bg-input hover:bg-border text-fg font-semibold px-3.5 py-2 rounded-lg transition shrink-0"
            title="OAuth connect — stores conn:{id} automatically (set app creds below first)"
          >
            OAuth ↗
          </a>
        )}
      </div>
      {oauth && (
        <div className="flex gap-2 mt-2">
          <input
            type="password"
            value={appVal}
            onChange={(e) => setAppVal(e.target.value)}
            placeholder="conn:app — client_id:client_secret (dev app)"
            className="flex-1 bg-input border border-border rounded-lg px-3 py-1.5 text-[11px] text-fg outline-none focus:border-accent transition"
          />
          <button
            onClick={async () => {
              if (!appVal) return;
              const r = await fetch("/api/kv", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "put", key: `conn:${id}:app`, value: appVal }),
              });
              toast(r.ok ? `${name} app creds saved` : "Failed");
              if (r.ok) setAppVal("");
            }}
            className="text-[11px] bg-input hover:bg-border text-fg font-semibold px-3 py-1.5 rounded-lg transition shrink-0"
          >
            Save app
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [totpSetup, setTotpSetup] = useState(false);
  const [totpUri, setTotpUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQr, setTotpQr] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  useEffect(() => {
    Promise.all(
      [...FLAGS.map((f) => f.key), "flag:two_factor"].map((k) =>
        kv("get", k).then((r) => [k, r.value === "true"])
      )
    )
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
                    {integration === "Brevo" && "conn:brevo (KV) / BREVO_API_KEY"}
                    {integration === "Scraping" && "CLOUDFLARE (browser)"}
                    {integration === "Workers AI" && "CLOUDFLARE_API_URL"}
                    {integration === "Cloudflare" && "CLOUDFLARE_DEPLOY_TOKEN"}
                    {integration === "Penpot" && "penpot.lazynext.com"}
                  </span>
                </div>
                <p className="text-xs text-muted pt-2 border-t border-border">
                  {integration === "Workers AI"
                    ? "Runs on Cloudflare Workers AI — free, no key needed."
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
              <div className="text-xs text-muted">Domains</div>
              <div className="space-y-1 mt-1">
                {[
                  ["lazynext.com", "marketing"],
                  ["dashboard.lazynext.com", "dashboard"],
                  ["ai-company.lazynext.com", "API"],
                  ["penpot.lazynext.com", "design"],
                ].map(([d, r]) => (
                  <div key={d} className="flex items-center justify-between">
                    <a href={`https://${d}`} target="_blank" rel="noreferrer" className="text-accentSoft hover:underline text-xs font-mono">
                      {d}
                    </a>
                    <span className="text-xs text-muted">{r}</span>
                  </div>
                ))}
              </div>
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
          <h2 className="text-sm font-semibold mb-3">Security</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-fg">Two-factor auth</div>
                <div className="text-xs text-muted">Real TOTP — an authenticator code is required at sign-in</div>
              </div>
              <button
                onClick={async () => {
                  if (flags["flag:two_factor"]) {
                    const code = prompt("Enter your authenticator code to disable 2FA:");
                    if (!code) return;
                    const r = await fetch("/api/2fa", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "disable", code }),
                    });
                    if (r.ok) { setFlags((f) => ({ ...f, "flag:two_factor": false })); toast("2FA disabled"); }
                    else toast("Invalid code — 2FA still on");
                  } else {
                    setTotpSetup(true);
                  }
                }}
                className={`w-11 h-6 rounded-full transition relative ${flags["flag:two_factor"] ? "bg-accent" : "bg-input border border-border"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${flags["flag:two_factor"] ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <div className="pt-3 border-t border-border">
              <div className="text-sm text-fg mb-1">Email verification</div>
              <div className="text-xs text-muted mb-3">Send a real verification email to the founder address via Brevo.</div>
              <button
                onClick={async () => {
                  const b = await queryApi<any>("SELECT founder_email FROM company_brain LIMIT 1");
                  const email = b[0]?.founder_email;
                  if (!email) return toast("No founder_email set");
                  const r = await fetch("/api/email", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      to: email,
                      subject: "Verify your Lazynext email",
                      html: `<div style="font-family:sans-serif;background:#0A0A0B;color:#FAFAFA;padding:32px;border-radius:12px"><h2 style="margin:0 0 12px"><span style="color:#A78BFA">◆</span> Lazynext</h2><p style="color:#9C9CAA">Confirm this address owns the company dashboard.</p><a href="https://dashboard.lazynext.com" style="display:inline-block;margin-top:16px;background:#8B5CF6;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Verify email</a></div>`,
                    }),
                  });
                  toast(r.ok ? `Verification sent to ${email}` : "Send failed");
                }}
                className="text-xs bg-accent hover:bg-accentSoft text-white font-semibold px-3.5 py-2 rounded-lg transition"
              >
                Send verification email
              </button>
            </div>
          </div>
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
          <h2 className="text-sm font-semibold mb-3">Chat integrations</h2>
          <p className="text-xs text-muted mb-4">
            Company events post to Slack, Discord, Telegram, Microsoft Teams or Google Chat.
            Paste a webhook URL — Lazynext formats the message for each platform automatically.
          </p>
          <div className="space-y-3">
            {(["slack", "discord", "telegram", "teams", "google chat"] as const).map((platform) => (
              <ChatHook key={platform} platform={platform} />
            ))}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden col-span-2">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-accentSoft" />
            <div className="text-sm font-semibold">Connector library</div>
          </div>
          <p className="px-5 pt-3 pb-1 text-xs text-muted">
            Situational services — add a credential and agents can call them. Stored in KV as
            <code className="mx-1 text-accentSoft">conn:*</code>; nothing activates until you connect it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0 px-5 py-4">
            {CONNECTORS.map((g) => (
              <div key={g.group} className="mb-5 last:mb-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted uppercase tracking-wide mb-3">
                  <g.icon className="w-3.5 h-3.5 text-accentSoft" />
                  {g.group}
                </div>
                <div className="space-y-4">
                  {g.items.map((c) => (
                    <ConnectorHook key={c.id} id={c.id} name={c.name} hint={c.hint} oauth={c.oauth} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-badDim">
          <h2 className="text-sm font-semibold mb-1 text-bad">Danger zone</h2>
          <p className="text-xs text-muted mb-4">
            Seeded demo rows (agents, tasks, product, messages) — clear before going live.
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
            <a href="https://github.com/Lazynext-AI" className="block text-sm text-accentSoft hover:underline">
              GitHub org →
            </a>
          </div>
        </Card>
      </div>

      {totpSetup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setTotpSetup(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-fg mb-4">Set up two-factor auth</h2>
            {!totpUri ? (
              <button
                onClick={async () => {
                  const r = await fetch("/api/2fa", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ action: "setup" }),
                  });
                  const d = await r.json();
                  setTotpUri(d.uri);
                  setTotpSecret(d.secret);
                  const QR = await import("qrcode");
                  setTotpQr(await QR.toDataURL(d.uri, { margin: 1, width: 200, color: { dark: "#FAFAFA", light: "#141419" } }));
                }}
                className="w-full bg-accent hover:bg-accentSoft text-white text-sm font-semibold py-2.5 rounded-lg transition"
              >
                Generate secret
              </button>
            ) : (
              <>
                {totpQr && <img src={totpQr} alt="TOTP QR" className="mx-auto rounded-lg mb-4" />}
                <div className="text-xs text-muted mb-1">Or enter manually:</div>
                <code className="block bg-input rounded-lg px-3 py-2 text-xs text-accentSoft font-mono break-all mb-4">{totpSecret}</code>
                <label className="text-xs text-muted">Enter the 6-digit code to confirm</label>
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  className="w-full bg-input border border-border rounded-lg px-3.5 py-2.5 mt-1.5 text-sm text-fg font-mono tracking-[0.3em] text-center outline-none focus:border-accent transition"
                  placeholder="000000"
                />
                <button
                  onClick={async () => {
                    const r = await fetch("/api/2fa", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "confirm", code: totpCode }),
                    });
                    if (r.ok) {
                      setFlags((f) => ({ ...f, "flag:two_factor": true }));
                      setTotpSetup(false); setTotpUri(""); setTotpCode("");
                      toast("2FA enabled — code required at sign-in");
                    } else toast("Invalid code");
                  }}
                  disabled={totpCode.length !== 6}
                  className="w-full mt-3 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  Confirm &amp; enable
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
