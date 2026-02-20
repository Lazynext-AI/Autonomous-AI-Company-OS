"""Customer Success Agent - feedback, onboarding."""

import asyncio
import time
import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import ReportMessage, TaskMessage


class CustomerSuccessAgent(BaseAgent):
    """Customer success agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_review_at: float = 0.0
        self._review_interval_seconds = 8 * 3600

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.USER_FEEDBACK, Channels.CTO_TASKS_CUSTOMER_SUCCESS]

    def get_system_prompt(self) -> str:
        return "You are customer success. You respond to feedback and onboard users."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            output = await self.call_llm(
                self.get_system_prompt(),
                f"Handle: {task.description}",
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
        if (now - self._last_review_at) >= self._review_interval_seconds:
            await self._run_customer_health_cycle()
            self._last_review_at = now
        await asyncio.sleep(3)

    async def _run_customer_health_cycle(self) -> None:
        brain = await self.company_brain.get()
        feedback_items = brain.user_feedback or []
        recent_feedback = [getattr(f, "content", str(f)) for f in feedback_items[:5]]
        prompt = f"""Create a customer success action plan.
Product: {brain.product_name or "Undefined"}
Mission: {brain.mission or "Acquire and retain users"}
Recent feedback: {recent_feedback if recent_feedback else 'No feedback yet'}

Return plain text with:
1) Top churn risks
2) onboarding improvements
3) response templates for top support issue
4) one retention experiment with KPI"""
        plan = await self.call_llm(self.get_system_prompt(), prompt)
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=f"cs-{str(uuid.uuid4())[:8]}",
                status="customer_success_plan",
                result=plan[:12000],
            ),
        )
        await self.episodic_memory.add_event(
            self.agent_id,
            "customer_success_plan_generated",
            plan[:300],
        )
