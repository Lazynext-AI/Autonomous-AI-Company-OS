import { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border border-border rounded-[14px] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string | number;
  delta?: string;
}) {
  const up = delta?.startsWith("+") || delta?.startsWith("−") || delta?.startsWith("-");
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-2xl font-bold text-zinc-50">{value}</div>
        {delta && (
          <div className={`text-xs font-medium ${up ? "text-ok" : "text-muted"}`}>
            {delta}
          </div>
        )}
      </div>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-okBg text-ok",
    done: "bg-okBg text-ok",
    live: "bg-okBg text-ok",
    active: "bg-okBg text-ok",
    running: "bg-okBg text-ok",
    in_progress: "bg-accentBg text-accentSoft",
    building: "bg-accentBg text-accentSoft",
    working: "bg-accentBg text-accentSoft",
    pending: "bg-warnBg text-warn",
    queued: "bg-warnBg text-warn",
    idle: "bg-warnBg text-warn",
    failed: "bg-badBg text-bad",
    stopped: "bg-badBg text-bad",
    error: "bg-badBg text-bad",
    escalated: "bg-badBg text-bad",
  };
  const cls = map[status] || "bg-border text-muted";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border border-dashed border-border rounded-[14px] py-16 text-center">
      <div className="text-3xl mb-3">◌</div>
      <div className="text-zinc-50 font-medium">{title}</div>
      {hint && <div className="text-sm text-muted mt-1">{hint}</div>}
    </div>
  );
}

export function timeAgo(dateString?: string) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 60) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
}
