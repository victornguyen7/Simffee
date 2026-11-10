"""Is the committed public/runs.json what the current code builds? (AUDIT_FIX_PLAN #4, #11)

    ./tools/build_demo.sh --out /tmp/simffee-bundle
    python3 tools/check_bundle.py /tmp/simffee-bundle/runs.json            # vs public/runs.json
    python3 tools/check_bundle.py NEW.json OLD.json

Exits 0 when the two bundles match apart from `meta.generated_at`, else prints the paths
that differ and exits 1. Regenerate with `./tools/build_demo.sh --out DIR` and copy
DIR/runs.json to public/runs.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
IGNORED = {".meta.generated_at"}
SHOWN = 40


def differences(new: Any, old: Any, path: str = "") -> list[str]:
    if path in IGNORED:
        return []
    if type(new) is not type(old):
        return [f"{path or '.'}: {type(new).__name__} in the rebuild, {type(old).__name__} committed"]
    if isinstance(new, dict):
        out: list[str] = []
        for key in sorted(set(new) | set(old)):
            sub = f"{path}.{key}"
            if key not in old:
                out.append(f"{sub}: only in the rebuild")
            elif key not in new:
                out.append(f"{sub}: only in the committed bundle")
            else:
                out.extend(differences(new[key], old[key], sub))
        return out
    if isinstance(new, list):
        out = [f"{path}: {len(new)} items in the rebuild, {len(old)} committed"] if len(new) != len(old) else []
        for i, (a, b) in enumerate(zip(new, old)):
            out.extend(differences(a, b, f"{path}[{i}]"))
        return out
    return [] if new == old else [f"{path}: {json.dumps(new)[:60]} in the rebuild, {json.dumps(old)[:60]} committed"]


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    new_path = Path(argv[1])
    old_path = Path(argv[2]) if len(argv) == 3 else ROOT / "public" / "runs.json"
    found = differences(json.loads(new_path.read_text(encoding="utf-8")),
                        json.loads(old_path.read_text(encoding="utf-8")))
    if not found:
        print(f"OK: {old_path} matches the rebuild (ignoring {', '.join(sorted(IGNORED))})")
        return 0
    print(f"STALE: {old_path} differs from the rebuild in {len(found)} place(s):")
    for line in found[:SHOWN]:
        print(f"  {line}")
    if len(found) > SHOWN:
        print(f"  ... and {len(found) - SHOWN} more")
    print("Regenerate: ./tools/build_demo.sh --out DIR && cp DIR/runs.json public/runs.json")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
