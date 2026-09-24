import { NextRequest, NextResponse } from "next/server";
import { workerFetch } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = req.cookies.get("lz_user_session")?.value;
  const sessionToken = member?.split(".")[0];
  if (sessionToken) {
    await workerFetch("/kv/delete", { key: `session:${sessionToken}` }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("lazynext_session", "", { httpOnly: true, maxAge: 0, path: "/" });
  res.cookies.set("lz_user_session", "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
