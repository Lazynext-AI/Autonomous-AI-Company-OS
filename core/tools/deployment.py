"""Deployment tools - Cloudflare Pages (frontend) and Containers (backend)."""

import asyncio
import os
import re
from pathlib import Path
from typing import Optional

import structlog

from core.config import get_settings
from core.tools.bin_resolver import find_binary

logger = structlog.get_logger(__name__)

CONTAINER_WORKER_JS = '''import { Container, getContainer } from "@cloudflare/containers";

export class Backend extends Container {
  defaultPort = 8000;
  sleepAfter = "10m";
}

export default {
  async fetch(request, env) {
    return getContainer(env.BACKEND).fetch(request);
  },
};
'''

CONTAINER_PACKAGE_JSON = '''{
  "private": true,
  "dependencies": {
    "@cloudflare/containers": "^0.1.0",
    "wrangler": "^4.0.0"
  }
}
'''

CONTAINER_WRANGLER_TOML = '''name = "{name}"
main = "worker.js"
compatibility_date = "2025-09-01"

[[containers]]
class_name = "Backend"
image = "{dockerfile}"
max_instances = 2

[[durable_objects.bindings]]
name = "BACKEND"
class_name = "Backend"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Backend"]
'''

GENERIC_DOCKERFILE = '''FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
'''


def _wrangler_env() -> dict:
    """Env vars for wrangler subprocesses. Prefers the scoped deploy token,
    falls back to global API key + email."""
    s = get_settings()
    env = dict(os.environ)
    if s.cloudflare_account_id:
        env["CLOUDFLARE_ACCOUNT_ID"] = s.cloudflare_account_id
    if s.cloudflare_deploy_token:
        env["CLOUDFLARE_API_TOKEN"] = s.cloudflare_deploy_token
        env.pop("CLOUDFLARE_API_KEY", None)
        env.pop("CLOUDFLARE_EMAIL", None)
    else:
        if s.cloudflare_api_key:
            env["CLOUDFLARE_API_KEY"] = s.cloudflare_api_key
        if s.cloudflare_email:
            env["CLOUDFLARE_EMAIL"] = s.cloudflare_email
    return env


def _wrangler_available() -> bool:
    s = get_settings()
    return bool(s.cloudflare_deploy_token or (s.cloudflare_api_key and s.cloudflare_email))


def _worker_subdomain() -> str:
    """Derive workers.dev subdomain from the deployed API worker URL."""
    url = get_settings().cloudflare_api_url
    m = re.match(r"https?://[^.]+\.([^.]+\.workers\.dev)", url)
    return m.group(1) if m else ""


async def _run(cmd: list[str], cwd: Optional[Path] = None, timeout: int = 300) -> tuple[int, str]:
    """Run a command, return (returncode, combined output)."""
    # launchd PATH is /usr/bin:/bin — npm/npx/wrangler live in Homebrew
    # prefixes, so bare names raise FileNotFoundError for the fleet.
    resolved = find_binary(cmd[0])
    if resolved:
        cmd = [resolved, *cmd[1:]]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd) if cwd else None,
        env=_wrangler_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "timed out"
    return proc.returncode or 0, (out or b"").decode(errors="replace")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return slug[:50] or "product"


class CloudflarePagesDeployer:
    """Deploy static frontend to Cloudflare Pages via wrangler direct upload."""

    def __init__(self):
        self.settings = get_settings()

    async def trigger_deployment(
        self, project_name: Optional[str] = None, directory: Optional[str] = None
    ) -> dict:
        """Upload a static directory to Cloudflare Pages. Returns {success, url}."""
        if not _wrangler_available():
            return {"success": False, "error": "CLOUDFLARE_DEPLOY_TOKEN (or API_KEY+EMAIL) not set"}

        if not directory:
            return {"success": False, "error": "No frontend directory provided"}
        src = Path(directory)
        if not src.exists() or not src.is_dir():
            return {"success": False, "error": f"Frontend directory not found: {directory}"}
        # Prefer a built output dir if present
        for sub in ("dist", "out", "build"):
            if (src / sub).is_dir():
                src = src / sub
                break
        if not (src / "index.html").exists():
            return {"success": False, "error": f"No index.html in {src} - build the frontend first"}

        name = _slugify(project_name or src.parent.name)
        # Wrangler no longer auto-creates the project on deploy.
        await _run(
            ["npx", "wrangler", "pages", "project", "create", name, "--production-branch", "main"],
            timeout=60,
        )
        code, out = await _run(
            ["npx", "wrangler", "pages", "deploy", str(src), "--project-name", name, "--branch", "main"],
            timeout=300,
        )
        if code != 0:
            logger.error("pages_deploy_failed", output=out[:400])
            return {"success": False, "error": out.strip()[:200]}

        m = re.search(r"https://[a-z0-9.-]*\.pages\.dev", out)
        url = m.group(0) if m else f"https://{name}.pages.dev"
        logger.info("pages_deployed", url=url)
        return {"success": True, "method": "wrangler_pages", "url": url}


class CloudflareBackendDeployer:
    """Deploy a containerized backend to Cloudflare Containers via wrangler.

    Requires a Dockerfile in the backend directory (a generic FastAPI one is
    generated if missing) and Docker running locally for the image build.
    """

    def __init__(self):
        self.settings = get_settings()

    async def trigger_deployment(
        self, project_name: Optional[str] = None, directory: Optional[str] = None
    ) -> dict:
        """Deploy the backend. JS/TS backends deploy as a plain Worker (free tier);
        anything with requirements.txt / Dockerfile goes to Cloudflare Containers."""
        if not _wrangler_available():
            return {"success": False, "error": "CLOUDFLARE_DEPLOY_TOKEN (or API_KEY+EMAIL) not set"}
        if not directory:
            return {"success": False, "error": "No backend directory provided"}

        backend = Path(directory)
        if not backend.exists() or not backend.is_dir():
            return {"success": False, "error": f"Backend directory not found: {directory}"}

        if (backend / "wrangler.toml").exists():
            return await self._deploy_js_worker(backend)
        dockerfile = backend / "Dockerfile"
        if not dockerfile.exists():
            if not (backend / "requirements.txt").exists():
                return {
                    "success": False,
                    "error": "No Dockerfile or requirements.txt in backend directory",
                }
            dockerfile.write_text(GENERIC_DOCKERFILE)
            logger.info("dockerfile_generated", path=str(dockerfile))

        name = _slugify(f"{project_name or backend.parent.name}-backend")
        deploy_dir = backend.parent / ".deploy" / name
        deploy_dir.mkdir(parents=True, exist_ok=True)
        (deploy_dir / "worker.js").write_text(CONTAINER_WORKER_JS)
        (deploy_dir / "package.json").write_text(CONTAINER_PACKAGE_JSON)
        (deploy_dir / "wrangler.toml").write_text(
            CONTAINER_WRANGLER_TOML.format(name=name, dockerfile=dockerfile.resolve())
        )

        code, out = await _run(["npm", "install", "--silent"], cwd=deploy_dir, timeout=180)
        if code != 0:
            return {"success": False, "error": f"npm install failed: {out.strip()[:200]}"}

        # wrangler builds the image from the Dockerfile and pushes it
        code, out = await _run(["npx", "wrangler", "deploy"], cwd=deploy_dir, timeout=900)
        if code != 0:
            logger.error("containers_deploy_failed", output=out[:400])
            return {"success": False, "error": out.strip()[:200]}

        subdomain = _worker_subdomain()
        url = f"https://{name}.{subdomain}" if subdomain else None
        logger.info("containers_deployed", url=url)
        result = {"success": True, "method": "wrangler_containers"}
        if url:
            result["url"] = url
        return result

    async def _deploy_js_worker(self, backend: Path) -> dict:
        """Deploy a JS/TS backend directory (must contain wrangler.toml + entry point)."""
        name = ""
        toml = (backend / "wrangler.toml").read_text()
        m = re.search(r'^name\s*=\s*"([^"]+)"', toml, re.M)
        name = m.group(1) if m else _slugify(backend.name)

        if (backend / "package.json").exists() and not (backend / "node_modules").exists():
            code, out = await _run(["npm", "install", "--silent"], cwd=backend, timeout=180)
            if code != 0:
                return {"success": False, "error": f"npm install failed: {out.strip()[:200]}"}

        code, out = await _run(["npx", "wrangler", "deploy"], cwd=backend, timeout=300)
        if code != 0:
            logger.error("worker_deploy_failed", output=out[:400])
            return {"success": False, "error": out.strip()[:200]}

        m = re.search(r"https://[a-z0-9.-]+\.workers\.dev", out)
        url = m.group(0) if m else (
            f"https://{name}.{_worker_subdomain()}" if _worker_subdomain() else None
        )
        logger.info("worker_deployed", url=url)
        result = {"success": True, "method": "wrangler_worker"}
        if url:
            result["url"] = url
        return result
