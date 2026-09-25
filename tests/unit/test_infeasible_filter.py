"""Deterministic kill-list in infeasible_task_reason.

Generated task specs that can never ship (impossible classes, already-shipped
systems, language-stack mismatches) die at insert as terminal failed rows —
the `infeasible:` marker lands them in the dead corpus so paraphrases stay
dead permanently. These specs were all observed burning attempts in the live
queue; the patterns are mirrored in worker/src/index.ts.
"""

from agents.strategic.cto_agent import infeasible_task_reason


def test_python_stack_deliverables_die() -> None:
    # All observed live-queue dead specs — the product repo is pure JS, so any
    # .py deliverable fails the node --test gate after burning 3 attempts.
    for desc in (
        "write test_uncovered_paths.py",
        "Create test_uncovered_paths_for_scanner.py",
        "Create test_accessibility_checker_deeper_w3c_coverage.py",
        "Integrate accessibility_checker.py into worker.js",
        "Integrate ai_scanner.py with wcag-scanner.js",
        "run pytest on the scanner module",
    ):
        assert infeasible_task_reason(desc) == "python-stack deliverable", desc


def test_language_agnostic_specs_survive() -> None:
    # Live pending queue at time of writing — none may be killed.
    for desc in (
        "write test for uncovered accessibility checker algorithm paths",
        "competitor analysis for accessibility checker",
        "security review of the worker",
        "measure effectiveness of the scanning API",
        "add test/coverage.test.mjs for edge cases",
        "fix src/scanner.js contrast ratio bug",
    ):
        assert infeasible_task_reason(desc) is None, desc


def test_existing_dead_classes_still_caught() -> None:
    assert infeasible_task_reason("add a landing page") == "landing/multi-page surface"
    assert infeasible_task_reason("implement Stripe payments") == "extra payment provider"
    assert infeasible_task_reason("scan PDF documents") == "document-file scanning"
