"""Code executor — Cloudflare container sandbox via the worker /exec route."""

from dataclasses import dataclass
from typing import Optional

from core.config import get_settings


@dataclass
class CodeExecutionResult:
    """Result of code execution."""

    success: bool
    stdout: str
    stderr: str
    result: Optional[str] = None
    error: Optional[str] = None


def run_code(code: str, api_key: Optional[str] = None) -> CodeExecutionResult:
    """Execute Python code on the Cloudflare exec container (worker /exec)."""
    settings = get_settings()
    if not (settings.cloudflare_api_url and settings.cloudflare_api_token):
        return CodeExecutionResult(
            success=False,
            stdout="",
            stderr="",
            error="Cloudflare not configured: set CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN.",
        )
    try:
        import httpx

        r = httpx.post(
            f"{settings.cloudflare_api_url.rstrip('/')}/exec",
            headers={
                "authorization": f"Bearer {settings.cloudflare_api_token}",
                "content-type": "application/json",
            },
            json={"code": code, "timeout": 60},
            timeout=90.0,
        )
        if r.status_code != 200:
            return CodeExecutionResult(success=False, stdout="", stderr="", error=f"exec HTTP {r.status_code}: {r.text[:200]}")
        d = r.json()
        return CodeExecutionResult(
            success=d.get("success", False),
            stdout=d.get("stdout", ""),
            stderr=d.get("stderr", ""),
            result=d.get("result"),
            error=d.get("error"),
        )
    except Exception as e:
        return CodeExecutionResult(success=False, stdout="", stderr="", error=str(e))
