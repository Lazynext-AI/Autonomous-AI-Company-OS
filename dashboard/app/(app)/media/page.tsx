"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { ImagePlus, Copy, Trash2, Image as ImageIcon } from "lucide-react";

interface MediaItem {
  id: string;
  url: string;
  name: string;
  type: string;
  size: number;
  created: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const fmtSize = (n?: number) =>
  !n ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/media");
      const d = await r.json();
      if (r.ok) setItems(d.media ?? []);
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) return toast("File too large — 5MB max");
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) return toast("Images only — png, jpeg, webp, gif or avif");
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type === "image/jpg" ? "image/jpeg" : file.type, data_b64: btoa(bin) }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        toast("Uploaded — use the URL as image_url in scheduled posts");
        load();
      } else toast(`Upload failed: ${d.error ?? r.status}`);
    } catch {
      toast("Upload failed");
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => toast("URL copied"), () => toast("Copy failed"));
  };

  const del = async (id: string) => {
    const r = await fetch(`/api/media?id=${id}`, { method: "DELETE" });
    if (r.ok) setItems((it) => it.filter((x) => x.id !== id));
    else toast("Delete failed");
  };

  return (
    <>
      <PageHeader title="Media library" subtitle="Native asset store (KV) — public URLs feed image_url on scheduled social posts.">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <ImagePlus className="w-4 h-4" /> {busy ? "Uploading…" : "Upload image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </PageHeader>

      {items.length === 0 && !loading ? (
        <Empty title="No media yet" hint="Upload an image — its public URL can be attached to scheduled posts (Instagram and Pinterest require one)." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl">
          {items.map((m) => (
            <Card key={m.id} className="p-0 overflow-hidden">
              <div className="h-40 bg-input flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="p-4">
                <div className="flex items-start gap-2">
                  <ImageIcon className="w-4 h-4 text-accentSoft shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-fg truncate">{m.name}</div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {m.type} · {fmtSize(m.size)} · {timeAgo(m.created ? new Date(m.created).toISOString() : undefined)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => copy(m.url)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-input hover:bg-border text-fg text-xs font-semibold px-3 py-2 rounded-lg transition"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy URL
                  </button>
                  <button
                    onClick={() => del(m.id)}
                    className="inline-flex items-center justify-center gap-1.5 bg-badBg hover:bg-bad/20 text-bad text-xs font-semibold px-3 py-2 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
