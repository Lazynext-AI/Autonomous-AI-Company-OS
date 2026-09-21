"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { DollarSign, Flag, FileText } from "lucide-react";

interface Briefing {
  id: number;
  kind: string;
  subject: string;
  content: string;
  created_at: string;
}

const ICONS: Record<string, JSX.Element> = {
  finance_report: <DollarSign className="w-4 h-4 text-ok" />,
  founder_brief: <Flag className="w-4 h-4 text-accentSoft" />,
};

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setBriefings(
          await queryApi<Briefing>("SELECT * FROM briefings ORDER BY id DESC LIMIT 50")
        );
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader title="Briefings" subtitle="Reports from your company — weekly founder briefs, finance, alerts." />

      {briefings.length === 0 && !loading ? (
        <Empty title="No briefings yet" hint="Weekly reports land here once the company is running." />
      ) : (
        <div className="space-y-4 max-w-3xl">
          {briefings.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-input flex items-center justify-center">
                  {ICONS[b.kind] || <FileText className="w-4 h-4 text-muted" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-zinc-50">{b.subject}</div>
                  <div className="text-xs text-muted capitalize">
                    {b.kind.replace(/_/g, " ")} · {timeAgo(b.created_at)}
                  </div>
                </div>
              </div>
              <div className="text-sm text-zinc-50/80 whitespace-pre-wrap leading-relaxed">
                {b.content}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
