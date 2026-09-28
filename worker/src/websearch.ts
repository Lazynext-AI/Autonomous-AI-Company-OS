// Web search — Serper.dev (real Google results) with a zero-cred fallback
// chain so agent research never hard-fails on a 402 from a paid provider:
// serper → DDG Lite scrape → DDG instant-answer. Normalizes results for
// agents + dashboard; `provider` in the response names the winner.
import { Env, json } from "./gateway";

interface Hit {
  title: string;
  url: string;
  snippet: string;
  source: "serper" | "ddg" | "ddg-answer";
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// DDG Lite (lite.duckduckgo.com) — no key, GET-servable result page. Results
// are <a class='result-link' href="//duckduckgo.com/l/?uddg=ENCODED…">title</a>
// followed by <td class='result-snippet'>…html…</td>; links+snippets pair by
// document order. Kept regex-only and side-effect-free so test/ddg-parser
// can lift the function verbatim (same pattern as focus-budget.test.mjs).
function parseDdgLite(html: string, n: number): { title: string; url: string; snippet: string }[] {
  const unesc = (s: string) =>
    s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ").trim();
  const links = [...html.matchAll(
    /<a[^>]+href="\/\/duckduckgo\.com\/l\/\?[^"]*uddg=([^&"]+)[^"]*"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g,
  )];
  const snips = [...html.matchAll(/<td class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g)];
  return links.slice(0, n).map((m, i) => ({
    title: unesc(m[2]),
    url: decodeURIComponent(m[1]),
    snippet: snips[i] ? unesc(snips[i][1]) : "",
  }));
}

async function ddgLite(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA },
  });
  if (!r.ok) return [];
  return parseDdgLite(await r.text(), n).map((h) => ({ ...h, source: "ddg" as const }));
}

// Last-resort: api.duckduckgo.com instant answers (Abstract + RelatedTopics).
// Sparse for navigational queries but free JSON with no key and no HTML.
async function ddgInstant(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1`,
    { headers: { "User-Agent": UA } },
  );
  if (!r.ok) return [];
  const d = (await r.json()) as {
    AbstractURL?: string; AbstractText?: string; Heading?: string;
    RelatedTopics?: { FirstURL?: string; Text?: string; Topics?: { FirstURL?: string; Text?: string }[] }[];
  };
  const hits: Hit[] = [];
  if (d.AbstractURL && d.AbstractText)
    hits.push({ title: d.Heading || q, url: d.AbstractURL, snippet: d.AbstractText, source: "ddg-answer" });
  const flat = (d.RelatedTopics ?? []).flatMap((t) => (t.Topics?.length ? t.Topics : [t]));
  for (const t of flat) {
    if (hits.length >= n || !t.FirstURL || !t.Text) continue;
    hits.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, snippet: t.Text, source: "ddg-answer" });
  }
  return hits.slice(0, n);
}

export async function handleWebSearch(req: Request, env: Env): Promise<Response> {
  const { q, limit = 8 } = (await req.json()) as { q?: string; limit?: number };
  const query = (q ?? "").trim();
  if (!query) return json({ error: "q required" }, 400);
  const n = Math.min(Math.max(limit, 1), 10);

  try {
    const hits = await serper(env, query, n);
    if (hits !== null) return json({ results: hits, provider: "serper", count: hits.length });
  } catch { /* fall through to the free chain */ }
  try {
    const hits = await ddgLite(query, n);
    if (hits.length) return json({ results: hits, provider: "duckduckgo", count: hits.length });
  } catch { /* fall through */ }
  try {
    const hits = await ddgInstant(query, n);
    if (hits.length) return json({ results: hits, provider: "duckduckgo-answer", count: hits.length });
  } catch { /* fall through */ }
  return json({ error: "all search providers failed", results: [], provider: "none", count: 0 }, 502);
}
