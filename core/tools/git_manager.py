"""Git manager - branch management, PR creation, and advanced git operations."""

import asyncio
import subprocess
from pathlib import Path
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class GitManager:
    """Manage git operations including branches and PRs."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root

    async def _run_git(self, *args: str) -> tuple[int, str, str]:
        """Run git command and return (returncode, stdout, stderr)."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "git",
                *args,
                cwd=str(self.repo_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return proc.returncode, stdout.decode(), stderr.decode()
        except Exception as e:
            logger.error("git_command_failed", command=args, error=str(e))
            return 1, "", str(e)

    async def get_current_branch(self) -> Optional[str]:
        """Get current git branch."""
        returncode, stdout, _ = await self._run_git("rev-parse", "--abbrev-ref", "HEAD")
        if returncode == 0:
            return stdout.strip()
        return None

    async def create_branch(self, branch_name: str, from_branch: str = "main") -> bool:
        """Create a new branch from specified branch."""
        # Check if branch exists, if not create main/master first
        returncode, stdout, _ = await self._run_git("branch", "--list", from_branch)
        if not stdout.strip():
            # Branch doesn't exist, create it
            returncode, _, _ = await self._run_git("checkout", "-b", from_branch)
            if returncode != 0:
                # Try master instead
                returncode, _, _ = await self._run_git("checkout", "-b", "master")
                if returncode == 0:
                    from_branch = "master"
                else:
                    logger.warning("failed_to_create_base_branch", branch=from_branch)
                    return False
        else:
            # Checkout base branch first
            returncode, _, _ = await self._run_git("checkout", from_branch)
            if returncode != 0:
                logger.warning("failed_to_checkout_base", branch=from_branch)
                return False

        # Create and checkout new branch
        returncode, _, _ = await self._run_git("checkout", "-b", branch_name)
        if returncode == 0:
            logger.info("branch_created", branch=branch_name, from_branch=from_branch)
            return True
        return False

    async def commit(self, files: list[str], message: str) -> bool:
        """Stage and commit files."""
        if not files:
            return False

        # Stage files
        returncode, _, stderr = await self._run_git("add", *files)
        if returncode != 0:
            logger.error("git_add_failed", error=stderr)
            return False

        # Check if there are changes to commit
        returncode, stdout, _ = await self._run_git("status", "--porcelain")
        if not stdout.strip():
            logger.info("no_changes_to_commit")
            return False

        # Commit
        returncode, _, stderr = await self._run_git("commit", "-m", message)
        if returncode == 0:
            logger.info("git_commit_success", files=files, message=message[:50])
            return True
        else:
            logger.warning("git_commit_failed", error=stderr[:200])
            return False

    async def has_remote(self, remote: str = "origin") -> bool:
        """Check if git remote exists."""
        returncode, stdout, _ = await self._run_git("remote", "get-url", remote)
        return returncode == 0

    async def push_branch(self, branch_name: str, remote: str = "origin") -> bool:
        """Push branch to remote. Automatically creates GitHub repo if needed."""
        from core.config import get_settings
        
        # Check if remote exists first
        if not await self.has_remote(remote):
            # Try to automatically create GitHub repo and configure remote
            logger.info("no_remote_configured", message="Attempting to create GitHub repo and configure remote")
            from core.tools.github_repo import GitHubRepoManager
            github_manager = GitHubRepoManager(self.repo_root)
            if await github_manager.ensure_remote_configured():
                logger.info("remote_configured_automatically")
            else:
                logger.error("failed_to_configure_remote", message="Set GITHUB_TOKEN in .env to enable automatic repo creation")
                return False
        
        # Inject the token into the push URL only — never persist it in
        # .git/config via remote URLs or -u upstream tracking.
        settings = get_settings()
        push_target = remote
        if settings.github_token:
            returncode, remote_url, _ = await self._run_git("remote", "get-url", remote)
            if returncode == 0:
                remote_url = remote_url.strip()
                if "@" in remote_url:
                    remote_url = f"https://{remote_url.split('@')[-1]}"
                    await self._run_git("remote", "set-url", remote, remote_url)
                if remote_url.startswith("https://") and "github.com" in remote_url:
                    push_target = remote_url.replace("https://", f"https://{settings.github_token.strip()}@")

        returncode, _, stderr = await self._run_git("push", push_target, branch_name)
        if returncode == 0:
            logger.info("branch_pushed", branch=branch_name, remote=remote)
            return True
        else:
            # Check if error is "repository not found" - try to create repo and update remote
            if "repository not found" in stderr.lower() or "repository 'https://" in stderr.lower():
                logger.warning("push_failed_repo_not_found", branch=branch_name, message="Repository doesn't exist, attempting to create it")
                from core.tools.github_repo import GitHubRepoManager
                github_manager = GitHubRepoManager(self.repo_root)
                
                # Remove existing remote and recreate
                await self._run_git("remote", "remove", remote)
                
                # Create repo and configure remote
                if await github_manager.ensure_remote_configured():
                    logger.info("repo_created_and_remote_configured", message="Retrying push after repo creation")
                    # Retry push against the freshly configured remote
                    returncode, _, stderr = await self._run_git("push", push_target, branch_name)
                    if returncode == 0:
                        logger.info("branch_pushed_after_repo_creation", branch=branch_name, remote=remote)
                        return True
                    else:
                        logger.warning("push_failed_after_repo_creation", branch=branch_name, error=stderr[:200])
                        return False
                else:
                    logger.error("failed_to_create_repo", message="Could not create GitHub repository")
                    return False
            else:
                logger.warning("push_failed", branch=branch_name, error=stderr[:200])
                return False

    async def create_pr_branch_and_commit(
        self, task_id: str, description: str, files: list[str]
    ) -> dict:
        """
        Create a feature branch, commit files, and optionally push.
        Returns dict with branch info.
        """
        # Generate branch name from task
        branch_name = f"agent/{task_id[:8]}/{description[:30].lower().replace(' ', '-')}"
        branch_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in branch_name)
        branch_name = branch_name[:50]  # Limit length

        # Always fork a fresh branch from the base — reusing whatever feature
        # branch happens to be checked out piles every task onto one mega-PR
        # that mixes unrelated (and possibly stale) work.
        branch_created = await self.create_branch(branch_name)
        if not branch_created:
            # Branch already exists (task retry) — check it out directly.
            rc, _, _ = await self._run_git("checkout", branch_name)
            branch_created = rc == 0

        commit_msg = f"[{task_id}] {description[:72]}"
        committed = await self.commit(files, commit_msg)

        result = {
            "branch": branch_name,
            "branch_created": branch_created,
            "committed": committed,
            "pushed": False,
        }

        # Optionally push (requires GitHub token for remote)
        if committed:
            pushed = await self.push_branch(branch_name)
            result["pushed"] = pushed
            if pushed:
                result["pr_url"], result["pr_error"] = await self._open_pr(branch_name, description)

        # Leave the repo on the base branch so the next task forks cleanly.
        rc, _, _ = await self._run_git("checkout", "main")
        if rc != 0:
            await self._run_git("checkout", "master")

        return result

    async def _open_pr(self, branch_name: str, title: str) -> tuple[str | None, str | None]:
        """Open a PR for the branch against the default branch, if none exists.

        Returns (pr_url, error): url on success, otherwise None plus a short
        reason. Push success used to mask a failed PR open (e.g. a rotated
        token) — the caller now carries the reason into the task result.
        """
        from core.config import get_settings
        settings = get_settings()
        if not settings.github_token:
            return None, "no github_token configured"
        returncode, remote_url, _ = await self._run_git("remote", "get-url", "origin")
        if returncode != 0 or "github.com" not in remote_url:
            return None, "origin remote is not github.com"
        repo = remote_url.strip().split("github.com/")[-1].removesuffix(".git")
        try:
            import httpx
            headers = {
                "Authorization": f"Bearer {settings.github_token.strip()}",
                "Accept": "application/vnd.github.v3+json",
            }
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                existing = await client.get(
                    f"https://api.github.com/repos/{repo}/pulls",
                    params={"head": f"{repo.split('/')[0]}:{branch_name}", "state": "open"},
                    headers=headers,
                )
                if existing.status_code == 200 and existing.json():
                    return existing.json()[0].get("html_url"), None
                r = await client.post(
                    f"https://api.github.com/repos/{repo}/pulls",
                    json={"title": title[:100], "head": branch_name, "base": "main"},
                    headers=headers,
                )
                if r.status_code == 201:
                    logger.info("pr_opened", branch=branch_name, url=r.json().get("html_url"))
                    return r.json().get("html_url"), None
                logger.warning("pr_open_failed", status=r.status_code, error=r.text[:200])
                return None, f"github api {r.status_code}: {r.text[:120]}"
        except Exception as e:
            logger.warning("pr_open_error", error=str(e))
            return None, str(e)[:160]
