"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { Key } from "lucide-react";

interface ApiKey {
  id: number;
  key_prefix: string;
  name: string;
  scopes: string;
  rate_limit_rpm: number;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setKeys(await queryApi<ApiKey>("SELECT * FROM api_keys ORDER BY id DESC"));
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
  }, []);

  const active = keys.filter((k) => !k.revoked_at);

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle={`${active.length} active · hashed lzk_* keys with scopes + rate limits`}
      />

      {keys.length === 0 && !loading ? (
        <Empty
          title="No API keys"
          hint="Create one with the lazynext CLI or the /api/v1/keys endpoint."
        />
      ) : (
        <Card className="p-0 overflow-hidden max-w-4xl">
          <div className="grid grid-cols-[1fr_140px_120px_140px_110px] px-5 py-3 border-b border-border text-[11px] font-bold text-muted uppercase tracking-wide">
            <span>Key</span><span>Scopes</span><span>Limit</span><span>Last used</span><span>Status</span>
          </div>
          {keys.map((k) => (
            <div
              key={k.id}
              className="grid grid-cols-[1fr_140px_120px_140px_110px] px-5 py-3.5 border-b border-border last:border-0 items-center hover:bg-cardHover transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Key className="w-3.5 h-3.5 text-accentSoft shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-zinc-50 font-mono truncate">{k.key_prefix}…</div>
                  <div className="text-xs text-muted truncate">{k.name}</div>
                </div>
              </div>
              <span className="text-xs text-accentSoft font-medium">{k.scopes}</span>
              <span className="text-xs text-muted">{k.rate_limit_rpm}/min</span>
              <span className="text-xs text-muted">{timeAgo(k.last_used_at)}</span>
              <span className={`text-xs font-semibold ${k.revoked_at ? "text-bad" : "text-ok"}`}>
                {k.revoked_at ? "revoked" : "active"}
              </span>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-muted mt-4 max-w-4xl">
        Keys are shown once at creation and stored as SHA-256 hashes. Docs:{" "}
        <a href="https://ai-company.lazynext.com/api/v1/docs" className="text-accentSoft hover:underline">
          ai-company.lazynext.com/api/v1/docs
        </a>
      </p>
    </>
  );
}
