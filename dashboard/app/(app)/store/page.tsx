"use client";

import { useEffect, useState } from "react";
import { queryApi } from "@/lib/api";
import { PageHeader, Card, Empty, timeAgo } from "@/components/ui";
import { toast } from "@/components/Toast";
import { ShoppingCart, Plus, X } from "lucide-react";

interface Product {
  id: number;
  name: string;
  description?: string;
  price_cents: number;
  currency: string;
  dodo_product_id?: string;
  active: number;
  created_at: string;
}

export default function StorePage() {
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", description: "", price: "", dodo_product_id: "" });

  const load = async () => {
    try {
      setRows(await queryApi<Product>("SELECT * FROM store_products ORDER BY id DESC LIMIT 100"));
    } catch {}
    setLoading(false);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "/api/v1/store/products",
        body: {
          name: f.name,
          description: f.description,
          price_cents: Math.round(parseFloat(f.price || "0") * 100),
          dodo_product_id: f.dodo_product_id,
        },
      }),
    });
    if (r.ok) {
      toast("Product added");
      setModal(false);
      setF({ name: "", description: "", price: "", dodo_product_id: "" });
      load();
    } else toast("Add failed");
    setBusy(false);
  };

  const toggle = async (id: number, active: number) => {
    const r = await fetch("/api/svc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/api/v1/store/products/${id}`, method: "PATCH", body: { active: active ? 0 : 1 } }),
    });
    if (r.ok) setRows((p) => p.map((x) => (x.id === id ? { ...x, active: active ? 0 : 1 } : x)));
    else toast("Update failed");
  };

  return (
    <>
      <PageHeader title="Store" subtitle="Native storefront catalog — D1 products, checkout via Dodo.">
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accentSoft text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New product
        </button>
      </PageHeader>

      {rows.length === 0 && !loading ? (
        <Empty title="No products" hint="Add a product — checkout runs through Dodo Payments." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-accentBg flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-5 h-5 text-accentSoft" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg truncate">{p.name}</div>
                  {p.description && <div className="text-xs text-muted mt-0.5 line-clamp-2">{p.description}</div>}
                  <div className="text-sm font-semibold text-ok mt-1">
                    ${(p.price_cents / 100).toFixed(2)} <span className="text-[10px] text-muted font-normal">{p.currency}</span>
                  </div>
                  <div className="text-[10px] text-muted mt-1">
                    {p.dodo_product_id ? `dodo:${p.dodo_product_id.slice(0, 12)}…` : "no dodo link"} · {timeAgo(p.created_at)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => toggle(p.id, p.active)}
                className={`mt-3 w-full text-xs font-semibold py-1.5 rounded-lg border transition ${
                  p.active ? "border-ok/40 text-ok" : "border-border text-muted"
                }`}
              >
                {p.active ? "Active" : "Inactive"}
              </button>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(false)}>
          <Card className="w-full max-w-md">
            <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-fg">New product</h3>
                <button type="button" onClick={() => setModal(false)} className="text-muted hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none min-h-16" />
              <input required type="number" step="0.01" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="Price (USD)" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <input value={f.dodo_product_id} onChange={(e) => setF({ ...f, dodo_product_id: e.target.value })} placeholder="Dodo product id (optional — links checkout)" className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-fg outline-none" />
              <button disabled={busy} className="w-full bg-accent hover:bg-accentSoft disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                {busy ? "Adding…" : "Add product"}
              </button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
