"""E2B code executor - run Python in isolated sandbox via e2b_code_interpreter."""

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
    """
    Execute Python code in an E2B sandbox.
    Uses e2b_code_interpreter.Sandbox per E2B docs.
    """
    settings = get_settings()
    key = api_key or settings.e2b_api_key
    if not key:
        return CodeExecutionResult(
            success=False,
            stdout="",
            stderr="",
            error="E2B_API_KEY not set. Add to .env or pass api_key.",
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
