"""Reward and correction prompt generator."""

import asyncio

from agents.base_agent import TaskResult
from core.memory.agent_memory import AgentMemory
from core.messaging.schemas import TaskMessage
import structlog

logger = structlog.get_logger(__name__)


class RewardEngine:
    """Generate reward/correction prompts based on performance."""

    def __init__(
        self,
        agent_memory: AgentMemory,
        ollama_client=None,
        knowledge_downloader=None,
    ) -> None:
        self.agent_memory = agent_memory
        self.ollama_client = ollama_client
        self.knowledge_downloader = knowledge_downloader

    async def process_score(
        self,
        agent_id: str,
        score: float,
        task: TaskMessage,
        result: TaskResult,
    ) -> None:
        """Inject reward or correction prompt based on score."""
        if score >= 90:
            prompt = await self._generate_elite_prompt(agent_id, task, result, score)
            await self.agent_memory.inject_reward_prompt(agent_id, prompt)
        elif score >= 75:
            prompt = await self._generate_good_prompt(agent_id, task, result, score)
            await self.agent_memory.inject_reward_prompt(agent_id, prompt)
        elif score >= 50:
            prompt = await self._generate_correction_prompt(agent_id, task, result, score)
            await self.agent_memory.inject_correction_prompt(agent_id, prompt)
        else:
            prompt = await self._generate_recovery_prompt(agent_id, task, result, score)
            await self.agent_memory.inject_correction_prompt(agent_id, prompt)
            if self.knowledge_downloader:
                await self.knowledge_downloader.find_and_download(task.description, "engineering")

    async def _generate_elite_prompt(
        self,
        agent_id: str,
        task: TaskMessage,
        result: TaskResult,
        score: float,
    ) -> str:
        return f"Excellent work (score {score}). Your approach '{result.approach_used}' was effective. Keep this momentum."

    async def _generate_good_prompt(
        self,
        agent_id: str,
        task: TaskMessage,
        result: TaskResult,
        score: float,
    ) -> str:
        return f"Good result (score {score}). Task completed successfully. Consider optimizing approach for future similar tasks."

    async def _generate_correction_prompt(
        self,
        agent_id: str,
        task: TaskMessage,
        result: TaskResult,
        score: float,
    ) -> str:
        return f"Score {score}. Review: {result.lesson or 'Consider alternative approaches'}. Improve for next time."

    async def _generate_recovery_prompt(
        self,
        agent_id: str,
        task: TaskMessage,
        result: TaskResult,
        score: float,
    ) -> str:
        return f"Learning moment (score {score}). What went wrong: {result.error or 'Unknown'}. Try: {result.lesson or 'Break task into smaller steps, consult knowledge base'}."

    async def broadcast_milestone_reward(self, milestone_type: str, description: str) -> None:
        """Inject celebration into all agent memories."""
        prompt = f"Milestone achieved: {milestone_type} - {description}. Celebrate and keep building!"
        try:
            from core.supabase_client import SupabaseClient
            client = SupabaseClient()
            if client.is_configured():
                r = await asyncio.to_thread(
                    lambda: client.table("agent_memories").select("agent_id").execute()
                )
                for row in (r.data or []):
                    aid = row.get("agent_id")
                    if aid:
                        await self.agent_memory.inject_reward_prompt(aid, prompt)
        except Exception as e:
            logger.error("milestone_broadcast_failed", error=str(e))
