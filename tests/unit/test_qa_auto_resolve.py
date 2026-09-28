"""QA auto-resolve: a passing suite must clear incidents it just disproved.

`open_bugs` had no recovery path — a transient api_health failure raised a
bug every loop (60s cadence minted four dupes on 2026-09-25), and briefings
kept counting them "open" days after the URL fix landed. Now a suite pass
resolves only the components it actually verified (api_health, frontend) —
user-reported bugs on other components must stay open.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agents.engineering.qa_agent import QAAgent
from core.memory.company_brain import BugSchema
from core.messaging.channels import Channels


class _Resp:
    def __init__(self, status: int) -> None:
        self.status_code = status


class _Client:
    def __init__(self, api_status: int, fe_status: int) -> None:
        self._api, self._fe = api_status, fe_status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url: str):
        return _Resp(self._api if url.endswith("/health") else self._fe)


def _agent(bugs: list[BugSchema]) -> QAAgent:
    brain = AsyncMock()
    brain.get.return_value = SimpleNamespace(
        live_urls={"api": "https://api.example", "frontend": "https://fe.example"},
        open_bugs=bugs,
    )
    agent = QAAgent(
        agent_id="qa-test",
        role="qa",
        company_brain=brain,
        agent_memory=AsyncMock(),
        episodic_memory=AsyncMock(),
        message_bus=AsyncMock(),
        ollama_client=AsyncMock(),
        task_tracker=AsyncMock(),
    )
    return agent


def _bug(bid: str, component: str, status: str = "open") -> BugSchema:
    return BugSchema(id=bid, description="x", component=component, status=status)


@pytest.mark.asyncio
async def test_pass_resolves_only_verified_components(monkeypatch):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _Client(200, 200))
    agent = _agent([
        _bug("b1", "api_health"),
        _bug("b2", "frontend"),
        _bug("b3", "user_reported"),           # not verified by the suite
        _bug("b4", "api_health", "resolved"),  # already closed
    ])
    await agent.run_full_qa_suite()

    resolved = {c.args[0] for c in agent.company_brain.resolve_bug.await_args_list}
    assert resolved == {"b1", "b2"}
    agent.company_brain.update_metrics.assert_awaited_once()


@pytest.mark.asyncio
async def test_failure_raises_incident_and_resolves_nothing(monkeypatch):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _Client(404, 200))
    agent = _agent([_bug("b1", "api_health")])
    await agent.run_full_qa_suite()

    agent.company_brain.resolve_bug.assert_not_awaited()
    assert agent.message_bus.publish.await_count == 1
    assert agent.message_bus.publish.await_args.args[0] == Channels.QA_ALERTS
