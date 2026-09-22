import { NextRequest } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Plan → Dodo product_id. Real test-mode products on the Lazynext Dodo account;
// override via env (DODO_PRODUCT_*) when switching to live-mode product IDs.
const PLAN_PRODUCTS: Record<string, string> = {
  Team: process.env.DODO_PRODUCT_TEAM ?? "pdt_0NoB2NaRPoCtVXR2nTiTE",
  Scale: process.env.DODO_PRODUCT_SCALE ?? "pdt_0NoB2ZWMcG7EfBv589KeJ",
};

export async function POST(req: NextRequest) {
  const { plan } = await req.json();
  const product_id = PLAN_PRODUCTS[plan];
  if (!product_id) {
    return Response.json(
      { error: `No Dodo product configured for "${plan}"` },
      { status: 400 },
    );
  }
  return workerFetch("/api/v1/billing/checkout", { product_id, plan });
}
