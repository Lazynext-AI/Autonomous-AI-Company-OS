"""QA Agent - continuous testing and health checks."""

import asyncio
from agents.base_agent import BaseAgent, TaskResult
from core.memory.company_brain import BugSchema
from core.messaging.channels import Channels
from core.messaging.schemas import QAAlertMessage, TaskMessage


QA_SYSTEM_PROMPT = """You are a QA engineer. Your job never stops. You continuously test the live product,
find bugs before users do, and ensure every deployment is solid."""


class QAAgent(BaseAgent):
    """QA agent - runs full suite every 15 minutes."""

    def get_subscribed_channels(self) -> list[Channels]:
        return []

    def get_system_prompt(self) -> str:
        return QA_SYSTEM_PROMPT

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        return TaskResult(task_id=task.task_id, success=True, output="QA runs suite")

    async def run(self) -> None:
        self.is_running = True
        await self.agent_memory.initialize(self.agent_id, self.role)

        while self.is_running:
            try:
                await self._maybe_update_status("active", "qa_suite")
                await self.run_full_qa_suite()
                await asyncio.sleep(60)  # Reduced from 300s to 60s for faster error recovery  # Reduced from 900s (15min) to 300s (5min) for faster monitoring
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("qa_loop_error", error=str(e))
                await self.message_bus.publish(
                    Channels.QA_ALERTS,
                    QAAlertMessage(
                        from_agent=self.agent_id,
                        severity="HIGH",
                        error_details=str(e),
                    ),
                )
                await asyncio.sleep(60)  # Reduced from 300s to 60s for faster error recovery

        self.is_running = False
        await self._maybe_update_status("stopped", "")

    async def run_full_qa_suite(self) -> None:
        brain = await self.company_brain.get()
        urls = brain.live_urls or {}
        
        # Skip health checks if live_urls is not configured
        if not urls or not urls.get("api") or not urls.get("frontend"):
            self.logger.info(
                "qa_skipped_no_live_urls",
                message="Skipping health checks - live_urls not configured. Set company_brain.live_urls.api and live_urls.frontend to enable QA monitoring."
            )
            # Don't raise alerts for missing configuration - this is expected before deployment
            return
        
        api_url = urls.get("api")
        frontend_url = urls.get("frontend")

        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{api_url}/health")
                if r.status_code != 200:
                    await self._raise_incident(
                        severity="CRITICAL",
                        component="api_health",
                        error_details=f"API /health returned {r.status_code}",
                        suggested_fix="Rollback latest deploy and restore health endpoint.",
                    )
                    return

                ui = await client.get(frontend_url)
                if ui.status_code >= 500:
                    await self._raise_incident(
                        severity="HIGH",
                        component="frontend",
                        error_details=f"Frontend returned {ui.status_code}",
                        suggested_fix="Investigate frontend deployment and restore last known good version.",
                    )
                    return
        except Exception as e:
            # Check if error is due to missing live_urls (shouldn't happen now, but safety check)
            error_str = str(e).lower()
            if "no live_urls" in error_str or "live_urls not configured" in error_str:
                self.logger.info("qa_skipped_configuration_missing")
                return
            
            await self._raise_incident(
                severity="CRITICAL",
                component="runtime",
                error_details=str(e),
                suggested_fix="Check service availability and rollback if needed.",
            )
            return

        await self.company_brain.update_metrics({"uptime_pct": 100})

    async def _raise_incident(
        self,
        severity: str,
        component: str,
        error_details: str,
        suggested_fix: str,
    ) -> None:
        """Broadcast incident and persist it in company state."""
        await self.message_bus.publish(
            Channels.QA_ALERTS,
            QAAlertMessage(
                from_agent=self.agent_id,
                severity=severity,
                affected_component=component,
                error_details=error_details,
                suggested_fix=suggested_fix,
            ),
        )

        try:
            await self.company_brain.add_bug(
                BugSchema(
                    description=error_details,
                    severity=severity,
                    component=component,
                    status="open",
                )
            )
        except Exception as e:
            self.logger.warning("qa_bug_record_failed", error=str(e))
        await self.episodic_memory.add_event(
            self.agent_id,
            "incident_alert_created",
            f"[{severity}] {component}: {error_details}"[:300],
        )
