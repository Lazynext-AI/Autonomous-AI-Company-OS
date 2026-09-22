"""Start all agents and deadlock detector."""

import asyncio

from rich.console import Console

from core.config import get_settings
from core.evaluation.reward_engine import RewardEngine
from core.evaluation.scorer import PerformanceScorer
from core.llm.atlas_client import AtlasClient
from core.memory.agent_memory import AgentMemory
from core.memory.company_brain_cached import CachedCompanyBrain
from core.memory.episodic_memory import EpisodicMemory
from core.messaging.bus import MessageBus
from core.operations.task_tracker import TaskTracker
from core.watchdog.deadlock_detector import DeadlockDetector

console = Console()


async def main() -> None:
    settings = get_settings()
    if not settings.cloudflare_api_url or not settings.cloudflare_api_token:
        console.print("[red]Cloudflare not configured — the Workers AI brain needs CLOUDFLARE_API_URL and CLOUDFLARE_API_TOKEN in .env[/red]")

    company_brain = CachedCompanyBrain()
    agent_memory = AgentMemory()
    episodic_memory = EpisodicMemory()
    message_bus = MessageBus()
    llm_client = AtlasClient()
    task_tracker = TaskTracker()
    await message_bus.create_consumer_groups()
    worker_task = llm_client.start_worker()

    agents = []
    try:
        from agents.engineering.qa_agent import QAAgent
        from agents.engineering.backend_agent import BackendAgent
        from agents.engineering.frontend_agent import FrontendAgent
        from agents.engineering.devops_agent import DevOpsAgent
        from agents.engineering.code_review_agent import CodeReviewAgent
        from agents.strategic.ceo_agent import CEOAgent
        from agents.strategic.cto_agent import CTOAgent
        from agents.infrastructure.knowledge_agent import KnowledgeAgent
        from agents.infrastructure.hr_agent import HRAgent
        from agents.growth.marketing_agent import MarketingAgent
        from agents.growth.sales_agent import SalesAgent
        from agents.growth.customer_success_agent import CustomerSuccessAgent
        from agents.infrastructure.finance_agent import FinanceAgent

        rag_engine = None
        knowledge_downloader = None
        try:
            from core.knowledge.rag_engine import RAGEngine
            from core.knowledge.downloader import KnowledgeDownloader
            rag_engine = RAGEngine()
            knowledge_downloader = KnowledgeDownloader()
        except ImportError:
            pass
        performance_scorer = PerformanceScorer(agent_memory)
        reward_engine = RewardEngine(
            agent_memory=agent_memory,
            ollama_client=llm_client,
            knowledge_downloader=knowledge_downloader,
        )

        def make_agent(cls, aid: str, role: str):
            return cls(
                agent_id=aid,
                role=role,
                company_brain=company_brain,
                agent_memory=agent_memory,
                episodic_memory=episodic_memory,
                message_bus=message_bus,
                ollama_client=llm_client,
                rag_engine=rag_engine,
                knowledge_downloader=knowledge_downloader,
                performance_scorer=performance_scorer,
                reward_engine=reward_engine,
                task_tracker=task_tracker,
            )

        agent_configs = [
            (QAAgent, "qa_1", "qa"),
            (KnowledgeAgent, "knowledge_1", "knowledge"),
            (CEOAgent, "ceo_1", "ceo"),
            (CTOAgent, "cto_1", "cto"),
            (BackendAgent, "backend_1", "backend"),
            (FrontendAgent, "frontend_1", "frontend"),
            (CodeReviewAgent, "code_review_1", "code_review"),
            (DevOpsAgent, "devops_1", "devops"),
            (MarketingAgent, "marketing_1", "marketing"),
            (SalesAgent, "sales_1", "sales"),
            (CustomerSuccessAgent, "customer_success_1", "customer_success"),
            (HRAgent, "hr_1", "hr"),
            (FinanceAgent, "finance_1", "finance"),
        ]

        for cls, aid, role in agent_configs:
            agent = make_agent(cls, aid, role)
            agents.append(asyncio.create_task(agent.run()))

        detector = DeadlockDetector(message_bus)

        async def watchdog_loop():
            while True:
                await detector.run_check()
                await asyncio.sleep(1800)

        agents.append(asyncio.create_task(watchdog_loop()))
        agents.insert(0, worker_task)

        console.print("[green]All agents started. Press Ctrl+C to stop.[/green]")

        await asyncio.gather(*agents)
    except KeyboardInterrupt:
        console.print("\n[yellow]Shutting down...[/yellow]")
        for t in agents:
            t.cancel()
        await asyncio.gather(*agents, return_exceptions=True)
    finally:
        await message_bus.close()
        await episodic_memory.close()
        await llm_client.close()


if __name__ == "__main__":
    asyncio.run(main())
