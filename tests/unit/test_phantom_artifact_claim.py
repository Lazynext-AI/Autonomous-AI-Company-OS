"""Phantom-artifact-claim detection in BaseAgent._phantom_artifact_claim.

A successful result that asserts a file deliverable — via File: path markers
(//, #, ####, <!--, * / **), a leading code fence, or a GitHub /pull/ URL —
must be vetoed when it carries no write evidence ([Files written:],
[Committed to git], [Pushed to remote], git_branch). A bare PR URL is a
claim, not evidence: hallucinated links are text-identical to real ones,
and every real PR is preceded by a commit our hooks mark. Claims with
evidence pass; plain prose passes. Regressed here because the first
cleanup only covered // and <!-- markers, letting the #- and ####-marker
cohort ship phantom completions — and three bare-URL phantoms
(661808ac/5ff7cd78/4723feb3, PRs closed unmerged) slipped the evidence
regex before URLs were reclassified as claims.
"""

import pytest

from agents.base_agent import BaseAgent, TaskResult


def _result(output: str) -> TaskResult:
    return TaskResult(task_id="t", success=True, output=output)


@pytest.mark.parametrize(
    "marker",
    [
        "// File: src/foo.js",
        "# File: scripts/run.py",
        "## File: src/rules/newrule.js",
        "#### File: worker/src/index.ts",
        "<!-- File: src/bar.js -->",
        "* File: src/baz.js",
        "** File: docs/notes.md",
        "Some prose first\n\n    // File: src/deep/nested.ts",
    ],
)
def test_file_markers_without_evidence_are_phantom(marker: str) -> None:
    assert BaseAgent._phantom_artifact_claim(_result(marker))


@pytest.mark.parametrize(
    "output",
    [
        "```python\ndef main():\n    pass\n```",
        "   ```js\nconsole.log(1)\n```",
        "```\nSELECT 1;\n```",
    ],
)
def test_leading_code_fence_without_evidence_is_phantom(output: str) -> None:
    assert BaseAgent._phantom_artifact_claim(_result(output))


@pytest.mark.parametrize(
    "output",
    [
        "# File: src/foo.js\n\n[Files written: src/foo.js]",
        "```js\n// code\n```\n\n[Committed to git]",
        "#### File: src/bar.ts\n\n[Pushed to remote] agent-abc123",
        "// File: src/x.js\n\ngit_branch: agent-task-1234",
        # Real PR completions: the URL rides along on write markers.
        "# File: src/y.py\n\n[Committed to git] [Pushed to remote] https://github.com/Lazynext-AI/repo/pull/42",
        "Multi-line claim:\n// File: a.js\n// File: b.js\n\n[Files written: a.js, b.js]",
    ],
)
def test_claims_with_write_evidence_pass(output: str) -> None:
    assert not BaseAgent._phantom_artifact_claim(_result(output))


@pytest.mark.parametrize(
    "output",
    [
        "",
        "**Accessibility Guide for Web Developers**\n\nWelcome to our guide...",
        "The audit found three issues: contrast, focus order, alt text.",
        "Plan: 1. Research keywords. 2. Draft content. 3. Publish.",
        "References src/scanner.js and worker/src/index.ts in prose only.",
        "The File: naming convention is used throughout this document.",
        # Citing an existing file for reference is prose, not a deliverable claim.
        "See github.com/org/repo/blob/main/src/z.js for the current implementation.",
    ],
)
def test_prose_without_file_claims_passes(output: str) -> None:
    assert not BaseAgent._phantom_artifact_claim(_result(output))


@pytest.mark.parametrize(
    "output",
    [
        # Bare PR links claim a merge that write_code never produced.
        "https://github.com/Lazynext-Platform/accessibility-checker/pull/92",
        "Opened PR: https://github.com/org/repo/pull/96 — all checks pass.",
        "# File: src/y.py\n\nhttps://github.com/Lazynext-AI/repo/pull/42",
    ],
)
def test_bare_pr_url_without_evidence_is_phantom(output: str) -> None:
    assert BaseAgent._phantom_artifact_claim(_result(output))


def test_veto_error_is_deterministic() -> None:
    # The veto message stamped in handle_task carries the phantom_completion:
    # marker, so an all-phantom run dies as failed/infeasible, not escalated.
    err = (
        "phantom_completion: result claims file artifacts "
        "(File: markers / code blob / PR link) but write_code "
        "produced no files_written or git evidence"
    )
    assert BaseAgent._is_deterministic_veto(err)
