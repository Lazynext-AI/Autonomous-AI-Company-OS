"""Deadlock detector - cron job for stuck agents and health checks."""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from core.config import get_settings
from core.messaging.bus import MessageBus
from core.messaging.channels import Channels
from core.messaging.schemas import HRRequestMessage

logger = structlog.get_logger(__name__)


class DeadlockDetector:
    """Detect stuck agents, backlog, and health issues."""

    def __init__(self, message_bus: MessageBus) -> None:
        self.message_bus = message_bus
        self._settings = get_settings()

    async def run_check(self) -> None:
        """Run all health checks."""
        await self._check_stuck_agents()
        await self._check_message_backlog()
        await self._check_model_availability()
        await self._check_connections()

    async def _check_stuck_agents(self) -> None:
        try:
            if not self._settings.cloudflare_api_url:
                return
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if not client.is_configured():
                return
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
            def _run():
                return client.table("task_log").select("task_id,agent_id").eq("status", "in_progress").lt("started_at", cutoff).execute()
            r = await asyncio.to_thread(_run)
            for row in (r.data or []):
                await self.message_bus.publish(
                    Channels.HR_REQUESTS,
                    HRRequestMessage(
                        from_agent="deadlock_detector",
                        request_type="reassign",
                        role_needed=row.get("agent_id", ""),
                        reason=f"Stuck on task {row.get('task_id', '')} for 2+ hours",
                    ),
                )
                logger.warning("stuck_agent_detected", **row)
        except Exception as e:
            logger.error("stuck_agents_check_failed", error=str(e))

    async def _check_message_backlog(self) -> None:
        for channel in Channels:
            count = await self.message_bus.get_pending_count(channel)
            if count > 50:
                logger.warning("message_backlog", channel=channel.value, count=count)

    async def _check_model_availability(self) -> None:
        """Check the Cloudflare Workers AI brain is configured."""
        try:
            if not (self._settings.cloudflare_api_url and self._settings.cloudflare_api_token):
                logger.warning("workers_ai_not_configured")
        except Exception as e:
            logger.error("brain_check_failed", error=str(e))

    async def _check_connections(self) -> None:
        """Check the Cloudflare Worker is reachable."""
        try:
            if not self._settings.cloudflare_api_url:
                logger.warning("cloudflare_api_url_not_set")
                return
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as http:
                r = await http.get(
                    f"{self._settings.cloudflare_api_url.rstrip('/')}/health",
                    headers={"Authorization": f"Bearer {self._settings.cloudflare_api_token}"},
                )
                if r.status_code != 200:
                    logger.error("cloudflare_worker_unhealthy", status=r.status_code)
        except Exception as e:
            logger.error("cloudflare_check_failed", error=str(e))
