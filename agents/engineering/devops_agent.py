"""DevOps Agent - Cloudflare deployments, monitoring."""

import asyncio
import uuid
from typing import Optional
import structlog

from agents.base_agent import BaseAgent, TaskResult
from core.config import get_settings
from core.tools.product_resolver import get_product_project_dir
from core.memory.company_brain import BlockerSchema
from core.messaging.channels import Channels
from core.messaging.schemas import QAAlertMessage, TaskMessage
from core.tools.code_writer import CodeWriter
from core.tools.deployment import CloudflareBackendDeployer, CloudflarePagesDeployer
from core.tools.git_hooks import GitHooksManager
from core.tools.github_actions import GitHubActionsManager

logger = structlog.get_logger(__name__)


DEVOPS_SYSTEM_PROMPT = """You are a senior DevOps engineer. You manage CI/CD pipelines, deployments,
environment configuration, and infrastructure monitoring.
You deploy frontends to Cloudflare Pages and containerized backends to Cloudflare Containers.
You monitor GitHub Actions workflows and automatically fix failures."""


class DevOpsAgent(BaseAgent):
    """DevOps engineering agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.code_writer = CodeWriter(company_brain=self.company_brain)
        self.backend_deployer = CloudflareBackendDeployer()
        self.pages_deployer = CloudflarePagesDeployer()
        self.github_actions = None  # Initialized in run() or _fix_workflow_failures using product repo

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_DEVOPS]

    def get_system_prompt(self) -> str:
        return DEVOPS_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            desc_lower = task.description.lower()

            # Check if this is a hook setup task
            if any(kw in desc_lower for kw in ["setup", "configure", "install", "hook", "git hook", "deployment hook"]):
                product_root = await get_product_project_dir(self.company_brain)
                if not product_root:
                    return TaskResult(
                        task_id=task.task_id,
                        success=False,
                        error="Could not resolve product repository from company brain",
                        time_taken_seconds=int(time.time() - start),
                    )
                hooks_manager = GitHooksManager(repo_root=product_root)

                # Check if hooks already exist to prevent duplicate setup
                hooks_dir = product_root / ".git" / "hooks"
                github_workflow_exists = (product_root / ".github" / "workflows" / "auto-deploy.yml").exists()
                post_push_exists = hooks_dir.exists() and (hooks_dir / "post-push").exists()

                if github_workflow_exists or post_push_exists:
                    return TaskResult(
                        task_id=task.task_id,
                        success=True,
                        output="✅ Git hooks and GitHub Actions workflow already configured. No action needed.",
                        approach_used="hook_setup_skipped",
                        time_taken_seconds=int(time.time() - start),
                    )

                # Automatically set up git hooks
                hooks_result = hooks_manager.setup_all_hooks()
                if hooks_result.get("success"):
                    output = "✅ Git hooks and GitHub Actions workflow configured successfully!\n\n"
                    for hook_type, result in hooks_result.get("results", {}).items():
                        if result.get("success"):
                            output += f"✓ {hook_type}: Configured\n"
                            if result.get("hook_file"):
                                output += f"  File: {result['hook_file']}\n"
                            if result.get("workflow_file"):
                                output += f"  Workflow: {result['workflow_file']}\n"
                    output += "\nDeployments will now trigger automatically on push to main/master branch."
                    return TaskResult(
                        task_id=task.task_id,
                        success=True,
                        output=output,
                        approach_used="hook_setup",
                        time_taken_seconds=int(time.time() - start),
                    )
                else:
                    return TaskResult(
                        task_id=task.task_id,
                        success=False,
                        error=f"Hook setup failed: {hooks_result.get('error', 'Unknown error')}",
                        time_taken_seconds=int(time.time() - start),
                    )

            prompt = f"Provide deployment/infrastructure execution plan for: {task.description}. Include verification and rollback steps."

            # Handle GitHub Actions workflow failures
            if any(kw in desc_lower for kw in ["fix workflow", "workflow failed", "github actions", "ci/cd failed", "pipeline failed"]):
                return await self._fix_workflow_failures(task)

            if any(kw in desc_lower for kw in ["github actions", "workflow", "dockerfile", "wrangler", "docker", "config", "yaml", "yml", "toml"]):
                prompt += "\n\nIMPORTANT: If this requires creating configuration files (Dockerfiles, wrangler.toml, etc.), wrap the file content in markdown code blocks with language tag (e.g., ```yaml\\ncode\\n```). Include the file path as a comment (e.g., # File: backend/Dockerfile)."

            output = await self.call_llm(
                DEVOPS_SYSTEM_PROMPT,
                prompt,
            )
            return TaskResult(
                task_id=task.task_id,
                success=True,
                output=output,
                approach_used="llm_generated",
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                time_taken_seconds=int(time.time() - start),
            )

    async def post_task_hook(self, task: TaskMessage, result: TaskResult) -> None:
        """Write generated config files, trigger deployments, and verify."""
        # Auto-setup deploy hooks ONCE if Cloudflare creds are configured but hooks don't exist
        # Only do this once per session to prevent loops
        if not hasattr(self, '_hooks_setup_attempted'):
            self._hooks_setup_attempted = False

        if not self._hooks_setup_attempted:
            try:
                settings = get_settings()
                if settings.cloudflare_api_key and settings.cloudflare_email:
                    product_root = await get_product_project_dir(self.company_brain)
                    if product_root:
                        hooks_dir = product_root / ".git" / "hooks"
                        post_push_exists = hooks_dir.exists() and (hooks_dir / "post-push").exists()
                        github_workflow_exists = (product_root / ".github" / "workflows" / "auto-deploy.yml").exists()

                        if not post_push_exists and not github_workflow_exists:
                            hooks_manager = GitHooksManager(repo_root=product_root)
                            hooks_result = hooks_manager.setup_all_hooks()
                            if hooks_result.get("success"):
                                logger.info("auto_hooks_setup", task_id=task.task_id)
                                result.output = f"{result.output}\n\n[✅ Git hooks automatically configured for deployments]"
                            self._hooks_setup_attempted = True  # Mark as attempted to prevent loops
            except Exception as e:
                logger.warning("auto_hooks_setup_failed", error=str(e))
                self._hooks_setup_attempted = True  # Mark as attempted even on error

        # Write code/config files first
        if result.success and result.output:
            try:
                write_result = await self.code_writer.write_code(
                    result.output,
                    task.description,
                    task.task_id,
                    self.role,
                )
                if write_result.get("files_written"):
                    logger.info(
                        "config_written",
                        task_id=task.task_id,
                        files=write_result["files_written"],
                        git_committed=write_result.get("git_committed", False),
                    )
                    result.output = f"{result.output}\n\n[Files written: {', '.join(write_result['files_written'])}]"
                    if write_result.get("git_committed"):
                        result.output += "\n[Committed to git]"
            except Exception as e:
                logger.error("config_write_failed", task_id=task.task_id, error=str(e))

        # Trigger deployments if this is a deploy task
        desc_lower = task.description.lower()
        if self._is_deploy_task(task.description):
            deployment_info = []
            backend_url = None
            frontend_url = None
            product_root = await get_product_project_dir(self.company_brain)
            product_name = product_root.name if product_root else None

            # Deploy backend to Cloudflare Containers
            if any(kw in desc_lower for kw in ["backend", "api", "server", "container"]):
                backend_dir = product_root / "backend" if product_root else None
                backend_result = await self.backend_deployer.trigger_deployment(
                    project_name=product_name,
                    directory=str(backend_dir) if backend_dir else None,
                )
                if backend_result.get("success"):
                    backend_url = backend_result.get("url")
                    if backend_url:
                        deployment_info.append(f"✓ Backend deployed to Cloudflare: {backend_url}")
                    else:
                        deployment_info.append("✓ Backend deployed to Cloudflare (URL pending)")
                    logger.info("backend_deploy_triggered", task_id=task.task_id, url=backend_url)
                else:
                    deployment_info.append(f"✗ Backend deploy failed: {backend_result.get('error', 'Unknown error')}")
                    logger.warning("backend_deploy_failed", task_id=task.task_id, error=backend_result.get("error"))

            # Deploy frontend to Cloudflare Pages
            if any(kw in desc_lower for kw in ["frontend", "dashboard", "ui", "client", "pages"]):
                frontend_dir = product_root / "frontend" if product_root else None
                pages_result = await self.pages_deployer.trigger_deployment(
                    project_name=f"{product_name}-frontend" if product_name else None,
                    directory=str(frontend_dir) if frontend_dir else None,
                )
                if pages_result.get("success"):
                    frontend_url = pages_result.get("url")
                    if frontend_url:
                        deployment_info.append(f"✓ Frontend deployed to Cloudflare Pages: {frontend_url}")
                    else:
                        deployment_info.append("✓ Frontend deployed to Cloudflare Pages (URL pending)")
                    logger.info("frontend_deploy_triggered", task_id=task.task_id, url=frontend_url)
                else:
                    deployment_info.append(f"✗ Frontend deploy failed: {pages_result.get('error', 'Unknown error')}")
                    logger.warning("frontend_deploy_failed", task_id=task.task_id, error=pages_result.get("error"))

            if deployment_info:
                result.output = f"{result.output}\n\n[Deployments: {'; '.join(deployment_info)}]"

            # Automatically update live_urls in company_brain after successful deployment
            if backend_url or frontend_url:
                await self._update_live_urls(backend_url, frontend_url)

        # Then verify deployments
        if not self._is_deploy_task(task.description):
            return
        source = (task.context or {}).get("source", "")

        ok, details = await self._verify_live_system()
        if ok:
            try:
                brain = await self.company_brain.get()
                metrics = brain.metrics
                current = getattr(metrics, "deploy_count", 0) or (
                    metrics.get("deploy_count", 0) if isinstance(metrics, dict) else 0
                )
                new_count = int(current) + 1
                await self.company_brain.update_metrics({"deploy_count": new_count})

                # Check if this is the first deployment milestone
                if new_count == 1:
                    await self._record_first_deployment_milestone()
            except Exception as e:
                self.logger.warning("deploy_metric_update_failed", error=str(e))
            await self.episodic_memory.add_event(
                self.agent_id,
                "deployment_verified",
                f"Task {task.task_id} passed verification.",
            )
            return

        if source == "auto_rollback":
            await self.message_bus.publish(
                Channels.QA_ALERTS,
                QAAlertMessage(
                    from_agent=self.agent_id,
                    severity="CRITICAL",
                    affected_component="deployment",
                    error_details=f"Rollback verification still failing: {details}",
                    suggested_fix="Manual intervention required: rollback task already attempted.",
                ),
            )
            try:
                await self.company_brain.add_blocker(
                    BlockerSchema(
                        description=f"Rollback attempt failed verification: {details}",
                        blocking="releases",
                        reported_by=self.agent_id,
                    )
                )
            except Exception as e:
                self.logger.warning("rollback_blocker_record_failed", error=str(e))
            return

        rollback_task = TaskMessage(
            from_agent=self.agent_id,
            task_id=str(uuid.uuid4())[:8],
            description=f"[CRITICAL] Roll back deployment and restore service. Trigger: {details}",
            acceptance_criteria=[
                "Last known good release restored",
                "API health endpoint returns 200",
                "Frontend responds without server errors",
            ],
            estimated_minutes=30,
            context={"assign_to": "devops", "source": "auto_rollback"},
        )
        await self.task_tracker.create_task(
            rollback_task.task_id,
            "devops",
            rollback_task.description,
            status="pending",
        )
        await self.message_bus.publish(Channels.CTO_TASKS_DEVOPS, rollback_task)
        await self.message_bus.publish(
            Channels.QA_ALERTS,
            QAAlertMessage(
                from_agent=self.agent_id,
                severity="CRITICAL",
                affected_component="deployment",
                error_details=f"Post-deploy verification failed: {details}",
                suggested_fix="Rollback task auto-generated.",
            ),
        )
        try:
            await self.company_brain.add_blocker(
                BlockerSchema(
                    description=f"Deployment verification failed: {details}",
                    blocking="releases",
                    reported_by=self.agent_id,
                )
            )
        except Exception as e:
            self.logger.warning("deploy_blocker_record_failed", error=str(e))

    async def _record_first_deployment_milestone(self) -> None:
        """Record first deployment milestone to enable founder briefings."""
        try:
            from core.cloudflare_client import CloudflareClient
            from datetime import datetime, timezone

            client = CloudflareClient()
            if not client.is_configured():
                return

            # Check if already logged
            def _check():
                r = client.table("milestone_log").select("id").eq("milestone_type", "first_deployment").limit(1).execute()
                return len(r.data or []) > 0

            already_logged = await asyncio.to_thread(_check)
            if already_logged:
                return

            # Save milestone
            payload = {
                "milestone_type": "first_deployment",
                "description": "First successful deployment completed",
                "achieved_at": datetime.now(timezone.utc).isoformat(),
            }

            def _insert():
                client.table("milestone_log").insert(payload).execute()

            await asyncio.to_thread(_insert)
            logger.info("first_deployment_milestone_recorded")

            # Broadcast milestone message
            from core.messaging.schemas import MilestoneMessage
            from core.messaging.channels import Channels
            await self.message_bus.publish(
                Channels.MILESTONE_BROADCASTS,
                MilestoneMessage(
                    from_agent=self.agent_id,
                    milestone_type="first_deployment",
                    description="First successful deployment completed",
                ),
            )
        except Exception as e:
            logger.warning("first_deployment_milestone_failed", error=str(e))

    def _is_deploy_task(self, description: str) -> bool:
        desc = description.lower()
        keywords = ("deploy", "release", "pipeline", "rollout", "ci/cd", "staging", "production")
        return any(k in desc for k in keywords)

    async def _update_live_urls(self, api_url: Optional[str] = None, frontend_url: Optional[str] = None) -> None:
        """Automatically update live_urls in company_brain after successful deployment."""
        try:
            brain = await self.company_brain.get()
            current_urls = brain.live_urls or {}

            updated = False
            new_urls = dict(current_urls)

            if api_url and api_url != current_urls.get("api"):
                new_urls["api"] = api_url
                updated = True
                logger.info("live_urls_updated", field="api", url=api_url)

            if frontend_url and frontend_url != current_urls.get("frontend"):
                new_urls["frontend"] = frontend_url
                updated = True
                logger.info("live_urls_updated", field="frontend", url=frontend_url)

            if updated:
                await self.company_brain.update_field("live_urls", new_urls)
                logger.info("company_brain_live_urls_updated", urls=new_urls)

                # Notify that QA monitoring will now start automatically
                await self.episodic_memory.add_event(
                    self.agent_id,
                    "live_urls_configured",
                    f"live_urls updated: api={new_urls.get('api', 'unchanged')}, frontend={new_urls.get('frontend', 'unchanged')}. QA monitoring will start automatically.",
                )
        except Exception as e:
            logger.warning("live_urls_update_failed", error=str(e))

    async def _verify_live_system(self) -> tuple[bool, str]:
        """Run smoke checks against live URLs configured in company brain."""
        brain = await self.company_brain.get()
        urls = brain.live_urls or {}
        api_url = urls.get("api")
        frontend_url = urls.get("frontend")

        if not api_url and not frontend_url:
            return False, "No live_urls configured in company brain."

        try:
            import httpx

            async with httpx.AsyncClient(timeout=12.0) as client:
                if api_url:
                    api = await client.get(f"{api_url.rstrip('/')}/health")
                    if api.status_code != 200:
                        return False, f"API health check returned {api.status_code}"
                if frontend_url:
                    ui = await client.get(frontend_url)
                    if ui.status_code >= 500:
                        return False, f"Frontend returned {ui.status_code}"
            return True, "Verification passed."
        except Exception as e:
            return False, str(e)

    async def run(self) -> None:
        """Background monitoring loop - check GitHub Actions workflows periodically."""
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        product_root = await get_product_project_dir(self.company_brain)
        if product_root:
            self.github_actions = GitHubActionsManager(product_root)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "monitoring")
                await self._monitor_github_actions()
                await asyncio.sleep(120)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("devops_monitoring_loop_error", error=str(e))
                await asyncio.sleep(120)

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def _monitor_github_actions(self) -> None:
        """Monitor GitHub Actions workflows and fix failures."""
        if not self.github_actions:
            return

        try:
            # Get failed workflows
            failed_workflows = await self.github_actions.get_failed_workflows(limit=5)

            if not failed_workflows:
                return

            self.logger.info("github_actions_failures_detected", count=len(failed_workflows))

            # Process each failed workflow
            for workflow in failed_workflows:
                run_id = workflow.get("id")
                workflow_name = workflow.get("name", "unknown")

                # Get detailed logs
                run_details = await self.github_actions.get_workflow_run_logs(run_id)
                if not run_details:
                    continue

                # Analyze failure and create fix task
                await self._create_workflow_fix_task(workflow, run_details)
        except Exception as e:
            self.logger.error("monitor_github_actions_error", error=str(e))

    async def _create_workflow_fix_task(self, workflow: dict, run_details: dict) -> None:
        """Create a task to fix a failed workflow."""
        try:
            workflow_name = workflow.get("name", "unknown")
            branch = workflow.get("head_branch", "unknown")
            run_id = workflow.get("id")

            # Check if we already created a task for this workflow run
            existing_tasks = await self.task_tracker.get_tasks_by_status("pending")
            existing_tasks += await self.task_tracker.get_tasks_by_status("in_progress")
            for task in existing_tasks:
                if f"run {run_id}" in task.get("description", ""):
                    return  # Already have a task for this

            # Create fix task
            fix_task = TaskMessage(
                from_agent=self.agent_id,
                task_id=str(uuid.uuid4())[:8],
                description=f"Fix GitHub Actions workflow failure: {workflow_name} (run {run_id}, branch: {branch})",
                acceptance_criteria=[
                    "Workflow file analyzed and errors identified",
                    "Workflow fixed and committed",
                    "Next workflow run succeeds",
                ],
                estimated_minutes=30,
                context={
                    "assign_to": "devops",
                    "source": "github_actions_monitoring",
                    "workflow_id": run_id,
                    "workflow_name": workflow_name,
                    "branch": branch,
                    "run_details": run_details,
                },
            )

            await self.task_tracker.create_task(
                fix_task.task_id,
                "devops",
                fix_task.description,
                status="pending",
                attempts=0,
            )
            await self.message_bus.publish(Channels.CTO_TASKS_DEVOPS, fix_task)
            self.logger.info("workflow_fix_task_created", workflow_name=workflow_name, run_id=run_id)
        except Exception as e:
            self.logger.error("create_workflow_fix_task_error", error=str(e))

    async def _fix_workflow_failures(self, task: TaskMessage) -> TaskResult:
        """Fix GitHub Actions workflow failures."""
        import time
        start = time.time()

        product_root = await get_product_project_dir(self.company_brain)
        if not product_root:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error="Could not resolve product repository from company brain",
                time_taken_seconds=int(time.time() - start),
            )
        if not self.github_actions:
            self.github_actions = GitHubActionsManager(product_root)

        try:
            # Get context from task
            context = task.context or {}
            run_id = context.get("workflow_id")
            workflow_name = context.get("workflow_name", "deploy.yml")
            run_details = context.get("run_details")

            # If no run_id, get latest failed workflows
            if not run_id:
                failed_workflows = await self.github_actions.get_failed_workflows(limit=1)
                if not failed_workflows:
                    return TaskResult(
                        task_id=task.task_id,
                        success=True,
                        output="No failed workflows found.",
                        time_taken_seconds=int(time.time() - start),
                    )
                workflow = failed_workflows[0]
                run_id = workflow.get("id")
                run_details = await self.github_actions.get_workflow_run_logs(run_id)

            if not run_details:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error="Could not fetch workflow run details",
                    time_taken_seconds=int(time.time() - start),
                )

            # Get workflow file
            workflow_content = await self.github_actions.get_workflow_file(workflow_name=workflow_name)
            if not workflow_content:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error=f"Could not find workflow file: {workflow_name}",
                    time_taken_seconds=int(time.time() - start),
                )

            # Analyze failure
            jobs = run_details.get("jobs", [])
            failed_steps = []
            for job in jobs:
                if job.get("conclusion") == "failure":
                    for step in job.get("steps", []):
                        if step.get("conclusion") == "failure":
                            failed_steps.append({
                                "job": job.get("name"),
                                "step": step.get("name"),
                            })

            # Create prompt for LLM to fix workflow
            prompt = f"""GitHub Actions workflow '{workflow_name}' failed.

Failed steps:
{chr(10).join(f"- {s['job']} → {s['step']}" for s in failed_steps)}

Current workflow file:
```yaml
{workflow_content}
```

Analyze the failure and provide a fixed workflow file. Common issues:
- Missing dependencies or setup steps
- Incorrect environment variables or secrets
- Wrong paths or working directories
- Missing build/install steps
- Incorrect action versions

Provide the complete fixed workflow file wrapped in ```yaml code block with file path comment."""

            fixed_workflow = await self.call_llm(
                DEVOPS_SYSTEM_PROMPT,
                prompt,
            )

            # Extract workflow code from LLM response
            import re
            yaml_match = re.search(r"```yaml\n(.*?)\n```", fixed_workflow, re.DOTALL)
            if not yaml_match:
                yaml_match = re.search(r"```\n(.*?)\n```", fixed_workflow, re.DOTALL)

            if yaml_match:
                fixed_content = yaml_match.group(1)

                write_result = await self.code_writer.write_code(
                    code_output=fixed_content,
                    task_description=f"Fix GitHub Actions workflow {workflow_name}",
                    task_id=task.task_id,
                    agent_role="devops",
                )

                if write_result.get("files_written"):
                    return TaskResult(
                        task_id=task.task_id,
                        success=True,
                        output=f"✅ Fixed workflow {workflow_name}. Files written: {write_result.get('files_written')}",
                        time_taken_seconds=int(time.time() - start),
                    )
                else:
                    return TaskResult(
                        task_id=task.task_id,
                        success=False,
                        error="Failed to write fixed workflow file",
                        time_taken_seconds=int(time.time() - start),
                    )
            else:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error="Could not extract workflow code from LLM response",
                    time_taken_seconds=int(time.time() - start),
                )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                time_taken_seconds=int(time.time() - start),
            )
