"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { ArrowLeft, Settings2 } from "lucide-react";
import { toast } from "@/components/Toast";

export default function AgentDetailPage() {
  const { id } = useParams();
  const [agent, setAgent] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [cfg, setCfg] = useState({ model: "", interval: "300", prompt: "" });

  useEffect(() => {
    const load = async () => {
      try {
        const [a, t] = await Promise.all([
          queryApi<any>("SELECT * FROM agent_memories WHERE agent_id = ? LIMIT 1", [id]),
          queryApi<any>(
            "SELECT task_id, description, status, performance_score, created_at FROM task_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50",
            [id]
          ),
        ]);
        if (a[0]) {
          const mem = a[0];
          setAgent({
            ...mem,
            episodic_memory: parseJson(mem.episodic_memory, []),
            semantic_memory: parseJson(mem.semantic_memory, {}),
            skills: parseJson(mem.skills, []),
            patterns_learned: parseJson(mem.patterns_learned, []),
            reward_history: parseJson(mem.reward_history, []),
          });
        }
        setTasks(t);
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  if (loading) return <div className="text-muted text-sm py-20 text-center">Loading…</div>;
  if (!agent)
    return (
      <>
        <Link href="/agents" className="text-sm text-accentSoft flex items-center gap-1.5 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Agents
        </Link>
        <Empty title="Agent not found" hint={String(id)} />
      </>
    );

  const done = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const score = agent.performance_score ?? 0;
  const episodes = (agent.episodic_memory || []).slice(-10).reverse();

  return (
    <>
      <Link href="/agents" className="text-sm text-accentSoft flex items-center gap-1.5 mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Agents
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-fg capitalize">
            {(agent.role || agent.agent_id).replace(/_/g, " ")}
          </h1>
          <p className="text-sm text-muted mt-1">{agent.agent_id}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfigOpen(true)}
            className="inline-flex items-center gap-2 bg-card hover:bg-cardHover border border-border text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Settings2 className="w-4 h-4" /> Configure
          </button>
          <StatusBadge status={agent.status || "active"} />
        </div>
      </div>

      {configOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfigOpen(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-fg mb-1">Agent config</h2>
            <p className="text-xs text-muted mb-5">Saved to KV — agents read these on the next tick.</p>
            <label className="text-xs text-muted">Model override</label>
            <input
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              placeholder="auto (Workers AI default)"
              className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
            <label className="text-xs text-muted">Loop interval (seconds)</label>
            <input
              type="number"
              min={30}
              value={cfg.interval}
              onChange={(e) => setCfg({ ...cfg, interval: e.target.value })}
              className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
            <label className="text-xs text-muted">System prompt addition</label>
            <textarea
              value={cfg.prompt}
              onChange={(e) => setCfg({ ...cfg, prompt: e.target.value })}
              rows={3}
              placeholder="Extra instructions for this agent…"
              className="mt-1.5 mb-5 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent resize-none"
            />
            <div className="flex gap-2.5">
              <button
                onClick={async () => {
                  const r = await fetch("/api/kv", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      action: "put",
                      key: `agent_config:${agent.agent_id}`,
                      value: JSON.stringify({ model: cfg.model || "auto", interval: +cfg.interval || 300, prompt: cfg.prompt }),
                    }),
                  });
                  if (r.ok) { toast("Config saved"); setConfigOpen(false); }
                  else toast("Save failed");
                }}
                className="flex-1 bg-accent hover:bg-accentSoft text-white text-sm font-semibold py-2.5 rounded-lg transition"
              >
                Save
              </button>
              <button onClick={() => setConfigOpen(false)} className="px-4 py-2.5 bg-input text-muted hover:text-fg text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card><div className="text-xs text-muted">Score</div><div className="text-2xl font-bold mt-1">{score.toFixed(0)}</div></Card>
        <Card><div className="text-xs text-muted">Tasks</div><div className="text-2xl font-bold mt-1">{tasks.length}</div></Card>
        <Card><div className="text-xs text-muted">Done</div><div className="text-2xl font-bold mt-1 text-ok">{done}</div></Card>
        <Card><div className="text-xs text-muted">Failed</div><div className="text-2xl font-bold mt-1 text-bad">{failed}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <h2 className="text-sm font-semibold mb-4">Skills</h2>
          {agent.skills?.length ? (
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((s: string) => (
                <span key={s} className="px-3 py-1.5 bg-accentBg text-accentSoft rounded-lg text-xs font-medium">{s}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Skills accumulate as the agent works.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Memory</h2>
          {episodes.length ? (
            <div className="space-y-2.5">
              {episodes.map((e: any, i: number) => (
                <div key={i} className="text-xs text-fg/80 bg-input rounded-lg px-3 py-2">
                  {typeof e === "string" ? e : e.event || JSON.stringify(e)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Episodic memory builds over time.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Patterns learned</h2>
          {(agent.patterns_learned || []).length ? (
            <div className="space-y-2.5">
              {agent.patterns_learned.slice(-8).reverse().map((p: any, i: number) => (
                <div key={i} className="text-xs text-fg/80 bg-input rounded-lg px-3 py-2">
                  {typeof p === "string" ? p : p.pattern || JSON.stringify(p)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Strategies the agent discovers appear here.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Reward history</h2>
          {(agent.reward_history || []).length ? (
            <div className="space-y-2">
              {agent.reward_history.slice(-8).reverse().map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className={`font-mono font-bold ${r.reward >= 0 ? "text-ok" : "text-bad"}`}>
                    {r.reward >= 0 ? "+" : ""}{r.reward}
                  </span>
                  <span className="text-fg/80 flex-1 truncate">
                    {r.reason || r.task || "task outcome"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Scored outcomes accumulate as the agent works.</p>
          )}
        </Card>

        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-sm font-semibold">Recent tasks</div>
          {tasks.length === 0 ? (
            <div className="p-5 text-sm text-muted">No tasks assigned yet.</div>
          ) : (
            tasks.map((t) => (
              <Link key={t.task_id} href={`/tasks/${t.task_id}`}
                className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0 hover:bg-cardHover transition">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg truncate">{t.description}</div>
                  <div className="text-xs text-muted">{timeAgo(t.created_at)}</div>
                </div>
                {t.performance_score != null && (
                  <span className="text-xs text-muted">{t.performance_score.toFixed(0)}pts</span>
                )}
                <StatusBadge status={t.status} />
              </Link>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
