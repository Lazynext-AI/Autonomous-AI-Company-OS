"""Code writer - writes generated code to files and commits to git."""

import asyncio
import re
from pathlib import Path
from typing import Optional, Any

import structlog

from core.config import get_settings
from core.tools.bin_resolver import find_binary
from core.tools.code_validator import CodeValidator
from core.tools.file_manager import FileManager
from core.tools.git_manager import GitManager
from core.tools.product_resolver import get_product_project_dir

logger = structlog.get_logger(__name__)

_NODE_BUILTINS = frozenset({
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "dns", "domain", "events", "fs", "http",
    "http2", "https", "inspector", "module", "net", "os", "path",
    "perf_hooks", "process", "punycode", "querystring", "readline", "repl",
    "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
    "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
})
# Bare import specifiers in written files — from 'x', import 'x',
# import('x'), require('x'), export ... from 'x'.
_IMPORT_SPEC_RE = re.compile(
    r"(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|\bimport\s+)['\"]([^'\"]+)['\"]"
)


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
    # Check for file path in comment (e.g., # File: scripts/x.py or // File: src/x.js)
    file_comment = re.search(r"(?:#|//)\s*File:\s*([^\n]+)", code, re.IGNORECASE)
    if file_comment:
        return file_comment.group(1).strip()

    # Check for common patterns
    desc_lower = task_description.lower()
    # No FastAPI/Next.js surface exists — the product repo is vanilla JS
    # (src/*.js modules behind worker.js + index.html) and the platform is
    # Python agents + a TypeScript Worker. Code written for those stacks is
    # a hallucinated deliverable; unplaceable beats a ghost app/ tree.
    if "from fastapi import" in code or "@app.post" in code or "@app.get" in code or "@router" in code:
        return None
    if re.search(r"from ['\"]react['\"]|from ['\"]next[/']|import React", code):
        return None
    if "CREATE TABLE" in code.upper() or "ALTER TABLE" in code.upper() or "migration" in desc_lower:
        import time
        return f"migrations/{int(time.time())}_migration.sql"
    if language == "python" and "def " in code:
        # Try to extract function/class name
        func_match = re.search(r"def\s+(\w+)", code)
        if func_match:
            return f"scripts/{func_match.group(1)}.py"
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
    if language == "javascript" or language == "js" or language == "mjs":
        if "config" in desc_lower:
            return "config.js"
        export_match = re.search(
            r"export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)", code
        )
        if export_match:
            return f"src/{export_match.group(1)}.js"
        return None
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


def _retained_line_fraction(prev: str, nxt: str) -> float:
    """Fraction of prev's non-empty lines still present in nxt — a rewrite
    keeping under half is a gutting, not an update (the cloud writer applies
    the same check at the artifact loop)."""
    keep = {l.strip() for l in nxt.splitlines() if l.strip()}
    prev_lines = [l.strip() for l in prev.splitlines() if l.strip()]
    if not prev_lines:
        return 1.0
    return sum(1 for l in prev_lines if l in keep) / len(prev_lines)


class CodeWriter:
    """Write code to files and commit to git. One repo per product in company brain."""

    def __init__(self, company_brain: Optional[Any] = None):
        self.settings = get_settings()
        self.company_brain = company_brain
        self.validator = CodeValidator()
        self.file_manager: Optional[FileManager] = None
        self.git_manager: Optional[GitManager] = None
        self._llm: Optional[Any] = None

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
            # .github/ is devops-only territory — workflow fixes go through
            # the gated PR path where CI validates the workflow itself.
            if rel in PROTECTED_FILES or (rel.startswith(".github/") and agent_role != "devops"):
                logger.info("protected_file_skipped", file=filename, task_id=task_id)
                skipped_protected.append(filename)
                continue

            # Doc-gutting guard — overwriting an existing file while keeping
            # under half of its lines is destruction, not an update (verified:
            # a task replaced the measured perf baseline doc with generic
            # prose; length-ratio checks miss it because prose is dense).
            filepath_chk = repo_root / rel
            if filepath_chk.is_file():
                prev_text = filepath_chk.read_text(encoding="utf-8", errors="replace")
                if len(prev_text) >= 800 and _retained_line_fraction(prev_text, code) < 0.5:
                    logger.warning("doc_gutting_skipped", file=filename, task_id=task_id)
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

        # Deterministic phantom-import gate — the LLM check below let
        # through code importing nonexistent packages (@cloudflare/brevo,
        # @cloudflare/kv) because no test imports dead files. Bare specifiers
        # must resolve to package.json deps or Node builtins.
        phantom_failed = None
        if files_written and not tests_failed:
            phantom_failed = self._check_phantom_imports(files_written, repo_root)

        # Task-fit review — catches valid-but-wrong artifacts (DOM ids that
        # don't exist, same-origin API calls from Pages, dead code) that the
        # test gate cannot. Same role as the cloud loop's LLM review.
        fitness_failed = None
        if files_written and not tests_failed and not phantom_failed:
            fitness_failed = await self._fitness_check(task_description, files_written, repo_root)

        reverted: list[str] = []
        if tests_failed or fitness_failed or phantom_failed:
            # Rejected artifacts left in the tree poison the next task's
            # test run — undo this round's writes. files_written must also
            # be cleared: callers treat a non-empty list as "work shipped"
            # and would mark the task completed over reverted files.
            await self._revert_files(repo_root, files_written)
            reverted, files_written = files_written, []

        # Commit to git if files were written
        git_info = {"committed": False, "branch": None, "pushed": False}
        if files_written and self.git_manager and not tests_failed and not fitness_failed and not phantom_failed:
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

        # A pushed branch with no PR means the open call failed (e.g. a
        # rotated token) — surface the reason instead of letting "pushed"
        # imply the PR exists.
        if git_info.get("pr_error"):
            result["pr_error"] = git_info["pr_error"]

        if reverted:
            result["reverted"] = reverted

        if tests_failed:
            result["tests_failed"] = tests_failed

        if fitness_failed:
            result["fitness_failed"] = fitness_failed

        if phantom_failed:
            result["phantom_imports"] = phantom_failed

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
        node = find_binary("node")
        if not node:
            return None  # node genuinely absent — CI remains the backstop
        try:
            # Bare `node --test` auto-discovers test files — same invocation
            # as CI. (`node --test test/` resolves the dir as a module path.)
            # `node` is resolved via find_binary: under launchd the PATH is
            # /usr/bin:/bin so a bare lookup fails and this gate silently
            # no-ops on every write (PR #87 shipped a broken test that way).
            proc = await asyncio.create_subprocess_exec(
                node, "--test",
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

    def _check_phantom_imports(
        self, files: list[str], repo_root: Path
    ) -> Optional[str]:
        """Reject bare import specifiers that don't resolve — nonexistent
        npm packages are the most common fleet hallucination and no test
        catches them when the file is dead code. Returns issue text or None.
        Skips when there's no package.json to judge against."""
        pkg_file = repo_root / "package.json"
        if not pkg_file.exists():
            return None
        try:
            import json as _json
            pkg = _json.loads(pkg_file.read_text(encoding="utf-8"))
        except Exception:
            return None
        declared = set()
        for key in ("dependencies", "devDependencies", "peerDependencies",
                    "optionalDependencies"):
            declared.update(pkg.get(key) or {})

        bad: list[str] = []
        for rel in files:
            if not rel.endswith((".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")):
                continue
            try:
                content = (repo_root / rel).read_text(encoding="utf-8")
            except Exception:
                continue
            for spec in set(_IMPORT_SPEC_RE.findall(content)):
                if spec.startswith((".", "/", "node:", "data:", "http:", "https:")):
                    continue
                root = spec if not spec.startswith("@") else "/".join(spec.split("/")[:2])
                if not spec.startswith("@"):
                    root = spec.split("/")[0]
                if root not in declared and root not in _NODE_BUILTINS:
                    bad.append(f"{rel}: '{spec}'")
        if bad:
            issue = "phantom imports: " + "; ".join(sorted(bad)[:5])
            logger.warning("phantom_imports_rejected", issue=issue)
            return issue
        return None

    async def _revert_files(self, repo_root: Path, files: list[str]) -> None:
        """Undo this round's writes: tracked files restore from HEAD, new
        files delete (with empty parent dirs pruned)."""
        for rel in files:
            proc = await asyncio.create_subprocess_exec(
                "git", "checkout", "HEAD", "--", rel,
                cwd=str(repo_root),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            rc = await proc.wait()
            path = repo_root / rel
            if rc != 0 and path.exists():
                path.unlink()
                for parent in path.parents:
                    if parent == repo_root:
                        break
                    try:
                        parent.rmdir()  # only removes when empty
                    except OSError:
                        break
        logger.info("files_reverted", files=files)

    async def _fitness_check(
        self, task_description: str, files: list[str], repo_root: Path
    ) -> Optional[str]:
        """LLM task-fit review — rejects only concrete mismatches (references
        to files/DOM ids/routes that don't exist, wrong hosts, unrelated code).
        Returns the issue text, or None when the artifacts fit."""
        try:
            from core.config import get_light_model
            from core.llm.workers_ai_client import WorkersAIClient

            if self._llm is None:
                self._llm = WorkersAIClient()

            proc = await asyncio.create_subprocess_exec(
                "git", "ls-files", cwd=str(repo_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await proc.communicate()
            tree = out.decode(errors="replace")[:3000]

            parts = []
            for rel in files[:4]:
                try:
                    content = (repo_root / rel).read_text(encoding="utf-8")[:2500]
                    parts.append(f"### {rel}\n{content}")
                except Exception:
                    continue
            if not parts:
                return None

            verdict = await self._llm.chat_completion(
                get_light_model(),
                [{"role": "user", "content": (
                    f"TASK: {task_description}\n\n"
                    f"EXISTING REPO FILES:\n{tree}\n\n"
                    f"NEW ARTIFACTS:\n" + "\n\n".join(parts)
                )}],
                system_prompt=(
                    "Review whether the new artifacts concretely fit the task and this repo. "
                    "Reject ONLY for hard defects: references to files, DOM ids, routes, or "
                    "endpoints that do not exist; wrong API hosts (the site's API is the "
                    "workers.dev URL, not same-origin); code unrelated to the task. "
                    "Style, verbosity, and incompleteness are NOT defects. "
                    'Reply JSON only: {"ok":true} or {"ok":false,"issue":"<one sentence>"}'
                ),
            )
            import json as _json
            text = str(verdict).strip()
            start, end = text.find("{"), text.rfind("}")
            data = _json.loads(text[start:end + 1]) if start >= 0 else {"ok": True}
            if not data.get("ok", True):
                issue = str(data.get("issue", "task-fit rejected"))[:300]
                logger.warning("fitness_check_rejected", issue=issue)
                return issue
            return None
        except Exception as e:
            logger.warning("fitness_check_error", error=str(e))
            return None  # LLM unavailable — test gate + CI remain the backstop
