"""Company brain - shared company state in Supabase."""

import asyncio
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class BugSchema(BaseModel):
    """Bug entry schema."""

    id: str = ""
    description: str = ""
    severity: str = "MEDIUM"
    component: str = ""
    status: str = "open"
    reported_at: datetime = Field(default_factory=_utc_now)


class FeedbackSchema(BaseModel):
    """User feedback entry."""

    id: str = ""
    content: str = ""
    source: str = ""
    sentiment: str = "neutral"
    created_at: datetime = Field(default_factory=_utc_now)


class BlockerSchema(BaseModel):
    """Blocker entry."""

    id: str = ""
    description: str = ""
    blocking: str = ""
    reported_by: str = ""
    created_at: datetime = Field(default_factory=_utc_now)


class MetricsSchema(BaseModel):
    """Company metrics."""

    users: int = 0
    revenue: float = 0.0
    mrr: float = 0.0
    uptime_pct: float = 100.0
    error_rate: float = 0.0
    deploy_count: int = 0


class CompanyBrainSchema(BaseModel):
    """Full company brain schema."""

    id: str = ""
    product_name: str = ""
    product_description: str = ""
    mission: str = ""
    tech_stack: dict[str, Any] = Field(default_factory=dict)
    live_urls: dict[str, Any] = Field(default_factory=dict)
    current_sprint: dict[str, Any] = Field(default_factory=dict)
    metrics: MetricsSchema = Field(default_factory=MetricsSchema)
    open_bugs: list[BugSchema] = Field(default_factory=list)
    shipped_features: list[str] = Field(default_factory=list)
    user_feedback: list[FeedbackSchema] = Field(default_factory=list)
    agent_statuses: dict[str, Any] = Field(default_factory=dict)
    blockers: list[BlockerSchema] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=_utc_now)


class CompanyBrain:
    """Async company brain - read/write shared company state."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None
        self._initialized = False

    def _get_client(self):
        """Lazy init Cloudflare client."""
        if self._client is None:
            try:
                from core.cloudflare_client import CloudflareClient
                c = CloudflareClient()
                if c.is_configured():
                    self._client = c
                    self._initialized = True
                else:
                    logger.warning("company_brain_cloudflare_not_configured")
            except Exception as e:
                logger.error("company_brain_cloudflare_init_failed", error=str(e))
        return self._client

    async def _run_sync(self, fn, *args, **kwargs):
        """Run sync client call in thread pool."""
        client = self._get_client()
        if client is None:
            raise RuntimeError("Cloudflare not configured - set CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN")
        return await asyncio.to_thread(fn, *args, **kwargs)

    def _row_to_schema(self, row: dict) -> CompanyBrainSchema:
        """Convert DB row to schema."""
        bugs = [BugSchema(**b) if isinstance(b, dict) else b for b in (row.get("open_bugs") or [])]
        feedback = [FeedbackSchema(**f) if isinstance(f, dict) else f for f in (row.get("user_feedback") or [])]
        blockers = [BlockerSchema(**b) if isinstance(b, dict) else b for b in (row.get("blockers") or [])]
        metrics_raw = row.get("metrics") or {}
        if isinstance(metrics_raw, dict):
            metrics = MetricsSchema(**metrics_raw)
        else:
            metrics = metrics_raw
        return CompanyBrainSchema(
            id=str(row.get("id", "")),
            product_name=row.get("product_name", ""),
            product_description=row.get("product_description", ""),
            mission=row.get("mission", ""),
            tech_stack=row.get("tech_stack") or {},
            live_urls=row.get("live_urls") or {},
            current_sprint=row.get("current_sprint") or {},
            metrics=metrics,
            open_bugs=bugs,
            shipped_features=row.get("shipped_features") or [],
            user_feedback=feedback,
            agent_statuses=row.get("agent_statuses") or {},
            blockers=blockers,
            updated_at=row.get("updated_at", _utc_now()),
        )

    async def get(self) -> CompanyBrainSchema:
        """Get full company brain."""
        def _fetch():
            r = self._client.table("company_brain").select("*").limit(1).execute()
            if hasattr(r, "data") and r.data and len(r.data) > 0:
                return r.data[0]
            return {}

        row = await self._run_sync(_fetch)
        return self._row_to_schema(row)

    async def update_field(self, field: str, value: Any) -> None:
        """Partial update of a single field."""
        def _update():
            r = self._client.table("company_brain").select("id").limit(1).execute()
            if not (hasattr(r, "data") and r.data):
                return
            row_id = r.data[0]["id"]
            self._client.table("company_brain").update({
                field: value,
                "updated_at": _utc_now().isoformat(),
            }).eq("id", row_id).execute()

        await self._run_sync(_update)
        logger.info("company_brain_updated", field=field)

    async def add_bug(self, bug: BugSchema) -> None:
        """Add bug to open_bugs."""
        brain = await self.get()
        bug.id = bug.id or f"bug_{len(brain.open_bugs)}_{_utc_now().timestamp()}"
        bugs = [b.model_dump(mode="json") if hasattr(b, "model_dump") else b for b in brain.open_bugs]
        bugs.append(bug.model_dump(mode="json"))
        await self.update_field("open_bugs", bugs)

    async def resolve_bug(self, bug_id: str) -> None:
        """Remove bug from open_bugs."""
        brain = await self.get()
        bugs = [b for b in brain.open_bugs if getattr(b, "id", "") != bug_id]
        await self.update_field("open_bugs", [b.model_dump(mode="json") if hasattr(b, "model_dump") else b for b in bugs])

    async def add_shipped_feature(self, feature: str) -> None:
        """Add to shipped_features."""
        brain = await self.get()
        features = list(brain.shipped_features) + [feature]
        await self.update_field("shipped_features", features)

    async def add_user_feedback(self, feedback: FeedbackSchema) -> None:
        """Add user feedback."""
        brain = await self.get()
        feedback.id = feedback.id or f"fb_{len(brain.user_feedback)}_{_utc_now().timestamp()}"
        items = [f.model_dump(mode="json") if hasattr(f, "model_dump") else f for f in brain.user_feedback]
        items.append(feedback.model_dump(mode="json"))
        await self.update_field("user_feedback", items)

    async def update_agent_status(self, agent_id: str, status: str, current_task: str = "") -> None:
        """Update agent status in agent_statuses."""
        brain = await self.get()
        statuses = dict(brain.agent_statuses)
        statuses[agent_id] = {"status": status, "current_task": current_task, "updated_at": _utc_now().isoformat()}
        await self.update_field("agent_statuses", statuses)

    async def update_metrics(self, metrics: dict) -> None:
        """Update metrics (merge with existing)."""
        brain = await self.get()
        m = brain.metrics.model_dump() if hasattr(brain.metrics, "model_dump") else dict(brain.metrics)
        m.update(metrics)
        await self.update_field("metrics", m)

    async def add_blocker(self, blocker: BlockerSchema) -> None:
        """Add blocker."""
        brain = await self.get()
        blocker.id = blocker.id or f"blk_{len(brain.blockers)}_{_utc_now().timestamp()}"
        blockers = [b.model_dump(mode="json") if hasattr(b, "model_dump") else b for b in brain.blockers]
        blockers.append(blocker.model_dump(mode="json"))
        await self.update_field("blockers", blockers)

    async def resolve_blocker(self, blocker_id: str) -> None:
        """Remove blocker."""
        brain = await self.get()
        blockers = [b for b in brain.blockers if getattr(b, "id", "") != blocker_id]
        await self.update_field("blockers", [b.model_dump(mode="json") if hasattr(b, "model_dump") else b for b in blockers])
