"""Founder briefing must only surface OPEN bugs.

`open_bugs` keeps resolved entries as history (manual D1 resolutions set
status='resolved' + a note rather than deleting the row). The CEO brief fed
the first five rows straight into the LLM prompt unfiltered, so fixed bugs —
the stale /health 404 corpus — kept reporting as live failures in every
Founder Briefing after they were resolved (observed 2026-09-28, briefing 118).
The agent-context "Open bugs: N" count had the same leak.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agents.strategic.ceo_agent import CEOAgent
from core.memory.company_brain import BugSchema


def _agent(bugs) -> CEOAgent:
    brain = AsyncMock()
    brain.get.return_value = SimpleNamespace(
        product_name="Accessibility Checker",
        mission="m",
        metrics={},
        shipped_features=[],
        open_bugs=bugs,
        blockers=[],
        current_sprint="",
        tech_stack=[],
        live_urls={},
    )
    return CEOAgent(
        agent_id="ceo-test",
        role="ceo",
        company_brain=brain,
        agent_memory=AsyncMock(),
        episodic_memory=AsyncMock(),
        message_bus=AsyncMock(),
        ollama_client=AsyncMock(),
        task_tracker=AsyncMock(),
    )


async def _brief_prompt(agent: CEOAgent) -> str:
    captured = {}

    async def fake_llm(system, prompt):
        captured["prompt"] = prompt
        return ""

    agent.call_llm = fake_llm
    await agent.generate_weekly_brief()
    return captured["prompt"]


@pytest.mark.asyncio
async def test_briefing_excludes_resolved_bugs():
    agent = _agent([
        BugSchema(id="b1", description="still broken", status="open"),
        BugSchema(id="b2", description="health probe 404", status="resolved"),
        {"id": "b3", "description": "raw dict resolved", "status": "resolved"},
    ])
    prompt = await _brief_prompt(agent)

    assert "still broken" in prompt
    assert "health probe 404" not in prompt
    assert "raw dict resolved" not in prompt


@pytest.mark.asyncio
async def test_briefing_says_none_when_all_resolved():
    agent = _agent([BugSchema(id="b1", description="fixed already", status="resolved")])
    prompt = await _brief_prompt(agent)

    assert "fixed already" not in prompt
    assert "Bugs: None" in prompt
