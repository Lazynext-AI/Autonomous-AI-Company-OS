"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { Rocket, ExternalLink } from "lucide-react";

export default function DeploymentsPage() {
  const [deploys, setDeploys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>(
          "SELECT id, milestone_type, description, created_at FROM milestone_log WHERE milestone_type LIKE '%deploy%' OR milestone_type LIKE '%ship%' ORDER BY id DESC LIMIT 50"
        );
        setDeploys(rows.map((r) => ({ ...r, description: parseJson(r.description, r.description) })));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader title="Deployments" subtitle="Everything the company has shipped." />

      {deploys.length === 0 && !loading ? (
        <Empty
          title="No deployments yet"
          hint="DevOps agent ships products here once the runtime is running."
        />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {deploys.map((d) => {
            const desc = typeof d.description === "object" ? d.description : {};
            return (
              <Card key={d.id} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                  <Rocket className="w-4.5 h-4.5 text-accentSoft" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <div className="text-sm font-semibold text-zinc-50 capitalize">
                      {d.milestone_type.replace(/_/g, " ")}
                    </div>
                    <StatusBadge status="deployed" />
                  </div>
                  {desc.url && (
                    <a
                      href={desc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accentSoft flex items-center gap-1 mt-1 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" /> {desc.url}
                    </a>
                  )}
                  {desc.commit && (
                    <div className="text-xs text-muted font-mono mt-1">commit {String(desc.commit).slice(0, 8)}</div>
                  )}
                </div>
                <span className="text-xs text-muted shrink-0">{timeAgo(d.created_at)}</span>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
