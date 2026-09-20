"""D1-backed rolling episodic memory (7-day retention)."""

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

TTL_DAYS = 7
MAX_EVENTS_PER_SCOPE = 1000


class EventSchema(BaseModel):
    """Episodic event schema."""

    agent_id: str = ""
    event_type: str = ""
    content: str = ""
    timestamp: datetime = Field(default_factory=_utc_now)


class EpisodicMemory:
    """Episodic memory stored in D1 episodic_events table."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None
        self._company_scope = "company"

    def _get_client(self):
        if self._client is None:
            from core.cloudflare_client import CloudflareClient
            self._client = CloudflareClient()
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None

    def _agent_scope(self, agent_id: str) -> str:
        return f"agent:{agent_id}"

    def _row_to_event(self, payload: str) -> EventSchema | None:
        try:
            data = json.loads(payload)
            if "timestamp" in data and isinstance(data["timestamp"], str):
                data["timestamp"] = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
            return EventSchema(**data)
        except (json.JSONDecodeError, TypeError):
            return None

    async def _prune(self, scope: str) -> None:
        """Expire events older than TTL_DAYS and cap at MAX_EVENTS_PER_SCOPE."""
        client = self._get_client()
        cutoff = (_utc_now() - timedelta(days=TTL_DAYS)).isoformat()
        await client.aexecute(
            "DELETE FROM episodic_events WHERE scope = ? AND created_at < ?",
            [scope, cutoff],
        )
        await client.aexecute(
            """DELETE FROM episodic_events WHERE scope = ? AND id NOT IN (
                   SELECT id FROM episodic_events WHERE scope = ? ORDER BY id DESC LIMIT ?
               )""",
            [scope, scope, MAX_EVENTS_PER_SCOPE],
        )

    async def add_event(self, agent_id: str, event_type: str, content: str) -> None:
        """Add event to agent's episodic memory."""
        try:
            client = self._get_client()
            event = EventSchema(
                agent_id=agent_id,
                event_type=event_type,
                content=content,
            )
            payload = json.dumps(event.model_dump(mode="json"))
            now = _utc_now().isoformat()
            await client.aexecute(
                "INSERT INTO episodic_events (scope, payload, created_at) VALUES (?, ?, ?)",
                [self._agent_scope(agent_id), payload, now],
            )
            await client.aexecute(
                "INSERT INTO episodic_events (scope, payload, created_at) VALUES (?, ?, ?)",
                [self._company_scope, payload, now],
            )
            await self._prune(self._agent_scope(agent_id))
            await self._prune(self._company_scope)
        except Exception as e:
            logger.error("episodic_memory_add_failed", agent_id=agent_id, error=str(e))
            raise

    async def get_recent(self, agent_id: str, n: int = 20) -> list[EventSchema]:
        """Get last n events for agent, newest first."""
        try:
            client = self._get_client()
            rows = await client.aquery(
                "SELECT payload FROM episodic_events WHERE scope = ? ORDER BY id DESC LIMIT ?",
                [self._agent_scope(agent_id), n],
            )
            return [e for e in (self._row_to_event(r.get("payload", "")) for r in rows) if e]
        except Exception as e:
            logger.error("episodic_memory_get_failed", agent_id=agent_id, error=str(e))
            return []

    async def get_company_events(self, n: int = 50) -> list[EventSchema]:
        """Get last n company-wide events, newest first."""
        try:
            client = self._get_client()
            rows = await client.aquery(
                "SELECT payload FROM episodic_events WHERE scope = ? ORDER BY id DESC LIMIT ?",
                [self._company_scope, n],
            )
            return [e for e in (self._row_to_event(r.get("payload", "")) for r in rows) if e]
        except Exception as e:
            logger.error("episodic_memory_company_get_failed", error=str(e))
            return []

    async def clear_agent(self, agent_id: str) -> None:
        """Clear all events for an agent."""
        try:
            client = self._get_client()
            await client.aexecute(
                "DELETE FROM episodic_events WHERE scope = ?",
                [self._agent_scope(agent_id)],
            )
            logger.info("episodic_memory_cleared", agent_id=agent_id)
        except Exception as e:
            logger.error("episodic_memory_clear_failed", agent_id=agent_id, error=str(e))
            raise
