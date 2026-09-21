"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import {
  LayoutDashboard, Users, ListTodo, Brain, FileText, BookOpen,
  Activity, Key, Settings, Menu, X, BarChart3, Package, Bell, Search,
  Rocket, Code2, MessageSquare,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/search", label: "Search", icon: Search },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/brain", label: "Brain", icon: Brain },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/feed", label: "Feed", icon: Activity },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/code", label: "Code", icon: Code2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm transition ${
              active ? "bg-accentBg text-accentSoft font-semibold" : "text-muted hover:text-fg hover:bg-cardHover"
            }`}
          >
            <Icon className="w-4 h-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 bg-card border-r border-border flex-col">
        <div className="px-7 pt-7 pb-8">
          <Link href="/" className="text-xl font-bold text-fg">
            ◆ Lazynext
          </Link>
        </div>
        {nav}
        <div className="px-7 pb-6 flex items-center gap-2 text-xs text-muted">
          <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
          Live · v0.1
          <span className="ml-auto"><ThemeToggle /></span>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-card border-b border-border flex items-center justify-between px-4 z-40">
        <Link href="/" className="text-lg font-bold text-fg">
          <span className="text-accentSoft">◆</span> Lazynext
        </Link>
        <ThemeToggle />
        <button
          onClick={() => setOpen(!open)}
          className="w-9 h-9 rounded-lg bg-input flex items-center justify-center text-muted"
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-bg/80" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-card border-r border-border flex flex-col">
            <div className="px-6 pt-6 pb-6 flex items-center justify-between">
              <span className="text-lg font-bold text-fg">◆ Lazynext</span>
              <button onClick={() => setOpen(false)} className="text-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            {nav}
            <div className="px-6 pb-6 flex items-center gap-2 text-xs text-muted">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              Live · v0.1
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
