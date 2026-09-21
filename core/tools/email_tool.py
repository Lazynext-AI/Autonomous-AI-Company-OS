"""Resend email tool."""

from core.config import get_settings


def _html_shell(subject: str, body: str, cta_label: str | None = None, cta_url: str | None = None) -> str:
    """Wrap plain-text body in the Lazynext email shell (design: Email Components)."""
    body_html = body.replace("\n", "<br>")
    cta = (
        f'<a href="{cta_url}" style="display:inline-block;padding:12px 24px;border-radius:10px;'
        f"background:#8B5CF6;color:#fff;font-weight:700;text-decoration:none;margin:16px 0\">"
        f"{cta_label}</a>"
        if cta_label and cta_url
        else ""
    )
    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0A0A0B;font-family:ui-sans-serif,system-ui,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="font-size:20px;font-weight:700;color:#FAFAFA;margin-bottom:24px">
    <span style="color:#A78BFA">◆</span> Lazynext
  </div>
  <div style="background:#141419;border:1px solid #26262E;border-radius:14px;padding:28px;
              color:#FAFAFA;font-size:15px;line-height:1.7">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px">{subject}</div>
    {body_html}
    {cta}
  </div>
  <div style="color:#9C9CAA;font-size:12px;margin-top:24px;text-align:center">
    Lazynext · The Autonomous AI Company OS ·
    <a href="https://lazynext.com" style="color:#A78BFA">lazynext.com</a>
  </div>
</div>
</body></html>"""


async def send_email(
    to: str, subject: str, body: str, cta_label: str | None = None, cta_url: str | None = None
) -> bool:
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
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "html": _html_shell(subject, body, cta_label, cta_url),
                },
            )
            return r.status_code in (200, 201)
    except Exception:
        return False
