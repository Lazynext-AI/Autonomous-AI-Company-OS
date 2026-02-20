"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Brain, Code, AlertTriangle, CheckCircle, TrendingUp, Package } from "lucide-react";

export default function BrainPage() {
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

    const fetchBrain = async () => {
      try {
        const { data } = await supabase
          .from("company_brain")
          .select("*")
          .limit(1)
          .single();

        if (data) {
          setBrain(data);
        }

        setLoading(false);
        setLastUpdate(new Date());
      } catch (error) {
        console.error("Error fetching brain:", error);
        setLoading(false);
      }
    };

    fetchBrain();

    // Real-time subscription
    const channel = supabase
      .channel("brain_updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_brain",
        },
        (payload) => {
          if (payload.new) {
            setBrain(payload.new);
            setLastUpdate(new Date());
          }
        }
      )
      .subscribe();

    const pollInterval = setInterval(fetchBrain, 2000);

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
          <p className="text-zinc-400">Loading company brain...</p>
        </div>
      </div>
    );
  }

  const metrics = brain?.metrics || {};
  const techStack = brain?.tech_stack || {};
  const shippedFeatures = Array.isArray(brain?.shipped_features) ? brain.shipped_features : [];
  const openBugs = Array.isArray(brain?.open_bugs) ? brain.open_bugs : [];
  const blockers = Array.isArray(brain?.blockers) ? brain.blockers : [];
  const userFeedback = Array.isArray(brain?.user_feedback) ? brain.user_feedback : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-6 h-6" />
              Company Brain
            </h1>
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
          <Link href="/feed" className="text-zinc-400 hover:text-zinc-200 transition">
            Live Feed
          </Link>
          <Link href="/brain" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-2">
            Company Brain
          </Link>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Product Info */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4">Product Information</h2>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-zinc-400 mb-1">Product Name</div>
                <div className="text-lg font-semibold">{brain?.product_name || "—"}</div>
              </div>
              <div>
                <div className="text-sm text-zinc-400 mb-1">Mission</div>
                <div className="text-zinc-200">{brain?.mission || "—"}</div>
              </div>
              <div>
                <div className="text-sm text-zinc-400 mb-1">Description</div>
                <div className="text-zinc-200">{brain?.product_description || "—"}</div>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Metrics
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <MetricItem label="Users" value={metrics.users ?? 0} />
              <MetricItem label="Revenue" value={`$${metrics.revenue ?? 0}`} />
              <MetricItem label="MRR" value={`$${metrics.mrr ?? 0}`} />
              <MetricItem label="Uptime" value={`${metrics.uptime_pct ?? 100}%`} />
              <MetricItem label="Error Rate" value={`${metrics.error_rate ?? 0}%`} />
              <MetricItem label="Deploys" value={metrics.deploy_count ?? 0} />
            </div>
          </div>

          {/* Tech Stack */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Code className="w-5 h-5" />
              Tech Stack
            </h2>
            {Object.keys(techStack).length === 0 ? (
              <p className="text-zinc-400 text-sm">No tech stack defined</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(techStack).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-zinc-400 capitalize">{key}:</span>
                    <span className="text-zinc-200">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shipped Features */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              Shipped Features ({shippedFeatures.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {shippedFeatures.length === 0 ? (
                <p className="text-zinc-400 text-sm">No features shipped yet</p>
              ) : (
                shippedFeatures.map((feature: any, idx: number) => (
                  <div key={idx} className="bg-zinc-800/50 rounded p-2 text-sm">
                    {typeof feature === "string" ? feature : feature.description || JSON.stringify(feature)}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Open Bugs */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Open Bugs ({openBugs.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {openBugs.length === 0 ? (
                <p className="text-zinc-400 text-sm">No open bugs</p>
              ) : (
                openBugs.map((bug: any, idx: number) => (
                  <div key={idx} className="bg-red-400/10 border border-red-400/20 rounded p-2 text-sm">
                    <div className="font-semibold text-red-400 mb-1">
                      {bug.severity || "UNKNOWN"}: {bug.component || "Unknown"}
                    </div>
                    <div className="text-zinc-300">
                      {typeof bug === "string" ? bug : bug.description || JSON.stringify(bug)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Blockers */}
          <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Blockers ({blockers.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {blockers.length === 0 ? (
                <p className="text-zinc-400 text-sm">No blockers</p>
              ) : (
                blockers.map((blocker: any, idx: number) => (
                  <div key={idx} className="bg-yellow-400/10 border border-yellow-400/20 rounded p-2 text-sm">
                    {typeof blocker === "string" ? blocker : blocker.description || JSON.stringify(blocker)}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
