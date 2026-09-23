// Web search connector — Serper.dev (real Google results). Normalizes
// results for agents + dashboard.
import { Env, json } from "./gateway";

interface Hit {
  title: string;
  url: string;
  snippet: string;
  source: "serper";
}

export async function serper(env: Env, q: string, n: number): Promise<Hit[] | null> {
  const key = env.SERPER_API_KEY;
  if (!key) return null;
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: n }),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
  return (d.organic ?? []).map((i) => ({
    title: i.title,
    url: i.link,
    snippet: i.snippet ?? "",
    source: "serper" as const,
  }));
}

export async function handleWebSearch(req: Request, env: Env): Promise<Response> {
  const { q, limit = 8 } = (await req.json()) as { q?: string; limit?: number };
  const query = (q ?? "").trim();
  if (!query) return json({ error: "q required" }, 400);
  const n = Math.min(Math.max(limit, 1), 10);

  const hits = await serper(env, query, n);
  if (hits === null)
    return json({ error: "search provider not configured — set SERPER_API_KEY" }, 503);
  return json({ results: hits, provider: "serper", count: hits.length });
}
