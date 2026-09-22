"""Pydantic settings and configuration for the Autonomous AI Company OS."""

from datetime import datetime, timezone
from functools import lru_cache
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def utc_now() -> datetime:
    """Timezone-aware UTC now (replaces deprecated datetime.utcnow)."""
    return datetime.now(timezone.utc)


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Cloudflare Worker (D1 + KV + Vectorize API layer)
    cloudflare_api_url: str = ""
    cloudflare_api_token: str = ""

    # LLM brain — Cloudflare Workers AI (via the company worker, no key needed)
    llm_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

    # Cloudflare account credentials (wrangler / deployments / resource management)
    cloudflare_account_id: str = ""
    cloudflare_deploy_token: str = ""  # scoped API token (preferred)
    cloudflare_api_key: str = ""       # Global API key fallback (cfk_...)
    cloudflare_email: str = ""

    # External APIs (optional)
    github_token: str = ""
    resend_api_key: str = ""
    email_from: str = "Lazynext <support@lazynext.com>"
    e2b_api_key: str = ""
    serper_api_key: str = ""
    firecrawl_api_key: str = ""

    # App config
    knowledge_base_dir: str = "./knowledge_base"
    products_base_dir: str = "./products"  # Base dir for product repos; one repo per product_name in company_brain
    log_level: str = "INFO"
    environment: str = "development"
    founder_email: str = ""
    # Orchestration intervals (seconds). Shorter = more responsive, more API calls.
    ceo_loop_interval: int = 60   # 1 min (optimized for speed)
    cto_loop_interval: int = 30  # 30 seconds (optimized for speed)

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v.upper() not in valid:
            return "INFO"
        return v.upper()


# Model role mapping — all agents run on Cloudflare Workers AI (Llama-3.3-70b).
WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
MODEL_REGISTRY: dict[str, str] = {
    role: WORKERS_AI_MODEL
    for role in (
        "ceo", "cto", "backend", "frontend", "fullstack", "code_review",
        "devops", "qa", "marketing", "sales", "customer_success", "hr",
        "knowledge", "finance",
    )
}


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


def get_model_for_role(role: str) -> str:
    """Return the model name for a given agent role."""
    settings = get_settings()
    role_lower = role.lower().strip()
    default_model = settings.llm_model
    return MODEL_REGISTRY.get(role_lower, default_model)


def get_light_model() -> str:
    """Return the light model for routing/simple tasks."""
    return WORKERS_AI_MODEL
