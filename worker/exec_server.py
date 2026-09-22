"""In-container exec server — receives code, runs it in a subprocess, returns
stdout/stderr/result/error — the agent code-execution sandbox."""

import json
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer


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
            code = body.get("code", "")
            if not code:
                return self._send({"error": "code required"}, 400)
            self._send(run_code(code, int(body.get("timeout", 60))))
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
