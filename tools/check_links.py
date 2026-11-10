"""Every relative link in the repository's Markdown points at a file that exists.

    python3 tools/check_links.py

Checks `[text](path)` links in the project's .md files (external URLs and pure #anchors are
skipped). Exits 1 and lists each broken link, so moving or renaming a doc cannot silently
strand the links to it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


# Dependencies, build output and local run data: not the project's documentation.
SKIP = {".git", "node_modules", "dist", "runs", "cache", "__pycache__", ".claude", ".devin"}


def tracked_markdown() -> list[Path]:
    """The project's Markdown files. Walks the tree rather than asking git, so the check
    also works in an export or a copy without a .git directory."""
    return sorted(p for p in ROOT.rglob("*.md")
                  if not SKIP.intersection(p.relative_to(ROOT).parts[:-1]))


def broken_links() -> list[str]:
    problems = []
    for doc in tracked_markdown():
        text = doc.read_text(encoding="utf-8")
        for match in LINK.finditer(text):
            target = match.group(1)
            if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("#"):
                continue
            path = target.split("#", 1)[0]
            if path and not (doc.parent / path).resolve().exists():
                line = text.count("\n", 0, match.start()) + 1
                problems.append(f"{doc.relative_to(ROOT)}:{line}: {target}")
    return problems


def main() -> int:
    problems = broken_links()
    for p in problems:
        print(f"broken link  {p}")
    print("all relative Markdown links resolve" if not problems else f"{len(problems)} broken link(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
