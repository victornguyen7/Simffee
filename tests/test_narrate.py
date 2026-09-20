"""narrate.py against a stubbed transport — no API key needed (BACKEND_PLAN 4).

    python3 tests/test_narrate.py

The rule under test: the narration may never contain a number that is not in its input.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from analyzer import narrate  # noqa: E402

failures = []


def check(name, got, want):
    if got == want:
        print(f"  pass  {name}")
    else:
        print(f"  FAIL  {name}\n          got  {got}\n          want {want}")
        failures.append(name)


def _fixture_analysis():
    """The slice of `analysis` narrate.payload_for reads, computed from the fixture rows.

    Not read from public/runs.json: that file may have been built from real engine output,
    and the replies scripted below assume the fixture's numbers.
    """
    from analyzer import attribution, confidence, impact
    fix = ROOT / "tests" / "fixtures"
    oracle = json.loads((fix / "expected_analysis.json").read_text(encoding="utf-8"))

    def rows(scenario, seed=0):
        path = fix / "runs" / scenario / f"{seed}.jsonl"
        return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]

    base = rows("baseline")
    actual = attribution.actual_driver(base, oracle["break_day"])
    twins = {f.stem: json.loads(f.read_text()) for f in (ROOT / "data/twins").glob("*.json")}
    return {
        "complete": True,
        "confidence": confidence.confidence([rows("baseline", seed) for seed in range(5)], oracle["break_day"], twins),
        "break_day": oracle["break_day"],
        "naive": oracle["naive"],
        "actual": {"driver": actual["driver"], "switchers": actual["switchers"]},
        "impact": impact.impact(base, rows("cf_null"), "simffee"),
    }


ANALYSIS = _fixture_analysis()


def stub(replies):
    """A transport that returns each reply in turn, recording the prompts it saw."""
    seen = []

    def transport(system, user, schema, temperature):
        seen.append({"user": user, "temperature": temperature})
        if not replies:
            raise RuntimeError("stub exhausted")
        return {"narration": replies.pop(0)}, {"input_tokens": 0, "output_tokens": 0}

    transport.seen = seen
    return transport


def main():
    payload = narrate.payload_for(ANALYSIS)
    print("payload the model may see:", json.dumps(payload, ensure_ascii=False))

    print("\nnumber guard")
    check("a figure from the payload is allowed",
          narrate.unsupported_numbers("Sales broke on day 4.", payload), [])
    check("an invented figure is caught",
          narrate.unsupported_numbers("Sales fell 91% on day 4.", payload), ["91"])
    check("a recomputed percentage is caught",
          narrate.unsupported_numbers("Around 37 percent of regulars left.", payload), ["37"])
    check("prose with no figures is allowed",
          narrate.unsupported_numbers("The obvious reading was price; the cause was the hours.", payload), [])

    print("\ndeterministic happy path")
    good = ("Sales broke on day 4; the obvious explanation was price. "
            "Recorded decisions pointed to opening hours; 4 customers were lost, "
            "with 3 attributed to the change and 1 also lost in the control.")
    t = stub(["Sales collapsed by 91% overnight."])
    out = narrate.narrate(ANALYSIS, complete_json=t)
    check("renders the exact computed facts", out["narration"], good)
    check("zero model attempts", out["attempts"], 0)
    check("transport never invoked", t.seen, [])
    check("nothing rejected", out["rejected"], None)
    check("exactly two sentences", len([s for s in good.split('.') if s.strip()]), 2)

    print("\nfield binding")
    changed = {**ANALYSIS, "impact": {**ANALYSIS["impact"], "lost_total": 6,
                                     "lost_by_decision": 6, "lost_anyway": 0}}
    t = stub(["Price caused the decline and cost 3 customers."])
    out = narrate.narrate(changed, complete_json=t)
    check("price digits cannot become customer counts", "3 customers" in out["narration"], False)
    check("uses actual impact", "6 customers" in out["narration"], True)
    check("uses actual driver", "pointed to opening hours" in out["narration"], True)
    check("untrusted prose never requested", t.seen, [])

    print("\ninsufficient evidence")
    out = narrate.narrate({**ANALYSIS, "complete": False})
    check("incomplete runs have no narration", out["narration"], None)
    out = narrate.narrate({**ANALYSIS, "confidence": {"unmeasured": True}})
    check("unmeasured confidence has no narration", out["narration"], None)

    print("\ntransport down")
    def broken(*a, **k):
        raise RuntimeError("no API key")
    out = narrate.narrate(ANALYSIS, complete_json=broken)
    check("offline rendering needs no transport", out["narration"], good)
    check("no transport failure possible", out["rejected"], None)

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
