"""GitHub repository management - create repos and configure remotes automatically."""

import asyncio
import httpx
from pathlib import Path
from typing import Optional

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class GitHubRepoManager:
    """Automatically create GitHub repositories and configure git remotes."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.settings = get_settings()
        self.token = self.settings.github_token.strip() if self.settings.github_token else ""

    async def ensure_remote_configured(self, repo_name: Optional[str] = None) -> bool:
        """
        Ensure git remote is configured. If not, create GitHub repo and add remote.
        Returns True if remote is now configured.
        """
        # Check if remote already exists
        returncode, stdout, _ = await self._run_git("remote", "get-url", "origin")
        if returncode == 0:
            existing = stdout.strip()
            if "@" in existing:
                await self._run_git("remote", "set-url", "origin", f"https://{existing.split('@')[-1]}")
            logger.info("remote_already_configured", remote_url=existing.split("@")[-1])
            await self._set_deploy_secrets(existing)
            return True

        # No remote exists - create one
        if not self.token:
            logger.warning("github_token_not_set", message="Set GITHUB_TOKEN in .env to enable automatic repo creation")
            return False

        # Determine repo name
        if not repo_name:
            repo_name = self.repo_root.name or "autonomous-ai-product"

        # Create GitHub repository
        repo_url = await self._create_github_repo(repo_name)
        if not repo_url:
            return False

        # Keep the remote URL clean — the token is injected transiently at push
        # time (see git_manager.push_branch) so it never persists in .git/config.
        returncode, _, stderr = await self._run_git("remote", "add", "origin", repo_url)
        if returncode == 0:
            logger.info("remote_added", repo_url=repo_url.split("@")[-1] if "@" in repo_url else repo_url)
            await self._set_deploy_secrets(repo_url)
            return True
        else:
            logger.error("failed_to_add_remote", error=stderr)
            return False

    async def _set_deploy_secrets(self, repo_url: str) -> None:
        """Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID secrets so the
        auto-deploy workflow can publish to Cloudflare on push."""
        try:
            from github import Github
            from github.GithubException import GithubException

            clean = repo_url.split("@")[-1].replace("https://", "").replace("github.com/", "").removesuffix(".git")
            gh = Github(self.token)
            repo = gh.get_repo(clean)

            secrets = {
                "CLOUDFLARE_ACCOUNT_ID": self.settings.cloudflare_account_id,
                "CLOUDFLARE_API_TOKEN": self.settings.cloudflare_deploy_token or "",
            }
            for name, value in secrets.items():
                if value:
                    repo.create_secret(name, value)
                    logger.info("repo_secret_set", repo=clean, secret=name)
        except Exception as e:
            logger.warning("repo_secrets_failed", error=str(e))

    async def _create_github_repo(self, repo_name: str) -> Optional[str]:
        """Create a GitHub repository using GitHub API."""
        try:
            # Use Bearer token format (recommended by GitHub)
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            payload = {
                "name": repo_name,
                "description": "Product built by Autonomous AI Company",
                "private": False,  # Public repo
                "auto_init": False,  # We'll push our own code
            }

            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                # First, verify token and get username
                user_response = await client.get("https://api.github.com/user", headers=headers)
                if user_response.status_code != 200:
                    logger.error("github_auth_failed", status=user_response.status_code, error=user_response.text[:200])
                    return None
                
                username = user_response.json().get("login")
                logger.info("github_auth_verified", username=username)

                # Create repository under the user's account
                user_url = "https://api.github.com/user/repos"
                response = await client.post(user_url, json=payload, headers=headers)
                
                if response.status_code == 201:
                    data = response.json()
                    repo_url = data.get("clone_url") or data.get("ssh_url")
                    logger.info("github_repo_created", repo_name=repo_name, owner=username, url=repo_url)
                    return repo_url
                elif response.status_code == 422:
                    # Repo might already exist
                    error_data = response.json()
                    if "already exists" in str(error_data).lower():
                        repo_url = f"https://github.com/{username}/{repo_name}.git"
                        logger.info("github_repo_exists", repo_name=repo_name, url=repo_url)
                        return repo_url
                    else:
                        logger.error("github_repo_creation_failed", status=response.status_code, error=response.text[:200])
                        return None
                else:
                    logger.error("github_repo_creation_failed", status=response.status_code, error=response.text[:200])
                    return None
        except Exception as e:
            logger.error("github_repo_creation_exception", error=str(e))
            return None

    async def _run_git(self, *args: str) -> tuple[int, str, str]:
        """Run git command."""
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
