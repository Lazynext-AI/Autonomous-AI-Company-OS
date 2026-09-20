"""Message bus over the Cloudflare Worker (D1-backed streams + consumer groups)."""

import json
import uuid
from datetime import datetime
from typing import TypeVar

import structlog

from core.config import get_settings
from core.messaging.channels import Channels
from core.messaging.schemas import (
    BaseMessage,
    DirectiveMessage,
    HRRequestMessage,
    KnowledgeRequestMessage,
    MilestoneMessage,
    QAAlertMessage,
    ReportMessage,
    TaskMessage,
)

logger = structlog.get_logger(__name__)

T = TypeVar("T", bound=BaseMessage)

MESSAGE_TYPE_MAP = {
    "TaskMessage": TaskMessage,
    "ReportMessage": ReportMessage,
    "QAAlertMessage": QAAlertMessage,
    "HRRequestMessage": HRRequestMessage,
    "KnowledgeRequestMessage": KnowledgeRequestMessage,
    "MilestoneMessage": MilestoneMessage,
    "DirectiveMessage": DirectiveMessage,
    "BaseMessage": BaseMessage,
}


class MessageBus:
    """Async message bus using the Cloudflare Worker bus endpoints."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._client = None

    def _get_client(self):
        if self._client is None:
            from core.cloudflare_client import CloudflareClient
            self._client = CloudflareClient()
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None

    def _serialize(self, message: BaseMessage) -> str:
        """Serialize message to JSON."""
        data = message.model_dump(mode="json")
        data["_type"] = type(message).__name__

        def _to_json_serializable(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            if isinstance(obj, dict):
                return {k: _to_json_serializable(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_to_json_serializable(x) for x in obj]
            return obj

        for k, v in data.items():
            data[k] = _to_json_serializable(v)
        return json.dumps(data)

    def _deserialize(self, raw: str) -> BaseMessage:
        """Deserialize JSON to message."""
        data = json.loads(raw)
        msg_type = data.pop("_type", "BaseMessage")
        cls = MESSAGE_TYPE_MAP.get(msg_type, BaseMessage)
        for k, v in data.items():
            if k in ("timestamp", "expires_at") and isinstance(v, str):
                try:
                    data[k] = datetime.fromisoformat(v.replace("Z", "+00:00"))
                except ValueError:
                    pass
        return cls(**data)

    async def publish(self, channel: Channels, message: BaseMessage) -> str:
        """Publish message to channel. Returns message ID."""
        try:
            client = self._get_client()
            if not message.message_id:
                message.message_id = str(uuid.uuid4())
            msg_id = await client.bus_publish(channel.value, self._serialize(message))
            logger.debug("message_published", channel=channel.value, message_id=message.message_id)
            return msg_id
        except Exception as e:
            logger.error("message_publish_failed", channel=channel.value, error=str(e))
            raise

    async def create_consumer_groups(self) -> None:
        """Ensure consumer group offsets exist for all channels (idempotent)."""
        try:
            client = self._get_client()
            await client.bus_ensure_groups([c.value for c in Channels], "agents")
            logger.info("consumer_groups_created")
        except Exception as e:
            logger.error("create_consumer_groups_failed", error=str(e))
            raise

    async def read_messages(
        self,
        channel: Channels,
        consumer_group: str,
        consumer_name: str,
        count: int = 10,
    ) -> list[tuple[str, BaseMessage]]:
        """Read messages for consumer. Returns list of (message_id, message)."""
        try:
            client = self._get_client()
            raw = await client.bus_poll(
                channel.value, consumer_group, consumer_name, count=count, wait_ms=3000
            )
            result = []
            for entry in raw:
                try:
                    msg = self._deserialize(entry.get("payload", "{}"))
                    result.append((entry["id"], msg))
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.warning("message_deserialize_failed", error=str(e))
            return result
        except Exception as e:
            logger.error("read_messages_failed", channel=channel.value, error=str(e))
            return []

    async def acknowledge(self, channel: Channels, consumer_group: str, message_id: str) -> None:
        """Acknowledge message processing."""
        try:
            client = self._get_client()
            await client.bus_ack(channel.value, consumer_group, [message_id])
        except Exception as e:
            logger.error("acknowledge_failed", channel=channel.value, message_id=message_id, error=str(e))
            raise

    async def get_pending_count(self, channel: Channels) -> int:
        """Get count of pending (unacked) messages for channel."""
        try:
            client = self._get_client()
            return await client.bus_pending(channel.value)
        except Exception:
            return 0
