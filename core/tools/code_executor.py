"""Code executor — Cloudflare container sandbox primary, E2B as fallback."""

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


def _run_code_cloudflare(code: str) -> Optional[CodeExecutionResult]:
    """Run code on the Cloudflare exec container via the worker /exec route."""
    settings = get_settings()
    if not (settings.cloudflare_api_url and settings.cloudflare_api_token):
        return None
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
            return None
        d = r.json()
        return CodeExecutionResult(
            success=d.get("success", False),
            stdout=d.get("stdout", ""),
            stderr=d.get("stderr", ""),
            result=d.get("result"),
            error=d.get("error"),
        )
    except Exception:
        return None


def run_code(code: str, api_key: Optional[str] = None) -> CodeExecutionResult:
    """
    Execute Python code — Cloudflare container sandbox first, E2B fallback.
    """
    settings = get_settings()

    cf = _run_code_cloudflare(code)
    if cf is not None:
        return cf

    key = api_key or settings.e2b_api_key
    if not key:
        return CodeExecutionResult(
            success=False,
            stdout="",
            stderr="",
            error="No exec backend: Cloudflare /exec unavailable and E2B_API_KEY not set.",
        )
    try:
        from e2b_code_interpreter import Sandbox

        with Sandbox.create(api_key=key) as sbx:
            execution = sbx.run_code(code)
            stdout = "\n".join(execution.logs.stdout) if execution.logs.stdout else ""
            stderr = "\n".join(execution.logs.stderr) if execution.logs.stderr else ""
            result = execution.text if execution.results else None
            err_msg = str(execution.error) if execution.error else None
            return CodeExecutionResult(
                success=execution.error is None,
                stdout=stdout,
                stderr=stderr,
                result=result,
                error=err_msg,
            )
    except ImportError:
        return CodeExecutionResult(
            success=False,
            stdout="",
            stderr="",
            error="Install e2b-code-interpreter: poetry add e2b-code-interpreter",
        )
    except Exception as e:
        return CodeExecutionResult(
            success=False,
            stdout="",
            stderr="",
            error=str(e),
        )
