"""Resend email tool."""

from core.config import get_settings


async def send_email(to: str, subject: str, body: str) -> bool:
    """Send email via Resend API."""
    settings = get_settings()
    if not settings.resend_api_key:
        return False
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": "Autonomous AI Company <onboarding@resend.dev>",
                    "to": [to],
                    "subject": subject,
                    "html": body.replace("\n", "<br>"),
                },
            )
            return r.status_code in (200, 201)
    except Exception:
        return False
