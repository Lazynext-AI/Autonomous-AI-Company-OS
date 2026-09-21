"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { queryApi, parseJson } from "@/lib/api";
import { Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { ArrowLeft, XCircle, RotateCcw } from "lucide-react";

interface Task {
  task_id: string;
  agent_id: string;
  description: string;
  status: string;
  attempts: number;
  result?: string;
  error_log?: any[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  performance_score?: number;
}

export default function TaskDetailPage() {
  const { id } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const act = async (sql: string, msg: string) => {
    setActing(true);
    const r = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql, params: [id] }),
    });
    toast(r.ok ? msg : "Action failed");
    setActing(false);
    if (r.ok) setTimeout(() => location.reload(), 600);
  };

  const cancel = () =>
    act(
      "UPDATE task_log SET status = 'failed', error_log = json_insert(COALESCE(error_log, '[]'), '$[#]', 'cancelled by founder') WHERE task_id = ? AND status IN ('pending', 'in_progress')",
      "Task cancelled"
    );
  const retry = () =>
    act(
      "UPDATE task_log SET status = 'pending', attempts = 0, result = NULL WHERE task_id = ? AND status = 'failed'",
      "Task re-queued"
    );

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>(
          "SELECT * FROM task_log WHERE task_id = ? LIMIT 1",
          [id]
        );
        if (rows[0]) setTask({ ...rows[0], error_log: parseJson(rows[0].error_log, []) });
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  if (loading) return <div className="text-muted text-sm py-20 text-center">Loading…</div>;
  if (!task)
    return (
      <>
        <Link href="/tasks" className="text-sm text-accentSoft flex items-center gap-1.5 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Tasks
        </Link>
        <Empty title="Task not found" hint={String(id)} />
      </>
    );

  const meta: [string, string][] = [
    ["Agent", task.agent_id.replace(/_/g, " ")],
    ["Task ID", task.task_id],
    ["Status", task.status.replace(/_/g, " ")],
    ["Attempts", String(task.attempts)],
    ["Created", timeAgo(task.created_at)],
    ["Started", task.started_at ? timeAgo(task.started_at) : "—"],
    ["Completed", task.completed_at ? timeAgo(task.completed_at) : "—"],
    ["Score", task.performance_score != null ? task.performance_score.toFixed(0) : "—"],
  ];

  return (
    <>
      <Link href="/tasks" className="text-sm text-accentSoft flex items-center gap-1.5 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Tasks
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-fg max-w-2xl">{task.description}</h1>
          <p className="text-sm text-muted mt-1">{task.agent_id.replace(/_/g, " ")}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {(task.status === "pending" || task.status === "in_progress") && (
            <button
              onClick={cancel}
              disabled={acting}
              className="inline-flex items-center gap-1.5 bg-card hover:bg-cardHover border border-border text-bad text-xs font-semibold px-3.5 py-2 rounded-lg transition"
            >
              <XCircle className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          {task.status === "failed" && (
            <button
              onClick={retry}
              disabled={acting}
              className="inline-flex items-center gap-1.5 bg-accent hover:bg-accentSoft text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
          )}
          <StatusBadge status={task.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Result</h2>
          {task.result ? (
            <pre className="bg-input rounded-lg p-4 text-xs text-fg/80 whitespace-pre-wrap overflow-x-auto">
              {task.result}
            </pre>
          ) : (
            <p className="text-sm text-muted">No result yet.</p>
          )}
          {Array.isArray(task.error_log) && task.error_log.length > 0 && (
            <>
              <h2 className="text-sm font-semibold mt-5 mb-3 text-bad">Errors</h2>
              <pre className="bg-badBg rounded-lg p-4 text-xs text-bad whitespace-pre-wrap">
                {task.error_log.map((e: any) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n")}
              </pre>
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Details</h2>
          <div className="space-y-3">
            {meta.map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted">{k}</span>
                <span className="text-fg text-right">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
