"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Crown, Bot } from "lucide-react";

interface Agent {
  agent_id: string;
  role: string;
  performance_score: number;
  current_task?: string;
  last_active: string;
}

export default function TeamPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queryApi<Agent>("SELECT * FROM agent_memories ORDER BY performance_score DESC")
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader title="Team" subtitle="Your company: 1 founder + an autonomous agent crew." />

      <div className="max-w-4xl space-y-5">
        {/* the human */}
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-[12px] bg-accentBg flex items-center justify-center">
            <Crown className="w-6 h-6 text-accentSoft" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-fg">You</div>
            <div className="text-xs text-muted">Founder · owner · final approval on sensitive actions</div>
          </div>
          <span className="text-xs font-semibold text-ok">online</span>
        </Card>

        {/* the agents */}
        <div>
          <h2 className="text-sm font-semibold text-fg mb-3">Agent crew ({agents.length})</h2>
          {agents.length === 0 && !loading ? (
            <Empty title="No agents yet" hint="The crew registers when the runtime starts." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {agents.map((a) => (
                <Card key={a.agent_id} className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-[10px] bg-input flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-accentSoft" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-fg capitalize">
                      {a.agent_id.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-muted capitalize">{a.role}</div>
                    {a.current_task && (
                      <div className="text-xs text-muted mt-1 truncate">{a.current_task}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-fg">{a.performance_score}</div>
                    <div className="text-[10px] text-muted">score</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card>
          <h2 className="text-sm font-semibold mb-2">Human roles</h2>
          <p className="text-xs text-muted">
            This is a single-owner product — the company is one human plus the agent crew. Seats,
            SSO and org roles appear if the platform ever goes multi-tenant.
          </p>
        </Card>
      </div>
    </>
  );
}
