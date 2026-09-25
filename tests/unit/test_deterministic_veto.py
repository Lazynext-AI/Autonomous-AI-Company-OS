"""Deterministic-veto classification in BaseAgent.handle_task.

Tasks that fail every attempt on spec-level gates (protected paths, task-fit,
phantom imports) must terminate as `failed` — no escalation, no QA alert, no
HR spawn. Mixed outcomes (a veto plus a test failure or exception) and pure
exception runs still escalate for human review.
"""

from unittest.mock import AsyncMock

import pytest

from agents.base_agent import BaseAgent, TaskResult, _DETERMINISTIC_VETO_MARKERS
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage


class _StubAgent(BaseAgent):
    def __init__(self, errors: list[str | Exception]) -> None:
        super().__init__(
            agent_id="test-agent",
            role="backend",
            company_brain=AsyncMock(),
            agent_memory=AsyncMock(),
            episodic_memory=AsyncMock(),
            message_bus=AsyncMock(),
            ollama_client=AsyncMock(),
            task_tracker=AsyncMock(),
        )
        self._errors = errors
        self._call = 0
        self.agent_memory.get_pending_prompts.return_value = []

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        err = self._errors[min(self._call, len(self._errors) - 1)]
        self._call += 1
        if isinstance(err, Exception):
            raise err
        return TaskResult(task_id=task.task_id, success=False, error=err)

    def get_subscribed_channels(self) -> list[Channels]:
        return []

    def get_system_prompt(self) -> str:
        return "stub"


def _task() -> TaskMessage:
    return TaskMessage(from_agent="ceo", task_id="t-veto", description="do a thing")


VETO = "Deliverable blocked: generated files only target protected paths"
VETO_FIT = "Deliverable rejected: task-fit review found it wrong for this product"
VETO_PHANTOM = "Deliverable rejected: phantom imports — generated code references modules that don't exist"
TEST_FAIL = "Deliverable rejected: repo test suite failed — fix and reship"


@pytest.mark.asyncio
async def test_all_veto_attempts_fail_terminally() -> None:
    agent = _StubAgent([VETO, VETO_FIT, VETO_PHANTOM, VETO])
    await agent.handle_task(_task())

    agent.task_tracker.mark_failed.assert_awaited_once()
    assert agent.task_tracker.mark_failed.await_args.args[0] == "t-veto"
    assert "infeasible:" in agent.task_tracker.mark_failed.await_args.args[2]
    agent.task_tracker.mark_escalated.assert_not_awaited()

    published = [c.args[0] for c in agent.message_bus.publish.await_args_list]
    assert Channels.QA_ALERTS not in published
    assert Channels.HR_REQUESTS not in published


@pytest.mark.asyncio
async def test_mixed_veto_and_test_failure_escalates() -> None:
    agent = _StubAgent([VETO, TEST_FAIL, VETO, TEST_FAIL])
    await agent.handle_task(_task())

    agent.task_tracker.mark_escalated.assert_awaited_once()
    agent.task_tracker.mark_failed.assert_not_awaited()
    published = [c.args[0] for c in agent.message_bus.publish.await_args_list]
    assert Channels.QA_ALERTS in published
    assert Channels.HR_REQUESTS in published


@pytest.mark.asyncio
async def test_exception_attempts_escalate() -> None:
    agent = _StubAgent([RuntimeError("boom")])
    await agent.handle_task(_task())

    agent.task_tracker.mark_escalated.assert_awaited_once()
    agent.task_tracker.mark_failed.assert_not_awaited()


def test_marker_set_covers_veto_classes_not_test_gate() -> None:
    for msg in (VETO, VETO_FIT, VETO_PHANTOM):
        assert BaseAgent._is_deterministic_veto(msg), msg
    for msg in (TEST_FAIL, "boom", "Task returned unsuccessful result"):
        assert not BaseAgent._is_deterministic_veto(msg), msg
    assert all(m == m.lower() for m in _DETERMINISTIC_VETO_MARKERS)
