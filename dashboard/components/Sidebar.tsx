"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import {
  LayoutDashboard, Users, ListTodo, Brain, FileText, BookOpen,
  Activity, Key, Settings, Menu, X, BarChart3, Package, Bell, Search, ChevronDown, Plus,
  Rocket, Code2, MessageSquare, TerminalSquare, ShieldCheck, ScrollText,
  LogOut, CreditCard, Zap, Palette, LifeBuoy, CalendarClock, ShoppingCart, Send, PenTool,
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
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/tickets", label: "Support", icon: LifeBuoy },
  { href: "/bookings", label: "Bookings", icon: CalendarClock },
  { href: "/store", label: "Store", icon: ShoppingCart },
  { href: "/campaigns", label: "Marketing", icon: Send },
  { href: "/signatures", label: "Signatures", icon: PenTool },
  { href: "/logs", label: "Logs", icon: TerminalSquare },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/sandbox", label: "Sandbox", icon: TerminalSquare },
  { href: "/team", label: "Team", icon: Users },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/code", label: "Code", icon: Code2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/playground", label: "Playground", icon: Zap },
  { href: "/design", label: "Design", icon: Palette },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(false);
  const [productMenu, setProductMenu] = useState(false);
  const [product, setProduct] = useState("LaunchDeck");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const read = new Set<string>(JSON.parse(localStorage.getItem("lz_notifications_read") || "[]"));
        const rows = await queryApi<{ id: number }>(
          "SELECT id FROM bus_messages WHERE channel IN ('alerts','milestones','deploys') ORDER BY id DESC LIMIT 50"
        );
        setUnread(rows.filter((r) => !read.has(`e-${r.id}`)).length);
        const p = await queryApi<{ product_name?: string }>(
          "SELECT product_name FROM company_brain LIMIT 1"
        );
        if (p[0]?.product_name) setProduct(p[0].product_name);
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

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
            {item.href === "/notifications" && unread > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 bg-card border-r border-border flex-col">
        <div className="px-7 pt-7 pb-4">
          <Link href="/" className="text-xl font-bold text-fg">
            ◆ Lazynext
          </Link>
        </div>
        <div className="px-4 pb-4">
          <button
            onClick={() => setProductMenu((o) => !o)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] bg-input border border-border text-sm hover:border-accentDim transition"
          >
            <Package className="w-3.5 h-3.5 text-accentSoft" />
            <span className="flex-1 text-left text-fg font-medium truncate">{product}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted transition ${productMenu ? "rotate-180" : ""}`} />
          </button>
          {productMenu && (
            <div className="mt-1 bg-card border border-border rounded-xl shadow-xl py-1.5">
              <Link
                href="/products"
                onClick={() => setProductMenu(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-xs text-fg/80 hover:bg-cardHover transition"
              >
                <Package className="w-3.5 h-3.5 text-accentSoft" /> {product}
              </Link>
              <Link
                href="/products"
                onClick={() => setProductMenu(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-xs text-muted hover:bg-cardHover hover:text-fg transition"
              >
                <Plus className="w-3.5 h-3.5" /> New product…
              </Link>
            </div>
          )}
        </div>
        {nav}
        <div className="px-7 pb-6 flex items-center gap-2 text-xs text-muted relative">
          <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
          Live · v0.1
          <span className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <div className="relative">
              <button
                onClick={() => setAvatarMenu((o) => !o)}
                aria-label="Account menu"
                className="w-8 h-8 rounded-full bg-accentBg flex items-center justify-center text-accentSoft text-xs font-bold transition hover:ring-2 hover:ring-accent"
              >
                F
              </button>
              {avatarMenu && (
                <div className="absolute bottom-10 right-0 bg-card border border-border rounded-xl shadow-xl w-48 py-2 z-50">
                  <div className="px-4 py-2 border-b border-border">
                    <div className="text-xs font-semibold text-fg">Founder</div>
                    <div className="text-[10px] text-muted">owner account</div>
                  </div>
                  <Link
                    href="/settings"
                    onClick={() => setAvatarMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-fg/80 hover:bg-cardHover transition"
                  >
                    <Settings className="w-3.5 h-3.5 text-muted" /> Settings
                  </Link>
                  <Link
                    href="/billing"
                    onClick={() => setAvatarMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-fg/80 hover:bg-cardHover transition"
                  >
                    <CreditCard className="w-3.5 h-3.5 text-muted" /> Billing
                  </Link>
                  <button
                    onClick={async () => {
                      await fetch("/api/logout", { method: "POST" });
                      location.href = "/login";
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-bad hover:bg-cardHover transition text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </span>
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
