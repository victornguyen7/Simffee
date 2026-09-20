"""engine/translate.py against a stubbed transport — no API key (ROADMAP A2).

    python3 tests/test_translate.py

What is under test is everything *after* the model: compile, validate, retry-with-feedback,
partial plans, caching, and the unsupported path. The model's own accuracy is checked live
by tools/check_translate_live.py.
"""

import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import translate  # noqa: E402
from engine.loader import load_chain, load_shops, scenario_from_dict  # noqa: E402
from engine.resolve import resolve  # noqa: E402

failures = []


def check(name, got, want):
    if got == want:
        print(f"  pass  {name}")
    else:
        print(f"  FAIL  {name}\n          got  {got}\n          want {want}")
        failures.append(name)


def act(action, shop="simffee", from_day=5, item=None, value=None):
    return {"action": action, "shop": shop, "from_day": from_day, "item": item, "value": value}


def reply(actions, label="test", situation="incumbent_change", unsupported=(), focus="simffee"):
    return {"situation": situation, "focus_shop": focus, "label": label,
            "actions": actions, "unsupported": list(unsupported)}


def stub(replies):
    seen = []

    def transport(system, user, schema, temperature):
        seen.append({"user": user, "temperature": temperature})
        if not replies:
            raise RuntimeError("stub exhausted")
        return replies.pop(0), {"input_tokens": 0, "output_tokens": 0}
    transport.seen = seen
    return transport


def main():
    shops = load_shops()
    actions = translate.load_actions()
    chain = load_chain("baseline")

    def compile_(r):
        return translate.compile_actions(r, chain, shops, actions, "u", "text")

    print("compile: one action per kind")
    cases = {
        "set_open": (act("set_open", value="6am"), {"open": "06:00"}),
        "set_close": (act("set_close", value="21:30"), {"close": "21:30"}),
        "set_price": (act("set_price", item="latte", value="40k"), {"price.latte": 40000}),
        "set_price numeric": (act("set_price", item="americano", value=30000), {"price.americano": 30000}),
        "add_item": (act("add_item", item="Croissant", value="30k"),
                     {"products": ["latte", "americano", "cold_brew", "croissant"], "price.croissant": 30000}),
        "drop_item": (act("drop_item", item="cold_brew"), {"products": ["latte", "americano"]}),
        "set_wait": (act("set_wait", value=2), {"avg_wait_min": 2}),
        "set_quality": (act("set_quality", value="85%"), {"quality": 0.85}),
        "set_marketing_reach": (act("set_marketing_reach", value=0.4), {"marketing.reach": 0.4}),
        "set_marketing_message": (act("set_marketing_message", value="Fresh croissants at 6"),
                                  {"marketing.message": "Fresh croissants at 6"}),
        "close_permanently (competitor)": (act("close_permanently", shop="starbucks"), {"permanently_closed": True}),
    }
    for name, (a, want_set) in cases.items():
        sc, problems = compile_(reply([a]))
        check(name, (problems, sc["overrides"][0]["set"] if sc else None), ([], want_set))

    print("\ncompile: restore")
    sc, problems = compile_(reply([act("restore", value="open"), act("restore", value="price.latte")]))
    check("restore -> unset of fields the chain changed", (problems, sc["overrides"][0].get("unset")),
          ([], ["open", "price.latte"]))
    sc, problems = compile_(reply([act("restore", value="latte")]))
    check("loose restore: 'latte' -> price.latte", (problems, sc["overrides"][0].get("unset")), ([], ["price.latte"]))
    sc, problems = compile_(reply([act("restore", value="hours")]))
    check("loose restore: 'hours' -> open", (problems, sc["overrides"][0].get("unset")), ([], ["open"]))
    sc, problems = compile_(reply([act("restore", value="quality")]))
    check("restore of a never-changed field is rejected", bool(problems) and sc is None, True)
    d5 = resolve(shops, chain + [scenario_from_dict(compile_(reply([act("restore", value="open")]))[0])], 5)
    check("restored open is the base value", d5["simffee"]["open"], "06:30")

    print("\ncompile: grouping, days, ordering")
    sc, problems = compile_(reply([
        act("set_open", value="06:00"), act("add_item", item="croissant", value=30000),
        act("set_price", shop="starbucks", item="latte", value=70000, from_day=8),
    ], situation="mixed"))
    check("no problems", problems, [])
    check("same shop+day merge into one block", len(sc["overrides"]), 2)
    check("blocks ordered by day", [o["from_day"] for o in sc["overrides"]], [5, 8])
    check("days extend past the last action", sc["days"], 10)
    check("situation carried", sc["situation"], "mixed")
    check("source carries the sentence", sc["source"]["text"], "text")
    check("role is whatif, parent is baseline", (sc["role"], sc["parent"]), ("whatif", "baseline"))
    sc, _ = compile_(reply([act("set_open", value="06:00")]))
    check("default days stay at the parent's", sc["days"], 7)

    print("\ncompile: add then price the new item in the same plan")
    sc, problems = compile_(reply([act("add_item", item="croissant", value=30000),
                                   act("set_price", item="croissant", value=28000)]))
    check("new item may be re-priced", (problems, sc["overrides"][0]["set"]["price.croissant"]), ([], 28000))

    print("\nvalidate: rejections")
    rejects = {
        "unknown action": reply([{**act("set_open", value="06:00"), "action": "teleport"}]),
        "unknown shop": reply([act("set_open", shop="kiosk", value="06:00")]),
        "from_day 1": reply([act("set_open", value="06:00", from_day=1)]),
        "bad time": reply([act("set_open", value="soonish")]),
        "price outside 0.3x-3x": reply([act("set_price", item="latte", value=500)]),
        "price for item not on menu": reply([act("set_price", item="frappuccino", value=60000)]),
        "drop item not on menu": reply([act("drop_item", item="frappuccino")]),
        "wait out of range": reply([act("set_wait", value=90)]),
        "quality out of range": reply([act("set_quality", value=1.7)]),
        "too many actions": reply([act("set_wait", value=i) for i in range(1, 9)]),
        "unknown field via add_item name only": reply([act("add_item", item="wifi", value=None)]),
        "no actions at all": reply([]),
    }
    for name, r in rejects.items():
        sc, problems = compile_(r)
        check(name, bool(problems), True)

    print("\ntranslate(): stub transport, caching, retry, partial, unsupported")
    with tempfile.TemporaryDirectory() as tmp:
        cache = pathlib.Path(tmp)
        good = reply([act("set_open", value="06:00"), act("add_item", item="croissant", value=30000)],
                     label="Open at six with croissants")
        t = stub([good])
        out = translate.translate("open at 6 and sell croissants", complete_json=t, cache_dir=cache)
        check("scenario produced", out["scenario"] is not None and out["problems"] == [], True)
        check("label from the model", out["scenario"]["label"], "Open at six with croissants")
        check("one attempt, low temperature", (out["attempts"], t.seen[0]["temperature"]), (1, 0.3))
        check("prompt shows the shops as they stand on day 4",
              "open 07:00" in t.seen[0]["user"] and "latte 48,000" in t.seen[0]["user"], True)
        check("prompt lists the menu and the not-on-menu examples",
              "set_open" in t.seen[0]["user"] and "loyalty" in t.seen[0]["user"], True)
        t2 = stub([])
        out2 = translate.translate("open at 6 and sell croissants", complete_json=t2, cache_dir=cache)
        check("second call is served from cache, zero transport", (out2["cached"], t2.seen), (True, []))
        check("cached scenario identical", out2["scenario"]["overrides"], out["scenario"]["overrides"])

        bad_then_good = [reply([act("set_price", item="latte", value=500)]),
                         reply([act("set_price", item="latte", value=40000)])]
        t = stub(bad_then_good)
        out = translate.translate("cut the latte", complete_json=t, cache_dir=cache)
        check("retry after a validation problem", (out["attempts"], out["problems"]), (2, []))
        check("retry prompt carries the problem", "outside" in t.seen[1]["user"], True)
        check("retry at temperature 0", t.seen[1]["temperature"], 0.0)

        partial = reply([act("set_open", value="06:00"), act("set_wait", value=90)])
        t = stub([partial, partial])
        out = translate.translate("open at 6 and cut the wait to 90", complete_json=t, cache_dir=cache)
        check("partial plan runs what compiled", out["scenario"] is not None
              and out["scenario"]["overrides"][0]["set"] == {"open": "06:00"}, True)
        check("...and reports the rest as unsupported", any("wait" in u["reason"] for u in out["unsupported"]), True)
        check("partial plans are not cached", len(list(cache.glob("*.json"))), 2)

        unsup = reply([], situation="unsupported",
                      unsupported=[{"text": "add a loyalty card", "reason": "no reward state yet", "nearest": None}])
        t = stub([unsup])
        out = translate.translate("add a loyalty card", complete_json=t, cache_dir=cache)
        check("fully unsupported: no scenario, one attempt, reason kept",
              (out["scenario"], out["attempts"], out["unsupported"][0]["reason"]), (None, 1, "no reward state yet"))

        def broken(*a, **k):
            raise RuntimeError("no key")
        out = translate.translate("anything", complete_json=broken, cache_dir=cache)
        check("dead transport: no scenario, says why", (out["scenario"], out["problems"][0].startswith("transport failed")),
              (None, True))

    print("\nvalue parsing")
    check("40k", translate._as_int("40k"), 40000)
    check("45.5k", translate._as_int("45.5k"), 45500)
    check("6am", translate._as_time("6am"), "06:00")
    check("6:45 pm", translate._as_time("6:45 pm"), "18:45")
    check("18", translate._as_time("18"), "18:00")
    check("85%", translate._as_fraction("85%"), 0.85)
    check("0.4", translate._as_fraction(0.4), 0.4)
    check("40 (as percent)", translate._as_fraction(40), 0.4)
    check("slug", translate.slug("Cold Brew!"), "cold_brew")

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
