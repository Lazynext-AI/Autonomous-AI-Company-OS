"""In-container exec server — the agent code-execution sandbox.

Accepts either:
  {"code": "..."}                 — run a Python snippet (legacy mode)
  {"files": {"a/b.py": "..."},     — write files into a temp workdir, then run
   "command": [...] |              the command(s) inside it (list, or list of
   "commands": [[...], [...]],     lists — each runs in order, first failure
   "deps": "auto"}                 wins). "deps": "auto" scans written files for
                                    imports and pip/npm installs them first.

Returns {success, stdout, stderr, result, error, deps}.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

NODE_BUILTINS = {
    "assert", "buffer", "child_process", "crypto", "dns", "events", "fs",
    "http", "http2", "https", "net", "os", "path", "perf_hooks", "process",
    "querystring", "readline", "stream", "string_decoder", "tls", "url",
    "util", "worker_threads", "zlib",
}


def _write_files(workdir: str, files: dict) -> None:
    for rel, content in files.items():
        rel = os.path.normpath(str(rel)).lstrip("/")
        if rel.startswith("..") or not isinstance(content, str):
            continue
        path = os.path.join(workdir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)


PY_IMPORT_TO_PKG = {
    "bs4": "beautifulsoup4", "PIL": "Pillow", "yaml": "PyYAML",
    "cv2": "opencv-python-headless", "sklearn": "scikit-learn",
    "dotenv": "python-dotenv", "Crypto": "pycryptodome",
    "googleapiclient": "google-api-python-client", "serial": "pyserial",
}


def _local_names(files: dict) -> set:
    """Names resolvable inside the file set itself — local modules and dirs."""
    local = set()
    for rel in files:
        parts = str(rel).split("/")
        for i, seg in enumerate(parts):
            if i < len(parts) - 1:
                local.add(seg)  # directory names ("from src.api import x" -> "src")
            stem = seg.rsplit(".", 1)[0]
            if stem and stem != "__init__":
                local.add(stem)
    return local


def _detect_py_deps(files: dict) -> list:
    mods = set()
    stdlib = set(getattr(sys, "stdlib_module_names", ()))
    local = _local_names(files)
    for rel, content in files.items():
        if not str(rel).endswith(".py") or not isinstance(content, str):
            continue
        for m in re.finditer(r"^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)", content, re.M):
            top = m.group(1)
            if top not in stdlib and not top.startswith("_") and top not in local:
                mods.add(PY_IMPORT_TO_PKG.get(top, top))
    return sorted(mods)


def _detect_js_deps(files: dict) -> list:
    mods = set()
    local = _local_names(files)
    for rel, content in files.items():
        if not str(rel).endswith((".js", ".mjs", ".cjs")) or not isinstance(content, str):
            continue
        for m in re.finditer(
            r"""(?:require\(|from\s+|import\s+)['"]([^'"]+)['"]""", content
        ):
            name = m.group(1)
            if name.startswith((".", "/", "node:")):
                continue
            top = name.split("/")[0] if not name.startswith("@") else "/".join(name.split("/")[:2])
            if top and top not in NODE_BUILTINS and top not in local:
                mods.add(top)
    return sorted(mods)


def _install_deps(workdir: str, files: dict, timeout: int) -> dict:
    """Install third-party imports detected in the written files."""
    deps = {"pip": [], "npm": []}
    pip_deps = _detect_py_deps(files)
    if pip_deps:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check", *pip_deps],
            cwd=workdir, capture_output=True, text=True, timeout=timeout,
        )
        deps["pip"] = pip_deps
        if proc.returncode != 0:
            return {"ok": False, "deps": deps, "error": f"pip install failed: {proc.stderr[-500:]}"}
    js_deps = _detect_js_deps(files)
    if js_deps:
        with open(os.path.join(workdir, "package.json"), "w") as f:
            f.write('{"name":"verify","private":true}')
        proc = subprocess.run(
            ["npm", "install", "--silent", "--no-audit", "--no-fund", *js_deps],
            cwd=workdir, capture_output=True, text=True, timeout=timeout,
        )
        deps["npm"] = js_deps
        if proc.returncode != 0:
            return {"ok": False, "deps": deps, "error": f"npm install failed: {proc.stderr[-500:]}"}
    return {"ok": True, "deps": deps, "error": None}


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
            commands = body.get("commands")
            deps = body.get("deps")
            code = body.get("code", "")

            if commands and isinstance(commands, list) and commands and isinstance(commands[0], list):
                pass  # multi-command mode
            elif isinstance(command, list) and command:
                commands = [command]
            else:
                commands = None

            if files or commands:
                if not commands:
                    return self._send({"error": "command required when files are given"}, 400)
                with tempfile.TemporaryDirectory() as workdir:
                    _write_files(workdir, files)
                    out = {"deps": None}
                    if deps == "auto":
                        try:
                            di = _install_deps(workdir, files, timeout)
                        except subprocess.TimeoutExpired:
                            di = {"ok": False, "deps": None, "error": "deps install timeout"}
                        out["deps"] = di["deps"]
                        if not di["ok"]:
                            return self._send({"success": False, "stdout": "", "stderr": "", "result": None,
                                               "error": di["error"], "deps": di["deps"]})
                    results = [run_command(c, workdir, timeout) for c in commands]
                    for r in results:
                        if not r["success"]:
                            r["deps"] = out["deps"]
                            return self._send(r)
                    last = results[-1]
                    last["deps"] = out["deps"]
                    return self._send(last)

            if not code:
                return self._send({"error": "code required"}, 400)
            self._send(run_code(code, timeout))
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
