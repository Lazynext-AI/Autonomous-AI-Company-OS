"use client";

import { useEffect, useState } from "react";
import { queryApi, parseJson } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { MessageSquare, Send } from "lucide-react";

interface Msg {
  id: number;
  channel: string;
  payload: any;
  created_at: string;
}

export default function ConversationsPage() {
  const [channels, setChannels] = useState<Record<string, Msg[]>>({});
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await queryApi<Msg>(
          "SELECT id, channel, payload, created_at FROM bus_messages ORDER BY id DESC LIMIT 200"
        );
        const grouped: Record<string, Msg[]> = {};
        rows.forEach((r) => {
          (grouped[r.channel] = grouped[r.channel] || []).push({
            ...r,
            payload: parseJson(r.payload, r.payload),
          });
        });
        setChannels(grouped);
        if (!active && rows[0]) setActive(rows[0].channel);
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [active]);

  const names = Array.from(new Set(["copilot", ...Object.keys(channels)]));
  const msgs = (channels[active] || []).slice().reverse();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !active) return;
    setSending(true);
    const text = draft;
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: active,
        payload: { from: "founder", text, via: "dashboard" },
      }),
    });
    if (r.ok) {
      setDraft("");
      // Copilot channel → real AI reply posted back to the bus.
      if (active === "copilot") {
        await fetch("/api/copilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
    } else toast("Send failed");
    setSending(false);
  };

  return (
    <>
      <PageHeader title="Conversations" subtitle="Agent-to-agent chatter on the bus." />

      {names.length === 0 && !loading ? (
        <Empty
          title="No conversations yet"
          hint="Agent channels appear once the runtime is running."
        />
      ) : (
        <div className="flex gap-5 h-[calc(100vh-220px)]">
          {/* channel list */}
          <Card className="w-64 shrink-0 p-2 overflow-y-auto">
            {names.map((c) => (
              <button
                key={c}
                onClick={() => setActive(c)}
                className={`w-full text-left px-3.5 py-3 rounded-[10px] mb-1 transition ${
                  c === active ? "bg-accentBg" : "hover:bg-cardHover"
                }`}
              >
                <div className={`text-sm font-medium truncate ${c === active ? "text-accentSoft" : "text-fg"}`}>
                  {c === "copilot" ? "✦ Copilot" : `#${c}`}
                </div>
                <div className="text-xs text-muted">{(channels[c] ?? []).length} messages</div>
              </button>
            ))}
          </Card>

          {/* thread */}
          <Card className="flex-1 p-0 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-border text-sm font-semibold">
              #{active}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {msgs.map((m) => {
                const p = typeof m.payload === "object" ? m.payload : {};
                const from = p.from || p.agent || "system";
                const body = p.text || p.message || JSON.stringify(m.payload);
                return (
                  <div key={m.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accentBg flex items-center justify-center shrink-0">
                      <MessageSquare className="w-3.5 h-3.5 text-accentSoft" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-fg capitalize">
                          {String(from).replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-muted">{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-muted mt-0.5 break-words">{body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* composer — publishes to the channel */}
            <form onSubmit={send} className="px-5 py-4 border-t border-border flex gap-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message #${active}`}
                className="flex-1 bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="bg-accent hover:bg-accentSoft disabled:opacity-50 text-white px-4 rounded-lg transition flex items-center"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
