"""Security scanner for code analysis - detects secrets, vulnerabilities, and security issues."""

import re
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class SecurityScanner:
    """Scans code for security vulnerabilities, secrets, and security issues."""

    def __init__(self) -> None:
        # Secret detection patterns
        self.secret_patterns = [
            (r'api[_-]?key\s*[:=]\s*["\']([^"\']+)["\']', "Hardcoded API key", "CRITICAL"),
            (r'password\s*[:=]\s*["\']([^"\']+)["\']', "Hardcoded password", "CRITICAL"),
            (r'secret\s*[:=]\s*["\']([^"\']+)["\']', "Hardcoded secret", "CRITICAL"),
            (r'token\s*[:=]\s*["\']([^"\']+)["\']', "Hardcoded token", "CRITICAL"),
            (r'["\'](sk-[a-zA-Z0-9]{32,})["\']', "Potential OpenAI API key", "CRITICAL"),
            (r'["\'](AIza[0-9A-Za-z-_]{35})["\']', "Potential Google API key", "CRITICAL"),
            (r'["\'](ghp_[a-zA-Z0-9]{36})["\']', "Potential GitHub token", "CRITICAL"),
            (r'["\'](xox[baprs]-[0-9a-zA-Z-]{10,48})["\']', "Potential Slack token", "CRITICAL"),
        ]
        
        # SQL injection patterns
        self.sql_patterns = [
            (r'f["\'].*\+.*\{.*\}', "Potential SQL injection (f-string in SQL)", "CRITICAL"),
            (r'execute\(.*\+', "Potential SQL injection (string concatenation)", "CRITICAL"),
            (r'query\(.*\+', "Potential SQL injection (string concatenation)", "CRITICAL"),
        ]
        
        # XSS patterns
        self.xss_patterns = [
            (r'innerHTML\s*=\s*[^"]*\+', "Potential XSS (innerHTML with concatenation)", "HIGH"),
            (r'dangerouslySetInnerHTML', "Potential XSS (React dangerouslySetInnerHTML)", "MEDIUM"),
        ]
        
        # Authentication issues
        self.auth_patterns = [
            (r'if\s+password\s*==\s*["\']', "Weak password comparison", "HIGH"),
            (r'bcrypt\.hash\(.*\)\s*==\s*', "Incorrect bcrypt comparison", "CRITICAL"),
        ]

    def scan_file(self, file_path: Path) -> dict[str, Any]:
        """Scan a single file for security issues."""
        issues = []
        
        if not file_path.exists():
            return {"issues": [], "file": str(file_path)}
        
        try:
            code = file_path.read_text(encoding="utf-8")
            file_str = str(file_path)
            
            # Check for secrets
            for pattern, description, severity in self.secret_patterns:
                matches = re.findall(pattern, code, re.IGNORECASE)
                if matches:
                    for match in matches[:3]:  # Limit to 3 matches per pattern
                        issues.append({
                            "type": "SECRET",
                            "severity": severity,
                            "description": description,
                            "line": self._find_line_number(code, match),
                            "file": file_str,
                        })
            
            # Check for SQL injection
            if file_path.suffix == ".py":
                for pattern, description, severity in self.sql_patterns:
                    if re.search(pattern, code):
                        issues.append({
                            "type": "SQL_INJECTION",
                            "severity": severity,
                            "description": description,
                            "line": self._find_line_number(code, pattern),
                            "file": file_str,
                        })
            
            # Check for XSS (JavaScript/TypeScript files)
            if file_path.suffix in [".js", ".jsx", ".ts", ".tsx"]:
                for pattern, description, severity in self.xss_patterns:
                    if re.search(pattern, code):
                        issues.append({
                            "type": "XSS",
                            "severity": severity,
                            "description": description,
                            "line": self._find_line_number(code, pattern),
                            "file": file_str,
                        })
            
            # Check for auth issues
            for pattern, description, severity in self.auth_patterns:
                if re.search(pattern, code):
                    issues.append({
                        "type": "AUTH",
                        "severity": severity,
                        "description": description,
                        "line": self._find_line_number(code, pattern),
                        "file": file_str,
                    })
        
        except Exception as e:
            logger.warning("security_scan_file_failed", file=str(file_path), error=str(e))
            return {"issues": [], "file": str(file_path), "error": str(e)}
        
        return {
            "issues": issues,
            "file": str(file_path),
            "critical_count": len([i for i in issues if i["severity"] == "CRITICAL"]),
            "high_count": len([i for i in issues if i["severity"] == "HIGH"]),
            "medium_count": len([i for i in issues if i["severity"] == "MEDIUM"]),
        }

    def scan_directory(self, directory: Path, extensions: list[str] = None) -> dict[str, Any]:
        """Scan all files in a directory for security issues."""
        if extensions is None:
            extensions = [".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml"]
        
        all_issues = []
        scanned_files = []
        
        for ext in extensions:
            for file_path in directory.rglob(f"*{ext}"):
                # Skip virtual environments and node_modules
                if any(skip in str(file_path) for skip in ["__pycache__", "node_modules", ".venv", "venv", ".git"]):
                    continue
                
                result = self.scan_file(file_path)
                scanned_files.append(result["file"])
                all_issues.extend(result.get("issues", []))
        
        return {
            "issues": all_issues,
            "scanned_files": scanned_files,
            "total_files": len(scanned_files),
            "critical_count": len([i for i in all_issues if i["severity"] == "CRITICAL"]),
            "high_count": len([i for i in all_issues if i["severity"] == "HIGH"]),
            "medium_count": len([i for i in all_issues if i["severity"] == "MEDIUM"]),
        }

    def _find_line_number(self, code: str, pattern: str) -> int:
        """Find the line number where a pattern appears."""
        try:
            if isinstance(pattern, str):
                match = re.search(pattern, code)
                if match:
                    return code[:match.start()].count("\n") + 1
        except Exception:
            pass
        return 0


class DependencyScanner:
    """Scans dependencies for known vulnerabilities."""

    def __init__(self) -> None:
        # Known vulnerable package versions (basic - in production use pip-audit/safety)
        self.vulnerable_packages = {
            "django": "<3.2.0",
            "flask": "<2.0.0",
            "requests": "<2.28.0",
            "urllib3": "<1.26.0",
            "pillow": "<9.0.0",
        }

    def scan_requirements(self, requirements_file: Path) -> dict[str, Any]:
        """Scan requirements.txt for vulnerabilities."""
        vulnerabilities = []
        
        if not requirements_file.exists():
            return {"vulnerabilities": [], "file": str(requirements_file)}
        
        try:
            content = requirements_file.read_text()
            for pkg, version_constraint in self.vulnerable_packages.items():
                if pkg.lower() in content.lower():
                    # Check if version constraint matches
                    pattern = rf"{pkg}\s*[=<>!]+.*{version_constraint}"
                    if re.search(pattern, content, re.IGNORECASE):
                        vulnerabilities.append({
                            "package": pkg,
                            "issue": f"Version constraint {version_constraint} may have vulnerabilities",
                            "severity": "HIGH",
                        })
        except Exception as e:
            logger.warning("dependency_scan_failed", error=str(e))
            return {"vulnerabilities": [], "file": str(requirements_file), "error": str(e)}
        
        return {
            "vulnerabilities": vulnerabilities,
            "file": str(requirements_file),
            "total": len(vulnerabilities),
        }

    def scan_package_json(self, package_json: Path) -> dict[str, Any]:
        """Scan package.json for vulnerabilities."""
        vulnerabilities = []
        
        if not package_json.exists():
            return {"vulnerabilities": [], "file": str(package_json)}
        
        try:
            import json
            data = json.loads(package_json.read_text())
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            
            # Basic checks - in production use npm audit
            vulnerable_js_packages = {
                "express": "<4.18.0",
                "lodash": "<4.17.21",
            }
            
            for pkg, version_constraint in vulnerable_js_packages.items():
                if pkg in deps:
                    version = deps[pkg]
                    if version.startswith("<") or version.startswith("^"):
                        vulnerabilities.append({
                            "package": pkg,
                            "issue": f"Version {version} may have vulnerabilities",
                            "severity": "MEDIUM",
                        })
        except Exception as e:
            logger.warning("package_json_scan_failed", error=str(e))
            return {"vulnerabilities": [], "file": str(package_json), "error": str(e)}
        
        return {
            "vulnerabilities": vulnerabilities,
            "file": str(package_json),
            "total": len(vulnerabilities),
        }
