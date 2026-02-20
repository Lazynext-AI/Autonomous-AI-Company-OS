"""Knowledge Agent - RAG queries and document ingestion."""

import uuid

from agents.base_agent import BaseAgent, TaskResult
from core.messaging.channels import Channels
from core.messaging.schemas import KnowledgeRequestMessage, ReportMessage, TaskMessage


class KnowledgeAgent(BaseAgent):
    """Knowledge agent - answers RAG queries, ingests documents."""

    def get_subscribed_channels(self) -> list[Channels]:
        return [Channels.KNOWLEDGE_REQUESTS]

    def get_system_prompt(self) -> str:
        return "You are the knowledge agent. You answer questions from the knowledge base and ingest new documents."

    async def execute_task(self, task: TaskMessage) -> TaskResult:
        if not self.rag_engine:
            return TaskResult(task_id=task.task_id, success=False, error="No RAG engine")
        import time
        start = time.time()
        try:
            result = await self.rag_engine.query(task.description)
            if result.needs_download and self.knowledge_downloader:
                await self.knowledge_downloader.find_and_download(
                    task.description, "engineering"
                )
                result = await self.rag_engine.query(task.description)
            return TaskResult(
                task_id=task.task_id,
                success=result.answer is not None,
                output=result.answer or "No answer found",
                approach_used="rag",
                time_taken_seconds=int(time.time() - start),
            )
        except Exception as e:
            return TaskResult(
                task_id=task.task_id,
                success=False,
                error=str(e),
                time_taken_seconds=int(time.time() - start),
            )

    async def handle_knowledge_request(self, request: KnowledgeRequestMessage) -> None:
        """Resolve peer knowledge requests and inject guidance into requester memory."""
        answer = "No relevant knowledge found."
        source_hint = ""
        confidence = 0.0

        if self.rag_engine:
            result = await self.rag_engine.query(request.query)
            if result.needs_download and self.knowledge_downloader:
                await self.knowledge_downloader.find_and_download(
                    request.query,
                    "engineering",
                )
                result = await self.rag_engine.query(request.query)
            if result.answer:
                answer = result.answer
            confidence = result.confidence
            if result.sources:
                top = result.sources[:2]
                source_hint = ", ".join(s.filename or "unknown_source" for s in top)
        else:
            answer = "Knowledge engine is offline. Continue with conservative implementation and add tests."

        guidance = (
            f"Knowledge response for query: {request.query}\n"
            f"Answer: {answer}\n"
            f"Confidence: {confidence:.2f}\n"
            f"Sources: {source_hint or 'none'}"
        )

        target_agent = request.requesting_agent or request.from_agent
        if target_agent:
            await self.agent_memory.inject_reward_prompt(target_agent, guidance[:4000])
            await self.episodic_memory.add_event(
                target_agent,
                "knowledge_response",
                guidance[:300],
            )

        await self.message_bus.publish(
            Channels.AGENT_REPORTS,
            ReportMessage(
                from_agent=self.agent_id,
                to_agent=target_agent,
                task_id=f"knowledge-{str(uuid.uuid4())[:8]}",
                status="knowledge_response",
                result=guidance[:12000],
            ),
        )
