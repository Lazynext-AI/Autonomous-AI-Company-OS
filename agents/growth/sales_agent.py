"""Sales Agent - prospects, outreach."""

import asyncio
import time
import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import ReportMessage, TaskMessage


class SalesAgent(BaseAgent):
    """Sales agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_outreach_at: float = 0.0
        self._outreach_interval_seconds = 4 * 3600

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_SALES]

    def get_system_prompt(self) -> str:
        return "You are an SDR. You find prospects and personalize outreach."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            output = await self.call_llm(
                self.get_system_prompt(),
                f"Create sales outreach for: {task.description}",
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
        if (now - self._last_outreach_at) >= self._outreach_interval_seconds:
            await self._run_outreach_cycle()
            self._last_outreach_at = now
        await asyncio.sleep(3)

    async def _run_outreach_cycle(self) -> None:
        brain = await self.company_brain.get()
        prompt = f"""Create a short outbound sales batch plan for today.
Product: {brain.product_name or "Undefined"}
Mission: {brain.mission or "Acquire initial users"}
Metrics: {brain.metrics}

Return plain text with:
1) ICP segment
2) 3 pain-based hooks
3) 1 outreach message template
4) follow-up sequence (day 2 and day 5)
5) success KPI for this batch"""
        plan = await self.call_llm(self.get_system_prompt(), prompt)
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=f"sales-{str(uuid.uuid4())[:8]}",
                status="outreach_batch_planned",
                result=plan[:12000],
            ),
        )
        await self.episodic_memory.add_event(
            self.agent_id,
            "sales_outreach_planned",
            plan[:300],
        )
