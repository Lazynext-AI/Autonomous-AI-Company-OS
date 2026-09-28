"""Finance Agent - weekly reports."""

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import TaskMessage


class FinanceAgent(BaseAgent):
    """Finance agent - weekly reports."""

    def get_subscribed_channels(self) -> list[Channels]:
        return []

    def get_system_prompt(self) -> str:
        return """You are the Finance Agent for an autonomous AI startup. You track revenue, MRR, users, burn rate, and runway.
Output concise, professional reports. Use actual data provided. Never use placeholders or templates."""

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        return TaskResult(task_id=task.task_id, success=True, output="Finance report")

    async def run(self) -> None:
        import asyncio
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "finance_report")
                if await self._report_due():
                    await self.run_weekly_finance_report()
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("finance_loop_error", error=str(e))
                await asyncio.sleep(3600)

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def _report_due(self) -> bool:
        """Persisted weekly gate — the in-loop sleep resets on every fleet
        restart (launchd KeepAlive), which fired a report per restart."""
        try:
            from datetime import datetime, timezone
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if not client.is_configured():
                return True
            last = await client.kv_get("brief:last:finance")
            now = datetime.now(timezone.utc).date()
            if last and (now - datetime.fromisoformat(last).date()).days < 7:
                return False
            self._pending_report_stamp = now.isoformat()
            return True
        except Exception as e:
            self.logger.warning("report_gate_read_failed", error=str(e))
            return True

    async def run_weekly_finance_report(self) -> None:
        # Only post reports after first milestone is achieved
        if not await self._has_any_milestones():
            self.logger.debug("skipping_report_no_milestones", message="Waiting for first milestone before posting reports")
            return

        brain = await self.company_brain.get()
        m = brain.metrics
        users = getattr(m, "users", 0) or (m.get("users", 0) if isinstance(m, dict) else 0)
        mrr = getattr(m, "mrr", 0) or (m.get("mrr", 0) if isinstance(m, dict) else 0)
        revenue = getattr(m, "revenue", 0) or (m.get("revenue", 0) if isinstance(m, dict) else 0)
        # brain.metrics has no writer for users/revenue — pull the live
        # product funnel so the report reflects real counts.
        funnel = {}
        try:
            import asyncio
            import httpx
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if client.is_configured():
                def _funnel():
                    with httpx.Client(timeout=15.0, headers=client._headers) as http:
                        r = http.get(f"{client.url}/api/v1/billing/funnel")
                        return r.json() if r.status_code == 200 else {}
                funnel = await asyncio.to_thread(_funnel)
                users = users or (funnel.get("licenses_pro", 0) + funnel.get("licenses_free", 0))
        except Exception as e:
            self.logger.warning("funnel_fetch_failed", error=str(e))
        funnel_line = (
            f"\nFunnel (live): scans_30d={funnel['scans_30d']}, leads={funnel['leads']}, "
            f"crm_leads={funnel['crm_leads']}, engaged={funnel['crm_engaged']}, "
            f"trials={funnel['trials_active']}, "
            f"pro={funnel['licenses_pro']}, subs={funnel['subscriptions_active']}, "
            f"monitors={funnel['monitors']}"
        ) if funnel else ""
        prompt = f"""You are the Finance Agent. Generate a concise weekly finance report for the founder.

DATA: Users={users}, MRR=${mrr}, Revenue=${revenue}{funnel_line}
Product: {brain.product_name or 'Not defined'}
Billing is in Dodo TEST MODE — revenue is legitimately $0 until the live flip; do not flag it as a failure.

Write a professional 3-5 sentence report. Include: key metrics, trends (if inferable), and one recommendation.
No placeholders. Use the actual numbers. Output plain text only."""
        report = await self.call_llm(self.get_system_prompt(), prompt)
        from core.operations.briefings import post_briefing
        await post_briefing("finance_report", "Weekly Finance Report", report)
        try:
            stamp = getattr(self, "_pending_report_stamp", None)
            if stamp:
                client = CloudflareClient()
                if client.is_configured():
                    await client.kv_put("brief:last:finance", stamp, ttl=0)
        except Exception as e:
            self.logger.warning("report_gate_write_failed", error=str(e))

        from core.config import get_settings
        s = get_settings()
        if s.founder_email:
            try:
                from core.tools.email_tool import send_email
                await send_email(s.founder_email, "Weekly Finance Report", report)
            except Exception as e:
                self.logger.warning("finance_report_email_failed", error=str(e))
    
    async def _has_any_milestones(self) -> bool:
        """Check if any milestones have been achieved."""
        try:
            import asyncio
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if not client.is_configured():
                return False
            
            def _check():
                r = client.table("milestone_log").select("id").limit(1).execute()
                return len(r.data or []) > 0
            
            return await asyncio.to_thread(_check)
        except Exception as e:
            self.logger.warning("milestone_check_failed", error=str(e))
            return False
