"""Redis-backed rolling episodic memory (7-day TTL)."""

import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
import redis.asyncio as redis
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

TTL_DAYS = 7
TTL_SECONDS = TTL_DAYS * 24 * 60 * 60


class EventSchema(BaseModel):
    """Episodic event schema."""

    agent_id: str = ""
    event_type: str = ""
    content: str = ""
    timestamp: datetime = Field(default_factory=_utc_now)


class EpisodicMemory:
    """Redis-backed rolling memory with 7-day TTL."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._redis: redis.Redis | None = None
        self._key_prefix = "episodic:"
        self._company_key = "episodic:company"

    async def _get_redis(self) -> redis.Redis:
        """Get or create Redis connection."""
        if self._redis is None:
            self._redis = redis.from_url(
                self._settings.redis_url,
                decode_responses=True,
            )
        return self._redis

    async def close(self) -> None:
        """Close Redis connection."""
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    def _agent_key(self, agent_id: str) -> str:
        return f"{self._key_prefix}agent:{agent_id}"

    async def add_event(self, agent_id: str, event_type: str, content: str) -> None:
        """Add event to agent's episodic memory."""
        try:
            r = await self._get_redis()
            event = EventSchema(
                agent_id=agent_id,
                event_type=event_type,
                content=content,
            )
            key = self._agent_key(agent_id)
            data = event.model_dump(mode="json")  # mode="json" already serializes datetime to str
            await r.lpush(key, json.dumps(data))
            await r.ltrim(key, 0, 999)  # Keep last 1000 events
            await r.expire(key, TTL_SECONDS)

            # Also add to company-wide feed
            await r.lpush(self._company_key, json.dumps(data))
            await r.ltrim(self._company_key, 0, 999)
            await r.expire(self._company_key, TTL_SECONDS)
        except redis.RedisError as e:
            logger.error("episodic_memory_add_failed", agent_id=agent_id, error=str(e))
            raise

    async def get_recent(self, agent_id: str, n: int = 20) -> list[EventSchema]:
        """Get last n events for agent."""
        try:
            r = await self._get_redis()
            key = self._agent_key(agent_id)
            raw = await r.lrange(key, 0, n - 1)
            events = []
            for item in raw:
                try:
                    data = json.loads(item)
                    if "timestamp" in data and isinstance(data["timestamp"], str):
                        data["timestamp"] = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
                    events.append(EventSchema(**data))
                except (json.JSONDecodeError, TypeError):
                    continue
            return events
        except redis.RedisError as e:
            logger.error("episodic_memory_get_failed", agent_id=agent_id, error=str(e))
            return []

    async def get_company_events(self, n: int = 50) -> list[EventSchema]:
        """Get last n company-wide events."""
        try:
            r = await self._get_redis()
            raw = await r.lrange(self._company_key, 0, n - 1)
            events = []
            for item in raw:
                try:
                    data = json.loads(item)
                    if "timestamp" in data and isinstance(data["timestamp"], str):
                        data["timestamp"] = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
                    events.append(EventSchema(**data))
                except (json.JSONDecodeError, TypeError):
                    continue
            return events
        except redis.RedisError as e:
            logger.error("episodic_memory_company_get_failed", error=str(e))
            return []

    async def clear_agent(self, agent_id: str) -> None:
        """Clear all events for an agent."""
        try:
            r = await self._get_redis()
            await r.delete(self._agent_key(agent_id))
            logger.info("episodic_memory_cleared", agent_id=agent_id)
        except redis.RedisError as e:
            logger.error("episodic_memory_clear_failed", agent_id=agent_id, error=str(e))
            raise
