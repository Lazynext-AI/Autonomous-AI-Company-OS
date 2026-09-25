"""Resolve external binaries for subprocess calls.

The fleet runs under launchd with PATH=/usr/bin:/bin:/usr/sbin:/sbin —
Homebrew installs (/opt/homebrew/bin, /usr/local/bin) are invisible to
shutil.which, so bare "node"/"npm"/"npx" lookups raise FileNotFoundError.
Callers that treat that as "tool absent" then silently skip their gate —
the local `node --test` check never fired once under launchd until this
resolver landed. Probe PATH first, then the standard install prefixes.
"""

import shutil
from pathlib import Path
from typing import Optional

_EXTRA_DIRS = ("/opt/homebrew/bin", "/usr/local/bin")


def find_binary(name: str) -> Optional[str]:
    """Return the full path to `name`, or None when not installed."""
    found = shutil.which(name)
    if found:
        return found
    for d in _EXTRA_DIRS:
        p = Path(d) / name
        if p.exists():
            return str(p)
    return None
