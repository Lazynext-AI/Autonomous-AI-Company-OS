"""Enrich crm_leads rows missing `email` with public business contacts.

Pipeline per lead (qualified, no email):
  1. Plain GET of the company's homepage + common contact paths; collect
     mailto: links and bare addresses from the HTML.
  2. Platform /scrape (Browser Rendering) on the contact page when the
     static HTML yields nothing — catches JS-rendered contact blocks.
  3. Serper site-search for an explicit contact/about page when the
     guesses miss.
Deep mode (--deep) retries the dead ends with a wider path list (team,
press, careers, legal pages), mailbox-snippet Serper queries, and a
Wayback CDX fallback for bot-protected pages (stale-address risk: the
evidence is tagged `wayback:` so the CRM reviewer can judge freshness).
First plausible business address wins; junk (noreply, sentry, example,
cdn/image hosts, unrelated third parties) is filtered. Writes only
public, company-published contacts — the same rule the original
serper-prospecting seed used.

Usage:
  set -a; source .env; set +a
  .venv/bin/python scripts/enrich_crm_contacts.py [--dry-run] [--limit N] [--deep]
"""

import argparse
import concurrent.futures as cf
import json
import re
import sys
import urllib.error
import urllib.request
from html import unescape
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(__file__).rsplit("/scripts/", 1)[0])
from core.config import get_settings  # noqa: E402

settings = get_settings()
API = settings.cloudflare_api_url.rstrip("/")
TOKEN = settings.cloudflare_api_token
SERPER = settings.serper_api_key

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

CONTACT_PATHS = [
    "/contact", "/contact-us", "/contactus", "/pages/contact", "/about",
    "/about-us", "/company/contact", "/support", "/get-in-touch",
]

# Second-pass-only paths (--deep): team, press, careers and legal pages
# often carry real mailboxes; privacy@/careers@ land in JUNK/DEPRIORITIZED
# anyway so they can only help, never poison.
DEEP_PATHS = [
    "/team", "/our-team", "/about/team", "/about-us/team", "/leadership",
    "/people", "/staff", "/who-we-are", "/meet-the-team",
    "/careers", "/jobs", "/work-with-us", "/join-us",
    "/press", "/media", "/news", "/newsroom",
    "/company", "/agency", "/studio", "/work", "/services", "/expertise",
    "/privacy", "/privacy-policy", "/terms", "/legal", "/impressum",
    "/locations", "/offices", "/en/contact", "/en/about",
]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
MAILTO_RE = re.compile(r'mailto:([^"\'>?\s]+)', re.I)

# Addresses that are never a usable business contact.
JUNK_LOCAL = re.compile(
    r"^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|"
    r"webmaster|hostmaster|abuse|privacy|dpo|legal|unsubscribe|bounce|"
    r"newsletter|marketing@|email@|user@|name@|your@|you@|example|test|"
    r"admin@2x|sentry|error|root|daemon|null|void|feedback@sentry)",
    re.I,
)
JUNK_DOMAIN = re.compile(
    r"(sentry\.io|wixpress\.com|example\.|sentry-|ucarecdn|2x\.|@2x\.|"
    r"godaddy|squarespace|shopify|wordpress|wpengine|cloudflare|"
    r"googleapis|gstatic|w3\.org|schema\.org|facebook|instagram|twitter|"
    r"linkedin\.com|youtube|github|npmjs|cdn|placeholder|domain\.com|"
    r"email\.com|yourdomain|company\.com|sitename|website\.com)",
    re.I,
)
# Obfuscation artefacts and image filenames (name@2x.png, logo@3x.jpg).
JUNK_TLD = re.compile(r"\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?)$", re.I)

GENERIC_LOCAL = re.compile(
    r"^(info|hello|hi|contact|sales|support|help|team|office|enquiries|"
    r"inquiries|mail|connect|reach|sayhello|getintouch|talk|business|"
    r"partners|service|services|admin)@",
    re.I,
)
# Published but not buyer-facing — kept only as last resort.
DEPRIORITIZED_LOCAL = re.compile(
    r"^(careers|jobs|press|media|hr|recruiting|security|dataprivacy|"
    r"dpo|gdpr|compliance)@",
    re.I,
)


def fetch(url: str, timeout: int = 15) -> tuple[int, str, str]:
    """Return (status, final_url, html). Follows redirects via urllib."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ctype = r.headers.get("content-type", "")
            body = r.read(600_000).decode("utf-8", "replace") if "text" in ctype or "html" in ctype or ctype == "" else ""
            return r.status, r.geturl(), body
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception:
        return 0, url, ""


def worker_post(path: str, payload: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "enrich/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read()[:200]}"}
    except Exception as e:
        return {"error": str(e)}


def brand_token(domain: str) -> str:
    """First-label brand stem, e.g. 'outerboxdesign.com' -> 'outerboxdesign'."""
    return domain.split(".")[0].replace("-", "")


def domains_related(own: str, other: str) -> bool:
    """True when the email domain plausibly belongs to the same company —
    one brand stem inside the other ('outerboxdesign.com' ~ 'outerbox.com')."""
    a, b = brand_token(own), brand_token(other)
    if len(a) >= 4 and (a in b or b in a):
        return True
    return False


def extract_emails(html: str, own_domain: str) -> list[str]:
    """Ranked business emails found in HTML — own-domain and generic first.
    Third-party domains are dropped unless they share the company's brand
    stem — page prose is full of bylines/testimonial addresses that are not
    the company's contact."""
    found: set[str] = set()
    for m in MAILTO_RE.findall(html):
        found.add(unescape(m).strip().lower())
    for m in EMAIL_RE.findall(html):
        found.add(m.strip(".,;:!?)('\"<>").lower())

    def plausible(e: str) -> bool:
        local, _, dom = e.partition("@")
        if not dom or JUNK_TLD.search(e):
            return False
        if JUNK_LOCAL.match(e) or JUNK_DOMAIN.search(e):
            return False
        if len(local) > 40 or len(e) > 80:
            return False
        if not e.endswith("@" + own_domain) and not domains_related(own_domain, dom):
            return False
        return True

    emails = [e for e in found if plausible(e)]
    depri = [e for e in emails if DEPRIORITIZED_LOCAL.match(e)]
    active = [e for e in emails if e not in depri]
    own = [e for e in active if e.endswith("@" + own_domain)]
    gen = [e for e in active if GENERIC_LOCAL.match(e) and e not in own]
    rest = [e for e in active if e not in own and e not in gen]
    return own + gen + rest + depri


def serper(query: str) -> list[dict]:
    if not SERPER:
        return []
    req = urllib.request.Request(
        "https://google.serper.dev/search",
        data=json.dumps({"q": query, "num": 8}).encode(),
        headers={"X-API-KEY": SERPER, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return []
    return data.get("organic", [])


def serper_contact_page(domain: str) -> str | None:
    """Best contact/about URL for the domain via Serper, or None."""
    for hit in serper(f"site:{domain} contact OR about"):
        link = hit.get("link", "")
        if urlparse(link).netloc.replace("www.", "").endswith(domain):
            if re.search(r"contact|about|team|company|support", link, re.I):
                return link
    return None


def serper_own_domain_email(domain: str) -> str | None:
    """Own-domain address surfaced in search snippets — catches companies
    whose contact page is form-only but whose mailbox is quoted elsewhere
    (directories, docs, footers of partner sites)."""
    for hit in serper(f'"{domain}" email contact'):
        text = f"{hit.get('title','')} {hit.get('snippet','')}"
        for e in extract_emails(text, domain):
            return e
    return None


def serper_mailbox_email(domain: str) -> str | None:
    """Deep mode: search snippets quoting common own-domain mailboxes —
    catches addresses listed in directories/profile pages even when the
    site's own pages are form-only or bot-protected."""
    for hit in serper(
        f'"{domain}" "contact@{domain}" OR "info@{domain}" OR "hello@{domain}"'
    ):
        text = f"{hit.get('title','')} {hit.get('snippet','')}"
        for e in extract_emails(text, domain):
            return e
    return None


def wayback_fetch(domain: str, pattern: str) -> str:
    """Deep mode: raw HTML of the latest archived snapshots matching a
    path pattern (contact*/about*/team*), or "". Reaches pages whose live
    version is bot-protected or form-only."""
    cdx = (
        "https://web.archive.org/cdx/search/cdx?"
        f"url={domain}/{pattern}&fl=timestamp,original"
        "&filter=statuscode:200&collapse=digest&limit=-3&output=json"
    )
    req = urllib.request.Request(cdx, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read().decode())
    except Exception:
        return ""
    for ts, orig in rows[1:] if len(rows) > 1 else []:
        # `id_` serves the archived page without Wayback's injected chrome.
        _, _, html = fetch(f"https://web.archive.org/web/{ts}id_/{orig}", timeout=25)
        if html:
            return html
    return ""


def find_contact_deep(company: str) -> tuple[str | None, str]:
    """Deep-mode fallbacks for leads the standard pipeline missed."""
    domain = company.strip().lower().replace("www.", "")
    base = f"https://{domain}"

    for path in DEEP_PATHS:
        status, final, html = fetch(urljoin(base, path))
        if status >= 400 or not html:
            continue
        emails = extract_emails(html, domain)
        if emails:
            return emails[0], final

    email = serper_mailbox_email(domain)
    if email:
        return email, f"serper-mailbox:{domain}"

    for pattern in ("contact*", "about*", "team*"):
        html = wayback_fetch(domain, pattern)
        if html:
            emails = extract_emails(html, domain)
            if emails:
                return emails[0], f"wayback:{domain}/{pattern.rstrip('*')}"
    return None, ""


def scrape_rendered(url: str) -> str:
    """Rendered main-text via the platform /scrape endpoint."""
    res = worker_post("/scrape", {"url": url, "max_chars": 20000}, timeout=90)
    return res.get("markdown", "") or ""


def find_contact(company: str) -> tuple[str | None, str]:
    """Return (email, evidence_url). Tries cheap fetches first."""
    domain = company.strip().lower().replace("www.", "")
    base = f"https://{domain}"

    candidates = [base] + [urljoin(base, p) for p in CONTACT_PATHS]
    for url in candidates:
        status, final, html = fetch(url)
        if status >= 400 or not html:
            continue
        emails = extract_emails(html, domain)
        if emails:
            return emails[0], final

    # Serper → rendered scrape on the best contact URL.
    contact_url = serper_contact_page(domain)
    for url in [contact_url, f"{base}/contact"]:
        if not url:
            continue
        text = scrape_rendered(url)
        if text:
            emails = extract_emails(text, domain)
            if emails:
                return emails[0], url

    # Last resort: own-domain address quoted in open-web snippets.
    email = serper_own_domain_email(domain)
    if email:
        return email, f"serper-snippet:{domain}"
    return None, ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--deep", action="store_true",
                    help="retry dead ends with DEEP_PATHS + mailbox snippets + Wayback")
    args = ap.parse_args()

    res = worker_post("/query", {
        "sql": "SELECT id, company, name FROM crm_leads "
               "WHERE status='qualified' AND (email IS NULL OR email='') "
               "ORDER BY id"
    })
    leads = res.get("results", [])
    if args.limit:
        leads = leads[: args.limit]
    print(f"{len(leads)} qualified leads missing email")

    def work(lead):
        email, ev = find_contact(lead["company"])
        if not email and args.deep:
            email, ev = find_contact_deep(lead["company"])
        return lead, email, ev

    updated, failed = 0, []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for lead, email, ev in ex.map(work, leads):
            if not email:
                failed.append(lead["company"])
                continue
            note = (
                f"Public business contact published on company site. "
                f"Enriched via enrich_crm_contacts.py. Source: {ev}"
            )
            print(f"  {lead['company']:45s} -> {email}")
            if not args.dry_run:
                r = worker_post("/query", {
                    "sql": "UPDATE crm_leads SET email=?, notes=notes||' | '||?, "
                           "updated_at=datetime('now') WHERE id=?",
                    "params": [email, note, lead["id"]],
                })
                if "error" in r:
                    print(f"    UPDATE failed: {r['error']}")
                    failed.append(lead["company"])
                    continue
            updated += 1

    print(f"\nEnriched: {updated}/{len(leads)}")
    if failed:
        print("No public contact found:", ", ".join(failed))


if __name__ == "__main__":
    main()
