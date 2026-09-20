"""Row validator for the frozen trajectory contract (BACKEND_PLAN 2.1).

Runs against fixtures and against B1's real runs/; the contract is the same. The enums
come from engine/schema.py so there is one definition rather than two that agree today.
This adds the file-level invariants schema.validate_row cannot see on its own: row
counts, per-day coverage, ordering, and told-list membership.

    python3 tools/validate.py                      # fixtures
    python3 tools/validate.py runs                 # B1's real output
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.schema import DAYS, validate_row  # noqa: E402

EXPECTED_DAYS = DAYS


def twin_ids():
    return {json.loads(f.read_text(encoding="utf-8"))["id"]
            for f in (ROOT / "data" / "twins").glob("*.json")}


def shop_ids():
    return set(json.loads((ROOT / "data" / "shops.json").read_text(encoding="utf-8")))


def check_row(r, twins, shops, where, errs):
    errs.extend(f"{where}: {problem}" for problem in validate_row(r, frozenset(shops)))
    if not isinstance(r, dict):
        return
    if not isinstance(r.get("twin"), str) or r["twin"] not in twins:
        errs.append(f"{where}: unknown twin")
    if not isinstance(r.get("told"), list):
        errs.append(f"{where}: told must be a list")
        return
    for t in r["told"]:
        if not isinstance(t, str) or t not in twins:
            errs.append(f"{where}: told unknown twin")
        if t == r.get("twin"):
            errs.append(f"{where}: twin told itself")


def check_file(path, twins, shops, errs):
    where = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    rows, line_numbers = [], []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
            line_numbers.append(i)
        except json.JSONDecodeError as e:
            errs.append(f"{where}:{i}: bad JSON: {e}")

    for i, r in zip(line_numbers, rows):
        check_row(r, twins, shops, f"{where}:{i}", errs)

    expected = len(twins) * EXPECTED_DAYS
    if len(rows) != expected:
        errs.append(f"{where}: {len(rows)} rows, expected {expected} ({len(twins)} twins x {EXPECTED_DAYS} days)")

    indexed = [r for r in rows if isinstance(r, dict) and type(r.get("day")) is int and isinstance(r.get("twin"), str)]
    seen = {}
    for r in indexed:
        if not 1 <= r["day"] <= EXPECTED_DAYS:
            errs.append(f"{where}: day outside 1-{EXPECTED_DAYS}")
        key = (r["day"], r["twin"])
        if key in seen:
            errs.append(f"{where}: duplicate row for day {r['day']} twin {r['twin']}")
        seen[key] = True
    for day in range(1, EXPECTED_DAYS + 1):
        missing = twins - {t for d, t in seen if d == day}
        if missing:
            errs.append(f"{where}: day {day} missing twins {sorted(missing)}")

    order = [(r["day"], r["twin"]) for r in indexed]
    if order != sorted(order):
        errs.append(f"{where}: rows not ordered by (day, twin)")

    return len(rows)


def main():
    base = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/runs")
    if not base.exists():
        print(f"no such directory: {base}")
        return 1

    twins, shops = twin_ids(), shop_ids()
    errs = []
    files = sorted(base.glob("*/*.jsonl"))
    if not files:
        print(f"no .jsonl files under {base}")
        return 1

    total = sum(check_file(f, twins, shops, errs) for f in files)

    if errs:
        print(f"FAIL — {len(errs)} problem(s) across {len(files)} file(s):")
        for e in errs[:40]:
            print(f"  {e}")
        if len(errs) > 40:
            print(f"  ... and {len(errs) - 40} more")
        return 1

    print(f"OK — {total} rows across {len(files)} files, {len(twins)} twins x {EXPECTED_DAYS} days")
    return 0


if __name__ == "__main__":
    sys.exit(main())
