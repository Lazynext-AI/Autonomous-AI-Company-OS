"""Web search tool — Serper.dev (real Google results) with a zero-cred
fallback chain so agent research never hard-fails on a paid provider's 402:
serper → DDG Lite scrape → DDG instant answers. Mirror of
worker/src/websearch.ts — keep the chains in sync.
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
    for k, v in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'),
                 ("&#x27;", "'"), ("&#39;", "'")):
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
    """Search the web — Serper first, free DuckDuckGo fallbacks after."""
    async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": _UA}) as client:
        for name, fn in (("serper", _search_serper), ("ddg", _search_ddg_lite),
                         ("ddg-answer", _search_ddg_instant)):
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
