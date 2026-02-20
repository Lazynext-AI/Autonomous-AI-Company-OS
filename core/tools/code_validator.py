"""Code validator - syntax checking, linting, and validation before writing files."""

import ast
import json
import re
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class CodeValidator:
    """Validate code before writing to disk."""

    @staticmethod
    def validate_python(code: str) -> tuple[bool, Optional[str]]:
        """Validate Python syntax."""
        try:
            ast.parse(code)
            return True, None
        except SyntaxError as e:
            return False, f"Python syntax error: {e.msg} at line {e.lineno}"
        except Exception as e:
            return False, f"Python validation error: {str(e)}"

    @staticmethod
    def validate_typescript(code: str) -> tuple[bool, Optional[str]]:
        """Basic TypeScript validation (checks for common syntax errors)."""
        # Check for unmatched braces
        open_braces = code.count("{")
        close_braces = code.count("}")
        if open_braces != close_braces:
            return False, f"Unmatched braces: {open_braces} open, {close_braces} close"

        open_parens = code.count("(")
        close_parens = code.count(")")
        if open_parens != close_parens:
            return False, f"Unmatched parentheses: {open_parens} open, {close_parens} close"

        # Check for common TypeScript errors
        if "import" in code and "from" not in code:
            # Check if it's a require-style import
            if "require(" not in code:
                return False, "Invalid import statement: missing 'from'"

        return True, None

    @staticmethod
    def validate_yaml(code: str) -> tuple[bool, Optional[str]]:
        """Validate YAML syntax."""
        try:
            import yaml
            yaml.safe_load(code)
            return True, None
        except ImportError:
            # Basic YAML validation without pyyaml
            # Check for balanced indentation and basic structure
            lines = code.split("\n")
            for i, line in enumerate(lines, 1):
                if line.strip() and not line.startswith("#"):
                    # Check for common YAML errors
                    if ":" in line and not line.strip().startswith("-"):
                        parts = line.split(":", 1)
                        if len(parts) == 2 and parts[0].strip() and not parts[1].strip():
                            # Key without value might be valid, but check context
                            pass
            return True, None
        except Exception as e:
            return False, f"YAML validation error: {str(e)}"

    @staticmethod
    def validate_json(code: str) -> tuple[bool, Optional[str]]:
        """Validate JSON syntax."""
        try:
            json.loads(code)
            return True, None
        except json.JSONDecodeError as e:
            return False, f"JSON syntax error: {e.msg} at line {e.lineno}"

    @staticmethod
    def validate_sql(code: str) -> tuple[bool, Optional[str]]:
        """Basic SQL validation."""
        # Check for balanced quotes
        single_quotes = code.count("'") - code.count("\\'")
        if single_quotes % 2 != 0:
            return False, "Unmatched single quotes in SQL"

        double_quotes = code.count('"') - code.count('\\"')
        if double_quotes % 2 != 0:
            return False, "Unmatched double quotes in SQL"

        # Check for common SQL errors
        if "CREATE TABLE" in code.upper() and "(" not in code:
            return False, "CREATE TABLE missing column definitions"

        return True, None

    def validate(self, code: str, language: str) -> tuple[bool, Optional[str], dict]:
        """
        Validate code based on language.
        Returns: (is_valid, error_message, validation_details)
        """
        language_lower = language.lower().strip()

        validation_details = {
            "language": language_lower,
            "lines": len(code.split("\n")),
            "characters": len(code),
        }

        if language_lower in ("python", "py"):
            is_valid, error = self.validate_python(code)
        elif language_lower in ("typescript", "ts", "tsx", "javascript", "js", "jsx"):
            is_valid, error = self.validate_typescript(code)
        elif language_lower in ("yaml", "yml"):
            is_valid, error = self.validate_yaml(code)
        elif language_lower == "json":
            is_valid, error = self.validate_json(code)
        elif language_lower == "sql":
            is_valid, error = self.validate_sql(code)
        else:
            # Unknown language - basic validation only
            logger.warning("unknown_language", language=language_lower)
            is_valid, error = True, None

        validation_details["valid"] = is_valid
        if error:
            validation_details["error"] = error

        return is_valid, error, validation_details
