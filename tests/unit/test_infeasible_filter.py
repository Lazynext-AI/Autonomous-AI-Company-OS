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


def test_launchdeck_scaffold_tasks_die() -> None:
    # products/launchdeck is a scaffold stub (no repo/tests/deploy path) — every
    # named task phantoms after 3 attempts. Observed live-queue descriptions.
    # (OAuth/JWT-flavoured LaunchDeck tasks die even earlier on user
    # accounts/auth; these isolate the launchdeck match.)
    for desc in (
        "Create onboarding documentation and support resources for LaunchDeck customers",
        "Build the Launch-Deck subscription management module",
        "Design the LaunchDeck admin interface",
        "Develop a module to display LaunchDeck scan results",
    ):
        assert infeasible_task_reason(desc) == "launchdeck scaffold", desc


def test_deliverable_gated_patterns() -> None:
    # Dead classes that only kill when the noun IS the deliverable —
    # verb + optional qualifier + noun, not a bare substring.
    for desc in (
        "Develop a mobile app that scans websites",
        "Create an iOS application for report viewing",
        "Build a react native client",
        "Create a new landing page for the Q4 campaign",
        "Develop PDF document scanning capabilities",
        "Develop a new module for PDF document analysis",
        "Build a lead capture system",
        "Set up drip campaign automation",
        "Develop personalized accessibility recommendations",
        "Create a dashboard to track key metrics",
        "Implement tracking for user engagement",
        "Add a signup form with OAuth",
    ):
        assert infeasible_task_reason(desc) is not None, desc


def test_deeper_coverage_doc_churn_dies() -> None:
    # docs/research/accessibility_checker_deeper_* tasks generated proposal
    # docs restating shipped features (PRs #92/#93 closed as churn). The old
    # \bdeeper\b gate missed underscore-joined filenames — `_` is a word char.
    for desc in (
        "create docs/research/accessibility_checker_deeper_wcag_3.0_coverage.md",
        "create docs/research/accessibility_checker_deeper_ux_coverage_testing.md",
        "Add deeper wcag coverage analysis",
        "Create deeper-coverage deliverable doc",
    ):
        assert infeasible_task_reason(desc) == "deeper-coverage deliverable", desc


def test_audience_and_copy_mentions_survive() -> None:
    # Measured false positives — every one of these was auto-killed by the
    # ungated patterns before 2026-09-25 despite being legit marketing/docs
    # work. The dead noun appearing in an audience/context phrase must not
    # kill the task; only the deliverable noun kills.
    for desc in (
        "Create a sales outreach campaign targeting mobile app developers",
        "Create a sales outreach sequence to target mobile app development companies and accessibility consultants",
        "Develop a targeted marketing campaign to promote the accessibility checker product to mobile app development companies",
        "Develop a tutorial on how to integrate the Accessibility Checker tool into a mobile app development workflow",
        "Create a technical guide for integrating the accessibility checker product with popular mobile app development tools",
        "Create a guide for customers on how to use the Accessibility Checker tool to improve the accessibility of their mobile apps",
        "Optimize the product's landing page for better conversion rates",
        "Improve the accessibility checker product's landing page to increase conversion rates",
        "Write a follow-up email template for trial users",
        "Create newsletter content for existing customers",
        "Create email templates for sales outreach and lead capture",
        "Write personalized outreach emails to accessibility consultants",
        "Improve the PDF report styling and layout",
        "Create a doc explaining the SDK authentication flow",
        "Create a report to analyze trial extension requests and conversion funnel metrics",
        "Improve the login page accessibility",
        "Add scan metrics to the existing dashboard",
    ):
        assert infeasible_task_reason(desc) is None, desc
