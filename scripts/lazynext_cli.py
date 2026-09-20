#!/usr/bin/env python3
"""lazynext CLI - control the company from the terminal.

Usage:
  lazynext status                  Company snapshot
  lazynext briefings [n]           List latest briefings
  lazynext briefing <id>           Show a full briefing
  lazynext tasks [n]               List latest tasks
  lazynext task "description"      Queue a task for agents
  lazynext agents                  Agent activity summary
  lazynext search "query"          Search the knowledge base
  lazynext health                  Ping all public endpoints
  lazynext mcp-tools               List MCP tools
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from core.public_api_client import LazynextApiClient  # noqa: E402

BASE = os.environ.get("LAZYNEXT_API_URL", "https://ai-company.lazynext.com")


def _client() -> LazynextApiClient:
    key = os.environ.get("LAZYNEXT_API_KEY", "")
    if not key:
        sys.exit("Set LAZYNEXT_API_KEY in .env (an lzk_ key). Create one via POST /api/v1/keys.")
    return LazynextApiClient(api_key=key, base_url=BASE)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    c = _client() if cmd not in ("help", "-h", "--help", "health") else None

    if cmd == "status":
        for k, v in c.status().items():
            print(f"{k}: {v}")
    elif cmd == "briefings":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        for b in c.list_briefings(limit=n):
            print(f"[{b['id']}] {b['subject']}  ({b['created_at']})")
            print(f"    {b['preview']}")
    elif cmd == "briefing":
        b = c.get_briefing(int(sys.argv[2]))
        print(f"# {b['subject']}\n\n{b['content']}")
    elif cmd == "tasks":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        for t in c.list_tasks(limit=n):
            print(f"[{t['status']}] {t['description'][:80]}  ({t['agent_id']})")
    elif cmd == "task":
        if len(sys.argv) < 3:
            sys.exit('usage: lazynext task "description"')
        r = c.create_task(sys.argv[2])
        print(f"queued: {r['task_id']} on {r['channel']}")
    elif cmd == "agents":
        for a in c.list_agents():
            print(f"{a['agent_id']}: {a['tasks']} tasks, last seen {a['last_seen']}")
    elif cmd == "search":
        if len(sys.argv) < 3:
            sys.exit('usage: lazynext search "query"')
        for r in c.search_knowledge(query=sys.argv[2]):
            print(f"{r['filename']} ({r.get('category', '')}):")
            print(f"    {r['content'][:150]}")
    elif cmd == "health":
        import urllib.request

        for name, url in {
            "api": f"{BASE}/api/v1/health",
            "dashboard": "https://dashboard.lazynext.com",
            "penpot": "https://penpot.lazynext.com",
        }.items():
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "lazynext-cli/1.0"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    print(f"{name}: {'UP' if r.status < 400 else 'DOWN'} ({r.status})")
            except Exception as e:
                print(f"{name}: DOWN ({e})")
    elif cmd == "mcp-tools":
        for t in c.mcp_tools():
            print(f"{t['name']}: {t['description'][:70]}")
    else:
        print(__doc__)
        return 0 if cmd in ("help", "-h", "--help") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
