"""Row validator for the frozen trajectory contract (BACKEND_PLAN 2.1).

Runs against fixtures now and against B1's real runs/ later; the contract is the same.
When engine/schema.py lands, DRIVERS/MODES/CHOICES should be imported from it instead.

    python3 tools/validate.py                      # fixtures
    python3 tools/validate.py runs                 # B1's real output
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DRIVERS = {"habit", "hours", "price", "distance", "wait", "product", "curiosity", "social", "quality"}
SOURCES = {"hours", "price", "product", "wait", "closed", "none"}
MODES = {"autopilot", "reappraisal"}
EXPECTED_DAYS = 7


def twin_ids():
    return {json.loads(f.read_text(encoding="utf-8"))["id"]
            for f in (ROOT / "data" / "twins").glob("*.json")}


def shop_ids():
    return set(json.loads((ROOT / "data" / "shops.json").read_text(encoding="utf-8")))


def check_row(r, twins, shops, where, errs):
    def bad(msg):
        errs.append(f"{where}: {msg}")

    for field in ("scenario", "seed", "day", "twin", "mode", "disruption", "state_before",
                  "choice", "spent", "abandoned", "primary_driver", "valence", "reasoning",
                  "state_after", "told"):
        if field not in r:
            bad(f"missing field {field!r}")
    if "secondary_driver" not in r:
        bad("missing field 'secondary_driver' (may be null, must be present)")
    if errs:
        return

    if r["twin"] not in twins:
        bad(f"unknown twin {r['twin']!r}")
    if r["mode"] not in MODES:
        bad(f"bad mode {r['mode']!r}")
    if r["choice"] not in shops | {"none"}:
        bad(f"bad choice {r['choice']!r}")
    if r["primary_driver"] not in DRIVERS:
        bad(f"bad primary_driver {r['primary_driver']!r}")
    if r["secondary_driver"] is not None and r["secondary_driver"] not in DRIVERS:
        bad(f"bad secondary_driver {r['secondary_driver']!r}")
    if r["disruption"].get("source") not in SOURCES:
        bad(f"bad disruption.source {r['disruption'].get('source')!r}")
    if not 0.0 <= r["disruption"].get("score", -1) <= 1.0:
        bad(f"disruption.score out of range: {r['disruption'].get('score')}")
    if not -1.0 <= r["valence"] <= 1.0:
        bad(f"valence out of range: {r['valence']}")

    if r["spent"] is None:
        bad("spent is null; must be 0 when choice == 'none'")
    elif r["choice"] == "none" and r["spent"] != 0:
        bad(f"choice 'none' but spent {r['spent']}")
    elif r["choice"] != "none" and r["spent"] <= 0:
        bad(f"choice {r['choice']!r} but spent {r['spent']}")

    if r["abandoned"] != (r["choice"] == "none"):
        bad(f"abandoned {r['abandoned']} disagrees with choice {r['choice']!r}")
    if len(r["reasoning"].split()) > 40:
        bad(f"reasoning is {len(r['reasoning'].split())} words, limit 40")
    for t in r["told"]:
        if t not in twins:
            bad(f"told unknown twin {t!r}")
        if t == r["twin"]:
            bad("twin told itself")
    for key in ("state_before", "state_after"):
        if "habit" not in r[key] or "latent_interest" not in r[key]:
            bad(f"{key} missing habit/latent_interest")


def check_file(path, twins, shops, errs):
    where = path.relative_to(ROOT)
    rows = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            errs.append(f"{where}:{i}: bad JSON: {e}")
            return 0

    for i, r in enumerate(rows, 1):
        check_row(r, twins, shops, f"{where}:{i}", errs)

    expected = len(twins) * EXPECTED_DAYS
    if len(rows) != expected:
        errs.append(f"{where}: {len(rows)} rows, expected {expected} ({len(twins)} twins x {EXPECTED_DAYS} days)")

    seen = {}
    for r in rows:
        key = (r["day"], r["twin"])
        if key in seen:
            errs.append(f"{where}: duplicate row for day {r['day']} twin {r['twin']}")
        seen[key] = True
    for day in range(1, EXPECTED_DAYS + 1):
        missing = twins - {t for d, t in seen if d == day}
        if missing:
            errs.append(f"{where}: day {day} missing twins {sorted(missing)}")

    order = [(r["day"], r["twin"]) for r in rows]
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
