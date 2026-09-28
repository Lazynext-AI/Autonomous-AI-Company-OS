"""Base agent - abstract class with retry-diversify-escalate protocol."""

import asyncio
import re
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, Optional

from pydantic import BaseModel, Field
import structlog

from core.config import get_model_for_role
from core.memory.agent_memory import AgentMemory
from core.memory.company_brain import CompanyBrain
from core.memory.episodic_memory import EpisodicMemory
from core.messaging.bus import MessageBus
from core.messaging.channels import Channels
from core.messaging.schemas import (
    HRRequestMessage,
    KnowledgeRequestMessage,
    QAAlertMessage,
    ReportMessage,
    TaskMessage,
)
from core.operations.task_tracker import TaskTracker

if TYPE_CHECKING:
    from core.evaluation.reward_engine import RewardEngine
    from core.evaluation.scorer import PerformanceScorer

# Spec-level vetoes where the task can never ship as written — protected-path
# blocks, task-fit rejections, and phantom-import rejections are static gate
# outcomes that retry identically forever, so they die as `failed` instead of
# escalating for human review. Deliberately absent: "repo test suite failed"
# and runtime exceptions — both may be real fixable defects worth human eyes.
_DETERMINISTIC_VETO_MARKERS = (
    "deliverable blocked:",
    "deliverable rejected: task-fit",
    "deliverable rejected: phantom",
    "phantom_completion:",
)

# A result claims a file deliverable when it carries a File: path marker in
# comment/header form (``// File:``, ``# File:``, ``<!-- File:``, ``#### File:``),
# opens straight with a code fence, or cites a GitHub /pull/ URL. Real code
# completions always carry write evidence appended by post_task_hook ([Files
# written:], [Committed to git], [Pushed to remote], git_branch) — a PR URL
# alone is a CLAIM, not evidence: hallucinated and real links are text-
# identical, and every real PR is preceded by a commit our hooks mark. Claim
# without evidence = phantom completion: the blob was produced but write_code
# placed/committed nothing (protected path, veto, parse failure) — historically
# these were marked `completed` anyway, and 200+ such rows had to be corrected
# by hand (bare-URL phantoms 661808ac/5ff7cd78/4723feb3 corrected 2026-09-27).
_ARTIFACT_CLAIM_RE = re.compile(
    r"(?m)^\s*(?:#{1,4}|/{2}|<!--|\*{1,2})?\s*File:\s*[\w./-]+\.[a-z0-9]+",
    re.IGNORECASE,
)
_PR_CLAIM_RE = re.compile(r"/pull/\d+")
_ARTIFACT_EVIDENCE_RE = re.compile(
    r"\[Files written:|\[Committed to git\]|\[Pushed to remote\]|git_branch"
)


class TaskResult(BaseModel):
    """Task execution result."""

    task_id: str = ""
    success: bool = False
    output: str = ""
    artifacts: list[str] = Field(default_factory=list)
    approach_used: str = ""
    time_taken_seconds: int = 0
    error: Optional[str] = None
    lesson: Optional[str] = None


class BaseAgent(ABC):
    """Abstract base agent with full retry-diversify-escalate protocol."""

    def __init__(
        self,
        agent_id: str,
        role: str,
        company_brain: CompanyBrain,
        agent_memory: AgentMemory,
        episodic_memory: EpisodicMemory,
        message_bus: MessageBus,
        ollama_client,  # WorkersAIClient or any client with chat_completion(model, messages, system_prompt)
        rag_engine=None,
        knowledge_downloader=None,
        performance_scorer: "PerformanceScorer | None" = None,
        reward_engine: "RewardEngine | None" = None,
        task_tracker: TaskTracker | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.role = role
        self.model = get_model_for_role(role)
        self.company_brain = company_brain
        self.agent_memory = agent_memory
        self.episodic_memory = episodic_memory
        self.message_bus = message_bus
        self.ollama_client = ollama_client
        self.rag_engine = rag_engine
        self.knowledge_downloader = knowledge_downloader
        self.performance_scorer = performance_scorer
        self.reward_engine = reward_engine
        self.task_tracker = task_tracker or TaskTracker()
        self.logger = structlog.get_logger().bind(agent_id=agent_id, role=role)
        self.is_running = False
        self.current_task: Optional[TaskMessage] = None
        self._injected_context: str = ""
        self._last_status_update: float = 0
        self._last_status_value: tuple[str, str] = ("", "")
        self._status_throttle_seconds: int = 60

    @abstractmethod
    async def execute_task(self, task: TaskMessage) -> TaskResult:
        """Subclasses implement task execution."""
        pass

    @abstractmethod
    def get_subscribed_channels(self) -> list[Channels]:
        """Channels this agent subscribes to."""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """System prompt for this agent."""
        pass

    async def build_full_context(self) -> str:
        """Build rich context string for LLM calls."""
        parts = []
        if self._injected_context:
            parts.append(self._injected_context)
        try:
            brain = await self.company_brain.get()
            parts.append(f"Company: {brain.product_name}")
            parts.append(f"Mission: {brain.mission}")
            parts.append(f"Current sprint: {brain.current_sprint}")
            parts.append(f"Metrics: {brain.metrics}")
            parts.append(f"Open bugs: {sum(1 for b in brain.open_bugs if (b.get('status', 'open') if isinstance(b, dict) else getattr(b, 'status', 'open')) == 'open')}")
            parts.append(f"Tech stack: {brain.tech_stack}")
        except Exception as e:
            self.logger.warning("build_context_brain_failed", error=str(e))

        try:
            mem = await self.agent_memory.get(self.agent_id)
            parts.append(f"Patterns learned: {mem.patterns_learned}")
        except Exception as e:
            self.logger.warning("build_context_memory_failed", error=str(e))

        try:
            events = await self.episodic_memory.get_recent(self.agent_id, n=10)
            parts.append("Recent events: " + "; ".join(e.content[:50] for e in events[:5]))
        except Exception:
            pass

        return "\n".join(parts)

    async def call_llm(
        self,
        system_prompt: str,
        user_message: str,
        extra_context: str = "",
    ) -> str:
        """Call LLM with full context."""
        context = await self.build_full_context()
        full_system = f"{context}\n\n{extra_context}\n\n{system_prompt}"
        return await self.ollama_client.chat_completion(
            self.model,
            [{"role": "user", "content": user_message}],
            system_prompt=full_system,
        )

    async def _maybe_update_status(self, status: str, current_task: str) -> None:
        """Update status only if throttle elapsed or value changed."""
        import time
        now = time.monotonic()
        key = (status, current_task[:100] if current_task else "")
        if key != self._last_status_value or (now - self._last_status_update) >= self._status_throttle_seconds:
            await self.company_brain.update_agent_status(self.agent_id, status, current_task)
            self._last_status_update = now
            self._last_status_value = key

    async def run(self) -> None:
        """Main agent loop."""
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "polling")
                tasks_found = False
                for channel in self.get_subscribed_channels():
                    msgs = await self.message_bus.read_messages(
                        channel, "agents", self.agent_id, count=5
                    )
                    for msg_id, msg in msgs:
                        if isinstance(msg, TaskMessage):
                            tasks_found = True
                            await self.handle_task(msg)
                            await self.message_bus.acknowledge(
                                channel, "agents", msg_id
                            )
                        elif isinstance(msg, KnowledgeRequestMessage):
                            tasks_found = True
                            await self.handle_knowledge_request(msg)
                            await self.message_bus.acknowledge(
                                channel, "agents", msg_id
                            )
                        else:
                            self.logger.warning(
                                "unsupported_message_type",
                                channel=channel.value,
                                type=type(msg).__name__,
                            )
                            await self.message_bus.acknowledge(
                                channel, "agents", msg_id
                            )

                await self.periodic_work()

                if not tasks_found:
                    await self.idle_behavior()

                await asyncio.sleep(0.5)  # Reduced from 2s for faster response
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("agent_loop_error", error=str(e))
                await asyncio.sleep(2)  # Reduced from 10s for faster recovery

        self.is_running = False
        await self.company_brain.update_agent_status(
            self.agent_id, "stopped", ""
        )

    async def handle_task(self, task: TaskMessage) -> None:
        """Full retry-diversify-escalate protocol."""
        self.current_task = task
        await self._maybe_update_status("active", task.description[:100])
        await self.episodic_memory.add_event(
            self.agent_id, "task_started", task.description
        )

        prompts = await self.agent_memory.get_pending_prompts(self.agent_id)
        await self.agent_memory.mark_prompts_consumed(self.agent_id)
        extra_context = "\n".join(prompts) if prompts else ""
        last_error = ""
        attempt_errors: list[str] = []
        last_result = TaskResult(
            task_id=task.task_id,
            success=False,
            error="Task did not complete",
            approach_used="not_started",
        )

        for attempt in range(1, 6):
            try:
                await self.task_tracker.mark_in_progress(task.task_id, self.agent_id, task.description)
                self._injected_context = extra_context if extra_context else ""
                if attempt == 1:
                    result = await self.execute_task(task)
                elif attempt == 2:
                    if self.rag_engine:
                        rag_result = await self.rag_engine.query(task.description)
                        if rag_result.needs_download and self.knowledge_downloader:
                            await self.knowledge_downloader.find_and_download(
                                task.description, "engineering", ingestion_callback=None
                            )
                        self._injected_context = f"RAG context: {rag_result.answer or 'No relevant knowledge found.'}"
                    else:
                        self._injected_context = "RAG unavailable for this run. Continue with internal best practices."
                    self._inject_last_error(last_error)
                    result = await self.execute_task(task)
                elif attempt == 3:
                    await self.message_bus.publish(
                        Channels.KNOWLEDGE_REQUESTS,
                        KnowledgeRequestMessage(
                            from_agent=self.agent_id,
                            query=task.description,
                            requesting_agent=self.agent_id,
                            urgency="high",
                        ),
                    )
                    await asyncio.sleep(3)  # Reduced from 12s for faster knowledge retrieval
                    knowledge_prompts = await self.agent_memory.get_pending_prompts(self.agent_id)
                    if knowledge_prompts:
                        await self.agent_memory.mark_prompts_consumed(self.agent_id)
                        self._injected_context = "\n".join(knowledge_prompts)
                    else:
                        self._injected_context = "Knowledge agent had no immediate guidance. Continue with best effort."
                    self._inject_last_error(last_error)
                    result = await self.execute_task(task)
                elif attempt == 4:
                    try:
                        from core.config import get_light_model
                        light_model = get_light_model()
                        decomp = await self.ollama_client.chat_completion(
                            light_model,
                            [{"role": "user", "content": f"Break into 3-5 subtasks:\n{task.description}"}],
                            system_prompt="List as bullet points only.",
                        )
                    except Exception:
                        decomp = await self.call_llm(
                            "Break this task into 3-5 atomic subtasks. List them as bullet points.",
                            task.description,
                        )
                    self._injected_context = f"Decomposed subtasks: {decomp}"
                    self._inject_last_error(last_error)
                    result = await self.execute_task(task)
                else:
                    break

                if result.success:
                    # Write hooks run before completion is recorded — a hook
                    # may veto success (e.g. every generated file was
                    # protected-skipped) so the task retries instead of
                    # "completing" with nothing shipped.
                    await self.post_task_hook(task, result)
                if result.success and self._phantom_artifact_claim(result):
                    # Claims file artifacts but nothing was written or
                    # committed — recording `completed` would mint a phantom
                    # row. Veto so it retries; a transient miss (parse slip,
                    # one-off veto) can still ship on a later attempt, while
                    # persistent phantoms exhaust attempts and die as
                    # `failed`/`infeasible:` via the deterministic-veto path.
                    result.success = False
                    result.error = (
                        "phantom_completion: result claims file artifacts "
                        "(File: markers / code blob / PR link) but write_code "
                        "produced no files_written or git evidence"
                    )
                if result.success:
                    self._injected_context = ""
                    await self.on_success(task, result)
                    return
                else:
                    err_msg = result.error or "Task returned unsuccessful result"
                    last_error = err_msg
                    last_result = result
                    attempt_errors.append(err_msg)
                    await self.agent_memory.record_task_failed(
                        self.agent_id, task.task_id, err_msg, result.approach_used
                    )
                    await self.task_tracker.append_error(task.task_id, err_msg, attempt)
                    if result.lesson:
                        await self.agent_memory.add_pattern_learned(
                            self.agent_id, result.lesson
                        )
            except Exception as e:
                last_error = str(e)
                last_result = TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error=last_error,
                    approach_used=f"attempt_{attempt}_exception",
                )
                attempt_errors.append(last_error)
                self.logger.error("attempt_failed", attempt=attempt, error=last_error)
                await self.agent_memory.increment_retry(self.agent_id)
                await self.task_tracker.append_error(task.task_id, last_error, attempt)

        if attempt_errors and all(
            self._is_deterministic_veto(e) for e in attempt_errors
        ):
            # Every attempt hit a spec-level veto (protected paths, task-fit,
            # phantom imports) — the task can never ship as specified, so it
            # dies as `failed` rather than escalated. No QA alert or HR spawn:
            # a human cannot fix a task spec that violates static gates.
            # Test-gate failures and exceptions stay escalatable — they may be
            # real implementation defects worth human review.
            await self.task_tracker.mark_failed(
                task.task_id,
                self.agent_id,
                f"infeasible: spec-level veto — {last_error or 'deterministic rejection'}",
                5,
            )
            await self.episodic_memory.add_event(
                self.agent_id, "task_failed_terminal",
                f"Task {task.task_id} failed terminally — deterministic veto",
            )
        else:
            await self.task_tracker.mark_escalated(
                task.task_id,
                self.agent_id,
                last_error or f"Task {task.task_id} failed after retries",
                5,
            )
            await self.episodic_memory.add_event(
                self.agent_id, "task_escalated", f"Task {task.task_id} escalated after 5 attempts"
            )
            await self.message_bus.publish(
                Channels.QA_ALERTS,
                QAAlertMessage(
                    from_agent=self.agent_id,
                    severity="HIGH",
                    error_details=f"Task {task.task_id} failed after 5 attempts. Last error: {last_error}",
                ),
            )
            await self.message_bus.publish(
                Channels.HR_REQUESTS,
                HRRequestMessage(
                    from_agent=self.agent_id,
                    request_type="spawn_agent",
                    role_needed=self.role,
                    reason="Task escalated",
                ),
            )
        if self.reward_engine:
            try:
                await self.reward_engine.process_score(
                    self.agent_id,
                    0.0,
                    task,
                    last_result,
                )
            except Exception as e:
                self.logger.warning("reward_engine_failure_path_failed", error=str(e))
        self.current_task = None

    def _inject_last_error(self, last_error: str) -> None:
        """Fold the previous attempt's failure into the retry context — the
        retry prompt sees what broke (test tail, gate reason) instead of
        regenerating blind and repeating the same defect."""
        if not last_error:
            return
        feedback = (
            "Previous attempt failed — fix this, do not retry blind: "
            f"{last_error[:800]}"
        )
        self._injected_context = (
            f"{self._injected_context}\n\n{feedback}"
            if self._injected_context
            else feedback
        )

    @staticmethod
    def _is_deterministic_veto(error: str) -> bool:
        return any(m in error.lower() for m in _DETERMINISTIC_VETO_MARKERS)

    @staticmethod
    def _phantom_artifact_claim(result: TaskResult) -> bool:
        """Result asserts a file deliverable that never touched disk or git."""
        out = result.output or ""
        if not out or _ARTIFACT_EVIDENCE_RE.search(out):
            return False
        return bool(
            out.lstrip().startswith("```")
            or _ARTIFACT_CLAIM_RE.search(out)
            or _PR_CLAIM_RE.search(out)
        )

    async def on_success(self, task: TaskMessage, result: TaskResult) -> None:
        """Handle successful task completion."""
        performance_score: float | None = None
        if self.performance_scorer:
            try:
                performance_score = await self.performance_scorer.score_task(
                    task.task_id,
                    result,
                    self.agent_id,
                    task,
                )
            except Exception as e:
                self.logger.warning("performance_scoring_failed", task_id=task.task_id, error=str(e))

        await self.agent_memory.record_task_completed(
            self.agent_id, task.task_id, result.output, result.approach_used, result.time_taken_seconds
        )
        await self.task_tracker.mark_completed(
            task.task_id,
            self.agent_id,
            result.output,
            performance_score=performance_score,
        )
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=task.task_id,
                status="completed",
                result=result.output,
                time_taken=result.time_taken_seconds,
            ),
        )
        await self.agent_memory.reset_retry(self.agent_id)
        await self.episodic_memory.add_event(
            self.agent_id, "task_completed", task.description[:80]
        )
        if self.reward_engine and performance_score is not None:
            try:
                await self.reward_engine.process_score(
                    self.agent_id,
                    performance_score,
                    task,
                    result,
                )
            except Exception as e:
                self.logger.warning("reward_engine_success_path_failed", task_id=task.task_id, error=str(e))
        self.current_task = None

    async def post_task_hook(self, task: TaskMessage, result: TaskResult) -> None:
        """Override in subclass for post-task logic."""
        pass

    async def handle_knowledge_request(self, request: KnowledgeRequestMessage) -> None:
        """Handle knowledge request from peer."""
        pass

    async def periodic_work(self) -> None:
        """Hook run every loop iteration, busy or idle.

        Override for interval-driven work (e.g. scheduled outreach) that must
        fire even while the agent keeps receiving tasks — idle_behavior only
        runs when the queue is empty.
        """

    async def idle_behavior(self) -> None:
        """Default idle: sleep briefly."""
        await asyncio.sleep(3)

    def stop(self) -> None:
        """Gracefully stop the agent."""
        self.is_running = False
