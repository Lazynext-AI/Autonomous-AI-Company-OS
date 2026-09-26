"""Integration tests for the full system loop. Requires a deployed Cloudflare Worker."""

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("CLOUDFLARE_API_URL") or not os.getenv("CLOUDFLARE_API_TOKEN"),
    reason="Cloudflare Worker not configured (CLOUDFLARE_API_URL/CLOUDFLARE_API_TOKEN)",
)


@pytest.mark.asyncio
async def test_message_bus_pubsub() -> None:
    """Test message bus publish and read."""
    from core.messaging.bus import MessageBus
    from core.messaging.channels import Channels
    from core.messaging.schemas import TaskMessage

    bus = MessageBus()
    try:
        await bus.create_consumer_groups()
        msg = TaskMessage(
            from_agent="cto",
            task_id="test-1",
            description="Test task",
        )
        await bus.publish(Channels.CTO_TASKS, msg)
        # The shared bus can hold production backlog ahead of ours — find the
        # message this test published rather than trusting position.
        msgs = await bus.read_messages(Channels.CTO_TASKS, "agents", "test_consumer", count=50)
        received = next(
            (m for _, m in msgs if isinstance(m, TaskMessage) and m.description == "Test task"),
            None,
        )
        assert received is not None
    finally:
        await bus.close()


@pytest.mark.asyncio
async def test_episodic_memory() -> None:
    """Test episodic memory add and get."""
    from core.memory.episodic_memory import EpisodicMemory, EventSchema

    mem = EpisodicMemory()
    try:
        await mem.add_event("test_agent", "task_started", "Test event")
        events = await mem.get_recent("test_agent", n=5)
        assert len(events) >= 1
        assert events[0].content == "Test event"
    finally:
        await mem.close()


@pytest.mark.asyncio
async def test_config_model_registry() -> None:
    """Test model registry."""
    from core.config import get_model_for_role

    assert get_model_for_role("ceo") == "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    assert get_model_for_role("backend") == "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
