"""Doc-gutting guard in CodeWriter.

Overwriting an existing substantial file while keeping under half of its
lines is destruction, not an update — a fleet task replaced the measured
performance-baseline doc with generic prose (PR closed unmerged), and the
verifier passed it because the Markdown was non-empty. The guard compares
retained lines, not byte length (prose is dense; a size ratio misses it).
Mirrors retainedLineFraction in worker/src/index.ts.
"""

from pathlib import Path

import pytest

import core.tools.code_writer as cw
from core.tools.code_writer import CodeWriter, _retained_line_fraction


def _doc(lines: int) -> str:
    return "\n".join(f"measured baseline fact {i}: latency p50={i}ms" for i in range(lines))


def test_retained_fraction_append_is_full() -> None:
    prev = _doc(60)
    assert _retained_line_fraction(prev, prev + "\nnew tail line") == 1.0


def test_retained_fraction_small_edit_keeps_most() -> None:
    prev = _doc(60)
    lines = prev.split("\n")
    lines[5] = "corrected fact: latency p50=999ms"
    assert _retained_line_fraction(prev, "\n".join(lines)) >= 0.5


def test_retained_fraction_gutting_is_low() -> None:
    prev = _doc(60)
    assert _retained_line_fraction(prev, "generic prose with no original lines") < 0.5


def test_retained_fraction_empty_prev_is_safe() -> None:
    assert _retained_line_fraction("", "anything") == 1.0


def _writer_to(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CodeWriter:
    async def _resolve(_brain):
        return tmp_path

    def _noop_sync(*_a, **_k):
        return None

    async def _noop_async(*_a, **_k):
        return None

    monkeypatch.setattr(cw, "get_product_project_dir", _resolve)
    monkeypatch.setattr(CodeWriter, "_check_phantom_imports", _noop_sync)
    monkeypatch.setattr(CodeWriter, "_fitness_check", _noop_async)
    return CodeWriter(company_brain=object())


@pytest.mark.asyncio
async def test_gutting_rewrite_is_rejected_and_file_untouched(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = tmp_path / "docs" / "perf.md"
    doc.parent.mkdir(parents=True)
    doc.write_text(_doc(80))
    w = _writer_to(tmp_path, monkeypatch)
    out = "```markdown\n// File: docs/perf.md\nShort generic advice with no measured content.\n```"
    res = await w.write_code(out, "optimize the performance doc", "t1", "devops")
    assert res["files_written"] == []
    assert doc.read_text() == _doc(80)


@pytest.mark.asyncio
async def test_inplace_extension_is_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = tmp_path / "docs" / "perf.md"
    doc.parent.mkdir(parents=True)
    doc.write_text(_doc(80))
    w = _writer_to(tmp_path, monkeypatch)
    out = "```markdown\n// File: docs/perf.md\n" + _doc(80) + "\nadded section: new findings\n```"
    res = await w.write_code(out, "extend the performance doc", "t2", "devops")
    assert res["files_written"] == ["docs/perf.md"]
    assert "added section" in doc.read_text()
    assert "measured baseline fact 40" in doc.read_text()
