"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Activity, CheckCircle, Clock, AlertCircle, TrendingUp, Zap } from "lucide-react";

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
  const [brain, setBrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setLoading(false);
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const fetchAgents = async () => {
      try {
        const { data: agentsData } = await supabase
          .from("agent_memories")
          .select("*")
          .order("last_active", { ascending: false });

        if (agentsData) {
          setAgents(agentsData as AgentMemory[]);
        }

        const { data: brainData } = await supabase
          .from("company_brain")
          .select("agent_statuses")
          .limit(1)
          .single();

        if (brainData) {
          setBrain(brainData);
        }

        setLoading(false);
        setLastUpdate(new Date());
      } catch (error) {
        console.error("Error fetching agents:", error);
        setLoading(false);
      }
    };

    fetchAgents();

    // Real-time subscription
    const channel = supabase
      .channel("agent_updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_memories",
        },
        () => {
          fetchAgents();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_brain",
        },
        () => {
          fetchAgents();
        }
      )
      .subscribe();

    const pollInterval = setInterval(fetchAgents, 2000);

    return () => {
      channel.unsubscribe();
      clearInterval(pollInterval);
    };
  }, [supabaseUrl, supabaseKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-400 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading agents...</p>
        </div>
      </div>
    );
  }

  const agentStatuses = brain?.agent_statuses || {};

  const getAgentStatus = (agentId: string) => {
    return agentStatuses[agentId] || { status: "unknown", current_task: "", updated_at: "" };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-400/20 text-green-400 border-green-400/30";
      case "idle":
        return "bg-yellow-400/20 text-yellow-400 border-yellow-400/30";
      case "stopped":
        return "bg-red-400/20 text-red-400 border-red-400/30";
      default:
        return "bg-zinc-400/20 text-zinc-400 border-zinc-400/30";
    }
  };

  const getPerformanceColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Agent Status</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>Live • Updated: {lastUpdate.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <nav className="flex gap-4 mb-6 border-b border-zinc-800 pb-4">
          <Link href="/" className="text-zinc-400 hover:text-zinc-200 transition">
            Overview
          </Link>
          <Link href="/agents" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-2">
            Agents
          </Link>
          <Link href="/feed" className="text-zinc-400 hover:text-zinc-200 transition">
            Live Feed
          </Link>
          <Link href="/brain" className="text-zinc-400 hover:text-zinc-200 transition">
            Company Brain
          </Link>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => {
            const status = getAgentStatus(agent.agent_id);
            const completedCount = Array.isArray(agent.tasks_completed) ? agent.tasks_completed.length : 0;
            const failedCount = Array.isArray(agent.tasks_failed) ? agent.tasks_failed.length : 0;
            const successRate =
              completedCount + failedCount > 0
                ? ((completedCount / (completedCount + failedCount)) * 100).toFixed(1)
                : "0";

            return (
              <div
                key={agent.agent_id}
                className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 hover:border-zinc-700 transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold capitalize">
                      {agent.role || agent.agent_id}
                    </h3>
                    <p className="text-sm text-zinc-400 mt-1">{agent.agent_id}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                      status.status
                    )}`}
                  >
                    {status.status}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-sm">Performance</span>
                    <span className={`text-lg font-bold ${getPerformanceColor(agent.performance_score)}`}>
                      {agent.performance_score.toFixed(1)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-800/50 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-xs text-zinc-400">Completed</span>
                      </div>
                      <div className="text-xl font-bold">{completedCount}</div>
                    </div>
                    <div className="bg-zinc-800/50 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle className="w-4 h-4 text-red-400" />
                        <span className="text-xs text-zinc-400">Failed</span>
                      </div>
                      <div className="text-xl font-bold">{failedCount}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                    <span className="text-zinc-400 text-sm">Success Rate</span>
                    <span className="text-sm font-semibold">{successRate}%</span>
                  </div>

                  {status.current_task && (
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className="text-xs text-zinc-400">Current Task</span>
                      </div>
                      <p className="text-sm text-zinc-200 line-clamp-2">
                        {typeof status.current_task === "string"
                          ? status.current_task
                          : status.current_task.description || "Working..."}
                      </p>
                    </div>
                  )}

                  {agent.retry_count > 0 && (
                    <div className="text-xs text-yellow-400 mt-2">
                      Retries: {agent.retry_count}
                    </div>
                  )}

                  <div className="text-xs text-zinc-500 mt-3">
                    Last active: {new Date(agent.last_active).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}

          {agents.length === 0 && (
            <div className="col-span-full text-center py-12 text-zinc-400">
              No agents found. Start the agent system to see agent status.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
