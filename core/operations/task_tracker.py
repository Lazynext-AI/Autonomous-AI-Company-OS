"""Task lifecycle tracker backed by D1 task_log via Cloudflare Worker."""

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog

from core.cloudflare_client import CloudflareClient

logger = structlog.get_logger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskTracker:
    """Create and update task lifecycle rows in task_log."""

    def __init__(self) -> None:
        self._client = CloudflareClient()

    def is_enabled(self) -> bool:
        return self._client.is_configured()

    async def _run_sync(self, fn, *args, **kwargs):
        if not self.is_enabled():
            return None
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as e:
            logger.warning("task_tracker_operation_failed", error=str(e))
            return None

    async def get_task(self, task_id: str) -> dict[str, Any] | None:
        """Fetch one task_log row by task_id."""

        def _fetch():
            r = self._client.table("task_log").select("*").eq("task_id", task_id).limit(1).execute()
            if r.data:
                return r.data[0]
            return None

        return await self._run_sync(_fetch)

    async def get_tasks_by_status(self, status: str, limit: int = 100) -> list[dict[str, Any]]:
        """Fetch task_log rows by status."""

        def _fetch():
            r = self._client.table("task_log").select("*").eq("status", status).limit(limit).execute()
            return r.data or []

        return await self._run_sync(_fetch)

    async def find_by_description(self, fragment: str) -> list[dict[str, Any]]:
        """Fetch task_log rows whose description contains fragment, any status."""

        def _fetch():
            r = (
                self._client.table("task_log")
                .select("task_id, description, status")
                .like("description", f"%{fragment}%")
                .limit(20)
                .execute()
            )
            return r.data or []

        return await self._run_sync(_fetch)

    async def create_task(
        self,
        task_id: str,
        agent_id: str,
        description: str,
        status: str = "pending",
        attempts: int = 0,
    ) -> None:
        """Insert a task row if missing; otherwise update key fields."""
        if not self.is_enabled():
            return
        row = await self.get_task(task_id)
        if row is not None:
            await self.update_task(task_id, agent_id=agent_id, description=description[:4000], status=status)
            return

        payload = {
            "task_id": task_id,
            "agent_id": agent_id,
            "description": description[:4000],
            "status": status,
            "attempts": max(0, attempts),
            "created_at": _utc_now_iso(),
        }

        def _insert():
            self._client.table("task_log").insert(payload).execute()

        await self._run_sync(_insert)

    async def update_task(self, task_id: str, **fields: Any) -> None:
        """Patch task row by task_id."""
        if not self.is_enabled():
            return

        sanitized: dict[str, Any] = {}
        for key, value in fields.items():
            if value is not None:
                sanitized[key] = value
        if not sanitized:
            return

        def _update():
            self._client.table("task_log").update(sanitized).eq("task_id", task_id).execute()

        await self._run_sync(_update)

    async def append_error(self, task_id: str, error: str, attempt: int) -> None:
        """Append an error entry to task_log.error_log."""
        if not self.is_enabled():
            return
        row = await self.get_task(task_id)
        existing = (row or {}).get("error_log") or []
        if not isinstance(existing, list):
            existing = []
        existing.append(
            {
                "attempt": attempt,
                "error": error[:2000],
                "at": _utc_now_iso(),
            }
        )
        await self.update_task(task_id, error_log=existing)

    async def mark_in_progress(self, task_id: str, agent_id: str, description: str = "") -> None:
        """Set task to in_progress and increment attempts."""
        if not self.is_enabled():
            return
        row = await self.get_task(task_id)
        attempts = int((row or {}).get("attempts", 0)) + 1
        if row is None:
            await self.create_task(
                task_id=task_id,
                agent_id=agent_id,
                description=description,
                status="in_progress",
                attempts=attempts,
            )
            await self.update_task(task_id, started_at=_utc_now_iso())
            return

        await self.update_task(
            task_id,
            agent_id=agent_id,
            description=description or row.get("description", ""),
            status="in_progress",
            attempts=attempts,
            started_at=_utc_now_iso(),
        )

    async def mark_completed(
        self,
        task_id: str,
        agent_id: str,
        result: str,
        performance_score: float | None = None,
    ) -> None:
        """Mark task as completed."""
        if not self.is_enabled():
            return
        fields: dict[str, Any] = {
            "agent_id": agent_id,
            "status": "completed",
            "result": result[:12000],
            "completed_at": _utc_now_iso(),
        }
        if performance_score is not None:
            fields["performance_score"] = float(performance_score)
        await self.update_task(task_id, **fields)

    async def mark_failed(self, task_id: str, agent_id: str, error: str, attempt: int) -> None:
        """Mark task as failed and record the error."""
        if not self.is_enabled():
            return
        await self.append_error(task_id, error, attempt)
        await self.update_task(
            task_id,
            agent_id=agent_id,
            status="failed",
            completed_at=_utc_now_iso(),
        )

    async def mark_escalated(self, task_id: str, agent_id: str, error: str, attempt: int) -> None:
        """Mark task as escalated and record escalation error."""
        if not self.is_enabled():
            return
        await self.append_error(task_id, error, attempt)
        await self.update_task(
            task_id,
            agent_id=agent_id,
            status="escalated",
            completed_at=_utc_now_iso(),
        )
