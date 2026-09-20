import { NextRequest } from "next/server";
import { queryWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  return queryWorker(body.sql, body.params ?? []);
}
