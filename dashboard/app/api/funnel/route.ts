import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Conversion funnel metrics, proxied to the admin route (internal token).
export async function GET() {
  return workerFetch("/api/v1/billing/funnel", undefined, "GET", true);
}
