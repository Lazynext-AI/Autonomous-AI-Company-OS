"""HR Agent - spawn, scale down, reassign agents."""

import asyncio

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import HRRequestMessage, TaskMessage


class HRAgent(BaseAgent):
    """HR agent - manages agent lifecycle."""

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.HR_REQUESTS]

    def get_system_prompt(self) -> str:
        return "You are HR for an AI company. You spawn, scale, and reassign agents."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        return TaskResult(task_id=task.task_id, success=True, output="HR handles requests")

    async def run(self) -> None:
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "hr")
                msgs = await self.message_bus.read_messages(
                    Channels.HR_REQUESTS, "agents", self.agent_id, count=5
                )
                for msg_id, msg in msgs:
                    if isinstance(msg, HRRequestMessage):
                        if msg.request_type == "spawn_agent":
                            await self.company_brain.update_agent_status(
                                f"{msg.role_needed}_new",
                                "spawned",
                                msg.reason,
                            )
                        await self.message_bus.acknowledge(
                            Channels.HR_REQUESTS, "agents", msg_id
                        )
                await asyncio.sleep(10)  # Reduced from 30s to 10s for faster HR processing
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("hr_loop_error", error=str(e))
                await asyncio.sleep(10)  # Reduced from 30s to 10s for faster HR processing

        self.is_running = False
        await self._maybe_update_status("stopped", "")
