"""Web search tool — Serper.dev (real Google results) with a zero-cred
metasearch cascade so agent research never hard-fails on a paid provider's
402: serper → searxng (optional SEARXNG_URL upstream — localhost works for
the local fleet) → Bing HTML scrape → Brave HTML scrape → DDG Lite scrape →
DDG instant answers. Mirror of worker/src/websearch.ts — keep the chains in
sync.
"""

import re
import urllib.parse
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_LINK_RE = re.compile(
    r"<a[^>]+href=\"//duckduckgo\.com/l/\?[^\"]*uddg=([^&\"]+)[^\"]*\"[^>]*class='result-link'[^>]*>([\s\S]*?)</a>"
)
_SNIP_RE = re.compile(r"<td class='result-snippet'[^>]*>([\s\S]*?)</td>")
_TAG_RE = re.compile(r"<[^>]*>")


def _unesc(s: str) -> str:
    s = _TAG_RE.sub("", s)
    s = re.sub(r"&#0*(\d+);", lambda m: chr(int(m.group(1))), s)
    for k, v in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#x27;", "'"), ("&#39;", "'")):
        s = s.replace(k, v)
    return re.sub(r"\s+", " ", s).strip()


def _ddg_lite(html: str, n: int) -> list[dict[str, Any]]:
    links = _LINK_RE.findall(html)
    snips = _SNIP_RE.findall(html)
    return [
        {
            "url": urllib.parse.unquote(u),
            "title": _unesc(t),
            "snippet": _unesc(snips[i]) if i < len(snips) else "",
        }
        for i, (u, t) in enumerate(links[:n])
    ]


async def _search_serper(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    key = get_settings().serper_api_key
    if not key:
        return []
    r = await client.post(
        "https://google.serper.dev/search",
        headers={"X-API-KEY": key, "Content-Type": "application/json"},
        json={"q": query, "num": n},
    )
    if r.status_code != 200:
        return []
    return [
        {"url": i.get("link", ""), "title": i.get("title", ""), "snippet": i.get("snippet", "")}
        for i in r.json().get("organic", [])[:n]
    ]


async def _search_ddg_lite(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    r = await client.get("https://lite.duckduckgo.com/lite/", params={"q": query})
    return _ddg_lite(r.text, n) if r.status_code == 200 else []


async def _search_searxng(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    # Optional self-hosted upstream — any SearXNG instance serving JSON.
    # localhost is reachable from the local fleet (unlike the cloud worker).
    base = (get_settings().searxng_url or "").rstrip("/")
    if not base:
        return []
    r = await client.get(f"{base}/search", params={"q": query, "format": "json"},
                         headers={"Accept": "application/json"})
    if r.status_code != 200:
        return []
    return [
        {"url": i.get("url", ""), "title": i.get("title", ""), "snippet": i.get("content", "")}
        for i in r.json().get("results", [])[:n]
    ]


_BING_BLOCK_RE = re.compile(r'<li class="b_algo"[^>]*>([\s\S]*?)</li>')
_BING_A_RE = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', re.I)
_BING_P_RE = re.compile(r"<p[^>]*>([\s\S]*?)</p>", re.I)
_BING_U_RE = re.compile(r"[?&]u=a1([^&]+)")


def _decode_bing_url(href: str) -> str:
    # bing.com/ck/a redirect links carry the real URL base64url'd in u=a1…
    m = _BING_U_RE.search(href)
    if not m:
        return href
    try:
        import base64
        s = urllib.parse.unquote(m.group(1)).replace("-", "+").replace("_", "/")
        s += "=" * (-len(s) % 4)
        return base64.b64decode(s).decode()
    except Exception:
        return href


def _bing(html: str, n: int) -> list[dict[str, Any]]:
    out = []
    for block in _BING_BLOCK_RE.findall(html):
        a = _BING_A_RE.search(block)
        if not a:
            continue
        p = _BING_P_RE.search(block)
        out.append({"url": _decode_bing_url(a.group(1).replace("&amp;", "&")),
                    "title": _unesc(a.group(2)),
                    "snippet": _unesc(p.group(1)) if p else ""})
        if len(out) >= n:
            break
    return out


async def _search_bing(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    r = await client.get("https://www.bing.com/search", params={"q": query},
                         headers={"Accept": "text/html"})
    return _bing(r.text, n) if r.status_code == 200 else []


_BRAVE_A_RE = re.compile(r'<a href="(https?://[^"]+)"[^>]*class="[^"]*\bl1\b')
_BRAVE_ANY_A_RE = re.compile(r'<a href="(https?://[^"]+)"')
_BRAVE_T_RE = re.compile(r'class="title [^"]*"[^>]*>([\s\S]*?)</div>')
_BRAVE_S_RE = re.compile(r'class="content [^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)</div>')


def _brave(html: str, n: int) -> list[dict[str, Any]]:
    # SSR cards split on <div class="snippet svelte-…">; svelte-* suffixes
    # rotate so match on the stable class tokens only.
    out = []
    for b in re.split(r'<div class="snippet svelte-[^"]*"', html)[1:]:
        a = _BRAVE_A_RE.search(b) or _BRAVE_ANY_A_RE.search(b)
        if not a:
            continue
        t = _BRAVE_T_RE.search(b)
        s = _BRAVE_S_RE.search(b)
        out.append({"url": a.group(1), "title": _unesc(t.group(1)) if t else "",
                    "snippet": _unesc(s.group(1)) if s else ""})
        if len(out) >= n:
            break
    return out


async def _search_brave(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    r = await client.get("https://search.brave.com/search",
                         params={"q": query, "source": "web"},
                         headers={"Accept": "text/html"})
    return _brave(r.text, n) if r.status_code == 200 else []


async def _search_ddg_instant(client: httpx.AsyncClient, query: str, n: int) -> list[dict[str, Any]]:
    r = await client.get(
        "https://api.duckduckgo.com/",
        params={"q": query, "format": "json", "no_html": "1", "no_redirect": "1"},
    )
    if r.status_code != 200:
        return []
    d = r.json()
    hits: list[dict[str, Any]] = []
    if d.get("AbstractURL") and d.get("AbstractText"):
        hits.append({"url": d["AbstractURL"], "title": d.get("Heading") or query,
                     "snippet": d["AbstractText"]})
    flat = [t for rt in d.get("RelatedTopics", [])
            for t in (rt.get("Topics") or [rt])]
    for t in flat:
        if len(hits) >= n or not t.get("FirstURL") or not t.get("Text"):
            continue
        hits.append({"url": t["FirstURL"], "title": t["Text"].split(" - ")[0],
                     "snippet": t["Text"]})
    return hits[:n]


async def search_web(query: str, max_results: int = 10) -> list[dict[str, Any]]:
    """Search the web — Serper first, free cascade after: searxng (if
    configured) → Bing → Brave → DDG Lite → DDG instant answers."""
    async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": _UA}) as client:
        for name, fn in (("serper", _search_serper), ("searxng", _search_searxng),
                         ("bing", _search_bing), ("brave", _search_brave),
                         ("ddg", _search_ddg_lite), ("ddg-answer", _search_ddg_instant)):
            try:
                hits = await fn(client, query, max_results)
                if hits:
                    for h in hits:
                        h["source"] = name
                    return hits
            except Exception as e:
                logger.error("web_search_provider_failed", provider=name,
                             query=query, error=str(e))
    return []
