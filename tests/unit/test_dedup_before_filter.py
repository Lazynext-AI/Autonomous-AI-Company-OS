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


def test_dead_corpus_markers_match_across_mirrors() -> None:
    # The dead corpus lives in two places that must agree: worker
    # DEAD_CORPUS_WHERE (index.ts) and the local CTO query (cto_agent.py).
    # Extract both from source and assert the result-side marker set is
    # identical — a marker added to one mirror without the other silently
    # unsuppresses respawns on whichever side misses it.
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    worker = (root / "worker/src/index.ts").read_text()
    clause = re.search(r'DEAD_CORPUS_WHERE\s*=\s*"([^"]+)"', worker).group(1)
    worker_result = set(re.findall(r"result LIKE '%([^']+)%'", clause))

    cto = (root / "agents/strategic/cto_agent.py").read_text()
    params = re.search(r'dead = client\.query\((.*?)\]\)', cto, re.S).group(1)
    # The dead-corpus param list: first N "%...%" literals map to the result
    # LIKEs, the trailing three to error_log LIKEs (infeasible/Deliverable/
    # phantom_completion). Result markers are everything before the first
    # error_log-only marker — count the result LIKE ?s to split correctly.
    sql_result_placeholders = params[: params.index("error_log LIKE")].count("result LIKE")
    literals = re.findall(r'"%([^"]+)%"', params)
    cto_result = set(literals[:sql_result_placeholders])

    assert worker_result == cto_result
    # Operator annotations meaning "work shipped — the class is dead" must be
    # corpus-visible, or escalations closed as shipped respawn as dup work.
    assert {"closed:", "resolved:"} <= worker_result
    # "deferred:" stays out deliberately — a pending business decision must
    # resurface, and suppressing it would block the post-decision proposal.
    assert "deferred:" not in worker_result
