"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, ListTodo, Brain, FileText, BookOpen,
  Activity, Key, Settings, Search,
} from "lucide-react";

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
  { href: "/analytics", label: "Analytics", icon: Activity, hint: "Tasks + scores over time" },
  { href: "/deployments", label: "Deployments", icon: Activity, hint: "Shipped products" },
  { href: "/code", label: "Code", icon: Activity, hint: "GitHub repos" },
  { href: "/api-keys", label: "API Keys", icon: Key, hint: "lzk_* keys + scopes" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Integrations + links" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = q
    ? ITEMS.filter(
        (i) =>
          i.label.toLowerCase().includes(q.toLowerCase()) ||
          i.hint.toLowerCase().includes(q.toLowerCase())
      )
    : ITEMS;

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

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
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
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && results[sel]) go(results[sel].href);
            }}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted bg-input px-1.5 py-0.5 rounded">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                onClick={() => go(item.href)}
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
          {results.length === 0 && (
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
