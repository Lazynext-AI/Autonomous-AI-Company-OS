"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty } from "@/components/ui";

export default function BrainPage() {
  const [brain, setBrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>("SELECT * FROM company_brain LIMIT 1");
        const d = rows[0];
        if (d) {
          setBrain({
            ...d,
            metrics: parseJson(d.metrics, {}),
            tech_stack: parseJson(d.tech_stack, {}),
            live_urls: parseJson(d.live_urls, {}),
            current_sprint: parseJson(d.current_sprint, {}),
            open_bugs: parseJson(d.open_bugs, []),
            shipped_features: parseJson(d.shipped_features, []),
            blockers: parseJson(d.blockers, []),
          });
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const metrics = brain?.metrics || {};
  const techStack = brain?.tech_stack || {};
  const shipped = brain?.shipped_features || [];
  const bugs = brain?.open_bugs || [];
  const blockers = brain?.blockers || [];

  return (
    <>
      <PageHeader title="Brain" subtitle="The company's memory — mission, stack, shipped, blockers." />

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <h2 className="text-sm font-semibold mb-4">Product</h2>
          <div className="space-y-3 text-sm">
            {[["Name", brain?.product_name], ["Mission", brain?.mission], ["Description", brain?.product_description]].map(([k, v]) => (
              <div key={k}>
                <div className="text-xs text-muted">{k}</div>
                <div className="text-zinc-50 mt-0.5">{v || "—"}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Metrics</h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              ["Users", metrics.users ?? 0],
              ["MRR", `$${metrics.mrr ?? 0}`],
              ["Uptime", `${metrics.uptime_pct ?? 100}%`],
              ["Deploys", metrics.deploy_count ?? 0],
              ["Error rate", `${metrics.error_rate ?? 0}%`],
              ["Revenue", `$${metrics.revenue ?? 0}`],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-xs text-muted">{l}</div>
                <div className="text-lg font-semibold text-zinc-50">{v}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Tech stack</h2>
          {Object.keys(techStack).length === 0 ? (
            <p className="text-sm text-muted">Not set yet.</p>
          ) : (
            Object.entries(techStack).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 text-sm">
                <span className="text-muted capitalize">{k}</span>
                <span className="text-zinc-50">{String(v)}</span>
              </div>
            ))
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Shipped ({shipped.length})</h2>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {shipped.length === 0 ? (
              <p className="text-sm text-muted">Nothing shipped yet.</p>
            ) : (
              shipped.map((f: any, i: number) => (
                <div key={i} className="bg-input rounded-lg px-3 py-2 text-xs text-zinc-50">
                  {typeof f === "string" ? f : f.description || JSON.stringify(f)}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Open bugs ({bugs.length})</h2>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {bugs.length === 0 ? (
              <p className="text-sm text-muted">None open.</p>
            ) : (
              bugs.map((b: any, i: number) => (
                <div key={i} className="bg-badBg rounded-lg px-3 py-2 text-xs text-zinc-50">
                  <span className="text-bad font-semibold">{b.severity || "BUG"}</span>{" "}
                  {typeof b === "string" ? b : b.description || JSON.stringify(b)}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4">Blockers ({blockers.length})</h2>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {blockers.length === 0 ? (
              <p className="text-sm text-muted">Clear — nothing blocking.</p>
            ) : (
              blockers.map((b: any, i: number) => (
                <div key={i} className="bg-warnBg rounded-lg px-3 py-2 text-xs text-zinc-50">
                  {typeof b === "string" ? b : b.description || JSON.stringify(b)}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
