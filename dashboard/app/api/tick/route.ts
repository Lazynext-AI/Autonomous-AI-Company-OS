import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST() {
  return workerFetch("/agent/tick", {});
}
