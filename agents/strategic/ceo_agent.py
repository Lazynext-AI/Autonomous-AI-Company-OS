"""CEO Agent - strategic direction and company health."""

import asyncio
from datetime import datetime, timedelta, timezone

from agents.base_agent import BaseAgent, TaskResult
from core.config import get_settings
from core.messaging.channels import Channels
from core.messaging.schemas import DirectiveMessage, MilestoneMessage, TaskMessage
from core.tools.search_tool import search_web
from core.tools.scrape_tool import research_topic


CEO_SYSTEM_PROMPT = """You are the CEO of an autonomous AI startup. Your job is to set strategic direction,
monitor company health, and ensure the team is always moving toward the mission.

ROLE: You define WHAT and WHY. The CTO defines HOW. You never write code.
FOCUS: User growth, revenue, product-market fit, competitive positioning.
OUTPUT: Clear, actionable directives the CTO can decompose into specific technical tasks.

When generating content:
- Be specific and contextual. Never use placeholders like [Current Date] or "TBD".
- Base all output on the actual data provided. If data is empty, acknowledge it and recommend next steps.
- Use concrete dates, numbers, and facts from the input.
- Write in a professional, executive tone."""


class CEOAgent(BaseAgent):
    """CEO agent - strategic direction, milestones, weekly briefs."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_brief_date = None
        self._milestone_thresholds = {
            "first_deployment": 1,  # First deployment milestone
            "first_user": 1,
            "10_users": 10,
            "100_users": 100,
            "first_dollar": 1,
            "100_mrr": 100,
            "1000_mrr": 1000,
        }

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.QA_ALERTS]

    def get_system_prompt(self) -> str:
        return CEO_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        return TaskResult(task_id=task.task_id, success=True, output="CEO does not execute tasks")

    async def run(self) -> None:
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "strategic_loop")
                await self.run_strategic_loop()
                interval = get_settings().ceo_loop_interval
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("ceo_loop_error", error=str(e))
                await asyncio.sleep(min(300, get_settings().ceo_loop_interval))

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def run_strategic_loop(self) -> None:
        brain = await self.company_brain.get()
        product_name = brain.product_name or "our product"

        search_results = await search_web(f"{product_name} competitors", 5)
        market_results = await search_web("market trends software startup", 5)
        search_context = "\n".join(
            f"- {r.get('title', '')}: {r.get('snippet', '')[:100]}"
            for r in (search_results + market_results)[:5]
        )

        # Firecrawl deep-read: pull full content from the top competitor pages.
        deep = await research_topic(f"{product_name} competitors", max_results=2)
        if deep:
            search_context += f"\n\nCompetitor deep-dive:\n{deep[:2500]}"

        directive = await self.generate_directive(search_context, brain)
        await self.message_bus.publish(Channels.CEO_DIRECTIVES, directive)
        await self.check_milestones()
        await self.maybe_generate_weekly_brief()

    async def generate_directive(self, search_context: str, brain) -> DirectiveMessage:
        deadline = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
        shipped = brain.shipped_features or []
        prompt = f"""You are the CEO. Create a strategic directive for the CTO to decompose into technical tasks.

CURRENT STATE:
- Product: {brain.product_name or 'Undefined - we need to define our first product'}
- Mission: {brain.mission or 'Build and launch a valuable software product'}
- Already shipped: {shipped if shipped else 'Nothing yet'}
- Metrics: {brain.metrics}
- Market context: {search_context[:500]}

RULES:
1. Be SPECIFIC. "Ship auth" not "Improve product". "Add POST /api/login" not "Work on backend".
2. If no product exists, your first priority MUST be defining and building the initial product.
3. Each priority must be actionable - the CTO will turn it into 5-10 concrete tasks.
4. Use the exact deadline: {deadline}
5. Return ONLY valid JSON, no markdown, no explanation.

JSON schema (return ONLY this object):
{{
  "strategic_goal": "One clear sentence: what we will achieve by the deadline",
  "deadline": "{deadline}",
  "priorities": [
    {{"area": "product", "focus": "Specific deliverable", "why": "Business reason"}},
    {{"area": "engineering", "focus": "Specific technical outcome", "why": "Technical reason"}},
    {{"area": "growth", "focus": "Specific growth action", "why": "Growth reason"}}
  ]
}}

Return ONLY the JSON object."""

        response = await self.call_llm(CEO_SYSTEM_PROMPT, prompt)
        import json
        try:
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(response[start:end])
                goal = str(data.get("strategic_goal", "")).strip()
                priorities = data.get("priorities", [])
                if not isinstance(priorities, list):
                    priorities = []
                priorities = [p for p in priorities if isinstance(p, dict) and p.get("area") and p.get("focus")]
                return DirectiveMessage(
                    from_agent=self.agent_id,
                    strategic_goal=goal or "Continue product development",
                    deadline=str(data.get("deadline", deadline)),
                    priorities=priorities[:5],
                )
        except json.JSONDecodeError:
            pass
        return DirectiveMessage(
            from_agent=self.agent_id,
            strategic_goal="Continue product development and user growth",
            deadline=deadline,
            priorities=[],
        )

    async def check_milestones(self) -> None:
        brain = await self.company_brain.get()
        m = brain.metrics
        users = getattr(m, "users", 0) or (m.get("users", 0) if isinstance(m, dict) else 0)
        mrr = getattr(m, "mrr", 0) or (m.get("mrr", 0) if isinstance(m, dict) else 0)
        revenue = getattr(m, "revenue", 0) or (m.get("revenue", 0) if isinstance(m, dict) else 0)

        for name, threshold in self._milestone_thresholds.items():
            # Check if milestone already logged
            already_logged = await self._is_milestone_logged(name)
            if already_logged:
                continue
            
            milestone_achieved = False
            description = ""
            
            if "user" in name and users >= threshold:
                milestone_achieved = True
                description = f"Reached {users} users"
            elif "mrr" in name and mrr >= threshold:
                milestone_achieved = True
                description = f"Reached ${mrr} MRR"
            elif "dollar" in name and revenue >= threshold:
                milestone_achieved = True
                description = "First revenue"
            
            if milestone_achieved:
                # Save milestone to database
                await self._save_milestone(name, description)
                
                # Broadcast milestone message
                await self.message_bus.publish(
                    Channels.MILESTONE_BROADCASTS,
                    MilestoneMessage(
                        from_agent=self.agent_id,
                        milestone_type=name,
                        description=description,
                    ),
                )
    
    async def _is_milestone_logged(self, milestone_type: str) -> bool:
        """Check if milestone already exists in milestone_log."""
        try:
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if not client.is_configured():
                return False
            
            def _check():
                r = client.table("milestone_log").select("id").eq("milestone_type", milestone_type).limit(1).execute()
                return len(r.data or []) > 0
            
            return await asyncio.to_thread(_check)
        except Exception as e:
            self.logger.warning("milestone_check_failed", milestone=milestone_type, error=str(e))
            return False
    
    async def _save_milestone(self, milestone_type: str, description: str) -> None:
        """Save milestone to milestone_log table."""
        try:
            from core.cloudflare_client import CloudflareClient
            from datetime import datetime, timezone
            
            client = CloudflareClient()
            if not client.is_configured():
                return
            
            payload = {
                "milestone_type": milestone_type,
                "description": description,
                "achieved_at": datetime.now(timezone.utc).isoformat(),
            }
            
            def _insert():
                client.table("milestone_log").insert(payload).execute()
            
            await asyncio.to_thread(_insert)
            self.logger.info("milestone_saved", milestone_type=milestone_type, description=description)
        except Exception as e:
            self.logger.warning("milestone_save_failed", milestone_type=milestone_type, error=str(e))

    async def maybe_generate_weekly_brief(self) -> None:
        # Only post briefings after first milestone is achieved
        if not await self._has_any_milestones():
            self.logger.debug("skipping_brief_no_milestones", message="Waiting for first milestone before posting briefings")
            return

        now = datetime.now(timezone.utc).date()
        if self._last_brief_date and (now - self._last_brief_date).days < 7:
            return
        brief = await self.generate_weekly_brief()
        self._last_brief_date = now
        from core.operations.briefings import post_briefing
        await post_briefing("founder_brief", "Founder Briefing", brief)

        from core.config import get_settings
        settings = get_settings()
        if settings.founder_email:
            try:
                from core.tools.email_tool import send_email
                await send_email(settings.founder_email, "Founder Briefing", brief)
            except Exception as e:
                self.logger.warning("weekly_brief_email_failed", error=str(e))
    
    async def _has_any_milestones(self) -> bool:
        """Check if any milestones have been achieved."""
        try:
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

    async def generate_weekly_brief(self) -> str:
        brain = await self.company_brain.get()
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%B %d, %Y")
        metrics = brain.metrics
        m_users = getattr(metrics, "users", 0) or (metrics.get("users", 0) if isinstance(metrics, dict) else 0)
        m_revenue = getattr(metrics, "revenue", 0) or (metrics.get("revenue", 0) if isinstance(metrics, dict) else 0)
        m_mrr = getattr(metrics, "mrr", 0) or (metrics.get("mrr", 0) if isinstance(metrics, dict) else 0)
        m_uptime = getattr(metrics, "uptime_pct", 100) or (metrics.get("uptime_pct", 100) if isinstance(metrics, dict) else 100)
        m_errors = getattr(metrics, "error_rate", 0) or (metrics.get("error_rate", 0) if isinstance(metrics, dict) else 0)
        m_deploys = getattr(metrics, "deploy_count", 0) or (metrics.get("deploy_count", 0) if isinstance(metrics, dict) else 0)
        shipped = brain.shipped_features or []
        bugs = brain.open_bugs or []
        blockers = brain.blockers or []
        bug_descs = [getattr(b, "description", str(b)) for b in bugs[:5]] if bugs else []
        blocker_descs = [getattr(b, "description", str(b)) for b in blockers[:5]] if blockers else []

        prompt = f"""Generate a Founder Briefing email. Use the EXACT date: {date_str}. Never use placeholders.

COMPANY DATA:
- Product: {brain.product_name or 'Not yet defined'}
- Mission: {brain.mission or 'Build and launch a valuable software product'}
- Shipped: {shipped if shipped else 'None yet'}
- Bugs: {bug_descs if bug_descs else 'None'}
- Blockers: {blocker_descs if blocker_descs else 'None'}
- Metrics: Users={m_users}, Revenue=${m_revenue}, MRR=${m_mrr}, Uptime={m_uptime}%, Error rate={m_errors}%, Deploys={m_deploys}

Use these section headers in order. Fill each with real content from the data above:
- ## Founder Briefing with **Date:** {date_str}
- ### What Shipped
- ### Metrics Delta
- ### Failures
- ### Blockers
- ### CEO Strategic Directive: Next Week Plan

RULES: Use {date_str} for the date. Never write [Current Date]. Populate each section from the company data. Be concise. Output ONLY the email body in markdown."""
        return await self.call_llm(CEO_SYSTEM_PROMPT, prompt)
