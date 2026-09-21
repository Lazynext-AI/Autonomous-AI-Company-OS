"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Bell, AlertTriangle, FileText, Zap } from "lucide-react";

interface Item {
  id: string;
  kind: "briefing" | "alert" | "event";
  title: string;
  body: string;
  at: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const briefings = await queryApi<any>(
          "SELECT id, kind, subject, content, created_at FROM briefings ORDER BY id DESC LIMIT 20"
        );
        const events = await queryApi<any>(
          "SELECT id, channel, payload, created_at FROM bus_messages ORDER BY id DESC LIMIT 40"
        );
        const all: Item[] = [
          ...briefings.map((b) => ({
            id: `b-${b.id}`,
            kind: "briefing" as const,
            title: b.subject,
            body: b.content,
            at: b.created_at,
          })),
          ...events
            .filter((e) => /alert|fail|deploy|milestone|error/i.test(e.channel + e.payload))
            .map((e) => ({
              id: `e-${e.id}`,
              kind: /alert|error|fail/i.test(e.channel + e.payload) ? ("alert" as const) : ("event" as const),
              title: e.channel,
              body: e.payload,
              at: e.created_at,
            })),
        ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
        setItems(all.slice(0, 50));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const icon = (k: Item["kind"]) =>
    k === "alert" ? (
      <AlertTriangle className="w-4 h-4 text-bad" />
    ) : k === "briefing" ? (
      <FileText className="w-4 h-4 text-accentSoft" />
    ) : (
      <Zap className="w-4 h-4 text-muted" />
    );

  return (
    <>
      <PageHeader title="Notifications" subtitle="Everything worth your attention — alerts, briefings, milestones." />

      {items.length === 0 && !loading ? (
        <Empty title="All caught up" hint="Alerts and briefings land here." />
      ) : (
        <div className="space-y-2.5 max-w-3xl">
          {items.map((n) => (
            <Card key={n.id} className="py-3.5 px-4 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-input flex items-center justify-center shrink-0 mt-0.5">
                {icon(n.kind)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-zinc-50 truncate">{n.title}</div>
                  <span className="text-xs text-muted shrink-0 ml-auto">{timeAgo(n.at)}</span>
                </div>
                <div className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
