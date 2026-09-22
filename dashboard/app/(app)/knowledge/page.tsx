"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { Plus, X } from "lucide-react";

interface Chunk {
  id: string;
  filename: string;
  category: string;
  chunk_index: number;
  content: string;
  ingested_at: string;
}

export default function KnowledgePage() {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("founder_notes");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sql: "INSERT INTO knowledge_chunks (id, filename, category, chunk_index, content) VALUES (lower(hex(randomblob(16))), ?, ?, 0, ?)",
        params: [title.trim() || "untitled.md", category, content],
      }),
    });
    setBusy(false);
    if (r.ok) {
      toast("Knowledge added");
      setModal(false);
      setTitle(""); setContent("");
      load();
    } else toast("Add failed");
  };

  const load = async () => {
      try {
        setChunks(
          await queryApi<Chunk>(
            "SELECT * FROM knowledge_chunks ORDER BY ingested_at DESC LIMIT 200"
          )
        );
        setLoading(false);
      } catch {
        setLoading(false);
      }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // group by file
  const files = chunks.reduce<Record<string, Chunk[]>>((acc, c) => {
    (acc[c.filename] ||= []).push(c);
    return acc;
  }, {});
  const categories = [...new Set(chunks.map((c) => c.category))];

  return (
    <>
      <PageHeader
        title="Knowledge"
        subtitle={`${chunks.length} chunks · ${Object.keys(files).length} documents · embedded to Vectorize`}
      >
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Add knowledge
        </button>
      </PageHeader>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((c) => (
            <span key={c} className="px-3 py-1.5 rounded-lg bg-accentBg text-xs text-accentSoft font-medium">
              {c}
            </span>
          ))}
        </div>
      )}

      {chunks.length === 0 && !loading ? (
        <Empty title="Knowledge base is empty" hint="Agents ingest docs via the knowledge pipeline." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(files).map(([file, list]) => (
            <Card
              key={file}
              className="hover:border-accentDim transition cursor-pointer"
              onClick={() => setOpenFile((o) => (o === file ? null : file))}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-input flex items-center justify-center text-accentSoft text-sm">
                  📄
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg truncate">{file}</div>
                  <div className="text-xs text-muted">
                    {list.length} chunk{list.length > 1 ? "s" : ""} · {list[0].category} · {timeAgo(list[0].ingested_at)}
                  </div>
                </div>
              </div>
              {openFile === file ? (
                <div className="space-y-2 mt-3">
                  {list.map((c: any, i: number) => (
                    <pre key={i} className="bg-input rounded-lg p-3 text-xs text-fg/80 whitespace-pre-wrap font-mono max-h-48 overflow-auto">
                      {c.content}
                    </pre>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted line-clamp-2">{list[0].content}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div
          className="fixed inset-0 z-[150] bg-bg/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setModal(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={add}
            className="w-full max-w-md bg-card border border-border rounded-[14px] p-6 relative"
          >
            <button type="button" onClick={() => setModal(false)} className="absolute top-4 right-4 text-muted hover:text-fg" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-bold text-fg mb-1">Add knowledge</h2>
            <p className="text-xs text-muted mb-5">Agents RAG over this — company facts, decisions, specs.</p>
            <label className="text-xs text-muted">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="launchdeck-spec.md"
              className="mt-1.5 mb-4 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
            />
            <label className="text-xs text-muted">Category</label>
            <div className="flex flex-wrap gap-2 mt-1.5 mb-4">
              {["founder_notes", "product", "market", "engineering"].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    category === c ? "bg-accent text-white" : "bg-input text-muted border border-border"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="text-xs text-muted">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={6}
              placeholder="Paste the knowledge agents should know…"
              className="mt-1.5 mb-5 w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent resize-none"
            />
            <button
              type="submit"
              disabled={busy || !content.trim()}
              className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
            >
              {busy ? "Adding…" : "Add to knowledge base"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
