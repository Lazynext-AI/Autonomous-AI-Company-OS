// Web search connector — Serper.dev (real Google results) as the primary
// provider, with Google Custom Search + Brave as fallbacks. Normalizes
// results for agents + dashboard.
import { Env, json } from "./gateway";

interface Hit {
  title: string;
  url: string;
  snippet: string;
  source: "serper" | "google" | "brave";
}

async function serper(env: Env, q: string, n: number): Promise<Hit[] | null> {
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

async function google(env: Env, q: string, n: number): Promise<Hit[] | null> {
  const key = env.GOOGLE_SEARCH_KEY;
  const cx = env.GOOGLE_SEARCH_CX;
  if (!key || !cx) return null;
  const u = `https://customsearch.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=${n}`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const d = (await r.json()) as { items?: { title: string; link: string; snippet: string }[] };
  return (d.items ?? []).map((i) => ({ title: i.title, url: i.link, snippet: i.snippet, source: "google" as const }));
}

async function brave(env: Env, q: string, n: number): Promise<Hit[] | null> {
  const key = env.BRAVE_SEARCH_KEY;
  if (!key) return null;
  const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`;
  const r = await fetch(u, { headers: { "x-subscription-token": key, accept: "application/json" } });
  if (!r.ok) return null;
  const d = (await r.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (d.web?.results ?? []).map((i) => ({ title: i.title, url: i.url, snippet: i.description, source: "brave" as const }));
}

export async function handleWebSearch(req: Request, env: Env): Promise<Response> {
  const { q, limit = 8 } = (await req.json()) as { q?: string; limit?: number };
  const query = (q ?? "").trim();
  if (!query) return json({ error: "q required" }, 400);
  const n = Math.min(Math.max(limit, 1), 10);

  const hits = (await serper(env, query, n)) ?? (await google(env, query, n)) ?? (await brave(env, query, n));
  if (hits === null)
    return json({ error: "no search provider configured — set SERPER_API_KEY, GOOGLE_SEARCH_KEY+CX, or BRAVE_SEARCH_KEY" }, 503);
  return json({ results: hits, provider: hits[0]?.source ?? null, count: hits.length });
}
