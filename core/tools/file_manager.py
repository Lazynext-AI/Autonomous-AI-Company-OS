"""File manager - handles backups, conflicts, and safe file operations."""

import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class FileManager:
    """Manage file operations with backups and conflict detection."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.backup_dir = repo_root / ".agent_backups"

    def backup_file(self, filepath: Path) -> Optional[Path]:
        """Create a backup of an existing file."""
        if not filepath.exists():
            return None

        try:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = self.backup_dir / f"{filepath.name}.{timestamp}.bak"
            shutil.copy2(filepath, backup_path)
            logger.info("file_backed_up", file=str(filepath), backup=str(backup_path))
            return backup_path
        except Exception as e:
            logger.error("backup_failed", file=str(filepath), error=str(e))
            return None

    def check_conflicts(self, filepath: Path, new_content: str) -> dict:
        """
        Check for conflicts with existing file.
        Returns dict with conflict info.
        """
        result = {
            "has_conflict": False,
            "file_exists": filepath.exists(),
            "is_identical": False,
            "conflict_details": None,
        }

        if not filepath.exists():
            return result

        try:
            existing_content = filepath.read_text(encoding="utf-8")
            result["is_identical"] = existing_content == new_content

            # Check for significant differences (more than whitespace)
            existing_stripped = existing_content.strip()
            new_stripped = new_content.strip()

            if existing_stripped != new_stripped:
                # Calculate similarity
                lines_existing = set(existing_stripped.split("\n"))
                lines_new = set(new_stripped.split("\n"))
                common_lines = lines_existing & lines_new
                total_lines = len(lines_existing | lines_new)

                similarity = len(common_lines) / total_lines if total_lines > 0 else 0.0

                result["has_conflict"] = similarity < 0.5  # Less than 50% similarity
                result["conflict_details"] = {
                    "similarity": similarity,
                    "existing_lines": len(existing_stripped.split("\n")),
                    "new_lines": len(new_stripped.split("\n")),
                }
        except Exception as e:
            logger.error("conflict_check_failed", file=str(filepath), error=str(e))
            result["has_conflict"] = True
            result["conflict_details"] = {"error": str(e)}

        return result

    def safe_write(
        self, filepath: Path, content: str, create_backup: bool = True
    ) -> dict:
        """
        Safely write file with backup and conflict checking.
        Returns dict with operation details.
        """
        result = {
            "success": False,
            "backup_created": False,
            "backup_path": None,
            "conflict_detected": False,
            "file_existed": False,
            "error": None,
        }

        try:
            # Check for conflicts
            conflict_check = self.check_conflicts(filepath, content)
            result["conflict_detected"] = conflict_check["has_conflict"]
            result["file_existed"] = conflict_check["file_exists"]

            # Create backup if file exists
            if filepath.exists() and create_backup:
                backup_path = self.backup_file(filepath)
                if backup_path:
                    result["backup_created"] = True
                    result["backup_path"] = str(backup_path)

            # Create parent directories
            filepath.parent.mkdir(parents=True, exist_ok=True)

            # Write file
            filepath.write_text(content, encoding="utf-8")
            result["success"] = True
            logger.info("file_written_safely", file=str(filepath))

        except Exception as e:
            result["error"] = str(e)
            logger.error("safe_write_failed", file=str(filepath), error=str(e))

        return result
