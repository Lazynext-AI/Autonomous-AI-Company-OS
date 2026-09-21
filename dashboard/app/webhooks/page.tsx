"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Webhook } from "lucide-react";

interface Endpoint {
  id: number;
  url: string;
  channels: string;
  active: number;
  created_at: string;
}
interface Delivery {
  id: number;
  endpoint_id: number;
  channel: string;
  status_code?: number;
  error?: string;
  attempted_at: string;
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setEndpoints(await queryApi<Endpoint>("SELECT * FROM webhook_endpoints ORDER BY id DESC"));
        setDeliveries(
          await queryApi<Delivery>("SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 30")
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
      <PageHeader title="Webhooks" subtitle="Signed outbound events — bus → your endpoints." />

      {endpoints.length === 0 && !loading ? (
        <Empty title="No endpoints" hint="Register one via the CLI or /api/v1/webhooks." />
      ) : (
        <div className="grid grid-cols-2 gap-5">
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">Endpoints</div>
            {endpoints.map((e) => (
              <div key={e.id} className="px-5 py-3.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <Webhook className="w-3.5 h-3.5 text-accentSoft" />
                  <span className="text-sm text-zinc-50 font-mono truncate">{e.url}</span>
                  <span className={`ml-auto text-xs font-semibold ${e.active ? "text-ok" : "text-muted"}`}>
                    {e.active ? "on" : "off"}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  channels: {e.channels} · added {timeAgo(e.created_at)}
                </div>
              </div>
            ))}
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">Deliveries</div>
            {deliveries.length === 0 ? (
              <div className="p-5 text-sm text-muted">No deliveries yet.</div>
            ) : (
              deliveries.map((d) => (
                <div key={d.id} className="px-5 py-3 border-b border-border last:border-0 flex items-center gap-3">
                  <span
                    className={`text-xs font-mono font-bold ${
                      d.status_code && d.status_code < 300 ? "text-ok" : "text-bad"
                    }`}
                  >
                    {d.status_code || "ERR"}
                  </span>
                  <span className="text-xs text-accentSoft">{d.channel}</span>
                  <span className="text-xs text-muted ml-auto">{timeAgo(d.attempted_at)}</span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}
    </>
  );
}
