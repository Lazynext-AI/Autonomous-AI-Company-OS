"""CTO Agent - technical orchestration and task decomposition."""

import asyncio
import json
import re
import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.config import get_settings
from core.messaging.channels import Channels
from core.messaging.schemas import DirectiveMessage, HRRequestMessage, QAAlertMessage, ReportMessage, TaskMessage


CTO_SYSTEM_PROMPT = """You are the CTO of an autonomous AI startup. You receive strategic goals from the CEO
and translate them into specific, executable technical tasks.

ROLE: You define HOW. The CEO defines WHAT and WHY. You never write code yourself—you assign tasks.
OUTPUT: A JSON array of tasks. Each task goes to exactly one agent based on assign_to.

AVAILABLE AGENTS (use these EXACT values for assign_to):
- backend: worker routes, scanner logic, KV/D1 data, auth/licensing
- frontend: UI, static pages, components, styling, client-side logic
- devops: CI/CD, deployment, infrastructure, GitHub Actions, Cloudflare
- marketing: Content, campaigns, SEO, landing pages, messaging
- sales: Outreach, demos, pipeline, customer acquisition
- customer_success: Support, onboarding, feedback, documentation

RULES:
1. Each task must have ONE assign_to. Pick the best-fit agent.
2. description: Clear, actionable. "Add POST /api/auth/login" not "Work on auth".
3. acceptance_criteria: 2-5 testable criteria. "Returns 401 for invalid credentials".
4. estimated_minutes: Realistic (15-120).
5. assign_to: One of backend, frontend, devops, marketing, sales, customer_success."""


# Task descriptions matching these are architecturally impossible or
# already-shipped classes the LLM re-proposes despite prompt bounds (109-task
# escalation wave on 2026-09-25). Killed at insert to save five doomed
# attempts each; the terminal failed row also feeds _is_duplicate_task so
# paraphrases stay suppressed for 24h. Keep patterns tight — a false positive
# silently drops real work; misses still die at the write/test/fitness gates.
# Mirrored in worker/src/index.ts (INFEASIBLE_TASK_PATTERNS) — keep in sync.
_INFEASIBLE_SPECS: list[tuple[str, str]] = [
    ("landing/multi-page surface", r"landing[\s-]?page|multi[\s-]?page|onboarding (flow|wizard|experience)"),
    ("a/b experiment", r"\b(a/?b|split)[\s-]?test"),
    ("user accounts/auth", r"user[\s-]?(account|login|dashboard|profile|registration|auth)|\b(sign[\s-]?up|log[\s-]?in|jwt|oauth|sso|saml)\b"),
    ("document-file scanning", r"\bpdf\b|\bdocx?\b|document[\s-]?file|file upload"),
    ("native app", r"mobile app|ios app|android app|react native|desktop app|electron"),
    ("analytics/tracking system", r"\b(analytics|telemetry|metrics)\b|tracking (system|pixel|infrastructure)|campaign (effectiveness|performance) tracking"),
    ("email/notification system", r"(notification|alerting) (system|service|engine)|email (system|automation|infrastructure|delivery)|follow[\s-]?up email|\bdrip\b"),
    ("feedback surface", r"feedback (endpoint|form|system|collection|widget)"),
    ("deploy automation", r"deploy(ment)? automation|auto[\s-]?deploy|\bci/?cd\b|deployment pipeline|\brollback\b"),
    ("lead capture", r"lead (capture|scoring|form)|newsletter"),
    ("extra payment provider", r"\b(stripe|paypal|paddle|lemonsqueezy|razorpay|payment gateway)\b"),
    ("extra email provider", r"\b(sendgrid|mailgun|postmark)\b|resend (api|integration|provider)"),
    ("export format", r"(csv|excel)[\s-]?export|export (to|as) (csv|pdf|excel)"),
    ("per-user personalization", r"personaliz|saved (history|scans|reports)|scan history"),
    ("monitoring system", r"monitoring (system|service|dashboard|platform)|uptime monitor"),
]
INFEASIBLE_TASK_PATTERNS: list[tuple[str, "re.Pattern[str]"]] = [
    (label, re.compile(p, re.IGNORECASE)) for label, p in _INFEASIBLE_SPECS
]


def infeasible_task_reason(description: str) -> str | None:
    """Return the dead-class label if a generated task can never ship."""
    for label, pat in INFEASIBLE_TASK_PATTERNS:
        if pat.search(description):
            return label
    return None


class CTOAgent(BaseAgent):
    """CTO agent - decomposes directives into tasks, handles escalations."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_orchestration = None

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.CEO_DIRECTIVES, Channels.AGENT_REPORTS, Channels.QA_ALERTS]

    def get_system_prompt(self) -> str:
        return CTO_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        return TaskResult(task_id=task.task_id, success=True, output="CTO delegates tasks")

    async def run(self) -> None:
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "orchestration")
                # Process messages in parallel for faster handling
                tasks = []
                for channel in self.get_subscribed_channels():
                    msgs = await self.message_bus.read_messages(channel, "agents", self.agent_id, count=10)
                    for msg_id, msg in msgs:
                        if isinstance(msg, DirectiveMessage):
                            tasks.append(self.run_orchestration_loop(directive=msg))
                        elif isinstance(msg, QAAlertMessage):
                            tasks.append(self.handle_qa_alert(msg))
                        elif isinstance(msg, ReportMessage):
                            tasks.append(self.handle_agent_report(msg))
                        await self.message_bus.acknowledge(channel, "agents", msg_id)
                
                # Execute all message handlers in parallel
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)

                await self.run_orchestration_loop()
                interval = get_settings().cto_loop_interval
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("cto_loop_error", error=str(e))
                await asyncio.sleep(min(30, get_settings().cto_loop_interval))  # Reduced from 120s to 30s

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def run_orchestration_loop(self, directive: DirectiveMessage | None = None) -> None:
        directive_msg_id: str | None = None
        if directive is None:
            msgs = await self.message_bus.read_messages(
                Channels.CEO_DIRECTIVES, "agents", self.agent_id, count=1
            )
            for msg_id, m in msgs:
                if isinstance(m, DirectiveMessage):
                    directive = m
                    directive_msg_id = msg_id
                    break

        if directive:
            tasks = await self.decompose_directive(directive)
            role_channel = {
                "backend": Channels.CTO_TASKS_BACKEND,
                "frontend": Channels.CTO_TASKS_FRONTEND,
                "devops": Channels.CTO_TASKS_DEVOPS,
                "code_review": Channels.CTO_TASKS_CODE_REVIEW,
                "marketing": Channels.CTO_TASKS_MARKETING,
                "sales": Channels.CTO_TASKS_SALES,
                "customer_success": Channels.CTO_TASKS_CUSTOMER_SUCCESS,
            }
            
            # Check for duplicate tasks before publishing
            seen_descriptions = set()
            for t in tasks:
                assign = (t.context or {}).get("assign_to", "backend")
                channel = role_channel.get(assign, Channels.CTO_TASKS_BACKEND)
                
                # Normalize description for duplicate detection
                desc_normalized = t.description.lower().strip()[:100]

                # Deterministic kill for impossible/already-shipped classes —
                # prompt bounds are advisory; this gate is not. Recorded as a
                # terminal failed row so the dedup corpus suppresses
                # paraphrases for 24h (agentTick only requeues attempts<3).
                infeasible = infeasible_task_reason(t.description)
                if infeasible:
                    self.logger.info("infeasible_task_filtered", description=t.description[:60], reason=infeasible)
                    await self.task_tracker.create_task(
                        t.task_id, assign, t.description, status="failed", attempts=3,
                    )
                    await self.task_tracker.update_task(
                        t.task_id, result=f"infeasible: {infeasible} (auto-killed at insert)",
                    )
                    continue

                # Check if similar task already exists or was recently completed
                is_duplicate = await self._is_duplicate_task(desc_normalized, assign)
                if is_duplicate:
                    self.logger.info("skipping_duplicate_task", description=t.description[:50], assign_to=assign)
                    continue
                
                # Track descriptions in this batch to avoid duplicates
                if desc_normalized in seen_descriptions:
                    self.logger.info("skipping_duplicate_in_batch", description=t.description[:50])
                    continue
                seen_descriptions.add(desc_normalized)
                
                await self.task_tracker.create_task(
                    t.task_id,
                    assign,
                    t.description,
                    status="pending",
                    attempts=0,
                )
                await self.message_bus.publish(channel, t)
            if directive_msg_id:
                await self.message_bus.acknowledge(Channels.CEO_DIRECTIVES, "agents", directive_msg_id)

        await self.check_agent_workloads()

    async def _get_recent_tasks(self) -> list[dict]:
        """Get recent tasks from task_log for duplicate prevention."""
        try:
            from core.cloudflare_client import CloudflareClient
            from datetime import datetime, timedelta, timezone
            
            client = CloudflareClient()
            if not client.is_configured():
                return []
            
            # Get tasks from last 24h — a 2h window lets the same idea
            # regenerate once older attempts scroll out of view.
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            
            def _fetch():
                r = client.table("task_log").select("description,status,agent_id").gte("created_at", cutoff).order("created_at", ascending=False).limit(50).execute()
                return r.data or []
            
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            self.logger.warning("recent_tasks_fetch_failed", error=str(e))
            return []

    async def _is_duplicate_task(self, description: str, assign_to: str) -> bool:
        """Check if a similar task already exists or was recently completed."""
        try:
            recent_tasks = await self._get_recent_tasks()
            desc_lower = description.lower().strip()
            
            # Check for similar tasks
            stop = {"task", "the", "and", "for", "with", "that", "this", "into",
                    "from", "conduct", "implement", "setup", "set", "add",
                    "create", "build", "review"}
            def content_words(desc: str) -> set:
                return {w.strip(".,:;()") for w in desc.split()
                        if len(w) > 3 and w not in stop}

            for task in recent_tasks:
                task_desc = (task.get("description") or "").lower().strip()
                status = task.get("status", "")

                if not task_desc or len(desc_lower) < 15:
                    continue

                # Substring match, then content-word overlap for paraphrases
                # ("security scan" vs "security audit" vs "vulnerability
                # assessment" — the same task reworded).
                similar = desc_lower in task_desc or task_desc in desc_lower
                if not similar:
                    a, b = content_words(desc_lower), content_words(task_desc)
                    if a and b:
                        smaller, larger = (a, b) if len(a) <= len(b) else (b, a)
                        similar = len(smaller & larger) >= max(2, (len(smaller) + 1) // 2)
                if not similar:
                    continue

                # Every status counts: a failed/escalated task is a signal the
                # approach needs changing, not that it should regenerate under
                # new wording on the next planning cycle.
                return True

            return False
        except Exception as e:
            self.logger.warning("duplicate_check_failed", error=str(e))
            return False

    async def decompose_directive(self, directive: DirectiveMessage) -> list[TaskMessage]:
        brain = await self.company_brain.get()
        
        # Get recent tasks to avoid duplicates
        recent_tasks = await self._get_recent_tasks()
        recent_descriptions = [t.get("description", "").lower()[:100] for t in recent_tasks[:10]]
        
        prompt = f"""Decompose this CEO directive into 5-10 technical tasks. Each task goes to ONE agent.

DIRECTIVE:
- Goal: {directive.strategic_goal}
- Deadline: {directive.deadline}
- Priorities: {json.dumps(directive.priorities)}

TECH CONTEXT:
- Stack: {brain.tech_stack}
- Sprint: {brain.current_sprint}
- Shipped: {brain.shipped_features or []}

RECENT TASKS (avoid duplicates):
{json.dumps(recent_descriptions[:5]) if recent_descriptions else "[]"}

CRITICAL RULES:
- Do NOT create tasks similar to recent tasks above. Each task must be unique and specific.
- The Shipped list is CLOSED work — never create a task that rebuilds, extends, or re-words anything in it, even partially.
- Managed files (worker.js, index.html, src/scanner.js, package.json, test/scanner.test.mjs) cannot be edited — deliverables targeting them are always rejected. Tasks must produce NEW modules, tests, or docs.
- The product has NO user accounts or auth — never propose tasks needing logins, user/customer dashboards, profiles, saved history, or per-user data.
- The product is a single-page app — no multi-page flows, onboarding wizards, landing pages, or A/B tests can ship.
- Recurring rejected classes — never propose: analytics/metrics dashboards or tracking systems (already exist in KV/D1/dashboard), notification/alert/email systems (already shipped via Brevo), feedback endpoints, deploy automation (intentionally manual), lead capture (the 402 funnel already ships it), report export formats (CSV + PDF export already ship on /report/:id).
- Stay in scope: no new platforms or apps, no additional payment providers (Dodo only), no additional email providers (Brevo only), no architecture rewrites. The scanner is HTML/DOM-based — no PDF/document-file scanning.

OUTPUT: JSON array only. No markdown, no explanation.
Schema per task:
{{
  "description": "Specific actionable task. E.g. 'Add POST /api/auth/login returning JWT'",
  "acceptance_criteria": ["Criterion 1", "Criterion 2"],
  "estimated_minutes": 45,
  "assign_to": "backend|frontend|devops|code_review|marketing|sales|customer_success"
}}

assign_to rules:
- backend: APIs, DB, auth, server logic
- frontend: UI, pages, components
- devops: CI/CD, deploy, infra
- code_review: Security scanning, code quality review, dependency checks
- marketing: content, SEO, campaigns
- sales: outreach, demos
- customer_success: docs, support, onboarding

Return 5-10 UNIQUE tasks. Return ONLY the JSON array."""

        response = await self.call_llm(CTO_SYSTEM_PROMPT, prompt)
        tasks = []
        try:
            start = response.find("[")
            end = response.rfind("]") + 1
            if start >= 0 and end > start:
                data = json.loads(response[start:end])
                if not isinstance(data, list):
                    data = []
                for t in data[:10]:
                    if not isinstance(t, dict):
                        continue
                    desc = str(t.get("description", "")).strip()
                    if not desc:
                        continue
                    ac = t.get("acceptance_criteria", [])
                    if not isinstance(ac, list):
                        ac = []
                    assign = str(t.get("assign_to", "backend")).lower().replace(" ", "_")
                    if assign not in ("backend", "frontend", "devops", "code_review", "marketing", "sales", "customer_success"):
                        assign = "backend"
                    tasks.append(TaskMessage(
                        from_agent=self.agent_id,
                        task_id=str(uuid.uuid4())[:8],
                        description=desc,
                        acceptance_criteria=ac[:5],
                        estimated_minutes=max(15, min(240, int(t.get("estimated_minutes", 60)))),
                        context={"directive": directive.strategic_goal, "assign_to": assign},
                    ))
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
        if not tasks:
            tasks.append(TaskMessage(
                from_agent=self.agent_id,
                task_id=str(uuid.uuid4())[:8],
                description=directive.strategic_goal,
                acceptance_criteria=[],
                estimated_minutes=120,
            ))
        return tasks

    async def check_agent_workloads(self) -> None:
        try:
            from core.cloudflare_client import CloudflareClient
            client = CloudflareClient()
            if not client.is_configured():
                return
            r = await asyncio.to_thread(
                lambda: client.table("task_log").select("agent_id").eq("status", "pending").execute()
            )
            from collections import Counter
            counts = Counter(row["agent_id"] for row in (r.data or []))
            for agent_id, count in counts.items():
                if count > 5:
                    await self.message_bus.publish(
                        Channels.HR_REQUESTS,
                        HRRequestMessage(
                            from_agent=self.agent_id,
                            request_type="spawn_agent",
                            role_needed=agent_id.split("_")[0] if "_" in agent_id else agent_id,
                            reason=f"Agent {agent_id} overloaded",
                        ),
                    )
        except Exception as e:
            self.logger.warning("check_workloads_failed", error=str(e))

    async def handle_qa_alert(self, alert: QAAlertMessage) -> None:
        """Convert QA alerts into concrete remediation tasks."""
        error_details = (alert.error_details or "").lower()
        
        # Skip creating tasks for missing live_urls configuration - this is expected before deployment
        if "no live_urls" in error_details or "live_urls not configured" in error_details:
            self.logger.info(
                "qa_alert_skipped_missing_config",
                message="Skipping QA alert - live_urls not configured (expected before deployment)"
            )
            return

        # Skip alerts for gate-vetoed deliverables - the task was infeasible, not buggy;
        # a remediation task hits the same gates and escalates again. Agents emit
        # "Deliverable blocked:" (protected paths) and "Deliverable rejected:" (tests/task-fit).
        if "deliverable" in error_details:
            self.logger.info(
                "qa_alert_skipped_gate_rejection",
                message="Skipping QA alert - deliverable rejections are task-spec issues, not bugs"
            )
            return

        # Skip alerts for transient infrastructure errors - network/timeout/SSL
        # hiccups are self-recovering and no remediation task can fix them.
        if any(s in error_details for s in (
            "ssl:", "unexpected_eof", "timed out", "timeout", "connection reset",
            "connection refused", "econnreset", "econnrefused", "502", "503", "429",
        )):
            self.logger.info(
                "qa_alert_skipped_transient_infra",
                message="Skipping QA alert - transient infra errors are not remediable"
            )
            return

        component = (alert.affected_component or "").lower()
        assign = "devops" if component in {"api_health", "runtime", "deployment", "health"} else "backend"
        role_channel = Channels.CTO_TASKS_DEVOPS if assign == "devops" else Channels.CTO_TASKS_BACKEND
        
        # Check for duplicate tasks before creating
        desc_normalized = f"resolve qa alert {component}".lower()
        is_duplicate = await self._is_duplicate_task(desc_normalized, assign)
        if is_duplicate:
            self.logger.info("skipping_duplicate_qa_remediation", component=component)
            return
        
        remediation = TaskMessage(
            from_agent=self.agent_id,
            task_id=str(uuid.uuid4())[:8],
            description=f"Resolve QA alert [{alert.severity}] on {component or 'unknown'}: {alert.error_details}",
            acceptance_criteria=[
                "Root cause identified",
                "Fix deployed",
                "Health checks stable for 15 minutes",
            ],
            estimated_minutes=30 if alert.severity == "CRITICAL" else 45,
            context={"assign_to": assign, "source": "cto_from_qa_alert"},
        )
        await self.task_tracker.create_task(
            remediation.task_id,
            assign,
            remediation.description,
            status="pending",
            attempts=0,
        )
        await self.message_bus.publish(role_channel, remediation)

    async def handle_agent_report(self, report: ReportMessage) -> None:
        """Capture high-level outcomes from worker reports."""
        if report.status != "completed":
            return
        short = (report.result or "")[:120]
        await self.episodic_memory.add_event(
            self.agent_id,
            "agent_report",
            f"{report.from_agent} completed {report.task_id}: {short}",
        )
