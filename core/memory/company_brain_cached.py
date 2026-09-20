"""Cached company brain - Workers KV cache with 60s TTL to reduce D1 reads."""

import json
from typing import Any

import structlog

from core.memory.company_brain import CompanyBrain, CompanyBrainSchema

logger = structlog.get_logger(__name__)

CACHE_KEY = "company_brain:cache"
CACHE_TTL = 60


class CachedCompanyBrain(CompanyBrain):
    """Company brain with Workers KV cache layer."""

    def __init__(self) -> None:
        super().__init__()
        self._cache_client = None

    def _get_cache(self):
        if self._cache_client is None:
            try:
                from core.cloudflare_client import CloudflareClient
                c = CloudflareClient()
                if c.is_configured():
                    self._cache_client = c
            except Exception as e:
                logger.warning("company_brain_cache_init_failed", error=str(e))
        return self._cache_client

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
        """Get from KV cache first, fallback to D1."""
        cache = self._get_cache()
        if cache:
            try:
                cached = await cache.kv_get(CACHE_KEY)
                if cached:
                    schema = self._cache_to_schema(cached)
                    if schema:
                        return schema
            except Exception:
                pass

        result = await super().get()

        if cache:
            try:
                await cache.kv_put(CACHE_KEY, self._schema_to_cache(result), ttl=CACHE_TTL)
            except Exception:
                pass

        return result

    async def update_field(self, field: str, value: Any) -> None:
        """Update D1 and invalidate cache."""
        await super().update_field(field, value)
        cache = self._get_cache()
        if cache:
            try:
                await cache.kv_delete(CACHE_KEY)
            except Exception:
                pass
