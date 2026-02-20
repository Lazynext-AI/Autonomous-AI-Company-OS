"""Pydantic v2 message schemas for the message bus."""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BaseMessage(BaseModel):
    """Base message schema for all bus messages."""

    message_id: str = Field(default_factory=lambda: "")
    from_agent: str = ""
    to_agent: str = ""
    channel: str = ""
    priority: int = 0
    timestamp: datetime = Field(default_factory=_utc_now)
    expires_at: datetime | None = None


class TaskMessage(BaseMessage):
    """Task assignment message."""

    task_id: str = ""
    description: str = ""
    acceptance_criteria: list[str] = Field(default_factory=list)
    estimated_minutes: int = 0
    relevant_knowledge: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    paired_task_id: str | None = None


class ReportMessage(BaseMessage):
    """Task completion report."""

    task_id: str = ""
    status: str = "completed"
    result: str = ""
    time_taken: float = 0.0
    blockers: list[str] = Field(default_factory=list)


class QAAlertMessage(BaseMessage):
    """QA alert for bugs or failures."""

    severity: str = "MEDIUM"  # CRITICAL, HIGH, MEDIUM
    affected_component: str = ""
    error_details: str = ""
    suggested_fix: str = ""


class HRRequestMessage(BaseMessage):
    """HR request for agent spawn/reassign."""

    request_type: str = "spawn_agent"  # spawn_agent, scale_down, reassign
    role_needed: str = ""
    reason: str = ""
    context: dict[str, Any] = Field(default_factory=dict)


class KnowledgeRequestMessage(BaseMessage):
    """Knowledge base query request."""

    query: str = ""
    requesting_agent: str = ""
    urgency: str = "normal"  # low, normal, high, critical


class MilestoneMessage(BaseMessage):
    """Milestone achievement broadcast."""

    milestone_type: str = ""
    description: str = ""


class DirectiveMessage(BaseMessage):
    """CEO strategic directive."""

    strategic_goal: str = ""
    deadline: str = ""
    priorities: list[dict[str, Any]] = Field(default_factory=list)
