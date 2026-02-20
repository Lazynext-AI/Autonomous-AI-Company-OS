"""Redis Streams message bus for agent communication."""

import json
import uuid
from datetime import datetime
from typing import TypeVar

import redis.asyncio as redis
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
    """Async message bus using Redis Streams."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._redis: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis:
        """Get or create Redis connection with reconnection logic."""
        if self._redis is None:
            self._redis = redis.from_url(
                self._settings.redis_url,
                decode_responses=True,
            )
        return self._redis

    async def close(self) -> None:
        """Close Redis connection."""
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    def _stream_name(self, channel: Channels) -> str:
        return f"stream:{channel.value}"

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
            r = await self._get_redis()
            if not message.message_id:
                message.message_id = str(uuid.uuid4())
            stream = self._stream_name(channel)
            msg_id = await r.xadd(stream, {"payload": self._serialize(message)}, maxlen=10000)
            logger.debug("message_published", channel=channel.value, message_id=message.message_id)
            return msg_id
        except redis.RedisError as e:
            logger.error("message_publish_failed", channel=channel.value, error=str(e))
            raise

    async def create_consumer_groups(self) -> None:
        """Create consumer groups for all channels (idempotent)."""
        try:
            r = await self._get_redis()
            for channel in Channels:
                stream = self._stream_name(channel)
                try:
                    await r.xgroup_create(stream, "agents", "0", mkstream=True)
                except redis.ResponseError as e:
                    if "BUSYGROUP" in str(e):
                        pass  # Group exists
                    else:
                        raise
            logger.info("consumer_groups_created")
        except redis.RedisError as e:
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
            r = await self._get_redis()
            stream = self._stream_name(channel)
            raw = await r.xreadgroup(
                consumer_group,
                consumer_name,
                {stream: ">"},
                count=count,
                block=3000,
            )
            result = []
            for stream_name, entries in raw:
                for msg_id, fields in entries:
                    payload = fields.get("payload", "{}")
                    try:
                        msg = self._deserialize(payload)
                        result.append((msg_id, msg))
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.warning("message_deserialize_failed", msg_id=msg_id, error=str(e))
            return result
        except redis.RedisError as e:
            logger.error("read_messages_failed", channel=channel.value, error=str(e))
            return []

    async def acknowledge(self, channel: Channels, consumer_group: str, message_id: str) -> None:
        """Acknowledge message processing."""
        try:
            r = await self._get_redis()
            stream = self._stream_name(channel)
            await r.xack(stream, consumer_group, message_id)
        except redis.RedisError as e:
            logger.error("acknowledge_failed", channel=channel.value, message_id=message_id, error=str(e))
            raise

    async def get_pending_count(self, channel: Channels) -> int:
        """Get count of pending (unacked) messages for channel."""
        try:
            r = await self._get_redis()
            stream = self._stream_name(channel)
            try:
                info = await r.xinfo_groups(stream)
                total = 0
                for g in info:
                    total += g.get("pending", 0)
                return total
            except redis.ResponseError:
                return 0
        except redis.RedisError:
            return 0
