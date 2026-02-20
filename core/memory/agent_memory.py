"""Per-agent personal memory in Supabase."""

import asyncio
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class AgentMemorySchema(BaseModel):
    """Agent memory schema."""

    id: str = ""
    agent_id: str = ""
    role: str = ""
    performance_score: float = 100.0
    current_task: dict[str, Any] | None = None
    tasks_completed: list[dict[str, Any]] = Field(default_factory=list)
    tasks_failed: list[dict[str, Any]] = Field(default_factory=list)
    patterns_learned: list[str] = Field(default_factory=list)
    reward_history: list[dict[str, Any]] = Field(default_factory=list)
    correction_history: list[dict[str, Any]] = Field(default_factory=list)
    retry_count: int = 0
    current_strategy: str = "default"
    last_active: datetime = Field(default_factory=_utc_now)
    created_at: datetime = Field(default_factory=_utc_now)
    pending_reward_prompts: list[str] = Field(default_factory=list)
    pending_correction_prompts: list[str] = Field(default_factory=list)


class AgentMemory:
    """Async agent memory - per-agent state in Supabase."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None

    def _get_client(self):
        """Lazy init Supabase client."""
        if self._client is None:
            try:
                from core.supabase_client import SupabaseClient
                c = SupabaseClient()
                if c.is_configured():
                    self._client = c
                else:
                    logger.warning("agent_memory_supabase_not_configured")
            except Exception as e:
                logger.error("agent_memory_supabase_init_failed", error=str(e))
        return self._client

    async def _run_sync(self, fn, *args, **kwargs):
        """Run sync Supabase call in thread pool."""
        client = self._get_client()
        if client is None:
            raise RuntimeError("Supabase not configured")
        return await asyncio.to_thread(fn, *args, **kwargs)

    def _row_to_schema(self, row: dict) -> AgentMemorySchema:
        """Convert DB row to schema."""
        reward = row.get("reward_history") or []
        correction = row.get("correction_history") or []
        pending_reward = [r.get("prompt", "") for r in reward if isinstance(r, dict) and r.get("consumed") is False]
        pending_correction = [c.get("prompt", "") for c in correction if isinstance(c, dict) and c.get("consumed") is False]
        return AgentMemorySchema(
            id=str(row.get("id", "")),
            agent_id=row.get("agent_id", ""),
            role=row.get("role", ""),
            performance_score=float(row.get("performance_score", 100)),
            current_task=row.get("current_task"),
            tasks_completed=row.get("tasks_completed") or [],
            tasks_failed=row.get("tasks_failed") or [],
            patterns_learned=row.get("patterns_learned") or [],
            reward_history=reward,
            correction_history=correction,
            retry_count=int(row.get("retry_count", 0)),
            current_strategy=row.get("current_strategy", "default"),
            last_active=row.get("last_active", _utc_now()),
            created_at=row.get("created_at", _utc_now()),
            pending_reward_prompts=pending_reward,
            pending_correction_prompts=pending_correction,
        )

    async def get(self, agent_id: str) -> AgentMemorySchema:
        """Get agent memory by agent_id."""
        def _fetch():
            r = self._client.table("agent_memories").select("*").eq("agent_id", agent_id).limit(1).execute()
            if r.data and len(r.data) > 0:
                return r.data[0]
            return {"agent_id": agent_id, "role": ""}

        row = await self._run_sync(_fetch)
        return self._row_to_schema(row)

    async def initialize(self, agent_id: str, role: str) -> None:
        """Create row if not exists."""
        def _init():
            r = self._client.table("agent_memories").select("id").eq("agent_id", agent_id).execute()
            if r.data and len(r.data) > 0:
                return
            self._client.table("agent_memories").insert({
                "agent_id": agent_id,
                "role": role,
                "performance_score": 100,
                "retry_count": 0,
                "current_strategy": "default",
            }).execute()

        await self._run_sync(_init)
        logger.info("agent_memory_initialized", agent_id=agent_id, role=role)

    async def record_task_completed(
        self,
        agent_id: str,
        task_id: str,
        result: str,
        approach: str,
        time_taken: float,
    ) -> None:
        """Record completed task."""
        def _record():
            r = self._client.table("agent_memories").select("tasks_completed").eq("agent_id", agent_id).execute()
            tasks = (r.data[0].get("tasks_completed") or []) if r.data else []
            tasks.append({
                "task_id": task_id,
                "result": result,
                "approach": approach,
                "time_taken": time_taken,
                "completed_at": _utc_now().isoformat(),
            })
            self._client.table("agent_memories").update({
                "tasks_completed": tasks,
                "current_task": None,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_record)

    async def record_task_failed(
        self,
        agent_id: str,
        task_id: str,
        error: str,
        approach_tried: str,
    ) -> None:
        """Record failed task."""
        def _record():
            r = self._client.table("agent_memories").select("tasks_failed").eq("agent_id", agent_id).execute()
            tasks = (r.data[0].get("tasks_failed") or []) if r.data else []
            tasks.append({
                "task_id": task_id,
                "error": error,
                "approach_tried": approach_tried,
                "failed_at": _utc_now().isoformat(),
            })
            self._client.table("agent_memories").update({
                "tasks_failed": tasks,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_record)

    async def add_pattern_learned(self, agent_id: str, pattern: str) -> None:
        """Add learned pattern."""
        def _add():
            r = self._client.table("agent_memories").select("patterns_learned").eq("agent_id", agent_id).execute()
            patterns = (r.data[0].get("patterns_learned") or []) if r.data else []
            if pattern not in patterns:
                patterns.append(pattern)
            self._client.table("agent_memories").update({
                "patterns_learned": patterns,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_add)

    async def inject_reward_prompt(self, agent_id: str, prompt: str) -> None:
        """Inject reward prompt (consumed on next task)."""
        def _inject():
            r = self._client.table("agent_memories").select("reward_history").eq("agent_id", agent_id).execute()
            history = (r.data[0].get("reward_history") or []) if r.data else []
            history.append({"prompt": prompt, "consumed": False, "injected_at": _utc_now().isoformat()})
            self._client.table("agent_memories").update({
                "reward_history": history,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_inject)

    async def inject_correction_prompt(self, agent_id: str, prompt: str) -> None:
        """Inject correction prompt."""
        def _inject():
            r = self._client.table("agent_memories").select("correction_history").eq("agent_id", agent_id).execute()
            history = (r.data[0].get("correction_history") or []) if r.data else []
            history.append({"prompt": prompt, "consumed": False, "injected_at": _utc_now().isoformat()})
            self._client.table("agent_memories").update({
                "correction_history": history,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_inject)

    async def get_pending_prompts(self, agent_id: str) -> list[str]:
        """Return reward + correction prompts not yet consumed."""
        mem = await self.get(agent_id)
        prompts = []
        for r in mem.reward_history:
            if isinstance(r, dict) and r.get("consumed") is False:
                prompts.append(r.get("prompt", ""))
        for c in mem.correction_history:
            if isinstance(c, dict) and c.get("consumed") is False:
                prompts.append(c.get("prompt", ""))
        return prompts

    async def mark_prompts_consumed(self, agent_id: str) -> None:
        """Mark all pending prompts as consumed."""
        def _mark():
            r = self._client.table("agent_memories").select("reward_history,correction_history").eq("agent_id", agent_id).execute()
            if not r.data:
                return
            row = r.data[0]
            reward = row.get("reward_history") or []
            correction = row.get("correction_history") or []
            for item in reward:
                if isinstance(item, dict):
                    item["consumed"] = True
            for item in correction:
                if isinstance(item, dict):
                    item["consumed"] = True
            self._client.table("agent_memories").update({
                "reward_history": reward,
                "correction_history": correction,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_mark)

    async def update_performance_score(self, agent_id: str, new_score: float) -> None:
        """Update performance score (rolling avg in caller)."""
        def _update():
            self._client.table("agent_memories").update({
                "performance_score": new_score,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_update)

    async def increment_retry(self, agent_id: str) -> None:
        """Increment retry count."""
        def _inc():
            r = self._client.table("agent_memories").select("retry_count").eq("agent_id", agent_id).execute()
            count = (r.data[0].get("retry_count", 0) + 1) if r.data else 1
            self._client.table("agent_memories").update({
                "retry_count": count,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_inc)

    async def reset_retry(self, agent_id: str) -> None:
        """Reset retry count to 0."""
        def _reset():
            self._client.table("agent_memories").update({
                "retry_count": 0,
                "last_active": _utc_now().isoformat(),
            }).eq("agent_id", agent_id).execute()

        await self._run_sync(_reset)
