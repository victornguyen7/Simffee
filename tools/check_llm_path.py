#!/usr/bin/env python3
"""Exercise the reappraisal path with a stubbed transport -- no API key, no spend.

Covers the four behaviours SPEC 4.3 specifies: a good reply is used and cached,
a bad reply is retried once at a lower temperature, two bad replies fall back to
autopilot with llm_failed, and a cached key never calls out again.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import decide, llm, loop                      # noqa: E402
from engine.loader import load_chain, load_shops, load_twins   # noqa: E402
from engine.resolve import resolve                        # noqa: E402
from engine.schema import validate_row                    # noqa: E402

SHOPS = load_shops()
SHOP_IDS = frozenset(SHOPS)
TWINS = load_twins(shop_ids=SHOP_IDS)
CHAIN = load_chain("baseline")

GOOD = {
    "choice": "starbucks", "primary_driver": "hours", "secondary_driver": "curiosity",
    "valence": 0.4,
    "reasoning": "My usual place wasn't open at 6:45 and I had to go somewhere, "
                 "so I finally tried the one Linh keeps talking about.",
}
BAD_ENUM = {**GOOD, "primary_driver": "vibes"}
SHUT_SHOP = {**GOOD, "choice": "simffee"}      # simffee is shut at 06:45 on day 4

calls: list[float] = []


def stub(replies):
    """Replace the transport with a canned sequence of replies."""
    queue = list(replies)

    def fake(system, user, schema, temperature, **kwargs):
        calls.append(temperature)
        if not queue:
            raise AssertionError("stub ran out of replies")
        return queue.pop(0), {"input_tokens": 900, "output_tokens": 60}

    llm.complete_json = fake


def run_one(replies, cache_dir: Path):
    """One reappraisal for T01 on day 4, the hours shock."""
    global calls
    calls = []
    decide.reset_stats()
    stub(replies)
    twin = next(t for t in TWINS if t.id == "T01")
    shops_today = resolve(SHOPS, CHAIN, 4)
    state = {
        "habit": dict(twin.mechanism["habit"]),
        "latent_interest": dict(twin.mechanism["latent_interest"]),
        "history": [],
    }
    from engine.disruption import disruption
    disr = disruption(twin, shops_today["simffee"], resolve(SHOPS, CHAIN, 1)["simffee"])
    decision = decide.reappraise(
        twin, state, shops_today, disr, "simffee", None, 4, "baseline", 0,
        cache_dir=cache_dir,
    )
    return decision, dict(decide.STATS)


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    failures = 0

    def check(label, condition, detail=""):
        nonlocal failures
        print(f"  {'ok  ' if condition else 'FAIL'}  {label}{'' if condition else '  <- ' + detail}")
        if not condition:
            failures += 1

    print("== 1. a valid reply is used, and cached ==")
    cache_a = tmp / "a"
    decision, stats = run_one([GOOD], cache_a)
    check("switched to starbucks", decision["choice"] == "starbucks", str(decision))
    check("kept the real drivers", decision["primary_driver"] == "hours"
          and decision["secondary_driver"] == "curiosity")
    check("reasoning trimmed to 40 words", len(decision["reasoning"].split()) <= 40)
    check("not flagged as failed", decision["llm_failed"] is False)
    check("one call at temperature 0.7", calls == [0.7], str(calls))
    check("wrote one cache file", len(list(cache_a.glob("*.json"))) == 1)

    print("== 2. the same key replays from cache, no call ==")
    decision2, stats2 = run_one([], cache_a)
    check("same decision", decision2["choice"] == "starbucks")
    check("zero calls", stats2["llm_calls"] == 0 and stats2["cache_hits"] == 1, str(stats2))

    print("== 3. a bad enum is retried once at 0.3 ==")
    decision3, stats3 = run_one([BAD_ENUM, GOOD], tmp / "c")
    check("recovered", decision3["choice"] == "starbucks")
    check("two calls, second cooler", calls == [0.7, 0.3], str(calls))
    check("counted the retry", stats3["retries"] == 1, str(stats3))

    print("== 4. a shop that is shut is rejected ==")
    decision4, stats4 = run_one([SHUT_SHOP, GOOD], tmp / "d")
    check("rejected the shut shop, retried", calls == [0.7, 0.3] and decision4["choice"] == "starbucks")

    print("== 5. two bad replies fall back and flag the row ==")
    decision5, stats5 = run_one([BAD_ENUM, BAD_ENUM], tmp / "e")
    check("flagged llm_failed", decision5["llm_failed"] is True, str(decision5))
    check("behaved like autopilot", decision5["primary_driver"] == "habit")
    check("nothing cached", not (tmp / "e").exists() or not list((tmp / "e").glob("*.json")))

    print("== 6. a switch produces a schema-valid row end to end ==")
    decide.reset_stats()
    stub([GOOD] * 40)
    rows = loop.run("baseline", 0, out=tmp / "runs", cache_dir=tmp / "f")
    problems = [p for row in rows for p in validate_row(row, SHOP_IDS)]
    check("70 valid rows", len(rows) == 70 and not problems, str(problems[:1]))
    day4 = {r["twin"]: r for r in rows if r["day"] == 4}
    switchers = [t for t, r in day4.items() if r["choice"] == "starbucks"]
    check("day 4 has switchers", len(switchers) >= 3, str(switchers))
    t01 = day4["T01"]
    check("first visit zeroed latent_interest",
          t01["state_after"]["latent_interest"]["starbucks"] == 0.0, str(t01["state_after"]))
    check("habit moved toward starbucks",
          t01["state_after"]["habit"]["starbucks"] > t01["state_before"]["habit"]["starbucks"])

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'all checks passed' if not failures else str(failures) + ' FAILURES'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
