"""Analyzer against the fixture oracle (BACKEND_PLAN 4, hour 2-4).

    python3 tests/test_analyzer.py

The fixtures encode a known day-4 break. If these fail after hour-6 tuning, the oracle in
tests/fixtures/expected_analysis.json is what tells you whether the analyzer broke or the
simulation legitimately changed.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from analyzer import attribution, breakpoint, pairwise  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
SHOP = "simffee"
SEED = 0

failures = []


def check(name, got, want):
    if got == want:
        print(f"  pass  {name}")
    else:
        print(f"  FAIL  {name}\n          got  {got}\n          want {want}")
        failures.append(name)


def rows(scenario, seed=SEED):
    path = FIX / "runs" / scenario / f"{seed}.jsonl"
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def main():
    oracle = json.loads((FIX / "expected_analysis.json").read_text(encoding="utf-8"))
    shops = json.loads((ROOT / "data" / "shops.json").read_text(encoding="utf-8"))
    baseline_sc = json.loads((ROOT / "data" / "scenarios" / "baseline.json").read_text(encoding="utf-8"))

    base, ctrl = rows("baseline"), rows("cf_null")

    print("breakpoint")
    brk = breakpoint.find_break(base, ctrl, SHOP)
    check("break_day", brk["break_day"], oracle["break_day"])
    check("break is the earliest candidate", brk["break_day"], min(c["day"] for c in brk["candidates"]))
    check("control never falls with it", any(c["control_fell_too"] for c in brk["candidates"]), False)

    print("attribution")
    active = [o for o in baseline_sc["overrides"] if o["from_day"] <= brk["break_day"]]
    naive = attribution.naive_read(active, shops)
    check("naive driver", naive["driver"], oracle["naive"]["driver"])
    check("naive magnitude", round(naive["magnitude"], 3), oracle["naive"]["magnitude"])
    check("naive label", naive["label"], oracle["naive"]["label"])

    actual = attribution.actual_driver(base, brk["break_day"])
    check("actual driver", actual["driver"], oracle["actual"]["driver"])
    check("histogram", actual["histogram"], oracle["actual"]["histogram"])
    check("surprise", attribution.compare(naive, actual)["surprise"], oracle["surprise"])

    print("pairwise")
    check("lost in baseline", pairwise.lost(base, SHOP), oracle["impact"]["lost_twins"])
    check("lost in control", pairwise.lost(ctrl, SHOP), oracle["impact"]["anyway_twins"])
    for sid, want in oracle["whatif"].items():
        got = pairwise.returns(base, rows(sid), SHOP)
        check(f"{sid} returns", {"returns": got["returns"], "of": got["of"]}, want)

    changes = pairwise.outcome_changes(base, rows("cf_restore_hours"), from_day=5)
    check("cf_restore_hours diverges for 3 twins", changes["count"], 3)

    print("\nnaive read considered:")
    for s in naive["considered"]:
        print(f"  {s['driver']:10} {s['magnitude']:.3f}  {s['detail']}")

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
