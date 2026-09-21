"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface AgentMemory {
  agent_id: string;
  role: string;
  performance_score: number;
  current_task: any;
  tasks_completed: any[];
  tasks_failed: any[];
  retry_count: number;
  last_active: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentMemory[]>([]);
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>(
          "SELECT * FROM agent_memories ORDER BY last_active DESC"
        );
        setAgents(
          rows.map((a) => ({
            ...a,
            current_task: parseJson(a.current_task, null),
            tasks_completed: parseJson(a.tasks_completed, []),
            tasks_failed: parseJson(a.tasks_failed, []),
          }))
        );
        const brain = await queryApi<any>(
          "SELECT agent_statuses FROM company_brain LIMIT 1"
        );
        setStatuses(parseJson(brain[0]?.agent_statuses, {}));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader title="Agents" subtitle="Your crew — status, scores, current work." />

      {agents.length === 0 && !loading ? (
        <Empty
          title="No agents yet"
          hint="Run make dev locally — agents register on first boot."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {agents.map((a) => {
            const s = statuses[a.agent_id] || {};
            const done = Array.isArray(a.tasks_completed) ? a.tasks_completed.length : 0;
            const failed = Array.isArray(a.tasks_failed) ? a.tasks_failed.length : 0;
            const rate = done + failed > 0 ? Math.round((done / (done + failed)) * 100) : 0;
            return (
              <Card key={a.agent_id} className="hover:border-accentDim transition">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-[10px] bg-accentDim flex items-center justify-center text-accentSoft font-bold text-sm">
                      {(a.role || a.agent_id)[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-zinc-50 capitalize">
                        {(a.role || a.agent_id).replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted">{a.agent_id}</div>
                    </div>
                  </div>
                  <StatusBadge status={s.status || "idle"} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-4">
                  <div className="bg-input rounded-lg py-2.5">
                    <div className="text-lg font-bold text-ok">{done}</div>
                    <div className="text-[10px] text-muted">done</div>
                  </div>
                  <div className="bg-input rounded-lg py-2.5">
                    <div className="text-lg font-bold text-bad">{failed}</div>
                    <div className="text-[10px] text-muted">failed</div>
                  </div>
                  <div className="bg-input rounded-lg py-2.5">
                    <div className="text-lg font-bold text-accentSoft">{rate}%</div>
                    <div className="text-[10px] text-muted">success</div>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted pt-3 border-t border-border">
                  <span>score {a.performance_score?.toFixed(0) ?? "—"}</span>
                  <span>{timeAgo(a.last_active)}</span>
                </div>
                {s.current_task && (
                  <div className="mt-3 bg-accentBg rounded-lg p-2.5 text-xs text-accentSoft truncate">
                    → {typeof s.current_task === "string" ? s.current_task : s.current_task.description || "Working…"}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
