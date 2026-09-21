"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, timeAgo } from "@/components/ui";
import { Search as SearchIcon, ListTodo, Users, BookOpen } from "lucide-react";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [t, a, k] = await Promise.all([
          queryApi<any>("SELECT task_id, description, status, agent_id, created_at FROM task_log ORDER BY created_at DESC LIMIT 200"),
          queryApi<any>("SELECT agent_id, role, performance_score, last_active FROM agent_memories"),
          queryApi<any>("SELECT id, filename, category, content, ingested_at FROM knowledge_chunks"),
        ]);
        setTasks(t); setAgents(a); setDocs(k);
      } catch {}
    };
    load();
  }, []);

  const needle = q.toLowerCase().trim();
  const hits = needle
    ? {
        tasks: tasks.filter((t) => (t.description + t.agent_id + t.task_id).toLowerCase().includes(needle)).slice(0, 10),
        agents: agents.filter((a) => (a.agent_id + a.role).toLowerCase().includes(needle)).slice(0, 10),
        docs: docs.filter((d) => (d.filename + d.category + d.content).toLowerCase().includes(needle)).slice(0, 10),
      }
    : { tasks: [], agents: [], docs: [] };
  const total = hits.tasks.length + hits.agents.length + hits.docs.length;

  return (
    <>
      <PageHeader title="Search" subtitle="Across tasks, agents and knowledge." />

      <div className="relative max-w-2xl mb-8">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks, agents, docs…"
          className="w-full bg-card border border-border rounded-[14px] pl-11 pr-4 py-3.5 text-sm text-fg outline-none focus:border-accent transition"
        />
      </div>

      {needle && (
        <p className="text-xs text-muted mb-5">{total} result{total === 1 ? "" : "s"} for “{q}”</p>
      )}

      {needle && total === 0 ? (
        <Card className="max-w-2xl text-center py-10 text-sm text-muted">Nothing matches.</Card>
      ) : (
        <div className="space-y-6 max-w-2xl">
          {hits.tasks.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                <ListTodo className="w-3.5 h-3.5" /> Tasks
              </h2>
              <Card className="p-0 overflow-hidden">
                {hits.tasks.map((t) => (
                  <Link key={t.task_id} href={`/tasks/${t.task_id}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-cardHover transition">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg truncate">{t.description}</div>
                      <div className="text-xs text-muted">{t.agent_id} · {timeAgo(t.created_at)}</div>
                    </div>
                    <StatusBadge status={t.status} />
                  </Link>
                ))}
              </Card>
            </section>
          )}
          {hits.agents.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Agents
              </h2>
              <Card className="p-0 overflow-hidden">
                {hits.agents.map((a) => (
                  <Link key={a.agent_id} href="/agents"
                    className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-cardHover transition">
                    <div className="w-7 h-7 rounded-lg bg-accentBg flex items-center justify-center text-xs font-bold text-accentSoft">
                      {(a.role || a.agent_id)[0].toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-fg capitalize">{(a.role || a.agent_id).replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted">{a.agent_id}</div>
                    </div>
                    <span className="text-xs text-muted">score {a.performance_score?.toFixed(0)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          )}
          {hits.docs.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5" /> Knowledge
              </h2>
              <Card className="p-0 overflow-hidden">
                {hits.docs.map((d) => (
                  <Link key={d.id} href="/knowledge"
                    className="block px-4 py-3 border-b border-border last:border-0 hover:bg-cardHover transition">
                    <div className="text-sm text-fg">{d.filename}</div>
                    <div className="text-xs text-muted line-clamp-1">{d.content}</div>
                  </Link>
                ))}
              </Card>
            </section>
          )}
        </div>
      )}
    </>
  );
}
