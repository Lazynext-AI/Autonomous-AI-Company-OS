"""Native services tools — CRM, support tickets, scheduling, storefront.

These replace third-party SaaS (HubSpot/Salesforce, Intercom/Zendesk, Calendly,
Shopify) with D1-backed services on the worker. Agents call these directly —
no external account needed. Checkout still runs through Dodo.
"""

from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


async def _call(method: str, path: str, body: dict | None = None) -> dict[str, Any]:
    """Call a native service route on the worker (admin token)."""
    s = get_settings()
    if not (s.cloudflare_api_url and s.cloudflare_api_token):
        return {"ok": False, "error": "worker not configured"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.request(
                method,
                f"{s.cloudflare_api_url.rstrip('/')}{path}",
                headers={
                    "authorization": f"Bearer {s.cloudflare_api_token}",
                    "content-type": "application/json",
                },
                json=body,
            )
            return r.json() if r.headers.get("content-type", "").startswith("application/json") else {"status": r.status_code}
    except Exception as e:
        logger.error("native_service_failed", path=path, error=str(e))
        return {"ok": False, "error": str(e)}


# --- CRM (replaces HubSpot/Salesforce/Pipedrive/Attio) ---------------------

async def add_lead(name: str, email: str = "", company: str = "", source: str = "", notes: str = "") -> dict:
    return await _call("POST", "/api/v1/crm/leads",
                       {"name": name, "email": email, "company": company, "source": source, "notes": notes})

async def list_leads() -> list[dict]:
    return (await _call("GET", "/api/v1/crm/leads")).get("rows", [])

async def update_lead(lead_id: int, status: str | None = None, notes: str | None = None) -> dict:
    return await _call("PATCH", f"/api/v1/crm/leads/{lead_id}",
                       {k: v for k, v in {"status": status, "notes": notes}.items() if v is not None})


# --- Support tickets (replaces Intercom/Zendesk) ---------------------------

async def create_ticket(subject: str, body: str = "", email: str = "", priority: str = "normal") -> dict:
    return await _call("POST", "/api/v1/support/tickets",
                       {"subject": subject, "body": body, "email": email, "priority": priority})

async def list_tickets() -> list[dict]:
    return (await _call("GET", "/api/v1/support/tickets")).get("rows", [])


# --- Scheduling (replaces Calendly) ----------------------------------------

async def book_meeting(title: str, starts_at: str, ends_at: str,
                       guest_name: str = "", guest_email: str = "") -> dict:
    return await _call("POST", "/api/v1/booking",
                       {"title": title, "starts_at": starts_at, "ends_at": ends_at,
                        "guest_name": guest_name, "guest_email": guest_email})

async def list_bookings() -> list[dict]:
    return (await _call("GET", "/api/v1/booking")).get("rows", [])


# --- Storefront (replaces Shopify; checkout via Dodo) ----------------------

async def add_store_product(name: str, price_cents: int, description: str = "",
                            dodo_product_id: str = "") -> dict:
    return await _call("POST", "/api/v1/store/products",
                       {"name": name, "price_cents": price_cents, "description": description,
                        "dodo_product_id": dodo_product_id})

async def list_store_products() -> list[dict]:
    return (await _call("GET", "/api/v1/store/products")).get("rows", [])


# --- Email marketing (replaces Mailchimp/SendGrid; sends via Brevo) ---------

async def add_contact(email: str, name: str = "", source: str = "") -> dict:
    return await _call("POST", "/api/v1/marketing/contacts",
                       {"email": email, "name": name, "source": source})

async def list_contacts() -> list[dict]:
    return (await _call("GET", "/api/v1/marketing/contacts")).get("rows", [])

async def create_campaign(name: str, subject: str, html: str) -> dict:
    return await _call("POST", "/api/v1/marketing/campaigns",
                       {"name": name, "subject": subject, "html": html})

async def send_campaign(campaign_id: int) -> dict:
    return await _call("POST", f"/api/v1/marketing/campaigns/{campaign_id}/send")

async def list_campaigns() -> list[dict]:
    return (await _call("GET", "/api/v1/marketing/campaigns")).get("rows", [])
