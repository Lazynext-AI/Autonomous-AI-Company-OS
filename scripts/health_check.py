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
    "a11y-checker-domain": "https://checker.lazynext.com/health",
    "a11y-api-domain": "https://api.lazynext.com/health",
}
# The product deploys the same bundle to two scripts (accessibility-checker +
# accessibility-checker-api). deploy.mjs keeps them in sync, but nothing
# detects a manual single-script deploy — compare a deterministic surface
# (/rules, the 75-rule manifest) on both workers.dev origins and alert on
# any byte difference. Also covers script liveness: a fetch failure fails
# the pair.
DRIFT_PAIRS = {
    "a11y-mirror": (
        "https://accessibility-checker.dry-hall-6a50.workers.dev/rules",
        "https://accessibility-checker-api.dry-hall-6a50.workers.dev/rules",
    ),
}
# Internal liveness via platform KV — the surfaces above prove the worker is
# reachable, but a stopped cron or wedged sweep leaves them green. Values are
# ms epochs; mon:/billing: store JSON {"at": ms}, the others bare epochs.
# Budgets: cron runs */10 → 25 min; daily sweeps → 26 h.
KV_WATCH = {
    "cron-tick": ("cron:last_tick", 25 * 60_000),
    "mon-sweep": ("mon:last_sweep", 26 * 3_600_000),
    "seq-sweep": ("seq:last_run", 26 * 3_600_000),
    "billing-reconcile": ("billing:last_reconcile", 26 * 3_600_000),
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


def fetch_body(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "healthcheck/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read() if r.status < 400 else None
    except Exception:
        return None


def kv_age_ms(key: str) -> float | None:
    """Read a KV timestamp via the platform worker; None when unreadable."""
    try:
        url = os.environ.get("CLOUDFLARE_API_URL", "")
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        req = urllib.request.Request(
            f"{url}/kv/get",
            data=json.dumps({"key": key}).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "healthcheck/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            v = json.loads(r.read()).get("value")
        if not v:
            return None
        try:
            ts = float(json.loads(v).get("at"))
        except (json.JSONDecodeError, AttributeError, TypeError):
            ts = float(v)
        import time

        return time.time() * 1000 - ts
    except Exception:
        return None


async def main() -> int:
    now = {name: check(url) for name, url in CHECKS.items()}
    for name, (a, b) in DRIFT_PAIRS.items():
        body_a, body_b = fetch_body(a), fetch_body(b)
        now[name] = body_a is not None and body_a == body_b
    for name, (key, budget) in KV_WATCH.items():
        age = kv_age_ms(key)
        now[name] = age is not None and age < budget
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
