"""Channel name constants for the message bus."""

from enum import Enum


class Channels(str, Enum):
    """All Redis Stream channel names."""

    CEO_DIRECTIVES = "ceo.directives"
    CTO_TASKS = "cto.tasks"  # Unassigned tasks
    CTO_TASKS_BACKEND = "cto.tasks.backend"
    CTO_TASKS_FRONTEND = "cto.tasks.frontend"
    CTO_TASKS_DEVOPS = "cto.tasks.devops"
    CTO_TASKS_MARKETING = "cto.tasks.marketing"
    CTO_TASKS_SALES = "cto.tasks.sales"
    CTO_TASKS_CUSTOMER_SUCCESS = "cto.tasks.customer_success"
    CTO_TASKS_CODE_REVIEW = "cto.tasks.code_review"
    AGENT_REPORTS = "agent.reports"
    QA_ALERTS = "qa.alerts"
    HR_REQUESTS = "hr.requests"
    KNOWLEDGE_REQUESTS = "knowledge.requests"
    FINANCE_REPORTS = "finance.reports"
    USER_FEEDBACK = "user.feedback"
    MILESTONE_BROADCASTS = "milestone.broadcasts"
