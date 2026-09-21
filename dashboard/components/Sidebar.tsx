"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ListTodo,
  Brain,
  FileText,
  BookOpen,
  Activity,
  Key,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/brain", label: "Brain", icon: Brain },
  { href: "/briefings", label: "Briefings", icon: FileText },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/feed", label: "Feed", icon: Activity },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 w-60 bg-card border-r border-border flex flex-col">
      <div className="px-7 pt-7 pb-8">
        <Link href="/" className="text-xl font-bold text-zinc-50">
          ◆ Lazynext
        </Link>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm transition ${
                active
                  ? "bg-accentBg text-accentSoft font-semibold"
                  : "text-muted hover:text-zinc-50 hover:bg-cardHover"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-7 pb-6 flex items-center gap-2 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
        Live · v0.1
      </div>
    </aside>
  );
}
