"""Client for the public Lazynext API (/api/v1) and MCP endpoint.

Usage:
    client = LazynextApiClient(api_key="lzk_...")
    client.status()
    client.search_knowledge("deployment")
    task = client.create_task("Build a landing page")
"""
from typing import Any, Optional

import httpx


class LazynextApiClient:
    """Thin REST client for the public Lazynext API."""

    def __init__(self, api_key: str, base_url: str = "https://ai-company.lazynext.com"):
        self.base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}

    def _get(self, path: str, **params: Any) -> Any:
        r = httpx.get(f"{self.base_url}{path}", headers=self._headers, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> Any:
        r = httpx.post(f"{self.base_url}{path}", headers=self._headers, json=body, timeout=30)
        r.raise_for_status()
        return r.json()

    def status(self) -> dict:
        return self._get("/api/v1/status")

    def join_waitlist(self, email: str) -> dict:
        # Public — no API key needed. The marketing waitlist posts here.
        r = httpx.post(f"{self.base_url}/api/v1/waitlist", json={"email": email}, timeout=15)
        r.raise_for_status()
        return r.json()

    def list_briefings(self, limit: int = 20) -> list:
        return self._get("/api/v1/briefings", limit=limit)["briefings"]

    def get_briefing(self, briefing_id: int) -> dict:
        return self._get(f"/api/v1/briefings/{briefing_id}")["briefing"]

    def list_tasks(self, limit: int = 50) -> list:
        return self._get("/api/v1/tasks", limit=limit)["tasks"]

    def create_task(
        self,
        description: str,
        channel: str = "cto.tasks",
        priority: int = 0,
        acceptance_criteria: Optional[list] = None,
    ) -> dict:
        return self._post(
            "/api/v1/tasks",
            {
                "description": description,
                "channel": channel,
                "priority": priority,
                "acceptance_criteria": acceptance_criteria or [],
            },
        )

    def search_knowledge(self, query: str = "", vector: Optional[list] = None, topK: int = 5) -> list:
        return self._post(
            "/api/v1/knowledge/search", {"query": query, "vector": vector, "topK": topK}
        )["results"]

    def list_agents(self) -> list:
        return self._get("/api/v1/agents")["agents"]

    # ------------------------------------------------------------- MCP ----

    def mcp_call(self, method: str, params: Optional[dict] = None, req_id: int = 1) -> dict:
        """Raw JSON-RPC call to the /mcp endpoint (spec 2026-07-28)."""
        body: dict = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            body["params"] = params
        r = httpx.post(
            f"{self.base_url}/mcp",
            headers={**self._headers, "MCP-Protocol-Version": "2026-07-28"},
            json=body,
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def mcp_tools(self) -> list:
        return self.mcp_call("tools/list")["result"]["tools"]

    def mcp_tool_call(self, name: str, arguments: Optional[dict] = None) -> dict:
        return self.mcp_call(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )["result"]
