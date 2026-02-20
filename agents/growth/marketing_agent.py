"""Marketing Agent - content, campaigns, growth."""

import asyncio
import time
import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import ReportMessage, TaskMessage


class MarketingAgent(BaseAgent):
    """Marketing agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_experiment_at: float = 0.0
        self._experiment_interval_seconds = 6 * 3600

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_MARKETING]

    def get_system_prompt(self) -> str:
        return "You are a growth marketer. You write compelling content for developers."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            output = await self.call_llm(
                self.get_system_prompt(),
                f"Create marketing content for: {task.description}",
            )
            return TaskResult(
                task_id=task.task_id,
                success=True,
                output=output,
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                time_taken_seconds=int(time.time() - start),
            )

    async def idle_behavior(self) -> None:
        now = time.time()
        if (now - self._last_experiment_at) >= self._experiment_interval_seconds:
            await self._run_growth_experiment_cycle()
            self._last_experiment_at = now
        await asyncio.sleep(3)

    async def _run_growth_experiment_cycle(self) -> None:
        brain = await self.company_brain.get()
        prompt = f"""Create one high-leverage growth experiment for this product.
Product: {brain.product_name or "Undefined"}
Mission: {brain.mission or "Acquire first paying users"}
Metrics: {brain.metrics}

Return plain text with:
1) Hypothesis
2) Channel
3) Asset to create
4) CTA
5) Success metric + target"""
        plan = await self.call_llm(self.get_system_prompt(), prompt)
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=f"mkt-{str(uuid.uuid4())[:8]}",
                status="growth_experiment_planned",
                result=plan[:12000],
            ),
        )
        await self.episodic_memory.add_event(
            self.agent_id,
            "growth_experiment_planned",
            plan[:300],
        )
