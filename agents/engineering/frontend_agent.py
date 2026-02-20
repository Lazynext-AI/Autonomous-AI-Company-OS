"""Frontend Agent - Next.js, TypeScript, Tailwind."""

import structlog

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage
from core.tools.code_writer import CodeWriter
from core.operations.task_tracker import TaskTracker

logger = structlog.get_logger(__name__)


FRONTEND_SYSTEM_PROMPT = """You are a senior frontend engineer. You build with Next.js 14 App Router, 
TypeScript, Tailwind CSS, and shadcn/ui components.
You always make responsive, accessible UIs. You connect to the backend API
using the URLs stored in company brain live_urls.api."""


class FrontendAgent(BaseAgent):
    """Frontend engineering agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.code_writer = CodeWriter(company_brain=self.company_brain)

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_FRONTEND]

    def get_system_prompt(self) -> str:
        return FRONTEND_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            code = await self.call_llm(
                FRONTEND_SYSTEM_PROMPT,
                f"Generate Next.js page/component for: {task.description}. TypeScript, Tailwind, loading/error states.\n\nIMPORTANT: Wrap your code in markdown code blocks with language tag (e.g., ```tsx\\ncode\\n```). Include the file path as a comment at the top (e.g., // File: app/pages/auth/login.tsx).",
            )
            return TaskResult(
                task_id=task.task_id,
                success=True,
                output=code,
                approach_used="llm_generated",
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                approach_used="default",
                time_taken_seconds=int(time.time() - start),
            )

    async def post_task_hook(self, task: TaskMessage, result: TaskResult) -> None:
        """Write generated code to files and commit to git."""
        if result.success and result.output:
            try:
                write_result = await self.code_writer.write_code(
                    result.output,
                    task.description,
                    task.task_id,
                    self.role,
                )
                if write_result.get("files_written"):
                    files_info = f"[Files written: {', '.join(write_result['files_written'])}]"
                    
                    if write_result.get("validation_errors"):
                        files_info += f"\n[Validation warnings: {len(write_result['validation_errors'])}]"
                    
                    if write_result.get("git_committed"):
                        files_info += "\n[Committed to git]"
                        if write_result.get("git_branch"):
                            files_info += f" (branch: {write_result['git_branch']})"
                        if write_result.get("git_pushed"):
                            files_info += " [Pushed to remote]"
                    
                    logger.info(
                        "code_written",
                        task_id=task.task_id,
                        files=write_result["files_written"],
                        git_committed=write_result.get("git_committed", False),
                        git_branch=write_result.get("git_branch"),
                    )
                    result.output = f"{result.output}\n\n{files_info}"
                    
                    # Automatically create deploy task if code was committed and pushed
                    if write_result.get("git_committed") and write_result.get("git_pushed"):
                        await self._auto_create_deploy_task(task, write_result)
            except Exception as e:
                logger.error("code_write_failed", task_id=task.task_id, error=str(e))
    
    async def _auto_create_deploy_task(self, task: TaskMessage, write_result: dict) -> None:
        """Automatically create a deploy task after successful code commit."""
        try:
            # Check if we should auto-deploy (only for frontend code)
            branch = write_result.get("git_branch", "")
            if "main" in branch or "master" in branch:
                # Code pushed to main/master - create deploy task
                import uuid
                deploy_task = TaskMessage(
                    from_agent=self.agent_id,
                    task_id=str(uuid.uuid4())[:8],
                    description=f"Deploy frontend to production (auto-triggered after: {task.description[:50]})",
                    acceptance_criteria=[
                        "Frontend deployed to Vercel",
                        "Frontend accessible and returns 200",
                        "live_urls.frontend updated in company brain",
                    ],
                    estimated_minutes=10,
                    context={"assign_to": "devops", "source": "auto_deploy_frontend", "original_task": task.task_id},
                )
                await self.task_tracker.create_task(
                    deploy_task.task_id,
                    "devops",
                    deploy_task.description,
                    status="pending",
                    attempts=0,
                )
                await self.message_bus.publish(Channels.CTO_TASKS_DEVOPS, deploy_task)
                logger.info("auto_deploy_task_created", task_id=task.task_id, deploy_task_id=deploy_task.task_id)
        except Exception as e:
            logger.warning("auto_deploy_task_creation_failed", error=str(e))
