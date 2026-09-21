"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";

interface BusMessage {
  id: number;
  channel: string;
  payload: string;
  created_at: string;
}

export default function FeedPage() {
  const [messages, setMessages] = useState<BusMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setMessages(
          await queryApi<BusMessage>(
            "SELECT * FROM bus_messages ORDER BY id DESC LIMIT 100"
          )
        );
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const channels = [...new Set(messages.map((m) => m.channel))];
  const shown = filter ? messages.filter((m) => m.channel === filter) : messages;

  return (
    <>
      <PageHeader title="Feed" subtitle="The message bus — every agent event, live." />

      {channels.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === null
                ? "bg-accent text-white"
                : "bg-card border border-border text-accentSoft hover:border-accent"
            }`}
          >
            all
          </button>
          {channels.slice(0, 12).map((ch) => (
            <button
              key={ch}
              onClick={() => setFilter(filter === ch ? null : ch)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === ch
                  ? "bg-accent text-white"
                  : "bg-card border border-border text-accentSoft hover:border-accent"
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && !loading ? (
        <Empty title="Bus is quiet" hint="Events stream here once agents are running." />
      ) : (
        <div className="space-y-2.5 max-w-4xl">
          {shown.map((m) => (
            <Card key={m.id} className="py-3.5 px-4">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted shrink-0 w-16">
                  {timeAgo(m.created_at)}
                </span>
                <span className="text-xs font-semibold text-accentSoft shrink-0">
                  {m.channel}
                </span>
                <span className="text-sm text-fg/80 truncate">{m.payload}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
