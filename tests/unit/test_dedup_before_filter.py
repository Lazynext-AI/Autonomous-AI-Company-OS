"""Dedup-before-filter ordering guarantee.

Measured defect (2026-09-27): the decompose loop ran infeasible_task_reason
BEFORE the duplicate check, so every paraphrase respawn of a dead class wrote
a fresh terminal tombstone — ~500 rows/day — flooding the dead corpus past
its LIMIT-500 read window and evicting the anchors, which respawned again.
327/328 kills that day matched rows older than the visible 500.

The reorder makes a respawn cost zero rows: _description_is_duplicate must
match a new phrasing against an existing dead-corpus row before the filter
fires. These tests pin the matcher semantics that guarantee relies on.
"""

from agents.strategic.cto_agent import CTOAgent


def _agent() -> CTOAgent:
    # The matcher is a pure function — construct without running the loop.
    return CTOAgent.__new__(CTOAgent)


DEAD_ROW = {
    "description": "Integrate Section 508 compliance checks into the scanner engine",
    "status": "failed",
    "agent_id": "backend",
    "created_at": "2026-09-25T00:00:00Z",
}


def test_dead_corpus_paraphrase_is_duplicate() -> None:
    # A reworded respawn of a dead class must dedup-match the tombstone —
    # this is what lets it be skipped before the infeasible filter writes
    # another tombstone.
    agent = _agent()
    assert agent._description_is_duplicate(
        "Develop Section 508 accessibility checks for the scanner", [DEAD_ROW]
    )
    assert agent._description_is_duplicate(
        "Create automated Section 508 compliance checks for the scanner",
        [DEAD_ROW],
    )


def test_substring_match_is_duplicate() -> None:
    agent = _agent()
    assert agent._description_is_duplicate(
        "Integrate Section 508 compliance checks into the scanner engine now",
        [DEAD_ROW],
    )


def test_unrelated_task_survives() -> None:
    agent = _agent()
    assert not agent._description_is_duplicate(
        "Add csv report streaming for large result sets", [DEAD_ROW]
    )
    assert not agent._description_is_duplicate(
        "Improve badge endpoint caching headers", [DEAD_ROW]
    )


def test_short_descriptions_never_dedup() -> None:
    # <15 chars can't produce a trustworthy overlap — must not be suppressed.
    agent = _agent()
    assert not agent._description_is_duplicate("fix bug", [DEAD_ROW])
