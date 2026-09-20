"""SPEC_FUNCTIONAL 6 — the analyzer and bundle builder must not know any shop or scenario name.

    python3 tests/test_generic.py

Three checks:
1. Rename both shops everywhere (data + fixture rows) -> identical analysis numbers.
2. A third shop nobody visits -> identical analysis numbers.
3. A scenario set with different ids, roles taken from `role`, a what-if that RAISES sales
   -> break found with direction "rise", naive read from the weights table.
"""

import copy
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs  # noqa: E402
from analyzer import attribution, breakpoint  # noqa: E402

FIX = ROOT / "tests" / "fixtures" / "runs"
failures = []


def check(name, got, want):
    if got == want:
        print(f"  pass  {name}")
    else:
        print(f"  FAIL  {name}\n          got  {got}\n          want {want}")
        failures.append(name)


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def rows(scenario, seed, base=FIX):
    return build_runs.load_rows(base, scenario, seed)


def rename_rows(rs, mapping):
    out = []
    for r in rs:
        r = copy.deepcopy(r)
        r["choice"] = mapping.get(r["choice"], r["choice"])
        for block in ("state_before", "state_after"):
            for key in ("habit", "latent_interest"):
                if key in r[block]:
                    r[block][key] = {mapping.get(k, k): v for k, v in r[block][key].items()}
        out.append(r)
    return out


def rename_shops(shops, mapping):
    return {mapping.get(k, k): v for k, v in shops.items()}


def rename_scenarios(files, mapping):
    out = {}
    for sid, sc in files.items():
        sc = copy.deepcopy(sc)
        for ov in sc["overrides"]:
            ov["shop"] = mapping.get(ov["shop"], ov["shop"])
        if sc.get("focus_shop"):
            sc["focus_shop"] = mapping[sc["focus_shop"]]
        out[sid] = sc
    return out


def strip(analysis):
    """The comparable core: numbers, not labels or coverage blobs."""
    a = analysis
    return {
        "break_day": a["break_day"], "direction": a["direction"], "drop": a["drop"],
        "naive": a["naive"]["driver"], "actual": a["actual"]["driver"],
        "surprise": a["surprise"],
        "impact": {k: a["impact"][k] for k in ("lost_total", "lost_by_decision", "lost_anyway")},
        "confidence": a["confidence"]["value"],
        "whatif": [(w["scenario"], w["returns"], w["of"], w["confidence"]) for w in a["whatif"]],
    }


def main():
    shops = load(ROOT / "data" / "shops.json")
    scenario_files = build_runs.load_scenarios()
    twins = {f.stem: load(f) for f in (ROOT / "data" / "twins").glob("*.json")}
    seeds = [0, 1, 2, 3, 4]
    groups = {sid: [rows(sid, s) for s in seeds] for sid in scenario_files}

    print("reference (as shipped)")
    ref = build_runs.build_analysis(FIX, shops, scenario_files, twins, groups, seeds)
    check("reference is complete", ref["complete"], True)
    print("  ", strip(ref))

    print("\n1. both shops renamed")
    mapping = {"simffee": "shop_a", "starbucks": "shop_b"}
    shops_r = rename_shops(shops, mapping)
    files_r = rename_scenarios(scenario_files, mapping)
    groups_r = {sid: [rename_rows(rs, mapping) for rs in per] for sid, per in groups.items()}
    got = build_runs.build_analysis(FIX, shops_r, files_r, twins, groups_r, seeds)
    check("focus shop follows the first shop in shops.json", got["focus_shop"], "shop_a")
    check("analysis numbers identical", strip(got), strip(ref))
    check("no shop name in the narration",
          any(s in (got["narration"] or "").lower() for s in ("simffee", "starbucks", "shop_a")), False)

    print("\n2. third shop that nobody visits")
    shops_3 = dict(shops)
    shops_3["kiosk"] = {**shops["starbucks"], "name": "Kiosk", "position": [4, 0]}
    got = build_runs.build_analysis(FIX, shops_3, scenario_files, twins, groups, seeds)
    check("analysis numbers identical with a third shop", strip(got), strip(ref))

    print("\n3. different ids, roles from `role`, a what-if that raises sales")
    base_rows = groups["baseline"]
    ctrl_rows = groups["cf_null"]
    # A branch where, from day 5, everyone who left comes back AND the two Starbucks regulars
    # also come: sales rise well above the pre-break trailing average.
    boost = []
    for rs in base_rows:
        out = []
        for r in rs:
            r = copy.deepcopy(r)
            if r["day"] >= 5 and r["choice"] != "simffee":
                r["choice"] = "simffee"; r["spent"] = 45000
            out.append(r)
        boost.append(out)
    files_x = {
        "ship": {**copy.deepcopy(scenario_files["baseline"]), "id": "ship", "role": "baseline",
                 "label": "Shipped", "order": 0},
        "hold": {**copy.deepcopy(scenario_files["cf_null"]), "id": "hold", "role": "control",
                 "label": "Held", "order": 1},
        "boost": {"id": "boost", "role": "whatif", "label": "Everyone comes", "parent": "ship",
                  "order": 2, "overrides": [{"from_day": 5, "shop": "simffee",
                                             "set": {"open": "06:00", "quality": 0.95}}]},
    }
    groups_x = {"ship": base_rows, "hold": ctrl_rows, "boost": boost}
    role = build_runs.roles(files_x)
    check("roles resolved from files", role, {"baseline": "ship", "control": "hold", "whatifs": ["boost"]})
    got = build_runs.build_analysis(FIX, shops, files_x, twins, groups_x, seeds)
    check("break still found under new ids", got["break_day"], ref["break_day"])
    check("what-if label comes from the file", got["whatif"][0]["label"], "Everyone comes")
    check("boost returns everyone", (got["whatif"][0]["returns"], got["whatif"][0]["of"]),
          (ref["impact"]["lost_total"], ref["impact"]["lost_total"]))

    # A rise as the *headline* break: control is flat, baseline jumps on day 4.
    flat = [[dict(r) for r in rs] for rs in ctrl_rows]
    jump = []
    for rs in flat:
        out = []
        for r in rs:
            r = dict(r)
            if r["day"] >= 4 and r["choice"] != "simffee":
                r["choice"] = "simffee"; r["spent"] = 45000
            out.append(r)
        jump.append(out)
    brk = breakpoint.find_break(jump[0], flat[0], "simffee", 7)
    check("a rise is a break", (brk["break_day"], brk["direction"]), (4, "rise"))
    check("signed drop is negative on a rise", brk["drop"] < 0, True)

    print("\n4. naive read covers every overridable field")
    w = attribution.load_weights()
    ovs = [{"from_day": 4, "shop": "simffee", "set": {
        "avg_wait_min": 12, "quality": 0.6, "marketing.reach": 0.4,
        "products": ["latte", "americano"], "close": "18:00", "permanently_closed": True}}]
    naive = attribution.naive_read(ovs, shops, w)
    drivers = {c["driver"] for c in naive["considered"]}
    check("all six kinds scored", drivers, {"wait", "quality", "marketing", "product", "hours", "closed"})
    check("closure is the loudest", naive["driver"], "closed")
    check("price coefficient unchanged from v1",
          attribution.naive_read([{"from_day": 4, "shop": "simffee", "set": {"price.latte": 48000}}], shops, w)["magnitude"],
          0.3333)
    check("an unknown field is silently not a candidate",
          attribution.naive_read([{"from_day": 4, "shop": "simffee", "set": {"wifi": True}}], shops, w)["driver"], None)
    check("unset blocks contribute nothing",
          attribution.naive_read([{"from_day": 4, "shop": "simffee", "unset": ["open"]}], shops, w)["driver"], None)

    print("\n5. --seeds below the floor is labelled, not faked")
    got = build_runs.build_analysis(FIX, shops, scenario_files, twins,
                                    {sid: per[:1] for sid, per in groups.items()}, [0])
    check("single seed: complete", got["complete"], True)
    check("single seed: confidence unmeasured", (got["confidence"]["value"], got["confidence"]["unmeasured"]), (None, True))
    check("single seed: reason names the floor", "3" in got["confidence"]["reason"], True)

    print("\n6. engine schema additions (A1): unset, new-item price, shop_label, days, discovery")
    from engine.loader import discover_scenarios, load_chain, load_scenario_file, scenario_from_dict
    from engine.loop import scenario_days
    from engine.resolve import display_name, resolve
    check("discovery: parents before children, then `order`",
          discover_scenarios(), ["baseline", "cf_null", "cf_restore_hours", "cf_discount"])
    adhoc = scenario_from_dict({
        "id": "u1", "parent": "baseline", "days": 10, "focus_shop": "simffee",
        "source": {"kind": "user", "text": "open earlier, sell croissants, call them Shop B"},
        "overrides": [
            {"from_day": 5, "shop": "simffee",
             "set": {"open": "06:00", "products": ["latte", "americano", "cold_brew", "croissant"],
                     "price.croissant": 30000}},
            {"from_day": 5, "shop": "simffee", "unset": ["price.latte"]},
            {"from_day": 5, "shop": "starbucks", "set": {"prompt.shop_label": "Shop B"}},
            {"from_day": 7, "shop": "starbucks", "unset": ["prompt.shop_label"]},
        ]})
    chain = load_chain("u1", extra={"u1": adhoc})
    check("chain resolves through `extra`", [s.id for s in chain], ["baseline", "u1"])
    check("days: child wins", scenario_days(chain), 10)
    check("days: v1 default when unset", scenario_days(load_chain("cf_discount")), 7)
    d4, d5, d7 = (resolve(shops, chain, d) for d in (4, 5, 7))
    check("day 4 still the parent's world", (d4["simffee"]["open"], d4["simffee"]["price"]["latte"]), ("07:00", 48000))
    check("unset restores the base price", d5["simffee"]["price"]["latte"], 45000)
    check("new item gets a creatable price leaf", d5["simffee"]["price"]["croissant"], 30000)
    check("shop_label is text only: name untouched", d5["starbucks"]["name"], "Starbucks")
    check("display_name follows the label", display_name(d5["starbucks"]), "Shop B")
    check("unset of a created key removes it", display_name(d7["starbucks"]), "Starbucks")
    check("v1 shops carry no prompt block", "prompt" in resolve(shops, load_chain("baseline"), 5)["starbucks"], False)
    try:
        resolve(shops, [scenario_from_dict({"id": "bad", "parent": None,
                                            "overrides": [{"from_day": 2, "shop": "simffee", "set": {"wifi": True}}]})], 3)
        check("unknown field is rejected", "no error", "KeyError")
    except KeyError:
        check("unknown field is rejected", "KeyError", "KeyError")
    try:
        scenario_from_dict({"id": "bad", "overrides": [{"from_day": 0, "shop": "simffee", "set": {}}]})
        check("from_day 0 is rejected", "no error", "ValueError")
    except ValueError:
        check("from_day 0 is rejected", "ValueError", "ValueError")
    with tempfile.TemporaryDirectory() as tmp:
        p = pathlib.Path(tmp) / "u1.json"
        p.write_text(json.dumps({"id": "u1", "parent": "baseline", "overrides": []}))
        check("load_scenario_file", load_scenario_file(p).id, "u1")

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
