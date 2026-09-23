"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";

interface LogLine {
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  text: string;
}

const LEVEL_STYLE = {
  info: "text-muted",
  warn: "text-warn",
  error: "text-bad",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<"all" | "error" | "warn">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [tasks, wh, bus] = await Promise.all([
          queryApi<any>(
            "SELECT task_id, agent_id, error_log, status, created_at, completed_at FROM task_log ORDER BY id DESC LIMIT 100"
          ),
          queryApi<any>(
            "SELECT id, channel, status_code, error, attempted_at FROM webhook_deliveries ORDER BY id DESC LIMIT 50"
          ).catch(() => []),
          queryApi<any>(
            "SELECT id, channel, created_at FROM bus_messages ORDER BY id DESC LIMIT 60"
          ).catch(() => []),
        ]);

        const lines: LogLine[] = [];
        tasks.forEach((t) => {
          const errs = parseJson(t.error_log, []);
          errs.forEach((e: any) =>
            lines.push({
              at: t.created_at,
              level: "error",
              source: t.agent_id,
              text: typeof e === "string" ? e : JSON.stringify(e),
            })
          );
          if (t.status === "completed")
            lines.push({ at: t.completed_at || t.created_at, level: "info", source: t.agent_id, text: `task ${t.task_id} completed` });
          if (t.status === "failed" && errs.length === 0)
            lines.push({ at: t.created_at, level: "error", source: t.agent_id, text: `task ${t.task_id} failed` });
        });
        wh.forEach((w) => {
          if (w.error || (w.status_code && w.status_code >= 400))
            lines.push({ at: w.attempted_at, level: "warn", source: "webhooks", text: `delivery ${w.id} → ${w.channel} HTTP ${w.status_code}${w.error ? ` ${w.error}` : ""}` });
        });
        bus.forEach((b) =>
          lines.push({ at: b.created_at, level: "info", source: "bus", text: `#${b.channel} message ${b.id}` })
        );

        lines.sort((a, b) => +new Date(b.at) - +new Date(a.at));
        setLogs(lines.slice(0, 200));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const shown = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <>
      <PageHeader title="Logs" subtitle="Live console — errors, deliveries, bus traffic." />

      <div className="flex gap-2 mb-5">
        {(["all", "warn", "error"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              filter === f ? "bg-accentBg text-accentSoft" : "text-muted hover:text-fg"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {shown.length === 0 && !loading ? (
        <Empty title="No logs" hint="Console output appears once the runtime is running." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="bg-input px-5 py-3 border-b border-border font-mono text-xs text-muted flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-ok animate-pulse" /> tail -f
          </div>
          <div className="font-mono text-xs max-h-[60vh] overflow-y-auto">
            {shown.map((l, i) => (
              <div key={i} className="flex gap-3 px-5 py-1.5 hover:bg-cardHover">
                <span className="text-muted shrink-0">{new Date(l.at).toLocaleTimeString()}</span>
                <span className={`uppercase w-11 shrink-0 ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
                <span className="text-accentSoft shrink-0">{l.source}</span>
                <span className="text-fg/80 break-all">{l.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
