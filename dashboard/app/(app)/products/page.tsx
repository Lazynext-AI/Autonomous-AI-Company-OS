"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Package, ExternalLink, Github, Rocket, X } from "lucide-react";

export default function ProductsPage() {
  const [brain, setBrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<any>("SELECT * FROM company_brain LIMIT 1");
        const b = rows[0];
        if (b) {
          setBrain({
            ...b,
            live_urls: parseJson(b.live_urls, {}),
            shipped_features: parseJson(b.shipped_features, []),
          });
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const urls = brain?.live_urls || {};
  const shipped = brain?.shipped_features || [];
  const hasProduct = !!brain?.product_name;

  const deploy = async () => {
    setBusy(true);
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "deploys",
        payload: {
          type: "deploy_request",
          product: brain?.product_name,
          from: "dashboard",
          requested_by: "founder",
        },
      }),
    });
    setBusy(false);
    setConfirm(false);
    toast(r.ok ? "Deploy requested — devops picks it up" : "Deploy failed");
  };

  return (
    <>
      <PageHeader title="Products" subtitle="What your company has shipped." />

      {!hasProduct && !loading ? (
        <Empty
          title="No product yet"
          hint="The CEO agent picks one once the runtime is funded and running."
        />
      ) : (
        <div className="space-y-5 max-w-4xl">
          {/* Current product card */}
          <Card>
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-[12px] bg-accentBg flex items-center justify-center">
                <Package className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-fg">{brain?.product_name}</h2>
                  <StatusBadge status="building" />
                </div>
                <p className="text-sm text-muted mt-1">{brain?.product_description}</p>
                <p className="text-xs text-muted mt-2">
                  Updated {timeAgo(brain?.updated_at)}
                </p>
              </div>
              <button
                onClick={() => setConfirm(true)}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition shrink-0"
              >
                <Rocket className="w-4 h-4" /> Ship
              </button>
            </div>

            {Object.keys(urls).length > 0 && (
              <div className="mt-5 pt-5 border-t border-border">
                <div className="text-xs text-muted font-semibold uppercase tracking-wide mb-3">
                  Live URLs
                </div>
                <div className="space-y-2">
                  {Object.entries(urls).map(([name, url]) => (
                    <a
                      key={name}
                      href={String(url)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 bg-input rounded-lg px-4 py-2.5 text-sm text-accentSoft hover:bg-cardHover transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="capitalize">{name}</span>
                      <span className="text-muted font-mono text-xs truncate">{String(url)}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Shipped features */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">
              Shipped features ({shipped.length})
            </div>
            {shipped.length === 0 ? (
              <div className="p-5 text-sm text-muted">
                Features land here as engineering agents ship them.
              </div>
            ) : (
              shipped.map((f: any, i: number) => (
                <div
                  key={i}
                  className="px-5 py-3.5 border-b border-border last:border-0 text-sm text-fg/80"
                >
                  {typeof f === "string" ? f : f.description || JSON.stringify(f)}
                </div>
              ))
            )}
          </Card>

          <a
            href="https://github.com/Lazynext-AI"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-accentSoft hover:underline"
          >
            <Github className="w-4 h-4" /> Product repos on GitHub →
          </a>
        </div>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-[14px] p-6 relative"
          >
            <button
              onClick={() => setConfirm(false)}
              className="absolute top-4 right-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-11 h-11 rounded-[12px] bg-accentBg flex items-center justify-center mb-4">
              <Rocket className="w-5 h-5 text-accentSoft" />
            </div>
            <h2 className="text-lg font-bold text-fg mb-1">Deploy {brain?.product_name}?</h2>
            <p className="text-sm text-muted mb-6">
              Sends a deploy request to the bus — the DevOps agent builds, deploys to Cloudflare and reports back.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirm(false)} className="text-sm text-muted hover:text-fg px-4 py-2.5">
                Cancel
              </button>
              <button
                onClick={deploy}
                disabled={busy}
                className="bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {busy ? "Shipping…" : "Ship it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
