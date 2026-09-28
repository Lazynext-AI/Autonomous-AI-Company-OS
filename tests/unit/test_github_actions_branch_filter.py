"""Default-branch scoping in GitHubActionsManager.get_failed_workflows.

Measured noise (2026-09-28): the monitor's failure list carried 5 stale
PR-branch runs — `branch not in ("main","master")` inside
_create_workflow_fix_task already stopped fix tasks, but only AFTER
get_workflow_run_logs had fetched every PR-branch run's jobs. The
_fix_workflow_failures fallback could even pick run[0] off a PR branch.

The fetch layer now passes GitHub's `branch` param for the repo default
(cached via /repos/{owner}/{repo}) and post-filters head_branch on
("main","master") when that lookup fails. These tests pin both layers.
"""

import httpx
import pytest

from core.tools.github_actions import GitHubActionsManager


def _manager(default_branch=None, owner="o", repo="r") -> GitHubActionsManager:
    # Bypass settings/git — the methods under test only need these fields.
    mgr = GitHubActionsManager.__new__(GitHubActionsManager)
    mgr._repo_owner = owner
    mgr._repo_name = repo
    mgr._default_branch = default_branch
    mgr.token = "x"
    return mgr


class _Resp:
    status_code = 200
    text = ""

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _Client:
    """Minimal AsyncClient stand-in; records params so the branch param is testable."""

    def __init__(self, payload, requests):
        self._payload = payload
        self._requests = requests

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, params=None):
        self._requests.append({"url": url, "params": dict(params or {})})
        return _Resp(self._payload)


RUNS = {
    "workflow_runs": [
        {"id": 1, "head_branch": "agent/abc", "conclusion": "failure"},
        {"id": 2, "head_branch": "main", "conclusion": "failure"},
        {"id": 3, "head_branch": "fix/thing", "conclusion": "failure"},
    ]
}


@pytest.mark.asyncio
async def test_failed_workflows_scoped_to_default_branch(monkeypatch):
    requests = []
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client(RUNS, requests))

    mgr = _manager(default_branch="main")
    runs = await mgr.get_failed_workflows(limit=5)

    # API param scopes the page — PR runs can't crowd out a main failure.
    assert requests[0]["params"]["branch"] == "main"
    # Post-filter keeps only the default-branch run.
    assert [r["id"] for r in runs] == [2]


@pytest.mark.asyncio
async def test_failed_workflows_fallback_allows_main_and_master(monkeypatch):
    requests = []
    payload = {
        "workflow_runs": [
            {"id": 1, "head_branch": "agent/abc", "conclusion": "failure"},
            {"id": 2, "head_branch": "master", "conclusion": "failure"},
            {"id": 3, "head_branch": "main", "conclusion": "failure"},
        ]
    }
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client(payload, requests))

    # The repo-metadata GET returns the same runs-shaped payload, which has
    # no default_branch key — so the lookup fails and the filter falls back
    # to main/master with no API branch param.
    mgr = _manager(default_branch=None)
    runs = await mgr.get_failed_workflows(limit=5)

    assert "branch" not in requests[-1]["params"]
    assert [r["id"] for r in runs] == [2, 3]


@pytest.mark.asyncio
async def test_failed_workflows_custom_default_branch(monkeypatch):
    requests = []
    payload = {
        "workflow_runs": [
            {"id": 1, "head_branch": "main", "conclusion": "failure"},
            {"id": 2, "head_branch": "trunk", "conclusion": "failure"},
        ]
    }
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client(payload, requests))

    mgr = _manager(default_branch="trunk")
    runs = await mgr.get_failed_workflows(limit=5)

    # A repo whose default isn't main/master must not lose its failures.
    assert requests[0]["params"]["branch"] == "trunk"
    assert [r["id"] for r in runs] == [2]
