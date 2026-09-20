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


ANALYSIS = json.loads((ROOT / "public" / "runs.json").read_text(encoding="utf-8"))["analysis"]


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

    print("\nhappy path")
    good = "Sales broke on day 4 and the obvious culprit was the price rise. The real cause was the later opening, which cost 3 customers outright."
    t = stub([good])
    out = narrate.narrate(ANALYSIS, complete_json=t)
    check("returns the narration", out["narration"], good)
    check("one attempt", out["attempts"], 1)
    check("nothing rejected", out["rejected"], None)

    print("\nretry path")
    t = stub(["Sales collapsed by 91% overnight.", good])
    out = narrate.narrate(ANALYSIS, complete_json=t)
    check("retries past an invented number", out["narration"], good)
    check("two attempts", out["attempts"], 2)
    check("retry drops the temperature", [s["temperature"] for s in t.seen], [0.7, 0.3])

    print("\ngiving up")
    t = stub(["It fell 91%.", "No, 84%."])
    out = narrate.narrate(ANALYSIS, complete_json=t)
    check("returns None rather than a bad narration", out["narration"], None)
    check("says why", out["rejected"], "invented numbers ['84']")

    print("\ntransport down")
    def broken(*a, **k):
        raise RuntimeError("no API key")
    out = narrate.narrate(ANALYSIS, complete_json=broken)
    check("survives a dead transport", out["narration"], None)
    check("reports the failure", out["rejected"].startswith("transport failed"), True)

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
