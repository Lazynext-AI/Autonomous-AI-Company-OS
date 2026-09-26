"""Sales Agent - prospects, outreach."""

import asyncio
import html
import json
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

    async def periodic_work(self) -> None:
        """Fire the outreach cycle on its interval even while tasks keep
        arriving — idle_behavior never runs when the queue stays busy."""
        now = time.time()
        if (now - self._last_outreach_at) >= self._outreach_interval_seconds:
            await self._run_outreach_cycle()
            self._last_outreach_at = now

    async def idle_behavior(self) -> None:
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
        qualified = await self._qualify_leads()
        campaign_id = await self._draft_campaign(brain.product_name or "Lazynext")
        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                task_id=f"sales-{str(uuid.uuid4())[:8]}",
                status="outreach_batch_planned",
                result=plan[:12000]
                + (f"\n\nDraft campaign id: {campaign_id}" if campaign_id else "")
                + f"\nLeads qualified this cycle: {qualified}",
            ),
        )
        await self.episodic_memory.add_event(
            self.agent_id,
            "sales_outreach_planned",
            plan[:300],
        )

    async def _qualify_leads(self, batch: int = 8) -> int:
        """Score a batch of raw crm_leads (the serper-prospecting seed)
        against the product ICP and stamp verdicts — the 'sales qualifies
        them first' step ahead of any consent-gated outreach. Bounded to a
        few rows per outreach cycle to keep LLM spend flat; leads stay out
        of email_contacts regardless of verdict — qualification only
        advances crm_leads.status."""
        if not self._cf.is_configured():
            return 0
        try:
            rows = await self._cf.aquery(
                "SELECT id, name, company, email, notes FROM crm_leads "
                "WHERE status = 'lead' ORDER BY id LIMIT ?",
                [batch],
            )
            if not rows:
                return 0
            brain = await self.company_brain.get()
            updates: list[tuple[str, list]] = []
            qualified = 0
            for lead in rows:
                verdict = await self.call_llm(
                    "You are a lead qualifier. Return ONLY compact JSON.",
                    "Score this prospect's fit for the product.\n"
                    f"Product: {brain.product_name or 'Lazynext'} — "
                    f"{brain.mission or 'WCAG accessibility scanning SaaS'}\n"
                    f"Lead: name={lead.get('name') or ''}, "
                    f"company={lead.get('company') or ''}, "
                    f"email={lead.get('email') or 'none'}\n"
                    f"Research notes: {(lead.get('notes') or '')[:800]}\n"
                    'Reply {"score":0-10,"verdict":"qualified|nurture|'
                    'disqualified","why":"<=160 chars"}',
                )
                score: object = "?"
                try:
                    data = json.loads(verdict[verdict.index("{"): verdict.rindex("}") + 1])
                    status = str(data.get("verdict", "nurture"))
                    why = str(data.get("why", ""))[:160]
                    score = data.get("score", "?")
                    if status not in ("qualified", "nurture", "disqualified"):
                        status = "nurture"
                except (ValueError, AttributeError):
                    status, why = "nurture", ""
                updates.append((
                    "UPDATE crm_leads SET status = ?, "
                    "notes = COALESCE(notes,'') || ? WHERE id = ?",
                    [status, f" | q:{score} {why}".strip(), lead["id"]],
                ))
                qualified += status == "qualified"
            await self._cf.abatch(updates)
            self.logger.info("leads_qualified", batch=len(rows), qualified=qualified)
            await self.episodic_memory.add_event(
                self.agent_id, "leads_qualified",
                f"batch={len(rows)} qualified={qualified}",
            )
            return qualified
        except Exception as e:
            self.logger.warning("lead_qualification_failed", error=str(e))
            return 0

    async def _draft_campaign(self, product_name: str) -> int | None:
        """Write one draft row into email_campaigns when none is pending.

        The Marketing page lists drafts with a Send button — the agent
        produces the artifact, a human fires it. Returns the campaign id.
        """
        if not self._cf.is_configured():
            self.logger.warning("draft_campaign_skipped", reason="cf_not_configured")
            return None
        try:
            pending = await self._cf.aquery(
                "SELECT COUNT(*) c FROM email_campaigns WHERE status IN ('draft','sending')"
            )
            if (pending[0]["c"] if pending else 0) > 0:
                self.logger.info("draft_campaign_skipped", reason="pending_exists")
                return None
            contacts = await self._cf.aquery(
                "SELECT COUNT(*) c FROM email_contacts WHERE subscribed = 1"
            )
            if not contacts or not contacts[0]["c"]:
                self.logger.info("draft_campaign_skipped", reason="no_subscribed_contacts")
                return None
            copy_prompt = (
                f"Write one outreach email for {product_name} to a cold prospect.\n"
                "Output exactly two lines:\n"
                "SUBJECT: <subject line>\n"
                "BODY: <plain text, 3 short paragraphs, no greeting placeholder, no HTML>"
            )
            subject = body = ""
            for attempt in range(2):
                copy = await self.call_llm(self.get_system_prompt(), copy_prompt)
                low = (copy or "").lower()
                if "subject:" in low:
                    after = copy[low.index("subject:") + len("subject:"):]
                    if "body:" in after.lower():
                        body_idx = after.lower().index("body:")
                        subject = after[:body_idx].strip().strip("*#` \t\n").strip()
                        body = after[body_idx + len("body:"):].strip().strip("*#` \t\n").strip()
                    else:
                        # No BODY: marker — first line is the subject, any
                        # remaining lines are the body the model forgot to tag.
                        lines = after.split("\n")
                        subject = lines[0].strip().strip("*#` \t\n").strip()
                        body = "\n".join(lines[1:]).strip().strip("*#` \t\n").strip()
                if subject:
                    break
                self.logger.warning(
                    "draft_campaign_copy_retry",
                    attempt=attempt,
                    copy=(copy or "")[:300],
                )
            if not subject:
                self.logger.warning(
                    "draft_campaign_skipped",
                    reason="copy_parse_failed",
                    copy=(copy or "")[:300],
                )
                return None
            if not body:
                body = (
                    f"Hi,\n\n{product_name} scans websites for accessibility issues and "
                    "produces a prioritized fix list — free rendered scan, no signup.\n\n"
                    "Worth a look? Reply and I'll send your site's report."
                )
            html_body = "".join(
                f"<p>{html.escape(p.strip())}</p>"
                for p in body.split("\n") if p.strip()
            ) or f"<p>{html.escape(body)}</p>"
            res = await self._cf.aexecute(
                "INSERT INTO email_campaigns (name, subject, html) VALUES (?, ?, ?)",
                [f"sales-outreach-{time.strftime('%Y-%m-%d')}", subject, html_body],
            )
            row_id = int(res.get("meta", {}).get("last_row_id", 0) or 0)
            if not row_id:
                self.logger.warning(
                    "draft_campaign_skipped", reason="insert_no_rowid", res=str(res)[:300]
                )
                return None
            return row_id
        except Exception as e:
            self.logger.warning(
                "draft_campaign_failed", error=str(e), error_type=type(e).__name__
            )
            return None
