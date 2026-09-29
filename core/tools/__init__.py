"""Agent tools: code executor (Cloudflare container), email (Brevo), web search (Serper), scraping (Browser Rendering)."""

from core.tools.code_executor import CodeExecutionResult, run_code
from core.tools.connectors import call_connector, connector_status, schedule_connector_post, request_native_signature
from core.tools.email_tool import send_email
from core.tools.scrape_tool import research_topic, scrape_url
from core.tools.search_tool import search_web
from core.tools.services import (
    add_contact, add_lead, add_store_product, book_meeting, create_campaign,
    create_ticket, list_bookings, list_campaigns,
    list_contacts, list_leads, list_store_products,
    list_tickets, send_campaign, update_lead,
)

__all__ = [
    "run_code",
    "CodeExecutionResult",
    "send_email",
    "search_web",
    "scrape_url",
    "research_topic",
    "call_connector",
    "connector_status",
    "schedule_connector_post",
    "request_native_signature",
    "add_lead",
    "list_leads",
    "update_lead",
    "create_ticket",
    "list_tickets",
    "book_meeting",
    "list_bookings",
    "add_store_product",
    "list_store_products",
    "add_contact",
    "list_contacts",
    "create_campaign",
    "send_campaign",
    "list_campaigns",
]
