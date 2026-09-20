"""runs/ + data/ -> public/runs.json, the one file the frontend reads (BACKEND_PLAN 2.3).

    python3 build_runs.py                  # from fixtures
    python3 build_runs.py runs             # from B1's real output

Everything here is computed from rows by analyzer/. `narration` is the one remaining
gap: it needs a live LLM call (SPEC 6.6) and stays null until then.
"""

import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from analyzer import attribution, breakpoint, confidence, impact, pairwise  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "runs.json"
SHOP = "simffee"

SEEDS = [0, 1, 2, 3, 4]
DEFAULT_SEED = 0
DAYS = 7

SYNTHETIC_LABEL = ("Synthetic seed population — 10 synthetic twins, not real people. "
                   "Results are a pre-testing signal, not a prediction.")

SCENARIO_LABELS = {
    "baseline": "What we shipped",
    "cf_null": "If unchanged",
    "cf_discount": "Cut prices 15%",
    "cf_restore_hours": "Reopen at 06:30",
}

WHATIF_ORDER = ["cf_restore_hours", "cf_discount"]


def load_rows(base, scenario, seed):
    path = base / scenario / f"{seed}.jsonl"
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def daily_sales(rows, shops):
    out = {s: [0] * DAYS for s in shops}
    for r in rows:
        if r["choice"] in out:
            out[r["choice"]][r["day"] - 1] += r["spent"]
    return out


def from_day(scenario):
    if not scenario["overrides"]:
        return 1
    return min(o["from_day"] for o in scenario["overrides"])


def build_twins():
    out = []
    for f in sorted((DATA / "twins").glob("*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        out.append({
            "id": t["id"],
            "name": t["name"],
            "home": t["home"],
            "profile": t["profile"],
            "why_excerpt": t["why_transcript"][:3],
            "say_do_gap": t["say_do_gap"],
        })
    return out


def build_analysis(base, shops, scenario_files, twins):
    """SPEC 6 — everything here is computed from rows. `narration` is the only gap."""
    baseline = load_rows(base, "baseline", DEFAULT_SEED)
    control = load_rows(base, "cf_null", DEFAULT_SEED)

    brk = breakpoint.find_break(baseline, control, SHOP, DAYS)
    break_day = brk["break_day"]
    if break_day is None:
        return {"break_day": None, "reason": "no day fell far enough below its trailing average"}

    active = [o for o in scenario_files["baseline"]["overrides"] if o["from_day"] <= break_day]
    naive = attribution.naive_read(active, shops)
    actual = attribution.actual_driver(baseline, break_day)
    imp = impact.impact(baseline, control, SHOP, DAYS)
    conf = confidence.confidence([load_rows(base, "baseline", s) for s in SEEDS],
                                 break_day, twins, DEFAULT_SEED)

    return {
        "break_day": break_day,
        "drop": brk["drop"],
        "naive": {k: naive[k] for k in ("driver", "magnitude", "label")},
        "actual": {"driver": actual["driver"], "histogram": actual["histogram"],
                   "switchers": actual["switchers"]},
        "surprise": attribution.compare(naive, actual)["surprise"],
        "impact": {
            "lost_total": imp["lost_total"],
            "lost_by_decision": imp["lost_by_decision"],
            "lost_anyway": imp["lost_anyway"],
            "per_twin": imp["per_twin"],
        },
        "evidence": attribution.select_evidence(baseline, break_day, actual["driver"], SHOP),
        "confidence": {k: conf[k] for k in ("value", "stability", "support", "unmeasured")
                       if k in conf} | {"reason": conf.get("reason")},
        "narration": None,
        "whatif": [{"scenario": s,
                    "label": SCENARIO_LABELS[s],
                    **{k: v for k, v in pairwise.returns(baseline, load_rows(base, s, DEFAULT_SEED),
                                                         SHOP, DAYS).items()
                       if k in ("returns", "of", "returned")}}
                   for s in WHATIF_ORDER],
    }


def main():
    base = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/runs")
    if not base.exists():
        print(f"no such directory: {base}")
        return 1

    shops = json.loads((DATA / "shops.json").read_text(encoding="utf-8"))
    scenario_files = {f.stem: json.loads(f.read_text(encoding="utf-8"))
                      for f in sorted((DATA / "scenarios").glob("*.json"))}

    twin_records = {}
    for f in sorted((DATA / "twins").glob("*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        twin_records[t["id"]] = t

    scenarios = {}
    for sid, sc in scenario_files.items():
        seeds = {}
        for seed in SEEDS:
            rows = load_rows(base, sid, seed)
            seeds[str(seed)] = {"rows": rows, "daily_sales": daily_sales(rows, shops)}
        scenarios[sid] = {
            "label": SCENARIO_LABELS[sid],
            "parent": sc.get("parent"),
            "from_day": from_day(sc),
            "seeds": seeds,
        }

    doc = {
        "meta": {
            "twins": len(list((DATA / "twins").glob("*.json"))),
            "days": DAYS,
            "seeds": SEEDS,
            "default_seed": DEFAULT_SEED,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "synthetic_label": SYNTHETIC_LABEL,
        },
        "shops": shops,
        "twins": build_twins(),
        "scenarios": scenarios,
        "analysis": build_analysis(base, shops, scenario_files, twin_records),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)}  {size / 1024:.0f} KB  "
          f"({len(scenarios)} scenarios x {len(SEEDS)} seeds)")
    if size > 2_000_000:
        print("WARNING: over the ~2MB budget (BACKEND_PLAN 4). Ship seed 0 only for cf_* branches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
