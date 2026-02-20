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
                await self.run_weekly_finance_report()
                await asyncio.sleep(604800)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("finance_loop_error", error=str(e))
                await asyncio.sleep(3600)

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def run_weekly_finance_report(self) -> None:
        from core.config import get_settings
        s = get_settings()
        if not s.founder_email:
            return
        
        # Only send emails after first milestone is achieved
        if not await self._has_any_milestones():
            self.logger.debug("skipping_email_no_milestones", message="Waiting for first milestone before sending emails")
            return
        
        brain = await self.company_brain.get()
        m = brain.metrics
        users = getattr(m, "users", 0) or (m.get("users", 0) if isinstance(m, dict) else 0)
        mrr = getattr(m, "mrr", 0) or (m.get("mrr", 0) if isinstance(m, dict) else 0)
        revenue = getattr(m, "revenue", 0) or (m.get("revenue", 0) if isinstance(m, dict) else 0)
        prompt = f"""You are the Finance Agent. Generate a concise weekly finance report for the founder.

DATA: Users={users}, MRR=${mrr}, Revenue=${revenue}
Product: {brain.product_name or 'Not defined'}

Write a professional 3-5 sentence report. Include: key metrics, trends (if inferable), and one recommendation.
No placeholders. Use the actual numbers. Output plain text only."""
        report = await self.call_llm(self.get_system_prompt(), prompt)
        try:
            from core.tools.email_tool import send_email
            await send_email(s.founder_email, "Weekly Finance Report", report)
        except Exception as e:
            self.logger.warning("finance_report_email_failed", error=str(e))
    
    async def _has_any_milestones(self) -> bool:
        """Check if any milestones have been achieved."""
        try:
            import asyncio
            from core.supabase_client import SupabaseClient
            client = SupabaseClient()
            if not client.is_configured():
                return False
            
            def _check():
                r = client.table("milestone_log").select("id").limit(1).execute()
                return len(r.data or []) > 0
            
            return await asyncio.to_thread(_check)
        except Exception as e:
            self.logger.warning("milestone_check_failed", error=str(e))
            return False
