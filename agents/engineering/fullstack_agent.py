"""Fullstack Agent - combines backend and frontend."""

from agents.engineering.backend_agent import BackendAgent
from agents.engineering.frontend_agent import FRONTEND_SYSTEM_PROMPT
from agents.base_agent import TaskResult
from core.messaging.schemas import TaskMessage


class FullstackAgent(BackendAgent):
    """Fullstack agent - delegates to backend/frontend as needed."""

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        desc = task.description.lower()
        if "frontend" in desc or "page" in desc or "ui" in desc or "component" in desc:
            try:
                code = await self.call_llm(
                    FRONTEND_SYSTEM_PROMPT,
                    f"Generate Next.js page/component for: {task.description}",
                )
                return TaskResult(
                    task_id=task.task_id,
                    success=True,
                    output=code,
                    approach_used="llm_frontend",
                    time_taken_seconds=int(time.time() - start),
                )
            except Exception as e:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error=str(e),
                    time_taken_seconds=int(time.time() - start),
                )
        return await BackendAgent.execute_task(self, task)
