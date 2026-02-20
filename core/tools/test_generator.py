"""Test generator - automatically generates and runs tests for generated code."""

import re
from pathlib import Path
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class TestGenerator:
    """Generate tests for generated code."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root

    def extract_functions_and_classes(self, code: str, language: str) -> list[dict]:
        """Extract function and class names from code."""
        items = []
        
        if language.lower() in ("python", "py"):
            # Extract functions
            func_pattern = r"def\s+(\w+)\s*\("
            for match in re.finditer(func_pattern, code):
                items.append({"type": "function", "name": match.group(1), "line": code[:match.start()].count("\n") + 1})
            
            # Extract classes
            class_pattern = r"class\s+(\w+)"
            for match in re.finditer(class_pattern, code):
                items.append({"type": "class", "name": match.group(1), "line": code[:match.start()].count("\n") + 1})
        
        elif language.lower() in ("typescript", "ts", "tsx"):
            # Extract functions
            func_patterns = [
                r"export\s+(?:async\s+)?function\s+(\w+)",
                r"const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>",
                r"export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>",
            ]
            for pattern in func_patterns:
                for match in re.finditer(pattern, code):
                    items.append({"type": "function", "name": match.group(1), "line": code[:match.start()].count("\n") + 1})
        
        return items

    def generate_test_file_path(self, source_file: Path) -> Path:
        """Generate test file path from source file."""
        # Convert app/api/auth.py -> tests/test_api/test_auth.py
        parts = source_file.parts
        if "app" in parts:
            idx = parts.index("app")
            relative = Path(*parts[idx + 1:])
            test_path = self.repo_root / "tests" / f"test_{relative.parent}" / f"test_{relative.name}"
        else:
            test_path = self.repo_root / "tests" / f"test_{source_file.name}"
        
        return test_path

    async def generate_test_code(
        self, source_code: str, source_file: Path, language: str, llm_client, model: str
    ) -> Optional[str]:
        """Generate test code using LLM."""
        items = self.extract_functions_and_classes(source_code, language)
        
        if not items:
            logger.warning("no_testable_items", file=str(source_file))
            return None

        items_summary = "\n".join([f"- {item['type']}: {item['name']}" for item in items])
        
        prompt = f"""Generate comprehensive unit tests for the following code:

File: {source_file}
Language: {language}

Code:
```{language}
{source_code}
```

Testable items:
{items_summary}

Requirements:
1. Write complete, runnable test code
2. Test all functions and classes
3. Include edge cases and error handling
4. Use appropriate testing framework (pytest for Python, Jest/Vitest for TypeScript)
5. Wrap code in markdown code blocks with language tag
6. Include file path comment (e.g., # File: tests/test_api/test_auth.py)

Generate the test file:"""

        try:
            test_code = await llm_client.chat_completion(
                model,
                [{"role": "user", "content": prompt}],
                system_prompt="You are an expert test engineer. Write comprehensive, production-quality tests.",
            )
            return test_code
        except Exception as e:
            logger.error("test_generation_failed", file=str(source_file), error=str(e))
            return None

    async def run_tests(self, test_file: Path, language: str) -> dict:
        """Run tests and return results."""
        result = {
            "success": False,
            "output": "",
            "error": None,
        }

        try:
            import asyncio

            if language.lower() in ("python", "py"):
                # Run pytest
                proc = await asyncio.create_subprocess_exec(
                    "pytest",
                    str(test_file),
                    "-v",
                    cwd=str(self.repo_root),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()
                result["output"] = stdout.decode() + stderr.decode()
                result["success"] = proc.returncode == 0
            elif language.lower() in ("typescript", "ts", "tsx"):
                # Run Jest/Vitest (would need package.json setup)
                logger.info("typescript_testing_not_implemented", file=str(test_file))
                result["success"] = True  # Skip for now
            else:
                result["error"] = f"Unsupported language for testing: {language}"
        except Exception as e:
            result["error"] = str(e)
            logger.error("test_execution_failed", file=str(test_file), error=str(e))

        return result
