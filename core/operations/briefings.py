"""Founder briefings - agent-written reports stored in D1, shown on the dashboard."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


async def post_briefing(kind: str, subject: str, content: str) -> bool:
    """Insert a briefing row into D1 for the dashboard to display."""
    try:
        from core.cloudflare_client import CloudflareClient
        client = CloudflareClient()
        if not client.is_configured():
            return False

        def _insert():
            client.table("briefings").insert(
                {"kind": kind, "subject": subject, "content": content}
            ).execute()

        await asyncio.to_thread(_insert)
        logger.info("briefing_posted", kind=kind, subject=subject)
        return True
    except Exception as e:
        logger.warning("briefing_post_failed", kind=kind, error=str(e))
        return False
