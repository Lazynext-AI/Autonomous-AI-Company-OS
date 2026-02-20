"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Activity, CheckCircle, XCircle, Clock, AlertCircle, Zap, Code, GitBranch } from "lucide-react";

interface Task {
  task_id: string;
  agent_id: string;
  description: string;
  status: string;
  result?: string;
  error_log?: any[];
  created_at: string;
  completed_at?: string;
  performance_score?: number;
}

export default function FeedPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) {
      setLoading(false);
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const fetchTasks = async () => {
      try {
        const { data: tasksData } = await supabase
          .from("task_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);

        if (tasksData) {
          setTasks(tasksData as Task[]);
        }

        setLoading(false);
        setLastUpdate(new Date());
      } catch (error) {
        console.error("Error fetching tasks:", error);
        setLoading(false);
      }
    };

    fetchTasks();

    // Real-time subscription
    const channel = supabase
      .channel("task_feed")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_log",
        },
        async () => {
          const { data: tasksData } = await supabase
            .from("task_log")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);

          if (tasksData) {
            setTasks(tasksData as Task[]);
            setLastUpdate(new Date());
          }
        }
      )
      .subscribe();

    const pollInterval = setInterval(fetchTasks, 1000);

    return () => {
      channel.unsubscribe();
      clearInterval(pollInterval);
    };
  }, [supabaseUrl, supabaseKey]);

  // Auto-scroll to top on new tasks
  useEffect(() => {
    if (scrollRef.current && tasks.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [tasks.length]);

  const filteredTasks = tasks.filter((task) => {
    if (filter === "all") return true;
    return task.status === filter;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-400" />;
      case "in_progress":
        return <Clock className="w-5 h-5 text-blue-400" />;
      case "pending":
        return <AlertCircle className="w-5 h-5 text-yellow-400" />;
      default:
        return <Activity className="w-5 h-5 text-zinc-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-400/10 text-green-400 border-green-400/20";
      case "failed":
        return "bg-red-400/10 text-red-400 border-red-400/20";
      case "in_progress":
        return "bg-blue-400/10 text-blue-400 border-blue-400/20";
      case "pending":
        return "bg-yellow-400/10 text-yellow-400 border-yellow-400/20";
      default:
        return "bg-zinc-400/10 text-zinc-400 border-zinc-400/20";
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-400 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading feed...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Live Task Feed</h1>
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
          <Link href="/agents" className="text-zinc-400 hover:text-zinc-200 transition">
            Agents
          </Link>
          <Link href="/feed" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-2">
            Live Feed
          </Link>
          <Link href="/brain" className="text-zinc-400 hover:text-zinc-200 transition">
            Company Brain
          </Link>
        </nav>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {["all", "pending", "in_progress", "completed", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === f
                  ? "bg-blue-400/20 text-blue-400 border border-blue-400/30"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1).replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Feed */}
        <div
          ref={scrollRef}
          className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto"
        >
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No tasks found with filter "{filter}"
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.task_id}
                className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 hover:border-zinc-700 transition"
              >
                <div className="flex items-start gap-4">
                  <div className="mt-1">{getStatusIcon(task.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                          task.status
                        )}`}
                      >
                        {task.status}
                      </span>
                      <span className="text-sm text-zinc-400">{task.agent_id}</span>
                      {task.performance_score && (
                        <span className="text-xs text-zinc-500">
                          Score: {task.performance_score.toFixed(1)}
                        </span>
                      )}
                      <span className="text-xs text-zinc-600 ml-auto">
                        {formatTime(task.created_at)}
                      </span>
                    </div>
                    <p className="text-zinc-200 mb-3">{task.description}</p>
                    {task.result && (
                      <div className="bg-zinc-800/50 rounded p-3 mt-3">
                        <div className="text-xs text-zinc-400 mb-1">Result:</div>
                        <div className="text-sm text-zinc-300 whitespace-pre-wrap line-clamp-5">
                          {task.result}
                        </div>
                      </div>
                    )}
                    {task.error_log && Array.isArray(task.error_log) && task.error_log.length > 0 && (
                      <div className="bg-red-400/10 border border-red-400/20 rounded p-3 mt-3">
                        <div className="text-xs text-red-400 mb-1">Errors:</div>
                        <div className="text-sm text-red-300">
                          {task.error_log.map((err: any, idx: number) => (
                            <div key={idx} className="mb-1">
                              {typeof err === "string" ? err : JSON.stringify(err)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {task.completed_at && (
                      <div className="text-xs text-zinc-500 mt-2">
                        Completed: {formatTime(task.completed_at)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
