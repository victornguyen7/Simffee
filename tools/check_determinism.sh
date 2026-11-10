#!/usr/bin/env bash
# B1 hard requirement (BACKEND_PLAN 3, 6.2): the same seed replays byte for byte,
# and a fork shares its parent's opening days so the override is the only
# difference between branches.
#
# Every run must be complete (--require-complete): comparing fallback rows with fallback
# rows proves nothing about the simulation (AUDIT_FIX_PLAN #12). SEEDS defaults to what the
# committed cache covers; the replay pins the cache's own model settings (--cache-defaults).
set -euo pipefail
cd "$(dirname "$0")/.."

SEEDS="${SEEDS:-0-2}"
ENGINE=(python3 -m engine.cli --offline --cache-defaults --require-complete --quiet --cache cache)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== replay: baseline seed 0, twice =="
"${ENGINE[@]}" --scenario baseline --seeds 0 --out "$TMP/a"
"${ENGINE[@]}" --scenario baseline --seeds 0 --out "$TMP/b"
diff -r "$TMP/a" "$TMP/b" && echo "   identical"

echo "== fork fairness: forks share their parent's opening days (seeds $SEEDS) =="
"${ENGINE[@]}" --all --seeds "$SEEDS" --out "$TMP/c"
python3 - "$TMP/c" "$SEEDS" <<'PY'
import json, sys
from pathlib import Path

out = Path(sys.argv[1])
seeds = sorted(int(p.stem) for p in (out / "baseline").glob("*.jsonl"))
if not seeds:
    sys.exit("   FAIL no baseline rows were written")

def rows(scenario, seed):
    path = out / scenario / f"{seed}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

def strip(row):
    row = dict(row)
    row.pop("scenario")
    return row

failures = 0
for seed in seeds:
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
