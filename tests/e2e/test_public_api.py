"""E2E tests against the live Lazynext deployment.

These hit the real production worker — they verify the deployed system,
not a mock. Run: pytest tests/e2e -v
"""
import os
import httpx
import pytest

BASE = os.environ.get("LAZYNEXT_API_URL", "https://ai-company.lazynext.com")
KEY = os.environ.get("LAZYNEXT_API_KEY", "")


def _client():
    return httpx.Client(base_url=BASE, timeout=20)


class TestPublicSurface:
    def test_health(self):
        r = _client().get("/api/v1/health")
        assert r.status_code == 200

    def test_openapi_spec(self):
        r = _client().get("/api/v1/openapi.json")
        assert r.status_code == 200
        paths = r.json()["paths"]
        for p in ["/api/v1/health", "/api/v1/waitlist", "/api/v1/status", "/api/v1/tasks"]:
            assert p in paths

    def test_a2a_agent_card(self):
        r = _client().get("/.well-known/agent.json")
        assert r.status_code == 200
        card = r.json()
        assert card["name"] and card["skills"]

    def test_widget_js(self):
        r = _client().get("/widget.js")
        assert r.status_code == 200
        assert "data-lazynext" in r.text

    def test_status_requires_key(self):
        r = _client().get("/api/v1/status")
        assert r.status_code in (401, 403)

    def test_oauth_rejects_bad_client(self):
        r = _client().post(
            "/oauth/token",
            data={"grant_type": "client_credentials", "client_secret": "bogus"},
        )
        assert r.status_code == 401


class TestAuthed:
    @pytest.mark.skipif(not KEY, reason="LAZYNEXT_API_KEY not set")
    def test_status_with_key(self):
        r = _client().get("/api/v1/status", headers={"authorization": f"Bearer {KEY}"})
        assert r.status_code == 200

    @pytest.mark.skipif(not KEY, reason="LAZYNEXT_API_KEY not set")
    def test_agents_with_key(self):
        r = _client().get("/api/v1/agents", headers={"authorization": f"Bearer {KEY}"})
        assert r.status_code == 200
