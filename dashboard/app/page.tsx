"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatCard, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { CheckCircle2, Clock, AlertCircle, Zap } from "lucide-react";

interface Task {
  task_id: string;
  agent_id: string;
  description: string;
  status: string;
  created_at: string;
  completed_at?: string;
}

export default function DashboardPage() {
  const [brain, setBrain] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const brainRows = await queryApi<any>(
          "SELECT * FROM company_brain LIMIT 1"
        );
        const b = brainRows[0];
        if (b) {
          setBrain({
            ...b,
            metrics: parseJson(b.metrics, {}),
            agent_statuses: parseJson(b.agent_statuses, {}),
          });
        }
        setTasks(
          await queryApi<Task>(
            "SELECT * FROM task_log ORDER BY created_at DESC LIMIT 50"
          )
        );
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, []);

  const metrics = brain?.metrics || {};
  const agentStatuses = brain?.agent_statuses || {};
  const agentList = Object.entries(agentStatuses) as [string, any][];
  const counts = {
    pending: tasks.filter((t) => t.status === "pending").length,
    working: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={brain?.product_name || "Your autonomous company"}
      >
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
          Live
        </div>
      </PageHeader>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Tasks done" value={counts.done} />
        <StatCard label="Working now" value={counts.working} />
        <StatCard label="Active agents" value={agentList.filter(([, s]) => s?.status === "active").length} />
        <StatCard label="Uptime" value={`${metrics.uptime_pct ?? 100}%`} />
      </div>

      <div className="grid grid-cols-3 gap-5 mb-6">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-50 mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-accentSoft" /> Task pipeline
          </h2>
          {[
            ["Queued", counts.pending, "text-warn"],
            ["Working", counts.working, "text-accentSoft"],
            ["Done", counts.done, "text-ok"],
            ["Failed", counts.failed, "text-bad"],
          ].map(([l, v, c]) => (
            <div key={l} className="flex justify-between py-2 text-sm">
              <span className="text-muted">{l}</span>
              <span className={`font-semibold ${c}`}>{v}</span>
            </div>
          ))}
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-zinc-50 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-accentSoft" /> Agents
          </h2>
          {agentList.length === 0 ? (
            <p className="text-sm text-muted">Agents appear once the runtime starts.</p>
          ) : (
            agentList.slice(0, 6).map(([id, s]) => (
              <div key={id} className="flex justify-between py-1.5 text-sm">
                <span className="text-zinc-50">{id.replace(/_/g, " ")}</span>
                <StatusBadge status={s?.status || "idle"} />
              </div>
            ))
          )}
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-zinc-50 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accentSoft" /> Company
          </h2>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-muted text-xs">Mission</div>
              <div className="text-zinc-50 mt-0.5">{brain?.mission || "—"}</div>
            </div>
            <div>
              <div className="text-muted text-xs">Deploys</div>
              <div className="text-zinc-50 mt-0.5">{metrics.deploy_count ?? 0}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border text-sm font-semibold">
          Recent tasks
        </div>
        {tasks.length === 0 && !loading ? (
          <div className="p-5">
            <Empty title="No tasks yet" hint="Fund Atlas and run make dev — the company starts." />
          </div>
        ) : (
          tasks.slice(0, 10).map((t) => (
            <div
              key={t.task_id}
              className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-0 hover:bg-cardHover transition"
            >
              {t.status === "completed" ? (
                <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
              ) : t.status === "failed" ? (
                <AlertCircle className="w-4 h-4 text-bad shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-warn shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-50 truncate">{t.description}</div>
                <div className="text-xs text-muted mt-0.5">
                  {t.agent_id.replace(/_/g, " ")} · {timeAgo(t.created_at)}
                </div>
              </div>
              <StatusBadge status={t.status} />
            </div>
          ))
        )}
      </Card>
    </>
  );
}
