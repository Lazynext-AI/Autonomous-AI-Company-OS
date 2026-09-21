"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { TerminalSquare, Plus, Trash2, FolderOpen, FileText, ChevronDown, ChevronRight } from "lucide-react";

interface Sandbox {
  sandboxID: string;
  templateID: string;
  alias?: string;
  startedAt?: string;
}

export default function SandboxPage() {
  const [boxes, setBoxes] = useState<Sandbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/sandbox");
      const d = await r.json();
      setBoxes(Array.isArray(d) ? d : []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    setCreating(true);
    const r = await fetch("/api/sandbox", { method: "POST" });
    if (r.ok) {
      toast("Sandbox created");
      load();
    } else {
      toast("Create failed");
    }
    setCreating(false);
  };

  const kill = async (id: string) => {
    const r = await fetch(`/api/sandbox?id=${id}`, { method: "DELETE" });
    toast(r.ok ? "Sandbox killed" : "Kill failed");
    load();
  };

  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, any[]>>({});
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);

  const browse = async (id: string, path = "/home/user") => {
    const r = await fetch(`/api/sandbox/files?id=${id}&path=${encodeURIComponent(path)}`);
    const d = await r.json();
    setFiles((f) => ({ ...f, [id]: d.entries ?? [] }));
    setOpen(id);
  };

  const readFile = async (id: string, path: string) => {
    const r = await fetch(`/api/sandbox/files?id=${id}&file=${encodeURIComponent(path)}`);
    const d = await r.json();
    setFileContent({ path, content: d.content ?? "(empty)" });
  };

  return (
    <>
      <PageHeader
        title="Sandbox"
        subtitle="Live E2B sandboxes — agents run untrusted code here."
      >
        <button
          onClick={create}
          disabled={creating}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> {creating ? "Creating…" : "New sandbox"}
        </button>
      </PageHeader>

      {boxes.length === 0 && !loading ? (
        <Empty
          title="No sandboxes running"
          hint="Create one — it's a real, isolated E2B VM (5-min timeout). Agents spawn these automatically when running."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
          {boxes.map((s) => (
            <Card key={s.sandboxID} className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                <TerminalSquare className="w-5 h-5 text-accentSoft" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg font-mono truncate">{s.sandboxID}</span>
                  <span className="w-2 h-2 rounded-full bg-ok animate-pulse shrink-0" />
                </div>
                <div className="text-xs text-muted mt-0.5">
                  template {s.alias || s.templateID} · envd :49983
                </div>
                {s.startedAt && (
                  <div className="text-xs text-muted">up {timeAgo(s.startedAt)}</div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => (open === s.sandboxID ? setOpen(null) : browse(s.sandboxID))}
                  className="text-muted hover:text-accentSoft transition"
                  aria-label="Browse files"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
                <button onClick={() => kill(s.sandboxID)} className="text-muted hover:text-bad transition" aria-label="Kill">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* live file browser — reads the real sandbox filesystem via envd */}
      {open && (
        <Card className="mt-4 max-w-4xl p-0 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accentSoft" />
            <span className="text-sm font-semibold font-mono">/home/user</span>
            <span className="text-xs text-muted ml-auto font-mono">{open}</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {(files[open] ?? []).length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted">Empty directory</p>
            ) : (
              (files[open] ?? []).map((e: any) => (
                <button
                  key={e.path}
                  onClick={() => (e.type === "FILE_TYPE_DIRECTORY" ? browse(open, e.path) : readFile(open, e.path))}
                  className="w-full flex items-center gap-2.5 px-5 py-2.5 text-left hover:bg-cardHover transition border-b border-border last:border-0"
                >
                  {e.type === "FILE_TYPE_DIRECTORY" ? (
                    <FolderOpen className="w-3.5 h-3.5 text-accentSoft shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-muted shrink-0" />
                  )}
                  <span className="text-xs font-mono text-fg truncate">{e.name}</span>
                  <span className="text-[10px] text-muted ml-auto">{e.size}b</span>
                </button>
              ))
            )}
          </div>
          {fileContent && (
            <div className="border-t border-border">
              <div className="px-5 py-2.5 text-xs font-mono text-muted border-b border-border">{fileContent.path}</div>
              <pre className="px-5 py-4 text-xs font-mono text-fg whitespace-pre-wrap max-h-48 overflow-y-auto">
                {fileContent.content}
              </pre>
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-muted mt-5 max-w-4xl">
        Sandboxes run agent-generated code. Command execution happens via the Python SDK inside the
        runtime — this panel manages sandbox lifecycle (create / list / kill) over the E2B REST API.
      </p>
    </>
  );
}
