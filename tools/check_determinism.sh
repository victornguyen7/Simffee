#!/usr/bin/env bash
# B1 hard requirement (BACKEND_PLAN 3, 6.2): the same seed replays byte for byte,
# and a fork shares its parent's opening days so the override is the only
# difference between branches.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== replay: baseline seed 0, twice =="
python3 -m engine.cli --scenario baseline --seeds 0 --out "$TMP/a" --offline --quiet
python3 -m engine.cli --scenario baseline --seeds 0 --out "$TMP/b" --offline --quiet
diff -r "$TMP/a" "$TMP/b" && echo "   identical"

echo "== fork fairness: cf_null days 1-3 == baseline days 1-3 =="
python3 -m engine.cli --all --seeds 0-4 --out "$TMP/c" --offline --quiet
python3 - "$TMP/c" <<'PY'
import json, sys
from pathlib import Path

out = Path(sys.argv[1])

def rows(scenario, seed):
    path = out / scenario / f"{seed}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

def strip(row):
    row = dict(row)
    row.pop("scenario")
    return row

failures = 0
for seed in range(5):
    base = rows("baseline", seed)
    for scenario, shared_until in (("cf_null", 3), ("cf_discount", 4), ("cf_restore_hours", 4)):
        child = rows(scenario, seed)
        if len(child) != 70:
            print(f"   FAIL {scenario} seed {seed}: {len(child)} rows, expected 70")
            failures += 1
        a = [strip(r) for r in base if r["day"] <= shared_until]
        b = [strip(r) for r in child if r["day"] <= shared_until]
        if a != b:
            print(f"   FAIL {scenario} seed {seed}: days 1-{shared_until} diverge from baseline")
            failures += 1
print("   all forks share their parent's opening days" if not failures else f"   {failures} failures")
sys.exit(1 if failures else 0)
PY
echo "== OK =="
