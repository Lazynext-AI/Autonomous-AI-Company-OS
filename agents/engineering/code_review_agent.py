"""Code Review Agent - Reviews generated code for security, quality, and best practices."""

import asyncio
import re
from pathlib import Path
from typing import Any

from agents.base_agent import BaseAgent, TaskResult
from core.config import get_settings
from core.tools.product_resolver import get_product_project_dir
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage
from core.memory.company_brain import CompanyBrain
from core.memory.agent_memory import AgentMemory
from core.memory.episodic_memory import EpisodicMemory
from core.messaging.bus import MessageBus
import structlog

logger = structlog.get_logger(__name__)

CODE_REVIEW_SYSTEM_PROMPT = """You are a senior code review agent specializing in security, code quality, and best practices.

Your responsibilities:
1. Review generated code for security vulnerabilities (SQL injection, XSS, secrets exposure, etc.)
2. Check code quality (error handling, type safety, documentation)
3. Validate best practices (DRY, SOLID principles, performance)
4. Suggest improvements before code is merged
5. Flag critical issues that must be fixed

Review criteria:
- Security: No hardcoded secrets, proper input validation, secure defaults
- Quality: Error handling, type hints, clear naming, documentation
- Performance: Efficient algorithms, proper caching, no N+1 queries
- Best Practices: SOLID principles, DRY, proper abstractions

Output format:
- CRITICAL: Must fix before merge (security issues, breaking bugs)
- WARNING: Should fix (code quality, performance issues)
- SUGGESTION: Nice to have (style, minor improvements)

Be thorough but practical. Focus on real issues, not style preferences."""

class CodeReviewAgent(BaseAgent):
    """Agent that reviews code for security, quality, and best practices."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.settings = get_settings()

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_CODE_REVIEW]

    def get_system_prompt(self) -> str:
        return CODE_REVIEW_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        """Review code files for security, quality, and best practices."""
        import time
        start = time.time()
        
        try:
            # Resolve product directory from company brain
            project_dir = await get_product_project_dir(self.company_brain)
            if not project_dir:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error="Could not resolve product directory from company brain",
                    time_taken_seconds=int(time.time() - start),
                )
            
            # Extract file paths from task description or context
            file_paths = self._extract_file_paths(task, project_dir)
            if not file_paths:
                return TaskResult(
                    task_id=task.task_id,
                    success=False,
                    error="No file paths found in task description",
                    time_taken_seconds=int(time.time() - start),
                )
            
            # Parallelize file reviews and scans
            async def review_file_async(file_path_str: str):
                file_path = project_dir / file_path_str.lstrip("/")
                if not file_path.exists():
                    return {"file": file_path_str, "error": "File not found"}
                try:
                    code = file_path.read_text(encoding="utf-8")
                    return await self._review_file(file_path_str, code, task)
                except Exception as e:
                    logger.warning("file_review_failed", file=file_path_str, error=str(e))
                    return {"file": file_path_str, "error": str(e)}
            
            # Run all reviews in parallel
            review_tasks = [review_file_async(fp) for fp in file_paths]
            reviews = await asyncio.gather(*review_tasks, return_exceptions=True)
            
            # Categorize issues
            critical_issues = []
            warnings = []
            suggestions = []
            
            for review_result in reviews:
                if isinstance(review_result, Exception):
                    logger.warning("review_exception", error=str(review_result))
                    continue
                if review_result.get("critical_issues"):
                    critical_issues.extend(review_result["critical_issues"])
                if review_result.get("warnings"):
                    warnings.extend(review_result["warnings"])
                if review_result.get("suggestions"):
                    suggestions.extend(review_result["suggestions"])
            
            # Run security and dependency scans in parallel
            security_scan_task = self._security_scan(file_paths, project_dir)
            dependency_scan_task = self._dependency_scan(project_dir)
            security_scan, dependency_scan = await asyncio.gather(
                security_scan_task, dependency_scan_task, return_exceptions=True
            )
            
            if isinstance(security_scan, Exception):
                logger.warning("security_scan_failed", error=str(security_scan))
                security_scan = {"issues": [], "summary": "Security scan failed"}
            if isinstance(dependency_scan, Exception):
                logger.warning("dependency_scan_failed", error=str(dependency_scan))
                dependency_scan = {"vulnerabilities": [], "summary": "Dependency scan failed"}
            
            # Build output
            output = "## Code Review Report\n\n"
            
            if critical_issues:
                output += f"### 🔴 CRITICAL ISSUES ({len(critical_issues)})\n"
                for issue in critical_issues[:10]:  # Limit to 10
                    output += f"- {issue}\n"
                output += "\n"
            
            if warnings:
                output += f"### ⚠️ WARNINGS ({len(warnings)})\n"
                for warning in warnings[:10]:
                    output += f"- {warning}\n"
                output += "\n"
            
            if suggestions:
                output += f"### 💡 SUGGESTIONS ({len(suggestions)})\n"
                for suggestion in suggestions[:5]:
                    output += f"- {suggestion}\n"
                output += "\n"
            
            if security_scan.get("issues"):
                output += f"### 🔒 Security Scan\n{security_scan['summary']}\n\n"
            
            if dependency_scan.get("vulnerabilities"):
                output += f"### 📦 Dependency Scan\n{dependency_scan['summary']}\n\n"
            
            if not critical_issues and not warnings:
                output += "✅ Code review passed! No critical issues found.\n"
            
            success = len(critical_issues) == 0
            
            return TaskResult(
                task_id=task.task_id,
                success=success,
                output=output,
                approach_used="code_review",
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            logger.error("code_review_failed", error=str(e), task_id=task.task_id)
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=f"Code review failed: {str(e)}",
                time_taken_seconds=int(time.time() - start),
            )

    def _extract_file_paths(self, task: TaskMessage, project_dir: Path | None = None) -> list[str]:
        """Extract file paths from task description or context."""
        paths = []
        
        # Check context
        if task.context:
            if isinstance(task.context, dict):
                if "file_paths" in task.context:
                    paths = task.context["file_paths"]
                elif "files" in task.context:
                    paths = task.context["files"]
        
        # Extract from description using regex
        if not paths:
            desc = task.description or ""
            # Match file paths like "review src/app.py" or "review product/src/main.py"
            pattern = r'(?:review|check|scan)\s+([^\s]+\.(?:py|ts|tsx|js|jsx|json|yaml|yml|sql|md))'
            matches = re.findall(pattern, desc, re.IGNORECASE)
            paths.extend(matches)
        
        # If still no paths, try to find recently modified files
        if not paths and project_dir and project_dir.exists():
            # Get Python files modified in last hour
            import time
            cutoff = time.time() - 3600
            for py_file in project_dir.rglob("*.py"):
                try:
                    if py_file.stat().st_mtime > cutoff:
                        rel_path = py_file.relative_to(project_dir)
                        paths.append(str(rel_path))
                except Exception:
                    pass
        
        return list(set(paths))[:10]  # Limit to 10 files

    async def _review_file(self, file_path: str, code: str, task: TaskMessage) -> dict[str, Any]:
        """Review a single file using LLM."""
        context = await self.build_full_context()
        
        prompt = f"""Review this code file for security vulnerabilities, code quality issues, and best practices.

File: {file_path}
Task: {task.description}

Code:
```python
{code[:8000]}  # Limit to 8000 chars
```

Provide a structured review with:
1. CRITICAL issues (security, breaking bugs) - must fix
2. WARNINGS (code quality, performance) - should fix
3. SUGGESTIONS (style, minor improvements) - nice to have

Format:
CRITICAL:
- Issue 1
- Issue 2

WARNINGS:
- Warning 1
- Warning 2

SUGGESTIONS:
- Suggestion 1
- Suggestion 2

If no issues, respond with "✅ No issues found."
"""
        
        response = await self.call_llm(CODE_REVIEW_SYSTEM_PROMPT, prompt)
        
        # Parse response
        critical_issues = []
        warnings = []
        suggestions = []
        
        current_section = None
        for line in response.split("\n"):
            line = line.strip()
            if "CRITICAL" in line.upper():
                current_section = "critical"
            elif "WARNING" in line.upper():
                current_section = "warning"
            elif "SUGGESTION" in line.upper():
                current_section = "suggestion"
            elif line.startswith("-") and current_section:
                issue = line[1:].strip()
                if current_section == "critical":
                    critical_issues.append(f"{file_path}: {issue}")
                elif current_section == "warning":
                    warnings.append(f"{file_path}: {issue}")
                elif current_section == "suggestion":
                    suggestions.append(f"{file_path}: {issue}")
        
        return {
            "file": file_path,
            "critical_issues": critical_issues,
            "warnings": warnings,
            "suggestions": suggestions,
        }

    async def _security_scan(self, file_paths: list[str], project_dir: Path) -> dict[str, Any]:
        """Scan for security issues: secrets, SQL injection, XSS, etc."""
        from core.tools.security_scanner import SecurityScanner
        
        scanner = SecurityScanner()
        all_issues = []
        
        for file_path_str in file_paths:
            file_path = project_dir / file_path_str.lstrip("/")
            if not file_path.exists():
                continue
            
            result = scanner.scan_file(file_path)
            all_issues.extend(result.get("issues", []))
        
        critical_issues = [i for i in all_issues if i.get("severity") == "CRITICAL"]
        high_issues = [i for i in all_issues if i.get("severity") == "HIGH"]
        
        return {
            "issues": all_issues,
            "critical_count": len(critical_issues),
            "high_count": len(high_issues),
            "summary": f"Found {len(critical_issues)} critical, {len(high_issues)} high severity issue(s)" if all_issues else "✅ No security issues detected",
        }

    async def _dependency_scan(self, project_dir: Path) -> dict[str, Any]:
        """Scan dependencies for known vulnerabilities."""
        from core.tools.security_scanner import DependencyScanner
        
        scanner = DependencyScanner()
        vulnerabilities = []
        
        # Check requirements.txt
        req_file = project_dir / "requirements.txt"
        if req_file.exists():
            result = scanner.scan_requirements(req_file)
            vulnerabilities.extend(result.get("vulnerabilities", []))
        
        # Check package.json
        pkg_file = project_dir / "package.json"
        if pkg_file.exists():
            result = scanner.scan_package_json(pkg_file)
            vulnerabilities.extend(result.get("vulnerabilities", []))
        
        return {
            "vulnerabilities": vulnerabilities,
            "summary": f"Found {len(vulnerabilities)} potential vulnerability(ies)" if vulnerabilities else "✅ No known vulnerabilities detected",
        }
