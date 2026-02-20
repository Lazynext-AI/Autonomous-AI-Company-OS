"""Code writer - writes generated code to files and commits to git."""

import re
from pathlib import Path
from typing import Optional

import structlog

from core.config import get_settings
from core.tools.code_validator import CodeValidator
from core.tools.file_manager import FileManager
from core.tools.git_manager import GitManager

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


class CodeWriter:
    """Write code to files and commit to git."""

    def __init__(self, base_path: Optional[str] = None):
        self.settings = get_settings()
        self.validator = CodeValidator()
        # Get or create project repository (where agents build the product)
        repo_root = self._get_repo_root()
        if repo_root:
            self.file_manager = FileManager(repo_root)
            self.git_manager = GitManager(repo_root)
            logger.info("code_writer_initialized", project_dir=str(repo_root))
        else:
            self.file_manager = None
            self.git_manager = None
            logger.warning("code_writer_no_repo", project_dir=self.settings.project_dir)

    def _get_repo_root(self) -> Optional[Path]:
        """
        Get the project directory where agents build the product.
        Creates a new git repo if it doesn't exist.
        """
        # Use configured project directory (where agents build the product)
        project_dir = Path(self.settings.project_dir).resolve()
        
        # Create directory if it doesn't exist
        project_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize git repo if it doesn't exist (synchronous for now)
        if not (project_dir / ".git").exists():
            logger.info("initializing_project_repo", dir=str(project_dir))
            try:
                import subprocess
                
                # Initialize git repo
                proc = subprocess.run(
                    ["git", "init"],
                    cwd=str(project_dir),
                    capture_output=True,
                    text=True,
                )
                if proc.returncode == 0:
                    # Create initial commit
                    readme_path = project_dir / "README.md"
                    if not readme_path.exists():
                        readme_path.write_text(
                            "# Product Built by Autonomous AI Company\n\n"
                            "This repository contains the product built by AI agents.\n"
                            "All code is generated and maintained autonomously.\n"
                        )
                        subprocess.run(
                            ["git", "add", "README.md"],
                            cwd=str(project_dir),
                            capture_output=True,
                        )
                        subprocess.run(
                            ["git", "commit", "-m", "Initial commit - Product repository"],
                            cwd=str(project_dir),
                            capture_output=True,
                        )
                    logger.info("project_repo_initialized", dir=str(project_dir))
                    
                    # Automatically configure GitHub remote if token is available
                    if self.settings.github_token:
                        try:
                            from core.tools.github_repo import GitHubRepoManager
                            github_manager = GitHubRepoManager(project_dir)
                            # This will run async, but we're in sync context - schedule it
                            import asyncio
                            loop = asyncio.get_event_loop()
                            if loop.is_running():
                                # If loop is running, create task
                                asyncio.create_task(github_manager.ensure_remote_configured())
                            else:
                                # If no loop, run it
                                asyncio.run(github_manager.ensure_remote_configured())
                        except Exception as e:
                            logger.warning("auto_github_setup_failed", error=str(e))
            except Exception as e:
                logger.error("failed_to_init_repo", dir=str(project_dir), error=str(e))
                return None
        
        return project_dir

    async def write_code(
        self,
        code_output: str,
        task_description: str,
        task_id: str,
        agent_role: str,
    ) -> dict[str, any]:
        """Write code blocks to files in the project directory. Returns dict with files_written, git_committed."""
        repo_root = self._get_repo_root()
        if not repo_root:
            logger.warning("no_project_repo", path=str(Path.cwd()))
            return {"files_written": [], "git_committed": False, "error": "Could not initialize project repository"}

        blocks = extract_code_blocks(code_output)
        if not blocks:
            # No code blocks found - try to treat entire output as code
            if code_output.strip():
                blocks = [{"language": "python", "code": code_output, "filename": None}]

        files_written = []
        validation_errors = []
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

        # Commit to git if files were written
        git_info = {"committed": False, "branch": None, "pushed": False}
        if files_written and self.git_manager:
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
        
        if validation_errors:
            result["validation_errors"] = validation_errors
            result["warnings"] = f"{len(validation_errors)} file(s) had validation issues"
        
        return result
