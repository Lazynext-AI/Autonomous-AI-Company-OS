"""Cached company brain - Redis cache with 60s TTL to reduce Supabase reads."""

import json
from typing import Any

import redis.asyncio as redis
import structlog

from core.config import get_settings
from core.memory.company_brain import CompanyBrain, CompanyBrainSchema

logger = structlog.get_logger(__name__)

CACHE_KEY = "company_brain:cache"
CACHE_TTL = 60


class CachedCompanyBrain(CompanyBrain):
    """Company brain with Redis cache layer."""

    def __init__(self) -> None:
        super().__init__()
        self._redis: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis | None:
        if self._redis is None:
            try:
                self._redis = redis.from_url(
                    get_settings().redis_url,
                    decode_responses=True,
                )
            except Exception as e:
                logger.warning("company_brain_cache_redis_failed", error=str(e))
        return self._redis

    def _schema_to_cache(self, schema: CompanyBrainSchema) -> str:
        data = schema.model_dump(mode="json")
        for k, v in data.items():
            if hasattr(v, "model_dump"):
                data[k] = v.model_dump() if callable(getattr(v, "model_dump", None)) else str(v)
            elif isinstance(v, list) and v and hasattr(v[0], "model_dump"):
                data[k] = [x.model_dump() if hasattr(x, "model_dump") else x for x in v]
        return json.dumps(data, default=str)

    def _cache_to_schema(self, raw: str) -> CompanyBrainSchema | None:
        try:
            data = json.loads(raw)
            return CompanyBrainSchema(**data)
        except (json.JSONDecodeError, TypeError):
            return None

    async def get(self) -> CompanyBrainSchema:
        """Get from cache first, fallback to Supabase."""
        r = await self._get_redis()
        if r:
            try:
                cached = await r.get(CACHE_KEY)
                if cached:
                    schema = self._cache_to_schema(cached)
                    if schema:
                        return schema
            except redis.RedisError:
                pass

        result = await super().get()

        if r:
            try:
                await r.setex(
                    CACHE_KEY,
                    CACHE_TTL,
                    self._schema_to_cache(result),
                )
            except redis.RedisError:
                pass

        return result

    async def update_field(self, field: str, value: Any) -> None:
        """Update Supabase and invalidate cache."""
        await super().update_field(field, value)
        r = await self._get_redis()
        if r:
            try:
                await r.delete(CACHE_KEY)
            except redis.RedisError:
                pass
