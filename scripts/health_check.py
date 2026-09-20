#!/usr/bin/env python3
"""Health check for public endpoints; emails the founder on failure/recovery.

Run via launchd (com.lazynext.healthcheck.plist) every 15 min.
State kept in .health_state.json so we only alert on transitions.
"""
import asyncio
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

CHECKS = {
    "api": "https://ai-company.lazynext.com/health",
    "public-api": "https://ai-company.lazynext.com/api/v1/health",
    "dashboard": "https://dashboard.lazynext.com",
    "penpot": "https://penpot.lazynext.com",
}
STATE_FILE = Path(".health_state.json")


def check(url: str) -> bool:
    try:
        headers = {"User-Agent": "healthcheck/1.0"}
        token = os.environ.get("CLOUDFLARE_API_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status < 400
    except Exception:
        return False


async def main() -> int:
    now = {name: check(url) for name, url in CHECKS.items()}
    prev = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    failed = [k for k, ok in now.items() if not ok]
    recovered = [k for k in prev if not prev.get(k) and now.get(k)]

    if failed != [k for k in prev if not prev.get(k)]:
        from core.tools.email_tool import send_email

        to = os.environ.get("FOUNDER_EMAIL", "support@lazynext.com")
        if failed:
            body = "FAILED checks: " + ", ".join(failed) + "\n\nAll results: " + json.dumps(now)
            await send_email(to, "[AI Company] Health check FAILED", body)
        if recovered and not failed:
            await send_email(to, "[AI Company] Recovered", "Back up: " + ", ".join(recovered))

    STATE_FILE.write_text(json.dumps(now))
    print("OK" if not failed else "FAILED: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
