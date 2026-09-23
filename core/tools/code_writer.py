"""Code writer - writes generated code to files and commits to git."""

import asyncio
import re
from pathlib import Path
from typing import Optional, Any

import structlog

from core.config import get_settings
from core.tools.code_validator import CodeValidator
from core.tools.file_manager import FileManager
from core.tools.git_manager import GitManager
from core.tools.product_resolver import get_product_project_dir

logger = structlog.get_logger(__name__)


def extract_code_blocks(text: str) -> list[dict[str, str]]:
    """Extract code blocks from LLM output. Returns list of {language, code, filename}."""
    blocks = []
    # Match ```language\ncode\n``` or ```\ncode\n```
    pattern = r"```(?:(\w+))?\n(.*?)```"
    matches = re.finditer(pattern, text, re.DOTALL)
    for match in matches:
        language = match.group(1) or ""
        code = match.group(2).strip()
        if code:
            blocks.append({"language": language, "code": code, "filename": None})
    return blocks


def infer_filename(code: str, language: str, task_description: str) -> Optional[str]:
    """Infer filename from code content, comments, and task description."""
    # Check for file path in comment (e.g., # File: app/api/auth.py or // File: app/pages/login.tsx)
    file_comment = re.search(r"(?:#|//)\s*File:\s*([^\n]+)", code, re.IGNORECASE)
    if file_comment:
        return file_comment.group(1).strip()

    # Check for common patterns
    desc_lower = task_description.lower()
    if "from fastapi import" in code or "@app.post" in code or "@app.get" in code or "@router" in code:
        if "auth" in desc_lower or "login" in desc_lower or "register" in desc_lower:
            return "app/api/auth.py"
        elif "user" in desc_lower:
            return "app/api/users.py"
        return "app/api/routes.py"
    if "import React" in code or "export default" in code or "from 'next" in code:
        if "page" in desc_lower or "route" in desc_lower:
            return "app/pages/page.tsx"
        elif "component" in desc_lower:
            return "app/components/component.tsx"
        return "app/pages/page.tsx"
    if "CREATE TABLE" in code.upper() or "ALTER TABLE" in code.upper() or "migration" in desc_lower:
        import time
        return f"migrations/{int(time.time())}_migration.sql"
    if language == "python" and "def " in code:
        # Try to extract function/class name
        func_match = re.search(r"def\s+(\w+)", code)
        if func_match:
            return f"app/{func_match.group(1)}.py"
    if language == "yaml" or ".yml" in desc_lower or ".yaml" in desc_lower:
        if "github" in desc_lower or "ci" in desc_lower or "workflow" in desc_lower:
            return ".github/workflows/deploy.yml"
        elif "docker" in desc_lower:
            return "Dockerfile"
        return "config.yml"
    if language == "bash" or language == "sh" or language == "shell":
        if "deploy" in desc_lower or "script" in desc_lower:
            return "scripts/deploy.sh"
        elif "setup" in desc_lower:
            return "scripts/setup.sh"
        return "scripts/script.sh"
    if language == "javascript" or language == "js":
        if "config" in desc_lower:
            return "config.js"
        return "app/script.js"
    if language == "toml":
        return "pyproject.toml" if "project" in desc_lower or "poetry" in desc_lower else "config.toml"
    return None


# Core product files are owned by the deployed product, not by task output —
# regenerating them churns the live surface (the cloud loop enforces the same
# set). Agents extend the product via new modules instead.
PROTECTED_FILES = {
    "index.html",
    "worker.js",
    "src/scanner.js",
    "package.json",
    "test/scanner.test.mjs",
}


class CodeWriter:
    """Write code to files and commit to git. One repo per product in company brain."""

    def __init__(self, company_brain: Optional[Any] = None):
        self.settings = get_settings()
        self.company_brain = company_brain
        self.validator = CodeValidator()
        self.file_manager: Optional[FileManager] = None
        self.git_manager: Optional[GitManager] = None

    async def write_code(
        self,
        code_output: str,
        task_description: str,
        task_id: str,
        agent_role: str,
    ) -> dict[str, any]:
        """Write code blocks to files in the project directory. Returns dict with files_written, git_committed."""
        if not self.company_brain:
            logger.warning("code_writer_no_company_brain")
            return {"files_written": [], "git_committed": False, "error": "Company brain not configured"}
        
        repo_root = await get_product_project_dir(self.company_brain)
        if not repo_root:
            logger.warning("no_product_repo", path=str(Path.cwd()))
            return {"files_written": [], "git_committed": False, "error": "Could not resolve product repository"}
        
        # Ensure file_manager and git_manager match current product
        if self.file_manager is None or str(self.file_manager.repo_root) != str(repo_root):
            self.file_manager = FileManager(repo_root)
            self.git_manager = GitManager(repo_root)
            logger.info("code_writer_using_product", project_dir=str(repo_root))

        blocks = extract_code_blocks(code_output)
        if not blocks:
            # No code blocks found - try to treat entire output as code
            if code_output.strip():
                blocks = [{"language": "python", "code": code_output, "filename": None}]

        files_written = []
        validation_errors = []
        skipped_protected = []
        seen_filenames = set()  # Track to prevent duplicates
        
        for block in blocks:
            language = block["language"]
            code = block["code"]
            filename = block["filename"] or infer_filename(code, language, task_description)

            if not filename:
                logger.warning("could_not_infer_filename", task_id=task_id, language=language, code_preview=code[:100])
                continue
            
            # Skip duplicate files (same filename in same task)
            if filename in seen_filenames:
                logger.debug("skipping_duplicate_file", file=filename, task_id=task_id)
                continue
            seen_filenames.add(filename)

            rel = filename.lstrip("./").replace("\\", "/")
            if rel in PROTECTED_FILES or rel.startswith(".github/"):
                logger.info("protected_file_skipped", file=filename, task_id=task_id)
                skipped_protected.append(filename)
                continue

            # Validate code before writing
            is_valid, error_msg, validation_details = self.validator.validate(code, language)
            if not is_valid:
                validation_errors.append(f"{filename}: {error_msg}")
                logger.warning(
                    "code_validation_failed",
                    file=filename,
                    error=error_msg,
                    task_id=task_id,
                )
                # Continue anyway but log the issue
                # In production, you might want to skip invalid files

            filepath = repo_root / filename
            
            # Safety check: ensure we're writing within the project directory
            # Prevent writing to home directory or outside project
            try:
                repo_root_real = repo_root.resolve()
                filepath_real = filepath.resolve()
                # Check if filepath is within repo_root
                if not str(filepath_real).startswith(str(repo_root_real)):
                    logger.error("file_outside_repo", file=filename, repo=str(repo_root_real), filepath=str(filepath_real))
                    continue
            except Exception as e:
                logger.warning("path_resolution_failed", error=str(e))

            # Use file manager for safe writes with backup
            if self.file_manager:
                write_result = self.file_manager.safe_write(filepath, code, create_backup=True)
                if write_result["success"]:
                    files_written.append(str(filepath.relative_to(repo_root)))
                    if write_result["backup_created"]:
                        logger.info("file_backed_up", file=filename, backup=write_result["backup_path"])
                    if write_result["conflict_detected"]:
                        logger.warning("file_conflict_detected", file=filename, task_id=task_id)
                else:
                    logger.error("safe_write_failed", file=filename, error=write_result.get("error"))
                    continue
            else:
                # FileManager should always be available - log error if not
                logger.error("file_manager_not_available", file=filename, task_id=task_id)
                continue

        # Run the repo's node tests before committing — the fleet previously
        # pushed broken PRs (missing modules, jest API in node:test files)
        # because nothing ever executed the generated tests locally.
        tests_failed = None
        if files_written and any(f.endswith((".mjs", ".js")) for f in files_written):
            tests_failed = await self._run_node_tests(repo_root)

        # Commit to git if files were written
        git_info = {"committed": False, "branch": None, "pushed": False}
        if files_written and self.git_manager and not tests_failed:
            try:
                # Use git manager for branch-based commits
                git_info = await self.git_manager.create_pr_branch_and_commit(
                    task_id, task_description, files_written
                )
            except Exception as e:
                logger.warning("git_operation_failed", error=str(e))

        result = {
            "files_written": files_written,
            "git_committed": git_info.get("committed", False),
            "git_branch": git_info.get("branch"),
            "git_pushed": git_info.get("pushed", False),
            "repo_root": str(repo_root),
        }

        if tests_failed:
            result["tests_failed"] = tests_failed

        if skipped_protected:
            result["skipped_protected"] = skipped_protected
        
        if validation_errors:
            result["validation_errors"] = validation_errors
            result["warnings"] = f"{len(validation_errors)} file(s) had validation issues"
        
        return result

    async def _run_node_tests(self, repo_root: Path, timeout: int = 120) -> Optional[str]:
        """Run `node --test test/` in the product repo. Returns the failure
        output tail, or None when tests pass / can't run here."""
        test_dir = repo_root / "test"
        if not test_dir.is_dir() or not any(test_dir.glob("*.test.mjs")):
            return None
        try:
            proc = await asyncio.create_subprocess_exec(
                "node", "--test", "test/",
                cwd=str(repo_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return f"node --test timed out after {timeout}s"
            if proc.returncode == 0:
                return None
            tail = out.decode(errors="replace")[-1500:]
            logger.warning("local_tests_failed", output=tail[-300:])
            return tail
        except FileNotFoundError:
            return None  # node not installed locally — CI remains the backstop
