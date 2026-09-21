"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";

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

  useEffect(() => {
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
      />

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
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(files).map(([file, list]) => (
            <Card key={file} className="hover:border-accentDim transition">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-input flex items-center justify-center text-accentSoft text-sm">
                  📄
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-50 truncate">{file}</div>
                  <div className="text-xs text-muted">
                    {list.length} chunk{list.length > 1 ? "s" : ""} · {list[0].category} · {timeAgo(list[0].ingested_at)}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted line-clamp-2">{list[0].content}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
