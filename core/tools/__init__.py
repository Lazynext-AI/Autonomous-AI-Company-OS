"""Agent tools: code executor (E2B), email (Resend), web search (Serper), scraping (Firecrawl)."""

from core.tools.code_executor import CodeExecutionResult, run_code
from core.tools.email_tool import send_email
from core.tools.scrape_tool import research_topic, scrape_url
from core.tools.search_tool import search_duckduckgo, search_web

__all__ = [
    "run_code",
    "CodeExecutionResult",
    "send_email",
    "search_duckduckgo",
    "search_web",
    "scrape_url",
    "research_topic",
]
