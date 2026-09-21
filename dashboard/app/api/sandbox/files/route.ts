import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxies envd Connect-RPC filesystem calls into a running sandbox.
// GET /api/sandbox/files?id=<sandboxID>&path=/home/user → directory listing
// GET /api/sandbox/files?id=<sandboxID>&file=/path → file contents
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const path = req.nextUrl.searchParams.get("path") || "/home/user";
  const file = req.nextUrl.searchParams.get("file");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const key = (env as any).E2B_API_KEY || process.env.E2B_API_KEY;
    if (!key) return NextResponse.json({ error: "E2B_API_KEY not set" }, { status: 503 });

    // Sandboxes created non-securely accept envd calls without a token.
    const envd = `https://49983-${id}.e2b.dev`;
    const headers = { "content-type": "application/json" };

    if (file) {
      const r = await fetch(`${envd}/files?path=${encodeURIComponent(file)}`, {
        cache: "no-store",
      });
      const text = r.ok ? await r.text() : "";
      return NextResponse.json({ path: file, content: text.slice(0, 8000), size: text.length });
    }

    const r = await fetch(`${envd}/filesystem.Filesystem/ListDir`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path, depth: 1 }),
      cache: "no-store",
    });
    const d = await r.json().catch(() => ({}));
    return NextResponse.json({ path, entries: d.entries ?? [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
