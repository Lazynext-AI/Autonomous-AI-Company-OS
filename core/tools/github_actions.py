"""GitHub Actions monitoring and management - check workflows, read logs, fix issues."""

import asyncio
import httpx
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class GitHubActionsManager:
    """Monitor GitHub Actions workflows, read logs, and manage workflow issues."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.settings = get_settings()
        self.token = self.settings.github_token.strip() if self.settings.github_token else ""
        self.org = self.settings.github_org.strip() if self.settings.github_org else ""
        self._repo_owner = None
        self._repo_name = None

    async def _get_repo_info(self) -> tuple[Optional[str], Optional[str]]:
        """Get repository owner and name from git remote."""
        if self._repo_owner and self._repo_name:
            return self._repo_owner, self._repo_name

        try:
            proc = await asyncio.create_subprocess_exec(
                "git",
                "remote",
                "get-url",
                "origin",
                cwd=str(self.repo_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode == 0:
                remote_url = stdout.decode().strip()
                # Parse: https://github.com/owner/repo.git or https://TOKEN@github.com/owner/repo.git
                if "github.com" in remote_url:
                    parts = remote_url.split("github.com/")[-1].replace(".git", "").split("/")
                    if len(parts) >= 2:
                        self._repo_owner = parts[0]
                        self._repo_name = parts[1]
                        return self._repo_owner, self._repo_name
        except Exception as e:
            logger.warning("failed_to_get_repo_info", error=str(e))
        
        return None, None

    async def get_failed_workflows(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent failed workflow runs."""
        owner, repo = await self._get_repo_info()
        if not owner or not repo:
            logger.warning("repo_info_not_available")
            return []

        if not self.token:
            logger.warning("github_token_not_set")
            return []

        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs"
            params = {
                "status": "failure",
                "per_page": limit,
                "page": 1,
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, params=params)
                
                if response.status_code == 200:
                    data = response.json()
                    workflows = []
                    for run in data.get("workflow_runs", []):
                        workflows.append({
                            "id": run.get("id"),
                            "name": run.get("name"),
                            "head_branch": run.get("head_branch"),
                            "conclusion": run.get("conclusion"),
                            "status": run.get("status"),
                            "created_at": run.get("created_at"),
                            "updated_at": run.get("updated_at"),
                            "html_url": run.get("html_url"),
                            "workflow_id": run.get("workflow_id"),
                        })
                    logger.info("fetched_failed_workflows", count=len(workflows))
                    return workflows
                else:
                    logger.error("failed_to_fetch_workflows", status=response.status_code, error=response.text[:200])
                    return []
        except Exception as e:
            logger.error("get_failed_workflows_exception", error=str(e))
            return []

    async def get_workflow_run_logs(self, run_id: int) -> Optional[Dict[str, Any]]:
        """Get logs and job details for a workflow run."""
        owner, repo = await self._get_repo_info()
        if not owner or not repo:
            return None

        if not self.token:
            return None

        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            # Get run details
            run_url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}"
            async with httpx.AsyncClient(timeout=30.0) as client:
                run_response = await client.get(run_url, headers=headers)
                if run_response.status_code != 200:
                    logger.error("failed_to_get_run_details", status=run_response.status_code)
                    return None

                run_data = run_response.json()

                # Get jobs for this run
                jobs_url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/jobs"
                jobs_response = await client.get(jobs_url, headers=headers)
                
                jobs = []
                if jobs_response.status_code == 200:
                    jobs_data = jobs_response.json()
                    for job in jobs_data.get("jobs", []):
                        # Get logs for failed steps
                        steps = []
                        for step in job.get("steps", []):
                            if step.get("conclusion") == "failure":
                                steps.append({
                                    "name": step.get("name"),
                                    "conclusion": step.get("conclusion"),
                                    "number": step.get("number"),
                                })
                        
                        jobs.append({
                            "id": job.get("id"),
                            "name": job.get("name"),
                            "conclusion": job.get("conclusion"),
                            "steps": steps,
                            "html_url": job.get("html_url"),
                        })

                return {
                    "run_id": run_id,
                    "name": run_data.get("name"),
                    "head_branch": run_data.get("head_branch"),
                    "conclusion": run_data.get("conclusion"),
                    "status": run_data.get("status"),
                    "html_url": run_data.get("html_url"),
                    "created_at": run_data.get("created_at"),
                    "jobs": jobs,
                    "commit_message": run_data.get("head_commit", {}).get("message", ""),
                }
        except Exception as e:
            logger.error("get_workflow_logs_exception", error=str(e))
            return None

    async def get_workflow_file(self, workflow_id: Optional[int] = None, workflow_name: Optional[str] = None) -> Optional[str]:
        """Get workflow YAML file content."""
        workflows_dir = self.repo_root / ".github" / "workflows"
        
        if workflow_name:
            workflow_file = workflows_dir / workflow_name
            if workflow_file.exists():
                return workflow_file.read_text(encoding="utf-8")
        
        # Try to find workflow file
        if workflows_dir.exists():
            for workflow_file in workflows_dir.glob("*.yml"):
                return workflow_file.read_text(encoding="utf-8")
            for workflow_file in workflows_dir.glob("*.yaml"):
                return workflow_file.read_text(encoding="utf-8")
        
        return None

    async def get_github_issues(self, state: str = "open", limit: int = 20) -> List[Dict[str, Any]]:
        """Get GitHub issues for the repository."""
        owner, repo = await self._get_repo_info()
        if not owner or not repo:
            return []

        if not self.token:
            return []

        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            url = f"https://api.github.com/repos/{owner}/{repo}/issues"
            params = {
                "state": state,
                "per_page": limit,
                "page": 1,
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, params=params)
                
                if response.status_code == 200:
                    issues = []
                    for issue in response.json():
                        # Filter out pull requests (they're also returned as issues)
                        if "pull_request" not in issue:
                            issues.append({
                                "number": issue.get("number"),
                                "title": issue.get("title"),
                                "body": issue.get("body", "")[:500],  # Truncate
                                "state": issue.get("state"),
                                "labels": [label.get("name") for label in issue.get("labels", [])],
                                "created_at": issue.get("created_at"),
                                "html_url": issue.get("html_url"),
                            })
                    logger.info("fetched_github_issues", count=len(issues))
                    return issues
                else:
                    logger.error("failed_to_fetch_issues", status=response.status_code)
                    return []
        except Exception as e:
            logger.error("get_github_issues_exception", error=str(e))
            return []

    async def create_issue(self, title: str, body: str, labels: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
        """Create a GitHub issue."""
        owner, repo = await self._get_repo_info()
        if not owner or not repo:
            return None

        if not self.token:
            return None

        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            url = f"https://api.github.com/repos/{owner}/{repo}/issues"
            payload = {
                "title": title,
                "body": body,
            }
            if labels:
                payload["labels"] = labels

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                
                if response.status_code == 201:
                    issue = response.json()
                    logger.info("github_issue_created", issue_number=issue.get("number"))
                    return {
                        "number": issue.get("number"),
                        "title": issue.get("title"),
                        "html_url": issue.get("html_url"),
                    }
                else:
                    logger.error("failed_to_create_issue", status=response.status_code, error=response.text[:200])
                    return None
        except Exception as e:
            logger.error("create_issue_exception", error=str(e))
            return None

    async def get_branches(self) -> List[Dict[str, Any]]:
        """Get all branches in the repository."""
        owner, repo = await self._get_repo_info()
        if not owner or not repo:
            return []

        if not self.token:
            return []

        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.v3+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            url = f"https://api.github.com/repos/{owner}/{repo}/branches"
            params = {"per_page": 100}

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, params=params)
                
                if response.status_code == 200:
                    branches = []
                    for branch in response.json():
                        branches.append({
                            "name": branch.get("name"),
                            "sha": branch.get("commit", {}).get("sha"),
                            "protected": branch.get("protected", False),
                        })
                    logger.info("fetched_branches", count=len(branches))
                    return branches
                else:
                    logger.error("failed_to_fetch_branches", status=response.status_code)
                    return []
        except Exception as e:
            logger.error("get_branches_exception", error=str(e))
            return []
