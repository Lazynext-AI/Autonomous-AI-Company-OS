"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { TerminalSquare, ChevronRight as Run } from "lucide-react";

const SAMPLE = `import sys, platform
print("python", platform.python_version())
print("hello from the exec container")
`;

export default function SandboxPage() {
  const [code, setCode] = useState(SAMPLE);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!code.trim()) return;
    setRunning(true);
    try {
      const r = await fetch("/api/sandbox/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      const text = d.error || d.stderr || d.stdout || JSON.stringify(d);
      setLog((l) => [{ ok: !!d.success, text }, ...l].slice(0, 20));
    } catch (e) {
      setLog((l) => [{ ok: false, text: String(e) }, ...l]);
    }
    setRunning(false);
  };

  return (
    <>
      <PageHeader
        title="Sandbox"
        subtitle="Cloudflare exec container — agents run untrusted Python here."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl">
        <Card className="p-0 overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-accentSoft" />
            <span className="text-sm font-semibold">Code</span>
            <span className="text-xs text-muted ml-auto font-mono">python · container</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-72 bg-black/40 text-fg font-mono text-xs p-4 outline-none resize-y"
          />
          <div className="border-t border-border px-4 py-2.5 flex items-center justify-end bg-input">
            <button
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition"
            >
              <Run className="w-3.5 h-3.5" /> {running ? "Running…" : "Run"}
            </button>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-ok" />
            <span className="text-sm font-semibold">Output</span>
            <span className="text-xs text-muted ml-auto">stdout / stderr</span>
          </div>
          <div className="flex-1 min-h-72 bg-black/90 font-mono text-xs p-4 overflow-y-auto space-y-3">
            {log.length === 0 && <div className="text-muted">Run code — output appears here.</div>}
            {log.map((l, i) => (
              <pre key={i} className={`whitespace-pre-wrap ${l.ok ? "text-green-400" : "text-bad"}`}>
                {l.text}
              </pre>
            ))}
          </div>
        </Card>
      </div>

      <p className="text-xs text-muted mt-5 max-w-4xl">
        This is the same Cloudflare container agents use for code execution — a sandboxed Python
        subprocess with a 60s timeout and no internet. Runs are stateless; each request is fresh.
      </p>
    </>
  );
}
