"""Sales Agent - prospects, outreach."""

import asyncio
import html
import time
import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.cloudflare_client import CloudflareClient
from core.messaging.channels import Channels
from core.messaging.schemas import ReportMessage, TaskMessage


class SalesAgent(BaseAgent):
    """Sales agent."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_outreach_at: float = 0.0
        self._outreach_interval_seconds = 4 * 3600
        self._cf = CloudflareClient()

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CTO_TASKS_SALES]

    def get_system_prompt(self) -> str:
        return "You are an SDR. You find prospects and personalize outreach."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        import time
        start = time.time()
        try:
            output = await self.call_llm(
                self.get_system_prompt(),
                f"Create sales outreach for: {task.description}",
            )
            return TaskResult(
                task_id=task.task_id,
                success=True,
                output=output,
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                time_taken_seconds=int(time.time() - start),
            )

    async def idle_behavior(self) -> None:
        now = time.time()
        if (now - self._last_outreach_at) >= self._outreach_interval_seconds:
            await self._run_outreach_cycle()
            self._last_outreach_at = now
        await asyncio.sleep(3)

    async def _run_outreach_cycle(self) -> None:
        brain = await self.company_brain.get()
        prompt = f"""Create a short outbound sales batch plan for today.
Product: {brain.product_name or "Undefined"}
Mission: {brain.mission or "Acquire initial users"}
Metrics: {brain.metrics}

Return plain text with:
1) ICP segment
2) 3 pain-based hooks
3) 1 outreach message template
4) follow-up sequence (day 2 and day 5)
5) success KPI for this batch"""
        plan = await self.call_llm(self.get_system_prompt(), prompt)
        campaign_id = await self._draft_campaign(brain.product_name or "Lazynext")
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=f"sales-{str(uuid.uuid4())[:8]}",
                status="outreach_batch_planned",
                result=plan[:12000] + (f"\n\nDraft campaign id: {campaign_id}" if campaign_id else ""),
            ),
        )
        await self.episodic_memory.add_event(
            self.agent_id,
            "sales_outreach_planned",
            plan[:300],
        )

    async def _draft_campaign(self, product_name: str) -> int | None:
        """Write one draft row into email_campaigns when none is pending.

        The Marketing page lists drafts with a Send button — the agent
        produces the artifact, a human fires it. Returns the campaign id.
        """
        if not self._cf.is_configured():
            return None
        try:
            pending = await self._cf.aquery(
                "SELECT COUNT(*) c FROM email_campaigns WHERE status IN ('draft','sending')"
            )
            if (pending[0]["c"] if pending else 0) > 0:
                return None
            contacts = await self._cf.aquery(
                "SELECT COUNT(*) c FROM email_contacts WHERE subscribed = 1"
            )
            if not contacts or not contacts[0]["c"]:
                return None
            copy = await self.call_llm(
                self.get_system_prompt(),
                f"Write one outreach email for {product_name} to a cold prospect.\n"
                "Output exactly two lines:\n"
                "SUBJECT: <subject line>\n"
                "BODY: <plain text, 3 short paragraphs, no greeting placeholder, no HTML>",
            )
            subject = body = ""
            if "SUBJECT:" in copy and "BODY:" in copy:
                after = copy.split("SUBJECT:", 1)[1]
                subject, body = (s.strip() for s in after.split("BODY:", 1))
            if not subject or not body:
                return None
            html_body = "".join(
                f"<p>{html.escape(p.strip())}</p>"
                for p in body.split("\n") if p.strip()
            ) or f"<p>{html.escape(body)}</p>"
            res = await self._cf.aexecute(
                "INSERT INTO email_campaigns (name, subject, html) VALUES (?, ?, ?)",
                [f"sales-outreach-{time.strftime('%Y-%m-%d')}", subject, html_body],
            )
            return int(res.get("meta", {}).get("last_row_id", 0)) or None
        except Exception as e:
            self.logger.warning("draft_campaign_failed", error=str(e))
            return None
