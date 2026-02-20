"""Resolve product project directory from company brain - one repo per product."""

import re
import subprocess
from pathlib import Path
from typing import Optional

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


def _slugify(name: str) -> str:
    """Convert product name to URL-safe slug."""
    if not name or not name.strip():
        return "new-product"
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
    return slug or "new-product"


async def get_product_project_dir(company_brain) -> Optional[Path]:
    """
    Resolve product project directory from company brain.
    One new repo per new product_name in company_brain.
    Path: {products_base_dir}/{slug(product_name)}/
    """
    try:
        brain = await company_brain.get()
        product_name = (brain.product_name or "").strip()
        if not product_name:
            product_name = "new-product"
        
        slug = _slugify(product_name)
        settings = get_settings()
        base = Path(settings.products_base_dir).resolve()
        project_dir = base / slug
        
        project_dir.mkdir(parents=True, exist_ok=True)
        
        if not (project_dir / ".git").exists():
            _init_git_repo(project_dir, product_name)
        
        return project_dir
    except Exception as e:
        logger.error("product_resolver_failed", error=str(e))
        return None


def _init_git_repo(project_dir: Path, product_name: str) -> None:
    """Initialize git repo and optionally configure GitHub remote."""
    logger.info("initializing_product_repo", dir=str(project_dir), product=product_name)
    try:
        subprocess.run(
            ["git", "init"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        readme = project_dir / "README.md"
        if not readme.exists():
            readme.write_text(
                f"# {product_name}\n\n"
                "Built by Autonomous AI Company.\n"
                "All code is generated and maintained autonomously.\n"
            )
            subprocess.run(["git", "add", "README.md"], cwd=str(project_dir), capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "Initial commit"],
                cwd=str(project_dir),
                capture_output=True,
            )
        
        # GitHub remote is configured on first push via git_manager
        
        logger.info("product_repo_initialized", dir=str(project_dir))
    except Exception as e:
        logger.error("init_product_repo_failed", dir=str(project_dir), error=str(e))
        raise
