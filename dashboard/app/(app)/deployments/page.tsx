"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { Rocket, ExternalLink } from "lucide-react";

export default function DeploymentsPage() {
  const [deploys, setDeploys] = useState<any[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>(
          "SELECT id, milestone_type, description, achieved_at AS created_at FROM milestone_log WHERE milestone_type LIKE '%deploy%' OR milestone_type LIKE '%ship%' ORDER BY achieved_at DESC LIMIT 50"
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
              <Card
                key={d.id}
                className="cursor-pointer"
                onClick={() => setOpen((o) => (o === d.id ? null : d.id))}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                    <Rocket className="w-4.5 h-4.5 text-accentSoft" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <div className="text-sm font-semibold text-fg capitalize">
                        {d.milestone_type.replace(/_/g, " ")}
                      </div>
                      <StatusBadge status="deployed" />
                    </div>
                    {desc.url && (
                      <a
                        href={desc.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
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
                </div>
                {open === d.id && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <div><div className="text-xs text-muted">Milestone</div><div className="text-xs text-fg mt-0.5">{d.milestone_type}</div></div>
                      <div><div className="text-xs text-muted">Deployed</div><div className="text-xs text-fg mt-0.5">{d.created_at ? new Date(d.created_at).toLocaleString() : "—"}</div></div>
                      {desc.url && <div><div className="text-xs text-muted">URL</div><div className="text-xs text-accentSoft mt-0.5 truncate">{desc.url}</div></div>}
                      {desc.commit && <div><div className="text-xs text-muted">Commit</div><div className="text-xs text-fg font-mono mt-0.5">{desc.commit}</div></div>}
                    </div>
                    <pre className="bg-input rounded-lg p-3 text-xs text-fg/70 whitespace-pre-wrap font-mono max-h-48 overflow-auto">
                      {JSON.stringify(desc, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
