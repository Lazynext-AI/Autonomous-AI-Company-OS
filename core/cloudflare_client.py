"""Cloudflare Worker client - D1 (fluent SQL), KV cache, bus, Vectorize.

Drop-in replacement for the old SupabaseClient: the fluent Table API is kept
synchronous (callers wrap it in asyncio.to_thread) while bus/kv/vectorize
helpers are async for the hot polling paths.
"""

import json
from datetime import date, datetime
from typing import Any

import httpx
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

# Columns storing JSON as TEXT; decoded on read, encoded on write.
JSON_COLUMNS: dict[str, set[str]] = {
    "company_brain": {
        "tech_stack", "live_urls", "current_sprint", "metrics", "open_bugs",
        "shipped_features", "user_feedback", "agent_statuses", "blockers",
    },
    "agent_memories": {
        "current_task", "tasks_completed", "tasks_failed", "patterns_learned",
        "reward_history", "correction_history",
    },
    "task_log": {"error_log"},
}


def _encode(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


class CloudflareClient:
    """Client for the ai-company-os Worker (D1 + KV + bus + Vectorize)."""

    def __init__(self) -> None:
        s = get_settings()
        self.url = (s.cloudflare_api_url or "").rstrip("/")
        self.token = s.cloudflare_api_token or ""
        self._headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        self._async_client: httpx.AsyncClient | None = None

    def is_configured(self) -> bool:
        return bool(self.url and self.token)

    # --- sync path (fluent Table API, runs inside asyncio.to_thread) ---

    def _post_sync(self, path: str, body: dict) -> dict:
        with httpx.Client(timeout=30.0) as http:
            r = http.post(f"{self.url}{path}", headers=self._headers, json=body)
            r.raise_for_status()
            return r.json()

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        """Run a read query, returning rows with JSON columns decoded."""
        res = self._post_sync("/query", {"sql": sql, "params": params or []})
        return res.get("results", [])

    def execute(self, sql: str, params: list | None = None) -> dict:
        """Run a write statement, returning D1 meta."""
        return self._post_sync("/query", {"sql": sql, "params": params or []})

    def table(self, name: str) -> "Table":
        return Table(self, name)

    # --- async path ---

    async def _get_async(self) -> httpx.AsyncClient:
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient(timeout=30.0, headers=self._headers)
        return self._async_client

    async def close(self) -> None:
        if self._async_client and not self._async_client.is_closed:
            await self._async_client.aclose()
            self._async_client = None

    async def _post(self, path: str, body: dict) -> dict:
        client = await self._get_async()
        r = await client.post(f"{self.url}{path}", json=body)
        r.raise_for_status()
        return r.json()

    async def aquery(self, sql: str, params: list | None = None) -> list[dict]:
        res = await self._post("/query", {"sql": sql, "params": params or []})
        return res.get("results", [])

    async def aexecute(self, sql: str, params: list | None = None) -> dict:
        return await self._post("/query", {"sql": sql, "params": params or []})

    async def abatch(self, statements: list[tuple[str, list]]) -> list[dict]:
        """Run multiple statements via D1 batch. Each item is (sql, params)."""
        res = await self._post(
            "/batch",
            {"statements": [{"sql": s, "params": p} for s, p in statements]},
        )
        return res.get("results", [])

    # --- message bus ---

    async def bus_publish(self, channel: str, payload: str) -> str:
        res = await self._post("/bus/publish", {"channel": channel, "payload": payload})
        return str(res.get("id", "0"))

    async def bus_poll(
        self, channel: str, group: str, consumer: str, count: int = 10, wait_ms: int = 3000
    ) -> list[dict]:
        res = await self._post(
            "/bus/poll",
            {
                "channel": channel, "group": group, "consumer": consumer,
                "count": count, "wait_ms": wait_ms,
            },
        )
        return res.get("messages", [])

    async def bus_ack(self, channel: str, group: str, ids: list[str]) -> None:
        await self._post("/bus/ack", {"channel": channel, "group": group, "ids": ids})

    async def bus_pending(self, channel: str) -> int:
        res = await self._post("/bus/pending", {"channel": channel})
        return int(res.get("count", 0))

    async def bus_ensure_groups(self, channels: list[str], group: str) -> None:
        await self._post("/bus/ensure", {"channels": channels, "group": group})

    # --- KV cache ---

    async def kv_get(self, key: str) -> str | None:
        res = await self._post("/kv/get", {"key": key})
        return res.get("value")

    async def kv_put(self, key: str, value: str, ttl: int = 60) -> None:
        await self._post("/kv/put", {"key": key, "value": value, "ttl": ttl})

    async def kv_delete(self, key: str) -> None:
        await self._post("/kv/delete", {"key": key})

    # --- Vectorize ---

    async def vectorize_upsert(self, vectors: list[dict]) -> int:
        res = await self._post("/vectorize/upsert", {"vectors": vectors})
        return int(res.get("count", 0))

    async def vectorize_query(
        self, vector: list[float], top_k: int = 5, filter: dict | None = None
    ) -> list[dict]:
        res = await self._post(
            "/vectorize/query", {"vector": vector, "topK": top_k, "filter": filter}
        )
        return res.get("matches", [])

    async def vectorize_delete(self, ids: list[str]) -> None:
        await self._post("/vectorize/delete", {"ids": ids})


def _decode_row(table: str, row: dict) -> dict:
    json_cols = JSON_COLUMNS.get(table)
    if not json_cols:
        return row
    out = dict(row)
    for col in json_cols:
        v = out.get(col)
        if isinstance(v, str):
            try:
                out[col] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return out


class Table:
    def __init__(self, client: CloudflareClient, name: str) -> None:
        self._client = client
        self._name = name

    def select(self, columns: str = "*") -> "QueryBuilder":
        return QueryBuilder(self._client, self._name).select(columns)

    def insert(self, data: dict | list) -> "InsertBuilder":
        return InsertBuilder(self._client, self._name, data)

    def update(self, data: dict) -> "UpdateBuilder":
        return UpdateBuilder(self._client, self._name, data)

    def eq(self, column: str, value: Any) -> "QueryBuilder":
        return QueryBuilder(self._client, self._name).eq(column, value)


class QueryBuilder:
    def __init__(self, client: CloudflareClient, name: str) -> None:
        self._client = client
        self._name = name
        self._select = "*"
        self._where: list[tuple[str, str, Any]] = []
        self._order = ""
        self._limit: int | None = None

    def select(self, columns: str) -> "QueryBuilder":
        self._select = columns
        return self

    def eq(self, column: str, value: Any) -> "QueryBuilder":
        self._where.append((column, "=", value))
        return self

    def lt(self, column: str, value: Any) -> "QueryBuilder":
        self._where.append((column, "<", value))
        return self

    def gte(self, column: str, value: Any) -> "QueryBuilder":
        self._where.append((column, ">=", value))
        return self

    def order(self, column: str, ascending: bool = True) -> "QueryBuilder":
        direction = "ASC" if ascending else "DESC"
        self._order = f"{self._order}, {column} {direction}" if self._order else f"{column} {direction}"
        return self

    def limit(self, n: int) -> "QueryBuilder":
        self._limit = n
        return self

    def execute(self) -> "Result":
        cols = ", ".join(c.strip() for c in self._select.split(",")) if self._select != "*" else "*"
        sql = f"SELECT {cols} FROM {self._name}"
        params: list = []
        if self._where:
            clauses = []
            for col, op, val in self._where:
                clauses.append(f"{col} {op} ?")
                params.append(_encode(val))
            sql += " WHERE " + " AND ".join(clauses)
        if self._order:
            sql += f" ORDER BY {self._order}"
        if self._limit is not None:
            sql += f" LIMIT {int(self._limit)}"
        rows = self._client.query(sql, params)
        return Result([_decode_row(self._name, r) for r in rows])


class UpdateBuilder:
    def __init__(self, client: CloudflareClient, name: str, data: dict) -> None:
        self._client = client
        self._name = name
        self._data = data
        self._where: list[tuple[str, Any]] = []

    def eq(self, column: str, value: Any) -> "UpdateBuilder":
        self._where.append((column, value))
        return self

    def execute(self) -> "Result":
        if not self._data:
            return Result([])
        sets = ", ".join(f"{k} = ?" for k in self._data)
        params = [_encode(v) for v in self._data.values()]
        sql = f"UPDATE {self._name} SET {sets}"
        if self._where:
            sql += " WHERE " + " AND ".join(f"{c} = ?" for c, _ in self._where)
            params.extend(_encode(v) for _, v in self._where)
        res = self._client.execute(sql, params)
        return Result(res.get("meta", {}).get("changes", 0))


class InsertBuilder:
    def __init__(self, client: CloudflareClient, name: str, data: dict | list) -> None:
        self._client = client
        self._name = name
        self._rows = data if isinstance(data, list) else [data]

    def execute(self) -> "Result":
        if not self._rows:
            return Result([])
        cols = list(self._rows[0].keys())
        placeholders = "(" + ", ".join("?" for _ in cols) + ")"
        sql = f"INSERT INTO {self._name} ({', '.join(cols)}) VALUES " + ", ".join(
            placeholders for _ in self._rows
        )
        params = [_encode(row.get(c)) for row in self._rows for c in cols]
        res = self._client.execute(sql, params)
        return Result(res.get("meta", {}).get("changes", 0))


class Result:
    def __init__(self, data: Any) -> None:
        self.data = data if isinstance(data, list) else [data] if data else []
