"""Performance scoring engine."""

import asyncio

from agents.base_agent import TaskResult
from core.memory.agent_memory import AgentMemory
from core.messaging.schemas import TaskMessage
import structlog

logger = structlog.get_logger(__name__)


class PerformanceScorer:
    """Score task performance with weighted signals."""

    def __init__(self, agent_memory: AgentMemory) -> None:
        self.agent_memory = agent_memory

    async def score_task(
        self,
        task_id: str,
        result: TaskResult,
        agent_id: str,
        task: TaskMessage,
    ) -> float:
        """Compute weighted performance score 0-100."""
        signals = []
        weights = []

        qa_score = 0.5
        try:
            from core.supabase_client import SupabaseClient
            client = SupabaseClient()
            if client.is_configured():
                r = await asyncio.to_thread(
                    lambda: client.table("task_log").select("result").eq("task_id", task_id).execute()
                )
                if r.data and "qa_pass" in str(r.data).lower():
                    qa_score = 1.0
        except Exception:
            pass
        signals.append(qa_score)
        weights.append(0.30)

        est = task.estimated_minutes or 60
        actual = result.time_taken_seconds / 60
        if actual <= est * 0.8:
            time_score = 1.0
        elif actual <= est * 1.2:
            time_score = 0.8
        elif actual <= est * 1.5:
            time_score = 0.6
        else:
            time_score = 0.3
        signals.append(time_score)
        weights.append(0.20)

        no_regression = 1.0
        signals.append(no_regression)
        weights.append(0.20)

        code_quality = 0.8
        signals.append(code_quality)
        weights.append(0.15)

        mem = await self.agent_memory.get(agent_id)
        attempt_score = max(0.2, min(1.0, 1.0 - (mem.retry_count - 1) * 0.2))
        signals.append(attempt_score)
        weights.append(0.15)

        total_weight = sum(weights)
        final = sum(s * w for s, w in zip(signals, weights)) / total_weight * 100

        new_avg = (mem.performance_score + final) / 2
        await self.agent_memory.update_performance_score(agent_id, new_avg)
        return final
