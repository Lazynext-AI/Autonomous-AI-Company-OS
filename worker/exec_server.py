"""In-container exec server — the agent code-execution sandbox.

Accepts either:
  {"code": "..."}                 — run a Python snippet (legacy mode)
  {"files": {"a/b.py": "..."},     — write files into a temp workdir, then run
   "command": ["python3","a/b.py"]}  the shell command inside it

Returns {success, stdout, stderr, result, error}.
"""

import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer


def _write_files(workdir: str, files: dict) -> None:
    for rel, content in files.items():
        rel = os.path.normpath(str(rel)).lstrip("/")
        if rel.startswith("..") or not isinstance(content, str):
            continue
        path = os.path.join(workdir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)


def run_code(code: str, timeout: int = 60) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
        path = f.name
    try:
        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "success": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "result": proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else None,
            "error": proc.stderr.strip() or None if proc.returncode != 0 else None,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "", "result": None, "error": "timeout"}


def run_command(command: list, workdir: str, timeout: int) -> dict:
    try:
        proc = subprocess.run(
            [str(c) for c in command],
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "success": proc.returncode == 0,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
            "result": proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else None,
            "error": proc.stderr.strip() or None if proc.returncode != 0 else None,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "", "result": None, "error": "timeout"}
    except FileNotFoundError as e:
        return {"success": False, "stdout": "", "stderr": "", "result": None, "error": str(e)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send({"ok": True})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/exec":
            return self._send({"error": "not found"}, 404)
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            timeout = int(body.get("timeout", 60))
            files = body.get("files") or {}
            command = body.get("command")
            code = body.get("code", "")

            if files or command:
                if not isinstance(command, list) or not command:
                    return self._send({"error": "command required when files are given"}, 400)
                with tempfile.TemporaryDirectory() as workdir:
                    _write_files(workdir, files)
                    return self._send(run_command(command, workdir, timeout))

            if not code:
                return self._send({"error": "code required"}, 400)
            self._send(run_code(code, timeout))
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
