"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import Link from "next/link";
import { Activity, Users, DollarSign, TrendingUp, AlertCircle, CheckCircle, Clock, Zap } from "lucide-react";

interface Task {
  task_id: string;
  agent_id: string;
  description: string;
  status: string;
  attempts: number;
  result?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  performance_score?: number;
}

interface AgentStatus {
  [key: string]: {
    status: string;
    current_task: string;
    updated_at: string;
  };
}

export default function DashboardPage() {
  const [brain, setBrain] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const brainRows = await queryApi<any>(
          "SELECT * FROM company_brain LIMIT 1"
        );
        const brainData = brainRows[0];
        if (brainData) {
          const parsed = {
            ...brainData,
            metrics: parseJson(brainData.metrics, {}),
            agent_statuses: parseJson(brainData.agent_statuses, {}),
            tech_stack: parseJson(brainData.tech_stack, {}),
            live_urls: parseJson(brainData.live_urls, {}),
            current_sprint: parseJson(brainData.current_sprint, {}),
            open_bugs: parseJson(brainData.open_bugs, []),
            shipped_features: parseJson(brainData.shipped_features, []),
            user_feedback: parseJson(brainData.user_feedback, []),
            blockers: parseJson(brainData.blockers, []),
          };
          setBrain(parsed);
          setAgentStatuses(parsed.agent_statuses);
        }

        const tasksData = await queryApi<Task>(
          "SELECT * FROM task_log ORDER BY created_at DESC LIMIT 50"
        );
        setTasks(tasksData);

        setLoading(false);
        setLastUpdate(new Date());
      } catch (error) {
        console.error("Error fetching data:", error);
        setLoading(false);
      }
    };

    fetchData();
    const pollInterval = setInterval(fetchData, 2000);
    return () => clearInterval(pollInterval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-400 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const metrics = brain?.metrics || {};
  const recentTasks = tasks.slice(0, 10);
  const activeAgents = Object.keys(agentStatuses).filter(
    (id) => agentStatuses[id]?.status === "active"
  ).length;
  const pendingTasks = tasks.filter((t) => t.status === "pending").length;
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress").length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-400 bg-green-400/10";
      case "in_progress":
        return "text-blue-400 bg-blue-400/10";
      case "failed":
        return "text-red-400 bg-red-400/10";
      case "pending":
        return "text-yellow-400 bg-yellow-400/10";
      default:
        return "text-zinc-400 bg-zinc-400/10";
    }
  };

  const getAgentDisplayName = (agentId: string) => {
    return agentId.replace(/_/g, " ").replace(/\d+/g, "").trim() || agentId;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Lazynext</h1>
              <p className="text-sm text-zinc-400 mt-1">
                {brain?.product_name || "No product defined"} • {brain?.mission || "No mission set"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span>Live</span>
              </div>
              <div className="text-xs text-zinc-500">
                Updated: {lastUpdate.toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Navigation */}
        <nav className="flex gap-4 mb-6 border-b border-zinc-800 pb-4">
          <Link href="/" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-2">
            Overview
          </Link>
          <Link href="/agents" className="text-zinc-400 hover:text-zinc-200 transition">
            Agents
          </Link>
          <Link href="/feed" className="text-zinc-400 hover:text-zinc-200 transition">
            Live Feed
          </Link>
          <Link href="/brain" className="text-zinc-400 hover:text-zinc-200 transition">
            Company Brain
          </Link>
          <Link href="/briefings" className="text-zinc-400 hover:text-zinc-200 transition">
            Briefings
          </Link>
        </nav>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            icon={<Users className="w-5 h-5" />}
            title="Users"
            value={metrics.users ?? 0}
            change={null}
          />
          <MetricCard
            icon={<DollarSign className="w-5 h-5" />}
            title="MRR"
            value={`$${metrics.mrr ?? 0}`}
            change={null}
          />
          <MetricCard
            icon={<TrendingUp className="w-5 h-5" />}
            title="Uptime"
            value={`${metrics.uptime_pct ?? 100}%`}
            change={null}
          />
          <MetricCard
            icon={<Zap className="w-5 h-5" />}
            title="Deploys"
            value={metrics.deploy_count ?? 0}
            change={null}
          />
        </div>

        {/* System Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Task Status */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Task Status
            </h2>
            <div className="space-y-3">
              <StatusRow label="Pending" value={pendingTasks} color="yellow" />
              <StatusRow label="In Progress" value={inProgressTasks} color="blue" />
              <StatusRow label="Completed" value={completedTasks} color="green" />
              <StatusRow label="Failed" value={failedTasks} color="red" />
            </div>
          </div>

          {/* Active Agents */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Active Agents
            </h2>
            <div className="text-3xl font-bold mb-2">{activeAgents}</div>
            <div className="text-sm text-zinc-400">
              {Object.keys(agentStatuses).length} total agents
            </div>
            <div className="mt-4 space-y-2 max-h-32 overflow-y-auto">
              {Object.entries(agentStatuses).slice(0, 5).map(([id, status]) => (
                <div key={id} className="text-xs">
                  <span className="text-zinc-300">{getAgentDisplayName(id)}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                    status.status === "active" ? "bg-green-400/20 text-green-400" : "bg-zinc-700 text-zinc-400"
                  }`}>
                    {status.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activity
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-zinc-300">{completedTasks} tasks completed</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-zinc-300">{failedTasks} tasks failed</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <span className="text-zinc-300">{inProgressTasks} tasks in progress</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="p-6 border-b border-zinc-800">
            <h2 className="text-lg font-semibold">Recent Tasks</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentTasks.length === 0 ? (
              <div className="p-6 text-center text-zinc-400">No tasks yet</div>
            ) : (
              recentTasks.map((task) => (
                <TaskRow key={task.task_id} task={task} getStatusColor={getStatusColor} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  change,
}: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  change: number | null;
}) {
  return (
    <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 hover:border-zinc-700 transition">
      <div className="flex items-center justify-between mb-2">
        <div className="text-zinc-400 text-sm">{title}</div>
        {icon}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {change !== null && (
        <div className={`text-xs mt-1 ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
          {change >= 0 ? "+" : ""}{change}%
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses = {
    yellow: "bg-yellow-400/20 text-yellow-400",
    blue: "bg-blue-400/20 text-blue-400",
    green: "bg-green-400/20 text-green-400",
    red: "bg-red-400/20 text-red-400",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-300 text-sm">{label}</span>
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${colorClasses[color as keyof typeof colorClasses]}`}>
        {value}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  getStatusColor,
}: {
  task: Task;
  getStatusColor: (status: string) => string;
}) {
  const timeAgo = task.created_at
    ? new Date(task.created_at).toLocaleTimeString()
    : "—";

  return (
    <div className="p-4 hover:bg-zinc-800/50 transition">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(task.status)}`}>
              {task.status}
            </span>
            <span className="text-xs text-zinc-500">{task.agent_id}</span>
            {task.performance_score && (
              <span className="text-xs text-zinc-400">
                Score: {task.performance_score.toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-200 line-clamp-2">{task.description}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
            <span>Created: {timeAgo}</span>
            {task.attempts > 0 && <span>Attempts: {task.attempts}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
