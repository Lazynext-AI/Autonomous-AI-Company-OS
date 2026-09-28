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


def test_dead_corpus_limit_matches_across_mirrors() -> None:
    # The cap is what stops corpus eviction — the 500→respawn-flood history is
    # in this file's docstring. A desynced cap (one mirror lowered, the other
    # not) silently re-opens the same failure on whichever side reads less.
    # Pin parity plus a floor at the current 10000; raising passes, lowering
    # must be a deliberate change to this test and the healthcheck warn level.
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    worker = (root / "worker/src/index.ts").read_text()
    # index.ts reads the corpus twice: a small prompt-side sample and the
    # dedup corpus proper. The corpus read is the largest LIMIT — take max.
    w_limit = max(
        int(m)
        for m in re.findall(
            r"DEAD_CORPUS_WHERE\} ORDER BY created_at DESC LIMIT (\d+)", worker
        )
    )

    cto = (root / "agents/strategic/cto_agent.py").read_text()
    dead_block = re.search(r"dead = client\.query\((.*?)\]\)", cto, re.S).group(1)
    c_limit = int(re.search(r"ORDER BY created_at DESC LIMIT (\d+)", dead_block).group(1))

    assert w_limit == c_limit
    assert w_limit >= 10000


def test_kill_class_anchor_check_precedes_tombstone() -> None:
    # Second flood mechanism (measured 2026-09-28, ~137 rows/day): divergent
    # paraphrases of a dead class share too few content words to trip
    # word-overlap dedup, slip to the kill-list, and each write a fresh
    # tombstone. The kill label IS the class name, so both mirrors must check
    # for an existing `infeasible: {label} (` anchor BEFORE writing — one row
    # per dead class ever, not one per paraphrase.
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]

    worker = (root / "worker/src/index.ts").read_text()
    w_anchor = worker.index("result LIKE ? OR error_log LIKE ? LIMIT 1")
    w_insert = worker.index("auto-killed at insert")
    assert w_anchor < w_insert
    # The prefix pattern pins the class label plus the " (" terminator —
    # dropping the terminator lets "audit" shadow "audit-report doc churn".
    assert "infeasible: ${infeasible} (%" in worker

    cto = (root / "agents/strategic/cto_agent.py").read_text()
    c_call = cto.index("self._dead_class_anchored(infeasible)")
    c_insert = cto.index('status="failed", attempts=3')
    assert c_call < c_insert
    assert 'f"infeasible: {label} (%"' in cto
    # Both columns: this mirror writes result=, the worker writes error_log=.
    assert re.search(r"result LIKE \?\s*\"\s*\n\s*\"OR error_log LIKE \?", cto)
