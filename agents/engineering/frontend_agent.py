"""Frontend Agent - Next.js, TypeScript, Tailwind."""

import structlog

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage
from core.tools.code_writer import CodeWriter
from core.operations.task_tracker import TaskTracker

logger = structlog.get_logger(__name__)


FRONTEND_SYSTEM_PROMPT = """You are a senior frontend engineer. You build UIs in the product's actual
stack — read company brain's tech_stack first (the current product UI is a
static GitHub Pages index.html with vanilla JS calling the worker API, not a
Next.js app). You always make responsive, accessible UIs. You connect to the
backend API using the URLs stored in company brain live_urls.api."""


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
                f"Generate the UI code for: {task.description}. Match the repo's existing frontend stack and file layout.\n\nIMPORTANT: Wrap your code in markdown code blocks with language tag (e.g., ```html\\ncode\\n```). Include the file path as a comment at the top (e.g., // File: docs/onboarding.html).",
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
                            if write_result.get("pr_error"):
                                files_info += f" [PR open failed: {write_result['pr_error']}]"
                    
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
                elif write_result.get("skipped_protected") or write_result.get("reverted"):
                    # Every generated file was blocked (protected path) or
                    # rejected and reverted by the local test/fitness gates —
                    # nothing shipped, so the task must not complete (dedup
                    # would mark the feature done forever).
                    result.success = False
                    if write_result.get("skipped_protected"):
                        result.error = ("Deliverable blocked: generated files only target "
                                        "protected paths — deliver as a NEW module instead "
                                        "(e.g. src/<feature>.js), not an edit to managed files")
                        result.lesson = "Managed files are protected — extend via new modules"
                    elif write_result.get("tests_failed"):
                        tail = str(write_result["tests_failed"])[-600:]
                        result.error = ("Deliverable rejected: repo test suite failed — fix and reship. "
                                        f"Failing output: {tail}")
                        result.lesson = "Generated code must pass the repo's node --test suite"
                    elif write_result.get("phantom_imports"):
                        result.error = ("Deliverable rejected: phantom imports — generated code "
                                        "references modules that don't exist: "
                                        f"{str(write_result['phantom_imports'])[:300]}")
                        result.lesson = "Import only package.json deps or Node builtins"
                    else:
                        fit = str(write_result.get("fitness_failed") or "")[:300]
                        result.error = ("Deliverable rejected: task-fit review found it wrong for this product"
                                        + (f": {fit}" if fit else ""))
                        result.lesson = "Generated code must fit the real product surface"
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
