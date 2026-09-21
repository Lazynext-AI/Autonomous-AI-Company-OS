import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  return workerFetch("/api/v1/webhooks/deliveries", undefined, "GET");
}
