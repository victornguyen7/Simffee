"""Live accuracy check for engine/translate.py — needs XAI_API_KEY (ROADMAP A2).

    python3 tools/check_translate_live.py            # ~12 calls first time, cached after
    python3 tools/check_translate_live.py --no-cache # force fresh calls

Each case says what the plan *must* contain (a subset of the compiled `set`/`unset`) or
that it must be unsupported. Prints a table and a score; exits 1 below the floor.
"""

import argparse
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import translate  # noqa: E402

CASES = [
    # (sentence, expected: {shop: {field: value}} across all overrides, or "unsupported")
    ("open at 6", {"simffee": {"open": "06:00"}}),
    ("cut the latte to 40k", {"simffee": {"price.latte": 40000}}),
    ("raise the wait to 10 minutes", {"simffee": {"avg_wait_min": 10}}),
    ("drop cold brew from the menu", {"simffee": {"products": ["latte", "americano"]}}),
    # the shop is at 07:00 on day 4, so "an hour earlier" is 06:00, not 05:30
    ("open an hour earlier and sell croissants at 30k",
     {"simffee": {"open": "06:00", "price.croissant": 30000}}),
    ("go back to opening at 6:30 but keep the new price", {"simffee": {"open": "06:30"}}),
    ("put the latte price back to what it was", {"simffee": {"unset": ["price.latte"]}}),
    ("undo everything we changed on day 4", {"simffee": {"unset": ["open", "price.latte"]}}),
    ("run a big ad campaign, double our reach", {"simffee": {"marketing.reach": 0.3}}),
    ("Starbucks raises their latte to 70k", {"starbucks": {"price.latte": 70000}}),
    ("Starbucks closes down", {"starbucks": {"permanently_closed": True}}),
    ("add a loyalty card", "unsupported"),
    ("Starbucks opens across the street on day 4", {"starbucks": {"exists_from_day": 4}}),
    ("host live music on friday nights", "unsupported"),
]

FLOOR = 0.75


def flatten(scenario):
    out = {}
    for ov in scenario["overrides"]:
        shop = out.setdefault(ov["shop"], {})
        shop.update(ov.get("set", {}))
        if ov.get("unset"):
            shop["unset"] = sorted(set(shop.get("unset", [])) | set(ov["unset"]))
    return out


def matches(got, want):
    for shop, fields in want.items():
        if shop not in got:
            return False
        for k, v in fields.items():
            g = got[shop].get(k)
            if k == "unset":
                if not set(v) <= set(g or []):
                    return False
            elif k == "products":
                if g is None or sorted(g) != sorted(v):
                    return False
            elif isinstance(v, float):
                if g is None or abs(float(g) - v) > 0.06:
                    return False
            elif g != v:
                return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()
    cache_dir = pathlib.Path(tempfile.mkdtemp()) if args.no_cache else translate.TRANSLATION_CACHE

    from engine.llm import available
    if not available():
        print("no xAI client (XAI_API_KEY missing) — this check is live-only")
        return 2

    hits, calls = 0, 0
    for text, want in CASES:
        out = translate.translate(text, complete_json=None, cache_dir=cache_dir)
        calls += out["attempts"]
        sc = out["scenario"]
        if want == "unsupported":
            ok = sc is None and bool(out["unsupported"])
            shown = "unsupported: " + (out["unsupported"][0]["reason"][:70] if out["unsupported"] else "(no reason)")
        else:
            ok = sc is not None and matches(flatten(sc), want)
            shown = json.dumps(flatten(sc), ensure_ascii=False) if sc else f"NO SCENARIO {out['problems'][:1]}"
        hits += ok
        print(f"  {'ok ' if ok else 'MISS'}  {text!r:52} -> {shown[:110]}")
        if sc and sc.get("unsupported") and want != "unsupported":
            print(f"        also unsupported: {[u['text'] for u in sc['unsupported']]}")
    score = hits / len(CASES)
    print(f"\n{hits}/{len(CASES)} = {score:.0%}  ({calls} model calls)   floor {FLOOR:.0%}")
    return 0 if score >= FLOOR else 1


if __name__ == "__main__":
    sys.exit(main())
