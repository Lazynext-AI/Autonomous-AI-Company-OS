"""Lightweight Supabase client using httpx (avoids supabase package build issues)."""

from typing import Any

import httpx

from core.config import get_settings


class SupabaseClient:
    """Minimal Supabase REST client for table operations."""

    def __init__(self) -> None:
        s = get_settings()
        self.url = (s.supabase_url or "").rstrip("/")
        self.key = s.supabase_service_key or s.supabase_anon_key
        self._headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def is_configured(self) -> bool:
        return bool(self.url and self.key)

    def _path(self, table: str) -> str:
        return f"{self.url}/rest/v1/{table}"

    def table(self, name: str) -> "Table":
        return Table(self, name)


class Table:
    def __init__(self, client: SupabaseClient, name: str) -> None:
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
    def __init__(self, client: SupabaseClient, name: str) -> None:
        self._client = client
        self._name = name
        self._select = "*"
        self._params: dict[str, str] = {}

    def select(self, columns: str) -> "QueryBuilder":
        self._select = columns
        return self

    def eq(self, column: str, value: Any) -> "QueryBuilder":
        self._params[column] = f"eq.{value}"
        return self

    def lt(self, column: str, value: Any) -> "QueryBuilder":
        self._params[column] = f"lt.{value}"
        return self

    def gte(self, column: str, value: Any) -> "QueryBuilder":
        """Greater than or equal filter."""
        self._params[column] = f"gte.{value}"
        return self

    def order(self, column: str, ascending: bool = True) -> "QueryBuilder":
        """Order results by column."""
        order_param = f"{column}.{'asc' if ascending else 'desc'}"
        if "order" in self._params:
            self._params["order"] += f",{order_param}"
        else:
            self._params["order"] = order_param
        return self

    def limit(self, n: int) -> "QueryBuilder":
        self._params["limit"] = str(n)
        return self

    def execute(self) -> "Result":
        params = {"select": self._select}
        for k, v in self._params.items():
            if k == "limit":
                params["limit"] = v
            elif k == "order":
                params["order"] = v
            else:
                params[k] = v
        with httpx.Client(timeout=30.0) as http:
            r = http.get(
                self._client._path(self._name),
                headers={**self._client._headers, "Accept": "application/json"},
                params=params,
            )
            r.raise_for_status()
            data = r.json() if r.content else []
            return Result(data if isinstance(data, list) else [data] if data else [])


class UpdateBuilder:
    def __init__(self, client: SupabaseClient, name: str, data: dict) -> None:
        self._client = client
        self._name = name
        self._data = data
        self._params: dict[str, str] = {}

    def eq(self, column: str, value: Any) -> "UpdateBuilder":
        self._params[column] = f"eq.{value}"
        return self

    def execute(self) -> "Result":
        with httpx.Client(timeout=30.0) as http:
            r = http.patch(
                self._client._path(self._name),
                headers=self._client._headers,
                json=self._data,
                params=self._params,
            )
            r.raise_for_status()
            return Result(r.json() if r.content else [])


class InsertBuilder:
    def __init__(self, client: SupabaseClient, name: str, data: dict | list) -> None:
        self._client = client
        self._name = name
        self._data = data

    def execute(self) -> "Result":
        with httpx.Client(timeout=30.0) as http:
            r = http.post(
                self._client._path(self._name),
                headers=self._client._headers,
                json=self._data,
            )
            r.raise_for_status()
            data = r.json() if r.content else []
            return Result(data if isinstance(data, list) else [data] if data else [])


class Result:
    def __init__(self, data: Any) -> None:
        self.data = data if isinstance(data, list) else [data] if data else []
