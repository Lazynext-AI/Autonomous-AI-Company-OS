"""Deployment tools - Railway and Vercel integration for agents."""

import httpx
from typing import Optional

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class RailwayDeployer:
    """Deploy backend to Railway."""

    def __init__(self):
        self.settings = get_settings()
        self.token = self.settings.railway_token.strip()
        self.base_url = "https://backboard.railway.app/graphql/v2"

    async def trigger_deployment(self, project_id: Optional[str] = None) -> dict:
        """
        Trigger Railway deployment and get deployment URL.
        If project_id is None, uses deploy hook URL from env.
        Returns deployment URL if available.
        """
        if not self.token:
            return {
                "success": False,
                "error": "RAILWAY_TOKEN not set",
            }

        try:
            # Option 1: Use deploy hook URL (simpler, recommended)
            deploy_hook = self.settings.railway_deploy_hook_url
            if deploy_hook:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(deploy_hook)
                    if response.status_code == 200:
                        logger.info("railway_deploy_triggered", hook=deploy_hook[:50])
                        
                        # Try to get deployment URL from Railway API
                        deployment_url = await self._get_deployment_url()
                        
                        result = {
                            "success": True,
                            "method": "deploy_hook",
                            "message": "Deployment triggered via hook",
                        }
                        if deployment_url:
                            result["url"] = deployment_url
                            logger.info("railway_deployment_url_fetched", url=deployment_url)
                        
                        return result
                    else:
                        return {
                            "success": False,
                            "error": f"Deploy hook returned {response.status_code}",
                        }

            # Option 2: Use Railway GraphQL API (if project_id provided)
            if project_id:
                query = """
                mutation {
                    deploymentCreate(input: {
                        projectId: "%s"
                    }) {
                        id
                        status
                    }
                }
                """ % project_id

                headers = {
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                }

                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        self.base_url,
                        json={"query": query},
                        headers=headers,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        if "errors" in data:
                            return {
                                "success": False,
                                "error": str(data["errors"]),
                            }
                        logger.info("railway_deploy_triggered", project_id=project_id)
                        return {
                            "success": True,
                            "method": "graphql",
                            "deployment_id": data.get("data", {}).get("deploymentCreate", {}).get("id"),
                        }
                    else:
                        return {
                            "success": False,
                            "error": f"Railway API returned {response.status_code}",
                        }

            return {
                "success": False,
                "error": "No deploy hook URL or project_id provided",
            }
        except Exception as e:
            logger.error("railway_deploy_failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }
    
    async def _get_deployment_url(self) -> Optional[str]:
        """Get the latest Railway deployment URL from API."""
        try:
            # Query Railway GraphQL API for project deployments
            query = """
            query {
                deployments {
                    edges {
                        node {
                            id
                            status
                            url
                            createdAt
                        }
                    }
                }
            }
            """
            
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            }
            
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    self.base_url,
                    json={"query": query},
                    headers=headers,
                )
                if response.status_code == 200:
                    data = response.json()
                    if "data" in data and "deployments" in data["data"]:
                        edges = data["data"]["deployments"].get("edges", [])
                        if edges:
                            # Get most recent deployment
                            latest = edges[0]["node"]
                            if latest.get("status") == "SUCCESS" and latest.get("url"):
                                return latest["url"]
            
            return None
        except Exception as e:
            logger.warning("railway_url_fetch_failed", error=str(e))
            return None


class VercelDeployer:
    """Deploy frontend to Vercel."""

    def __init__(self):
        self.settings = get_settings()
        self.token = self.settings.vercel_token.strip()
        self.team_id = self.settings.vercel_team_id.strip()
        self.base_url = "https://api.vercel.com"

    async def trigger_deployment(
        self, project_name: Optional[str] = None, directory: str = "dashboard"
    ) -> dict:
        """
        Trigger Vercel deployment and get deployment URL.
        If project_name is None, uses deploy hook URL from env.
        Returns deployment URL if available.
        """
        if not self.token:
            return {
                "success": False,
                "error": "VERCEL_TOKEN not set",
            }

        try:
            # Option 1: Use deploy hook URL (simpler, recommended)
            deploy_hook = self.settings.vercel_deploy_hook_url
            if deploy_hook:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(deploy_hook)
                    if response.status_code == 200:
                        logger.info("vercel_deploy_triggered", hook=deploy_hook[:50])
                        
                        # Try to get deployment URL from Vercel API
                        deployment_url = await self._get_deployment_url(project_name)
                        
                        result = {
                            "success": True,
                            "method": "deploy_hook",
                            "message": "Deployment triggered via hook",
                        }
                        if deployment_url:
                            result["url"] = deployment_url
                            logger.info("vercel_deployment_url_fetched", url=deployment_url)
                        
                        return result
                    else:
                        return {
                            "success": False,
                            "error": f"Deploy hook returned {response.status_code}",
                        }

            # Option 2: Use Vercel API (if project_name provided)
            if project_name:
                headers = {
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                }

                # Get project ID first
                url = f"{self.base_url}/v9/projects/{project_name}"
                if self.team_id:
                    url += f"?teamId={self.team_id}"

                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Trigger deployment
                    deploy_url = f"{self.base_url}/v13/deployments"
                    if self.team_id:
                        deploy_url += f"?teamId={self.team_id}"

                    payload = {
                        "name": project_name,
                        "projectSettings": {"framework": "nextjs"},
                    }

                    response = await client.post(deploy_url, json=payload, headers=headers)
                    if response.status_code in (200, 201):
                        data = response.json()
                        logger.info("vercel_deploy_triggered", project=project_name)
                        return {
                            "success": True,
                            "method": "api",
                            "deployment_id": data.get("uid"),
                            "url": data.get("url"),
                        }
                    else:
                        return {
                            "success": False,
                            "error": f"Vercel API returned {response.status_code}: {response.text[:200]}",
                        }

            return {
                "success": False,
                "error": "No deploy hook URL or project_name provided",
            }
        except Exception as e:
            logger.error("vercel_deploy_failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }
    
    async def _get_deployment_url(self, project_name: Optional[str] = None) -> Optional[str]:
        """Get the latest Vercel deployment URL from API."""
        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            }
            
            # If project_name provided, get project deployments
            if project_name:
                url = f"{self.base_url}/v6/deployments"
                params = {"projectId": project_name, "limit": 1}
                if self.team_id:
                    params["teamId"] = self.team_id
                
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.get(url, params=params, headers=headers)
                    if response.status_code == 200:
                        data = response.json()
                        deployments = data.get("deployments", [])
                        if deployments:
                            latest = deployments[0]
                            if latest.get("readyState") == "READY" and latest.get("url"):
                                return f"https://{latest['url']}"
            
            # Fallback: Try to get from project settings
            # Vercel projects have a default domain pattern: project-name.vercel.app
            if project_name:
                return f"https://{project_name}.vercel.app"
            
            return None
        except Exception as e:
            logger.warning("vercel_url_fetch_failed", error=str(e))
            return None
