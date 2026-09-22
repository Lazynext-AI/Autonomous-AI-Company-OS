"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, ListTodo, Brain, FileText, BookOpen,
  Activity, Key, Settings, Search, Zap, TerminalSquare, Moon, LogOut,
} from "lucide-react";
import { toast } from "@/components/Toast";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard, hint: "Dashboard home" },
  { href: "/products", label: "Products", icon: Activity, hint: "What the company shipped" },
  { href: "/notifications", label: "Notifications", icon: Activity, hint: "Alerts + briefings" },
  { href: "/search", label: "Search", icon: Activity, hint: "Tasks, agents, knowledge" },
  { href: "/agents", label: "Agents", icon: Users, hint: "Crew status + scores" },
  { href: "/tasks", label: "Tasks", icon: ListTodo, hint: "Queued, working, done" },
  { href: "/brain", label: "Brain", icon: Brain, hint: "Mission, stack, blockers" },
  { href: "/briefings", label: "Briefings", icon: FileText, hint: "Company reports" },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen, hint: "Ingested docs" },
  { href: "/feed", label: "Feed", icon: Activity, hint: "Live bus messages" },
  { href: "/conversations", label: "Conversations", icon: Activity, hint: "Agent-to-agent threads" },
  { href: "/logs", label: "Logs", icon: Activity, hint: "Console — errors + events" },
  { href: "/approvals", label: "Approvals", icon: Activity, hint: "Sign off on sensitive actions" },
  { href: "/audit", label: "Audit", icon: Activity, hint: "Who did what — founder + agent events" },
  { href: "/sandbox", label: "Sandbox", icon: Activity, hint: "Cloudflare exec container — run code" },
  { href: "/team", label: "Team", icon: Activity, hint: "1 human + the agent crew" },
  { href: "/billing", label: "Billing", icon: Activity, hint: "Plan + usage metrics" },
  { href: "/analytics", label: "Analytics", icon: Activity, hint: "Tasks + scores over time" },
  { href: "/deployments", label: "Deployments", icon: Activity, hint: "Shipped products" },
  { href: "/code", label: "Code", icon: Activity, hint: "GitHub repos" },
  { href: "/api-keys", label: "API Keys", icon: Key, hint: "lzk_* keys + scopes" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Integrations + links" },
];

const ACTIONS: { label: string; hint: string; icon: any; run: () => Promise<string> | string }[] = [
  {
    label: "Agent tick",
    hint: "One agent generates a message on the bus",
    icon: Zap,
    run: async () => {
      const r = await fetch("/api/tick", { method: "POST" });
      return r.ok ? "Agent ticked" : "Tick failed";
    },
  },
  {
    label: "Open sandbox",
    hint: "Run code in the Cloudflare container",
    icon: TerminalSquare,
    run: () => {
      location.href = "/sandbox";
      return "Opening sandbox…";
    },
  },
  {
    label: "Toggle theme",
    hint: "Switch dark / light",
    icon: Moon,
    run: () => {
      document.documentElement.classList.toggle("light");
      localStorage.setItem("lz_theme", document.documentElement.classList.contains("light") ? "light" : "dark");
      return "Theme toggled";
    },
  },
  {
    label: "Sign out",
    hint: "End the dashboard session",
    icon: LogOut,
    run: async () => {
      await fetch("/api/logout", { method: "POST" });
      location.href = "/login";
      return "";
    },
  },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const qLower = q.toLowerCase();
  const results = q
    ? ITEMS.filter(
        (i) =>
          i.label.toLowerCase().includes(qLower) ||
          i.hint.toLowerCase().includes(qLower)
      )
    : ITEMS;
  const actions = q
    ? ACTIONS.filter(
        (a) =>
          a.label.toLowerCase().includes(qLower) ||
          a.hint.toLowerCase().includes(qLower)
      )
    : [];
  const all = [...results.map((r) => ({ ...r, action: null as any })),
               ...actions.map((a) => ({ href: null as any, label: a.label, hint: a.hint, icon: a.icon, action: a }))];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setSel(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const go = async (item: (typeof all)[number]) => {
    setOpen(false);
    if (item.href) {
      router.push(item.href);
    } else if (item.action) {
      const msg = await item.action.run();
      if (msg) toast(msg);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-bg/70 backdrop-blur-sm flex items-start justify-center pt-[18vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-[14px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Search className="w-4 h-4 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && all[sel]) go(all[sel]);
            }}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted bg-input px-1.5 py-0.5 rounded">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {all.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href ?? item.label}
                onClick={() => go(item)}
                onMouseEnter={() => setSel(i)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-left transition ${
                  i === sel ? "bg-accentBg" : ""
                }`}
              >
                <Icon className={`w-4 h-4 ${i === sel ? "text-accentSoft" : "text-muted"}`} />
                <div>
                  <div className={`text-sm font-medium ${i === sel ? "text-accentSoft" : "text-fg"}`}>
                    {item.label}
                  </div>
                  <div className="text-xs text-muted">{item.hint}</div>
                </div>
              </button>
            );
          })}
          {all.length === 0 && (
            <div className="py-8 text-center text-sm text-muted">No matches</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex gap-4 text-[10px] text-muted">
          <span>↑↓ navigate</span><span>↵ open</span><span>⌘K toggle</span>
        </div>
      </div>
    </div>
  );
}
