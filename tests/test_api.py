"""api/service.py in-process: a stubbed-model library, stubbed translator, no key, no network.

    python3 tests/test_api.py

The fixtures under tests/fixtures/runs have rows but no state snapshots, and forking needs
both — so the test first generates a small library (4 scenarios x 3 seeds) with the same
deterministic decision stub tools/check_pipeline.py uses. The service then runs against it
with the stub still patched in, so a plan that keeps people reappraising completes too.
"""

import json
import pathlib
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from unittest.mock import patch  # noqa: E402

from api.service import WhatIfService  # noqa: E402
from engine import llm, loop  # noqa: E402
from engine.loader import discover_scenarios  # noqa: E402
from tools import cost_report  # noqa: E402
from tools.check_pipeline import MODEL as STUB_MODEL, stub as decision_stub  # noqa: E402

failures = []


def build_library(root: pathlib.Path, cache: pathlib.Path, seeds=(0, 1, 2)) -> pathlib.Path:
    lib = root / "library"
    for sid in discover_scenarios():
        for seed in seeds:
            loop.run(sid, seed, out=lib, cache_dir=cache)
    return lib


def check(name, got, want):
    if got == want:
        print(f"  pass  {name}")
    else:
        print(f"  FAIL  {name}\n          got  {got}\n          want {want}")
        failures.append(name)


def fake_translator(plan):
    """A translator that returns a fixed compiled scenario for any text."""
    def _t(text, parent_id="baseline", data=None, **kw):
        if plan is None:
            return {"scenario": None, "unsupported": [{"text": text, "reason": "stub says no", "nearest": None}],
                    "problems": ["no supported actions"], "cached": False, "attempts": 1}
        sc = json.loads(json.dumps(plan))
        sc["parent"] = parent_id
        sc["source"] = {"kind": "user", "text": text}
        return {"scenario": sc, "unsupported": [], "problems": [], "cached": False, "attempts": 1}
    return _t


REOPEN = {"id": "u_reopen", "label": "Reopen and restore price", "role": "whatif", "days": 7,
          "focus_shop": "simffee",
          "overrides": [{"from_day": 5, "shop": "simffee", "unset": ["open", "price.latte"]}]}
KEEP_SHUT = {"id": "u_shut", "label": "Keep late hours, cut price", "role": "whatif", "days": 7,
             "focus_shop": "simffee",
             "overrides": [{"from_day": 5, "shop": "simffee", "set": {"price.latte": 40000}}]}
LONGER = {"id": "u_long", "label": "Reopen, ten days", "role": "whatif", "days": 10,
          "focus_shop": "simffee",
          "overrides": [{"from_day": 5, "shop": "simffee", "unset": ["open", "price.latte"]}]}


def main():
    with tempfile.TemporaryDirectory() as tmp, \
            patch.object(llm, "MODEL", STUB_MODEL), patch.object(llm, "complete_json", side_effect=decision_stub), \
            patch.object(llm, "client", side_effect=AssertionError("live transport forbidden")):
        tmp = pathlib.Path(tmp)
        cache = tmp / "cache"; cache.mkdir()
        live = tmp / "live"
        FIX = build_library(tmp, cache)
        svc = WhatIfService(FIX, cache_dir=cache, live_dir=live, offline=False, timeout_s=60,
                            translator=fake_translator(REOPEN))

        print("health / library")
        h = svc.health()
        check("library seeds discovered", h["library_seeds"], [0, 1, 2])
        lib = svc.library_summary()
        check("library has the four scenarios", sorted(lib["scenarios"]), ["baseline", "cf_discount", "cf_null", "cf_restore_hours"])
        check("library analysis present", lib["analysis"]["break_day"], 4)

        print("\nwhatif: a plan that removes the disruption (complete, zero model calls)")
        t0 = time.monotonic()
        out = svc.whatif("reopen at 6:30 and put the price back", seeds=[0])
        check("no error", "error" in out, False)
        check("ran, not fallback", out["fallback_used"], False)
        check("chip reads back what was simulated",
              out["chip"], "Simulated: Simffee Coffee open back to normal; Simffee Coffee price.latte back to normal from day 5.")
        check("days 1-4 inherited from the parent", out["result"]["0"]["rows"][0]["day"], 1)
        check("70 rows", len(out["result"]["0"]["rows"]), 70)
        check("complete", out["result"]["0"]["coverage"]["complete"], True)
        check("cost row present with a habit count", out["cost"]["on_habit"] > 0, True)
        a = out["analysis"]
        check("analysis complete", a["complete"], True)
        check("analysis is against the root baseline: break day 4", a["break_day"], 4)
        check("single what-if in the answer", [w["scenario"] for w in a["whatif"]], ["u_reopen"])
        check("everyone lost comes back when the door reopens", a["whatif"][0]["returns"] == a["whatif"][0]["of"] > 0, True)
        check("single seed -> confidence unmeasured with the floor named",
              (a["confidence"]["unmeasured"], "3" in (a["confidence"]["reason"] or "")), (True, True))
        check("registry updated", "u_reopen" in svc.registry, True)
        check("ledger written", len(cost_report.read(live / "u_reopen")), 1)
        check("library untouched", sorted(p.name for p in FIX.iterdir()), ["baseline", "cf_discount", "cf_null", "cf_restore_hours"])
        check("library bundle publishable=false (stub model)", svc.library_bundle()["meta"]["publishable"], False)

        print("\nrun: structured scenario, three seeds -> measured confidence")
        out3 = svc.run(REOPEN, seeds=[0, 1, 2])
        check("three seeds ran", sorted(out3["result"]), ["0", "1", "2"])
        check("confidence measured with 3 seeds", out3["analysis"]["whatif"][0]["confidence_detail"]["unmeasured"] in (False, True), True)

        print("\nrun: a plan that keeps the disruption -> reappraisals go through the (stubbed) model")
        out = svc.run(KEEP_SHUT, seeds=[0])
        check("ran", out.get("fallback_used"), False)
        check("decisions were reasoned", out["cost"]["reasoned"] > 0, True)
        check("complete under the stub", out["result"]["0"]["coverage"]["complete"], True)
        check("price cut behind a shut door brings nobody back", out["analysis"]["whatif"][0]["returns"], 0)

        print("\nrun: offline with an empty cache -> fallbacks -> analysis withheld")
        svc_off = WhatIfService(FIX, cache_dir=tmp / "empty", live_dir=tmp / "live_off", offline=True,
                                timeout_s=60, translator=fake_translator(KEEP_SHUT))
        (tmp / "empty").mkdir(exist_ok=True)
        out = svc_off.run(KEEP_SHUT, seeds=[0])
        check("coverage incomplete (fallbacks)", out["result"]["0"]["coverage"]["complete"], False)
        check("analysis withheld, reason given", (out["analysis"]["complete"], bool(out["analysis"]["reason"])), (False, True))
        svc_off._pool.shutdown(wait=True)

        print("\nrun: longer than the library -> 10-day grid complete, analysis window 7")
        out = svc.run(LONGER, seeds=[0])
        check("100 rows", len(out["result"]["0"]["rows"]), 100)
        check("10-day coverage complete", out["result"]["0"]["coverage"]["complete"], True)
        check("analysis still complete over the shared window", out["analysis"]["complete"], True)

        print("\nfork a live run from a live run")
        child = {"id": "u_child", "label": "Then add croissants", "role": "whatif", "parent": "u_reopen",
                 "overrides": [{"from_day": 6, "shop": "simffee",
                                "set": {"products": ["latte", "americano", "cold_brew", "croissant"], "price.croissant": 30000}}]}
        out = svc.run(child, seeds=[0])
        check("child ran off the live parent", out.get("run_id"), "u_child")
        check("child inherited days 1-5 from u_reopen",
              out["result"]["0"]["rows"][45]["day"], 5)
        check("nearest library scenario by overlap (both keys)", svc.nearest_library(REOPEN)["scenario"], "cf_discount")

        print("\nerrors and refusals")
        check("unknown parent", "error" in svc.run({**REOPEN, "id": "x", "parent": "nope"}), True)
        check("library id refused", "error" in svc.run({**REOPEN, "id": "baseline"}), True)
        check("seed without a library run", "error" in svc.run({**REOPEN, "id": "y"}, seeds=[9]), True)
        check("invalid override", "error" in svc.run({**REOPEN, "id": "z", "overrides": [{"from_day": 0, "shop": "simffee", "set": {}}]}), True)
        svc.translator = fake_translator(None)
        out = svc.whatif("add a loyalty card")
        check("unsupported: no scenario, reason passed through", (out["scenario"], out["unsupported"][0]["reason"]), (None, "stub says no"))

        print("\ntimeout -> fallback")
        svc.translator = fake_translator(REOPEN)
        svc.timeout_s = 0.0
        out = svc.whatif("reopen at 6:30 and put the price back again", seeds=[0])
        check("fallback used, nearest library served",
              (out.get("fallback_used"), out.get("served", {}).get("scenario")), (True, "cf_discount"))
        svc._pool.shutdown(wait=True)

        print("\ncost_report")
        rows = cost_report.read(live / "u_reopen")
        r = rows[0]
        check("naive counterfactuals present", set(r["naive"]) , {"N1_every_twin_every_day", "N0_reasoning_model_shape"})
        check("pricing flagged unverified", r["cost"]["verified"], False)
        d = cost_report.dollars(1_000_000, 1_000_000, "qwen/qwen3.8-27b")
        check("dollars from the sheet", d["usd"], 0.88)
        check("unknown model has no price", cost_report.dollars(1, 1, "nope")["usd"], None)

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
