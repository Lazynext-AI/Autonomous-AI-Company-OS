import { NextRequest } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Plan → Dodo product_id mapping (create the products in Dodo dashboard,
// then set these IDs — or configure via env).
const PLAN_PRODUCTS: Record<string, string> = {
  Company: process.env.DODO_PRODUCT_COMPANY ?? "",
  Scale: process.env.DODO_PRODUCT_SCALE ?? "",
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
