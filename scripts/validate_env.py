#!/usr/bin/env python3
"""
Validate all API keys and services in .env before starting the agents.
Run: make validate-env  or  PYTHONPATH=. python scripts/validate_env.py
"""

import asyncio
import os
import sys
from pathlib import Path

# Add project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Load .env before importing config
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import httpx
from rich.console import Console
from rich.table import Table

console = Console()

# How to fix each service
FIX_INSTRUCTIONS = {
    "supabase": (
        "Supabase: Project Settings → API → copy SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY. "
        "Service key is under 'service_role' (keep secret!)."
    ),
    "redis": (
        "Redis: Run 'docker-compose up -d' to start Redis. Or ensure Redis is running at REDIS_URL."
    ),
    "claude": (
        "Claude: Get API key at console.anthropic.com. Add ANTHROPIC_API_KEY to .env."
    ),
    "embeddings": (
        "Embeddings: Install sentence-transformers: pip install sentence-transformers (free, local, no API key)"
    ),
    "chromadb": (
        "ChromaDB: Run 'docker-compose up -d' to start ChromaDB. It runs on port 8010."
    ),
    "github": (
        "GitHub: github.com → Settings → Developer settings → Personal access tokens → Generate new token. "
        "Scopes: repo, read:org, workflow."
    ),
    "vercel": (
        "Vercel: vercel.com → Account → Settings → Tokens → Create token. "
        "VERCEL_TEAM_ID: Team Settings → General → Team ID."
    ),
    "railway": (
        "Railway: railway.app → Account → Settings → Tokens → Create token. "
        "Use a token with full access (not workspace-scoped) for validation."
    ),
    "resend": (
        "Resend: resend.com → API Keys → Create API key. Free tier: 3000 emails/month. "
        "Add domain in Resend dashboard to send to non-resend.dev addresses."
    ),
    "e2b": (
        "E2B: pip install e2b-code-interpreter. Get API key at e2b.dev/dashboard → API Keys. "
        "Uses e2b_code_interpreter.Sandbox per E2B docs."
    ),
}


async def check_supabase() -> tuple[bool, str]:
    """Validate Supabase URL and keys."""
    url = os.getenv("SUPABASE_URL", "").strip()
    anon = os.getenv("SUPABASE_ANON_KEY", "").strip()
    service = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not (anon or service):
        return False, "SUPABASE_URL and at least one key (ANON or SERVICE) required"
    key = service or anon
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{url.rstrip('/')}/rest/v1/company_brain",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Accept": "application/json",
                },
                params={"select": "id", "limit": "1"},
            )
            if r.status_code in (200, 206):
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid key (401). Check SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY."
            if r.status_code == 404:
                return False, "404: Run supabase/migrations/001_initial.sql in Supabase SQL Editor to create tables."
            return False, f"HTTP {r.status_code}"
    except httpx.ConnectError as e:
        return False, f"Connection failed: {e}"
    except Exception as e:
        return False, str(e)


async def check_redis() -> tuple[bool, str]:
    """Validate Redis connection."""
    url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        import redis.asyncio as redis
        r = redis.from_url(url)
        await r.ping()
        await r.aclose()
        return True, "OK"
    except ImportError:
        return False, "redis package not installed"

    except Exception as e:
        return False, f"Cannot connect: {e}. Ensure Redis is running (docker-compose up -d)."


async def check_claude() -> tuple[bool, str]:
    """Validate Claude API key."""
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return False, "ANTHROPIC_API_KEY not set. Get at console.anthropic.com"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-5",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "Hi"}],
                },
            )
            if r.status_code == 200:
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid API key. Check console.anthropic.com"
            return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)


async def check_embeddings() -> tuple[bool, str]:
    """Validate local embeddings (sentence-transformers)."""
    try:
        from sentence_transformers import SentenceTransformer
        # Try loading the model (will download on first run)
        model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        test_emb = model.encode("test")
        if len(test_emb) == 384:  # all-MiniLM-L6-v2 produces 384-dim embeddings
            return True, "OK"
        return False, "Model loaded but wrong dimension"
    except ImportError:
        return False, "sentence-transformers not installed. Run: pip install sentence-transformers"
    except Exception as e:
        return False, f"Error loading model: {str(e)[:100]}"


async def check_chromadb() -> tuple[bool, str]:
    """Validate ChromaDB is reachable."""
    # ChromaDB runs on 8010 in docker-compose; try v2 then v1 heartbeat
    last_err = ""
    for path in ("/api/v2/heartbeat", "/api/v1/heartbeat"):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"http://localhost:8010{path}")
                if r.status_code == 200:
                    return True, "OK"
                last_err = f"HTTP {r.status_code}"
        except httpx.ConnectError:
            return False, "ChromaDB not reachable. Run 'docker-compose up -d'."
    return False, last_err or "ChromaDB returned non-200."


async def check_github() -> tuple[bool, str]:
    """Validate GitHub token."""
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        return False, "GITHUB_TOKEN not set"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 200:
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid or expired token. Generate new token at github.com/settings/tokens"
            if r.status_code == 403:
                return False, "Token lacks permissions. Add repo, read:org scopes."
            return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)


async def check_vercel() -> tuple[bool, str]:
    """Validate Vercel token."""
    token = os.getenv("VERCEL_TOKEN", "").strip()
    if not token:
        return False, "VERCEL_TOKEN not set"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.vercel.com/v2/user",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code == 200:
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid token. Create at vercel.com/account/tokens"
            if r.status_code == 403:
                return False, "Token expired or revoked."
            return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)


async def check_railway() -> tuple[bool, str]:
    """Validate Railway token."""
    token = os.getenv("RAILWAY_TOKEN", "").strip()
    if not token:
        return False, "RAILWAY_TOKEN not set"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                "https://backboard.railway.app/graphql/v2",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"query": "query { me { id } }"},
            )
            if r.status_code == 200:
                data = r.json()
                if "errors" in data and data["errors"]:
                    err = data["errors"][0].get("message", "Unknown")
                    if "not authorized" in err.lower():
                        return False, "Token invalid or workspace-scoped. Use full-access token."
                    return False, err
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid token. Create at railway.app → Account → Tokens"
            return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)


async def check_resend() -> tuple[bool, str]:
    """Validate Resend API key."""
    key = os.getenv("RESEND_API_KEY", "").strip()
    if not key:
        return False, "RESEND_API_KEY not set (optional for emails)"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.resend.com/domains",
                headers={"Authorization": f"Bearer {key}"},
            )
            if r.status_code == 200:
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid key. Create at resend.com → API Keys"
            if r.status_code == 403:
                return False, "Key invalid or revoked."
            return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)


async def check_e2b() -> tuple[bool, str]:
    """Validate E2B API key using e2b_code_interpreter SDK (Sandbox.create + run_code)."""
    key = os.getenv("E2B_API_KEY", "").strip()
    if not key:
        return False, "E2B_API_KEY not set (optional for sandbox execution)"
    try:
        from e2b_code_interpreter import Sandbox

        def _validate() -> None:
            with Sandbox.create(api_key=key) as sbx:
                sbx.run_code("print(1)")

        await asyncio.to_thread(_validate)
        return True, "OK"
    except ImportError:
        return False, "Install e2b-code-interpreter: poetry add e2b-code-interpreter"
    except Exception as e:
        err = str(e).lower()
        if "401" in err or "unauthorized" in err or "invalid" in err:
            return False, "Invalid key. Create at e2b.dev/dashboard → API Keys"
        return False, str(e)


async def main() -> None:
    console.print("\n[bold]Validating .env and services...[/bold]\n")

    checks = [
        ("Supabase", check_supabase, True),
        ("Redis", check_redis, True),
        ("Claude", check_claude, True),
        ("Embeddings", check_embeddings, True),
        ("ChromaDB", check_chromadb, False),
        ("GitHub", check_github, False),
        ("Vercel", check_vercel, False),
        ("Railway", check_railway, False),
        ("Resend", check_resend, False),
        ("E2B", check_e2b, False),
    ]

    results: list[tuple[str, bool, str]] = []
    for name, fn, required in checks:
        ok, msg = await fn()
        results.append((name, ok, msg))
        if not ok and required:
            console.print(f"[red]✗[/red] {name}: {msg}")
        elif not ok:
            console.print(f"[yellow]⚠[/yellow] {name}: {msg}")
        else:
            console.print(f"[green]✓[/green] {name}: OK")

    failed_required = [r for r in results if not r[1] and r[0] in ("Supabase", "Redis", "Claude", "Embeddings")]
    failed_optional = [r for r in results if not r[1] and r[0] not in ("Supabase", "Redis", "Claude", "Embeddings")]

    if failed_required:
        console.print("\n[bold red]Required services failed. Fix these before starting:[/bold red]")
        for name, _, msg in failed_required:
            key = name.lower()
            console.print(f"\n  [bold]{name}[/bold]: {msg}")
            if key in FIX_INSTRUCTIONS:
                console.print(f"  → {FIX_INSTRUCTIONS[key]}")

    if failed_optional:
        console.print("\n[bold yellow]Optional services (fix if you need them):[/bold yellow]")
        for name, _, msg in failed_optional:
            key = name.lower()
            console.print(f"\n  [bold]{name}[/bold]: {msg}")
            if key in FIX_INSTRUCTIONS:
                console.print(f"  → {FIX_INSTRUCTIONS[key]}")

    if failed_required:
        console.print("\n")
        sys.exit(1)

    console.print("\n[bold green]All required services OK. You can run 'make dev' or 'make agents'.[/bold green]\n")


if __name__ == "__main__":
    asyncio.run(main())
