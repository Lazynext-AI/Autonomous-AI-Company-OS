"""Pydantic settings and configuration for the Autonomous AI Company OS."""

from datetime import datetime, timezone
from functools import lru_cache
from pydantic import field_validator
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

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379"

    # ChromaDB
    chroma_persist_dir: str = "./chroma_db"

    # Anthropic Claude API
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"
    ollama_base_url: str = "http://localhost:11434"

    # External APIs
    github_token: str = ""
    github_org: str = ""
    vercel_token: str = ""
    vercel_team_id: str = ""
    vercel_deploy_hook_url: str = ""  # Vercel deploy hook URL
    railway_token: str = ""
    railway_deploy_hook_url: str = ""  # Railway deploy hook URL
    resend_api_key: str = ""
    e2b_api_key: str = ""

    # App config
    knowledge_base_dir: str = "./knowledge_base"
    project_dir: str = "./product"  # Directory where agents build the product (separate from autonomous-ai-company repo)
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


# Model role mapping - tiered Claude models by importance (cost-optimized)
# High priority (coding, complex reasoning): Sonnet 4.5 (replaced Opus 4.6 for cost savings)
# Medium priority (strategic, orchestration): Sonnet 4.5
# Low priority (simple tasks, reporting): Haiku 4.5
MODEL_REGISTRY: dict[str, str] = {
    "ceo": "claude-sonnet-4-5",           # Strategic thinking
    "cto": "claude-sonnet-4-5",           # Task decomposition (downgraded from Opus for cost)
    "backend": "claude-sonnet-4-5",       # Code generation (downgraded from Opus for cost)
    "frontend": "claude-sonnet-4-5",      # UI code (downgraded from Opus for cost)
    "fullstack": "claude-sonnet-4-5",     # Full-stack code (downgraded from Opus for cost)
    "code_review": "claude-sonnet-4-5",   # Security and quality review (downgraded from Opus for cost)
    "devops": "claude-sonnet-4-5",        # Infrastructure automation
    "qa": "claude-sonnet-4-5",            # Testing and validation
    "marketing": "claude-haiku-4-5",      # Content generation
    "sales": "claude-haiku-4-5",          # Outreach templates
    "customer_success": "claude-haiku-4-5",  # Support responses
    "hr": "claude-haiku-4-5",             # Simple HR tasks
    "knowledge": "claude-haiku-4-5",      # RAG queries
    "finance": "claude-haiku-4-5",        # Report generation
}


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


def get_model_for_role(role: str) -> str:
    """Return the model name for a given agent role."""
    settings = get_settings()
    role_lower = role.lower().strip()
    default_model = settings.anthropic_model or "claude-sonnet-4-5"
    return MODEL_REGISTRY.get(role_lower, default_model)


def get_light_model() -> str:
    """Return the light model for routing/simple tasks."""
    settings = get_settings()
    # Allow override via env, but default to haiku for cost efficiency
    if settings.anthropic_model and "haiku" in settings.anthropic_model.lower():
        return settings.anthropic_model
    return "claude-haiku-4-5"
