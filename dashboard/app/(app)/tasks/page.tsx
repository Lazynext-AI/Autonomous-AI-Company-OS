"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import Link from "next/link";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";

interface Task {
  task_id: string;
  agent_id: string;
  description: string;
  status: string;
  attempts: number;
  result?: string;
  error_log?: any[];
  created_at: string;
  completed_at?: string;
  performance_score?: number;
}

const FILTERS = ["all", "pending", "in_progress", "completed", "failed"];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>(
          "SELECT * FROM task_log ORDER BY created_at DESC LIMIT 200"
        );
        setTasks(rows.map((t) => ({ ...t, error_log: parseJson(t.error_log, []) })));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <>
      <PageHeader title="Tasks" subtitle="Everything the company is doing — queued, working, done.">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === f
                  ? "bg-accent text-white"
                  : "bg-card text-muted hover:text-fg border border-border"
              }`}
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>
      </PageHeader>

      {filtered.length === 0 && !loading ? (
        <Empty
        title={filter === "all" ? "No tasks yet" : `No ${filter.replace("_", " ")} tasks`}
        hint="Tasks appear when agents start working."
      />
      ) : (
        <Card className="p-0 overflow-hidden">
          {filtered.map((t) => (
            <Link
              key={t.task_id}
              href={`/tasks/${t.task_id}`}
              className="block px-5 py-4 border-b border-border last:border-0 hover:bg-cardHover transition"
            >
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg">{t.description}</div>
                  <div className="text-xs text-muted mt-1">
                    {t.agent_id.replace(/_/g, " ")} · {t.task_id} · {timeAgo(t.created_at)}
                    {t.attempts > 1 && ` · ${t.attempts} attempts`}
                  </div>
                </div>
                {t.performance_score != null && (
                  <span className="text-xs text-muted">{t.performance_score.toFixed(0)}</span>
                )}
                <StatusBadge status={t.status} />
              </div>
              {t.result && (
                <div className="mt-3 bg-input rounded-lg p-3 text-xs text-muted whitespace-pre-wrap line-clamp-5">
                  {t.result}
                </div>
              )}
              {Array.isArray(t.error_log) && t.error_log.length > 0 && (
                <div className="mt-3 bg-badBg rounded-lg p-3 text-xs text-bad">
                  {t.error_log.map((e: any, i: number) => (
                    <div key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</div>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
