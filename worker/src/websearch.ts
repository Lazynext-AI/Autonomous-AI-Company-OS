// Web search — zero-cred metasearch cascade so agent research never hard-
// fails on a provider 402/429: serper (if the key ever refills) → searxng
// (optional self-hosted upstream via SEARXNG_URL) → Bing HTML scrape →
// Brave HTML scrape → DDG Lite scrape → DDG instant-answer. The scrape
// chain IS the self-hosted option — metasearch running inside the Worker,
// no server to operate. Normalizes results for agents + dashboard;
// `provider` in the response names the winner.
import { Env, json } from "./gateway";

interface Hit {
  title: string;
  url: string;
  snippet: string;
  source: "serper" | "searxng" | "bing" | "brave" | "ddg" | "ddg-answer";
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
function unescHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "")
    .replace(/&#0*(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function parseDdgLite(html: string, n: number): { title: string; url: string; snippet: string }[] {
  const unesc = unescHtml;
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

// Optional self-hosted upstream — any SearXNG instance reachable over HTTPS
// (public instance, tunnel, or the user's own host) serves JSON results and
// covers ~70 engines upstream for free. Absent by default; set SEARXNG_URL.
async function searxng(env: Env, q: string, n: number): Promise<Hit[]> {
  const base = env.SEARXNG_URL;
  if (!base) return [];
  const r = await fetch(
    `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(q)}&format=json`,
    { headers: { Accept: "application/json", "User-Agent": UA } },
  );
  if (!r.ok) return [];
  const d = (await r.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (d.results ?? []).slice(0, n).map((i) => ({
    title: i.title, url: i.url, snippet: i.content ?? "", source: "searxng" as const,
  }));
}

// Bing HTML — results are <li class="b_algo"> blocks with <h2><a> + <p>.
// hrefs are bing.com/ck/a redirects: the real URL is base64url in u=a1….
// Kept regex-only and side-effect-free so tests can lift it verbatim.
function decodeBingUrl(href: string): string {
  const m = href.match(/[?&]u=a1([^&]+)/);
  if (!m) return href;
  try {
    const s = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
    return atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  } catch {
    return href;
  }
}

function parseBing(html: string, n: number): { title: string; url: string; snippet: string }[] {
  const unesc = unescHtml;
  const out: { title: string; url: string; snippet: string }[] = [];
  for (const m of html.matchAll(/<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)) {
    const a = m[1].match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const p = m[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.push({ title: unesc(a[2]), url: decodeBingUrl(a[1].replace(/&amp;/g, "&")), snippet: p ? unesc(p[1]) : "" });
    if (out.length >= n) break;
  }
  return out;
}

async function bing(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!r.ok) return [];
  return parseBing(await r.text(), n).map((h) => ({ ...h, source: "bing" as const }));
}

// Brave Search HTML — SSR result cards: <div class="snippet svelte-…"> with
// result-content > a[href] (direct URL), a .title element, and a
// .content.line-clamp… description. svelte-* class suffixes rotate, so the
// matches key on the stable class tokens only.
function parseBrave(html: string, n: number): { title: string; url: string; snippet: string }[] {
  const unesc = unescHtml;
  const out: { title: string; url: string; snippet: string }[] = [];
  for (const b of html.split(/<div class="snippet svelte-[^"]*"/).slice(1)) {
    const a = b.match(/<a href="(https?:\/\/[^"]+)"[^>]*class="[^"]*\bl1\b/) ?? b.match(/<a href="(https?:\/\/[^"]+)"/);
    if (!a) continue;
    const t = b.match(/class="title [^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const s = b.match(/class="content [^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    out.push({ title: t ? unesc(t[1]) : "", url: a[1], snippet: s ? unesc(s[1]) : "" });
    if (out.length >= n) break;
  }
  return out;
}

async function brave(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!r.ok) return [];
  return parseBrave(await r.text(), n).map((h) => ({ ...h, source: "brave" as const }));
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
  for (const [name, fn] of [
    ["searxng", () => searxng(env, query, n)],
    ["bing", () => bing(query, n)],
    ["brave", () => brave(query, n)],
    ["duckduckgo", () => ddgLite(query, n)],
  ] as const) {
    try {
      const hits = await fn();
      if (hits.length) return json({ results: hits, provider: name, count: hits.length });
    } catch { /* next provider */ }
  }
  try {
    const hits = await ddgInstant(query, n);
    if (hits.length) return json({ results: hits, provider: "duckduckgo-answer", count: hits.length });
  } catch { /* fall through */ }
  return json({ error: "all search providers failed", results: [], provider: "none", count: 0 }, 502);
}
