"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import Link from "next/link";
import { FileText, DollarSign, Flag } from "lucide-react";

interface Briefing {
  id: number;
  kind: string;
  subject: string;
  content: string;
  created_at: string;
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    const fetchBriefings = async () => {
      try {
        const rows = await queryApi<Briefing>(
          "SELECT * FROM briefings ORDER BY id DESC LIMIT 50"
        );
        setBriefings(rows);
        setLoading(false);
        setLastUpdate(new Date());
      } catch (error) {
        console.error("Error fetching briefings:", error);
        setLoading(false);
      }
    };

    fetchBriefings();
    const pollInterval = setInterval(fetchBriefings, 5000);
    return () => clearInterval(pollInterval);
  }, []);

  const getKindIcon = (kind: string) => {
    switch (kind) {
      case "finance_report":
        return <DollarSign className="w-5 h-5 text-green-400" />;
      case "founder_brief":
        return <Flag className="w-5 h-5 text-blue-400" />;
      default:
        return <FileText className="w-5 h-5 text-zinc-400" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-400 mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading briefings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Founder Briefings</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>Live • Updated: {lastUpdate.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
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
          <Link href="/brain" className="text-zinc-400 hover:text-zinc-200 transition">
            Company Brain
          </Link>
          <Link href="/briefings" className="text-blue-400 font-semibold border-b-2 border-blue-400 pb-2">
            Briefings
          </Link>
        </nav>

        <div className="space-y-4">
          {briefings.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              No briefings yet. Weekly reports appear here after the first milestone is achieved.
            </div>
          ) : (
            briefings.map((briefing) => (
              <div
                key={briefing.id}
                className="bg-zinc-900 rounded-lg p-6 border border-zinc-800"
              >
                <div className="flex items-center gap-3 mb-3">
                  {getKindIcon(briefing.kind)}
                  <h3 className="text-lg font-semibold">{briefing.subject}</h3>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {formatTime(briefing.created_at)}
                  </span>
                </div>
                <div className="text-sm text-zinc-300 whitespace-pre-wrap">
                  {briefing.content}
                </div>
                <div className="text-xs text-zinc-600 mt-3 capitalize">
                  {briefing.kind.replace(/_/g, " ")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
