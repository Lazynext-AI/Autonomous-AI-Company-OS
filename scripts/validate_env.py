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

console = Console()

# How to fix each service
FIX_INSTRUCTIONS = {
    "cloudflare": (
        "Cloudflare: Deploy worker/ (cd worker && npx wrangler deploy), set "
        "CLOUDFLARE_API_URL to the workers.dev URL and CLOUDFLARE_API_TOKEN to the "
        "shared secret set via 'npx wrangler secret put API_TOKEN'."
    ),
    "atlas": (
        "Atlas Cloud: Get API key at atlascloud.ai. Add ATLASCLOUD_API_KEY to .env."
    ),
    "embeddings": (
        "Embeddings: Install sentence-transformers: pip install sentence-transformers (free, local, no API key)"
    ),
    "github": (
        "GitHub: github.com → Settings → Developer settings → Personal access tokens → Generate new token. "
        "Scopes: repo, read:org, workflow."
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


async def check_cloudflare() -> tuple[bool, str]:
    """Validate Cloudflare Worker is reachable and D1 is migrated."""
    url = os.getenv("CLOUDFLARE_API_URL", "").strip()
    token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if not url or not token:
        return False, "CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN required"
    try:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{url.rstrip('/')}/health", headers=headers)
            if r.status_code == 401:
                return False, "Invalid CLOUDFLARE_API_TOKEN (401)"
            if r.status_code != 200:
                return False, f"Worker /health returned HTTP {r.status_code}"
            r = await client.post(
                f"{url.rstrip('/')}/query",
                headers=headers,
                json={"sql": "SELECT id FROM company_brain LIMIT 1", "params": []},
            )
            if r.status_code != 200:
                return False, "D1 query failed - run 'make worker-migrate' to apply the schema."
            return True, "OK"
    except httpx.ConnectError as e:
        return False, f"Connection failed: {e}"
    except Exception as e:
        return False, str(e)


async def check_atlas() -> tuple[bool, str]:
    """Validate Atlas Cloud API key."""
    key = os.getenv("ATLASCLOUD_API_KEY", "").strip()
    base = os.getenv("ATLAS_BASE_URL", "https://api.atlascloud.ai/v1").strip().rstrip("/")
    model = os.getenv("ATLAS_MODEL", "deepseek-ai/DeepSeek-V3.1-Terminus").strip()
    if not key:
        return False, "ATLASCLOUD_API_KEY not set. Get at atlascloud.ai"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "Hi"}],
                },
            )
            if r.status_code == 200:
                return True, "OK"
            if r.status_code == 401:
                return False, "Invalid API key. Check atlascloud.ai"
            return False, f"HTTP {r.status_code}: {r.text[:120]}"
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
        ("Cloudflare", check_cloudflare, True),
        ("Atlas", check_atlas, True),
        ("Embeddings", check_embeddings, True),
        ("GitHub", check_github, False),
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

    failed_required = [r for r in results if not r[1] and r[0] in ("Cloudflare", "Atlas", "Embeddings")]
    failed_optional = [r for r in results if not r[1] and r[0] not in ("Cloudflare", "Atlas", "Embeddings")]

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
