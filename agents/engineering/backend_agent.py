"""Backend Agent - FastAPI, PostgreSQL, Redis."""

import structlog

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage
from core.tools.code_writer import CodeWriter
from core.operations.task_tracker import TaskTracker
from core.tools.code_executor import run_code

logger = structlog.get_logger(__name__)


BACKEND_SYSTEM_PROMPT = """You are a senior backend engineer. You write production-quality code in the
product's actual stack — read company brain's tech_stack first (the current
product is a Cloudflare Worker ES-module JS API backed by platform KV/D1, not
a Python service). You always write tests alongside code. You always handle
errors explicitly. You follow the existing codebase patterns — match the
language and framework already in the repo."""


class BackendAgent(BaseAgent):
    """Backend engineering agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.code_writer = CodeWriter(company_brain=self.company_brain)

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_BACKEND]

    def get_system_prompt(self) -> str:
        return BACKEND_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            desc_lower = task.description.lower()
            if "api" in desc_lower or "endpoint" in desc_lower:
                code = await self.call_llm(
                    BACKEND_SYSTEM_PROMPT,
                    f"Generate endpoint code for: {task.description}. Match the repo's stack — routes, validation, error handling.\n\nIMPORTANT: Wrap your code in markdown code blocks with language tag (e.g., ```js\\ncode\\n```). Include the file path as a comment at the top (e.g., // File: src/routes/scan.js).",
                )
                return TaskResult(
                    task_id=task.task_id,
                    success=True,
                    output=code,
                    approach_used="llm_generated",
                    time_taken_seconds=int(time.time() - start),
                )
            elif "database" in desc_lower or "schema" in desc_lower:
                code = await self.call_llm(
                    BACKEND_SYSTEM_PROMPT,
                    f"Generate the schema/migration for: {task.description}. Match the repo's actual storage (D1 SQL via platform /query, KV via /kv/* — not Postgres).",
                )
                return TaskResult(
                    task_id=task.task_id,
                    success=True,
                    output=code,
                    approach_used="llm_generated",
                    time_taken_seconds=int(time.time() - start),
                )
            else:
                code = await self.call_llm(
                    BACKEND_SYSTEM_PROMPT,
                    f"Implement: {task.description}. Full code with tests, matching the repo's stack.\n\nIMPORTANT: Wrap your code in markdown code blocks with language tag (e.g., ```js\\ncode\\n```). Include the file path as a comment at the top (e.g., // File: src/feature.js).",
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
    
    async def _auto_create_deploy_task(self, task: TaskMessage, write_result: dict) -> None:
        """Automatically create a deploy task after successful code commit."""
        try:
            # Check if we should auto-deploy (only for backend/API code)
            branch = write_result.get("git_branch", "")
            if "main" in branch or "master" in branch:
                # Code pushed to main/master - create deploy task
                import uuid
                deploy_task = TaskMessage(
                    from_agent=self.agent_id,
                    task_id=str(uuid.uuid4())[:8],
                    description=f"Deploy backend API to production (auto-triggered after: {task.description[:50]})",
                    acceptance_criteria=[
                        "Backend deployed to Railway",
                        "API health endpoint returns 200",
                        "live_urls.api updated in company brain",
                    ],
                    estimated_minutes=15,
                    context={"assign_to": "devops", "source": "auto_deploy_backend", "original_task": task.task_id},
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

    async def post_task_hook(self, task: TaskMessage, result: TaskResult) -> None:
        """Write generated code to files, test in the Cloudflare sandbox, and commit to git."""
        if result.success and result.output:
            try:
                # Extract Python code blocks for testing (optional - skip if the exec container is unavailable or dependencies missing)
                import re
                code_blocks = re.findall(r"```python\n(.*?)```", result.output, re.DOTALL)
                
                # Test code in the Cloudflare exec container (skip if dependencies missing - expected in clean sandbox)
                test_results = []
                if code_blocks:
                    for i, code in enumerate(code_blocks):
                        # Skip testing if code has imports that won't be available in the exec container
                        has_external_imports = any(imp in code for imp in ["from app.", "import app.", "from pydantic_settings", "from sqlalchemy"])
                        if has_external_imports:
                            test_results.append(f"Code block {i+1}: ⚠ Skipped (requires project dependencies)")
                            logger.info("code_test_skipped", task_id=task.task_id, block=i+1, reason="external_dependencies")
                            continue
                        
                        test_result = run_code(code)
                        if test_result.success:
                            test_results.append(f"Code block {i+1}: ✓ Passed")
                            logger.info("code_test_passed", task_id=task.task_id, block=i+1)
                        else:
                            # Don't fail on missing dependencies - that's expected in clean sandbox
                            error_msg = test_result.error or test_result.stderr[:100] or ""
                            if "ModuleNotFoundError" in error_msg or "No module named" in error_msg:
                                test_results.append(f"Code block {i+1}: ⚠ Skipped (dependencies not in sandbox)")
                                logger.info("code_test_skipped", task_id=task.task_id, block=i+1, reason="missing_dependencies")
                            else:
                                test_results.append(f"Code block {i+1}: ✗ Failed - {error_msg[:80]}")
                                logger.warning("code_test_failed", task_id=task.task_id, block=i+1, error=error_msg)
                
                write_result = await self.code_writer.write_code(
                    result.output,
                    task.description,
                    task.task_id,
                    self.role,
                )
                if write_result.get("files_written"):
                    files_info = f"[Files written: {', '.join(write_result['files_written'])}]"
                    
                    # Add test results if available
                    if test_results:
                        files_info += f"\n[Exec Tests: {'; '.join(test_results)}]"
                    
                    # Add validation warnings if any
                    if write_result.get("validation_errors"):
                        files_info += f"\n[Validation warnings: {len(write_result['validation_errors'])}]"
                    
                    # Add git info
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
                        tests_run=len(test_results) > 0,
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
                        result.error = "Deliverable rejected: repo test suite failed — fix and reship"
                        result.lesson = "Generated code must pass the repo's node --test suite"
                    else:
                        result.error = "Deliverable rejected: task-fit review found it wrong for this product"
                        result.lesson = "Generated code must fit the real product surface"
            except Exception as e:
                logger.error("code_write_failed", task_id=task.task_id, error=str(e))
