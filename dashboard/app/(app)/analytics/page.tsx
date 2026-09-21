"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty } from "@/components/ui";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Task {
  status: string;
  created_at: string;
  performance_score?: number;
}

const C = { ok: "#22C55E", warn: "#F59E0B", bad: "#EF4444", accent: "#8B5CF6", accentSoft: "#A78BFA" };

export default function AnalyticsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setTasks(await queryApi<Task>("SELECT status, created_at, performance_score FROM task_log ORDER BY created_at ASC"));
        setLoading(false);
      } catch { setLoading(false); }
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // tasks per day
  const byDay = tasks.reduce<Record<string, number>>((acc, t) => {
    const d = (t.created_at || "").slice(0, 10);
    if (d) acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
  const tasksPerDay = Object.entries(byDay).slice(-14).map(([day, count]) => ({ day: day.slice(5), count }));

  // status distribution
  const byStatus = ["completed", "in_progress", "pending", "failed"].map((s) => ({
    name: s.replace("_", " "),
    value: tasks.filter((t) => t.status === s).length,
  })).filter((s) => s.value > 0);
  const pieColors = [C.ok, C.accentSoft, C.warn, C.bad];

  // performance trend
  const scored = tasks.filter((t) => t.performance_score != null);
  const perf = scored.slice(-30).map((t, i) => ({ i, score: Math.round(t.performance_score!) }));

  const tipStyle = { background: "#141419", border: "1px solid #26262E", borderRadius: 8, fontSize: 12 };

  return (
    <>
      <PageHeader title="Analytics" subtitle="How the company is actually performing." />

      {tasks.length === 0 && !loading ? (
        <Empty title="No data yet" hint="Charts appear once agents complete tasks." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <h2 className="text-sm font-semibold mb-4">Tasks per day</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={tasksPerDay}>
                <XAxis dataKey="day" tick={{ fill: "#9C9CAA", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#9C9CAA", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tipStyle} cursor={{ fill: "#1A1A21" }} />
                <Bar dataKey="count" fill={C.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold mb-4">Status split</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" innerRadius={55} outerRadius={80} strokeWidth={0}>
                  {byStatus.map((_, i) => <Cell key={i} fill={pieColors[i % 4]} />)}
                </Pie>
                <Tooltip contentStyle={tipStyle} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#9C9CAA" }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="text-sm font-semibold mb-4">Task score trend</h2>
            {perf.length === 0 ? (
              <p className="text-sm text-muted">Scored tasks appear as agents finish work.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={perf}>
                  <XAxis dataKey="i" tick={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9C9CAA", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} />
                  <Line type="monotone" dataKey="score" stroke={C.accentSoft} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
