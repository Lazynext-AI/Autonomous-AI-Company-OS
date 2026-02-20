"""Seed knowledge base with PDFs from knowledge_base/ and optional auto-downloads."""

import asyncio
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from core.config import get_settings
from core.knowledge.ingestion import KnowledgeIngestion

console = Console()

KNOWLEDGE_BASE_SEED = [
    ("FastAPI documentation", "engineering"),
    ("PostgreSQL documentation", "engineering"),
    ("Redis documentation", "engineering"),
    ("Docker best practices", "engineering"),
    ("Clean Code principles", "engineering"),
    ("Zero to One key concepts", "business"),
    ("The Lean Startup key concepts", "business"),
    ("Crossing the Chasm summary", "business"),
    ("Growth hacking fundamentals", "marketing"),
]


async def main() -> None:
    """Seed knowledge base with existing PDFs and optionally download recommended content."""
    settings = get_settings()
    kb_dir = Path(settings.knowledge_base_dir)
    ingestion = KnowledgeIngestion()

    total_files = 0
    total_chunks = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Scanning knowledge_base...", total=None)
        if not kb_dir.exists():
            kb_dir.mkdir(parents=True)
            for sub in ["engineering", "business", "marketing", "domain_specific"]:
                (kb_dir / sub).mkdir(exist_ok=True)

        results = await ingestion.ingest_directory(str(kb_dir))
        for filepath, chunks in results.items():
            total_files += 1
            total_chunks += chunks
            progress.update(task, description=f"Ingested {Path(filepath).name} ({chunks} chunks)")

    console.print(f"\n[green]Done.[/green] {total_files} files ingested, {total_chunks} chunks created.")
    console.print("Add PDFs to knowledge_base/engineering, business, marketing, or domain_specific/")
    console.print("Then run 'make seed' again to ingest new files.")
    console.print("\nRecommended downloads (run Knowledge Agent to fetch):")
    for topic, cat in KNOWLEDGE_BASE_SEED[:5]:
        console.print(f"  - {topic} ({cat})")


if __name__ == "__main__":
    asyncio.run(main())
