"""runs/ + data/ -> public/runs.json, the one file the frontend reads (BACKEND_PLAN 2.3).

    python3 build_runs.py                  # from fixtures
    python3 build_runs.py runs             # from B1's real output

Structure (meta, shops, twins, scenarios, daily_sales) is computed from the rows here.
The `analysis` block is still read from the fixture oracle; analyzer/ replaces that at
hour 2-4 and nothing else about this file changes.
"""

import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "runs.json"
ORACLE = ROOT / "tests" / "fixtures" / "expected_analysis.json"

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


def build_analysis(base, shops):
    """Placeholder: reshapes the fixture oracle into the 2.3 contract.

    analyzer/ computes every one of these from rows at hour 2-4. Frontend should not
    need to change when that happens.
    """
    oracle = json.loads(ORACLE.read_text(encoding="utf-8"))
    rows = load_rows(base, "baseline", DEFAULT_SEED)
    by_key = {(r["twin"], r["day"]): r for r in rows}
    break_day = oracle["break_day"]

    return {
        "break_day": break_day,
        "naive": oracle["naive"],
        "actual": oracle["actual"],
        "surprise": oracle["surprise"],
        "impact": {
            "lost_total": oracle["impact"]["lost_total"],
            "lost_by_decision": oracle["impact"]["lost_by_decision"],
            "lost_anyway": oracle["impact"]["lost_anyway"],
            "per_twin": [{"twin": t,
                          "baseline": by_key[(t, DAYS)]["choice"],
                          "cf_null": next(r["choice"] for r in load_rows(base, "cf_null", DEFAULT_SEED)
                                          if r["twin"] == t and r["day"] == DAYS)}
                         for t in oracle["impact"]["lost_twins"]],
        },
        "evidence": [
            dict(by_key[("T01", break_day)], kind="switcher"),
            dict(by_key[("T08", break_day)], kind="resisted"),
        ],
        "confidence": {"value": None, "stability": None, "support": None},
        "narration": None,
        "whatif": [{"scenario": s,
                    "label": SCENARIO_LABELS[s],
                    "returns": oracle["whatif"][s]["returns"],
                    "of": oracle["whatif"][s]["of"],
                    "confidence": None}
                   for s in WHATIF_ORDER],
        "_source": "fixture oracle; replaced by analyzer/ at hour 2-4",
    }


def main():
    base = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/runs")
    if not base.exists():
        print(f"no such directory: {base}")
        return 1

    shops = json.loads((DATA / "shops.json").read_text(encoding="utf-8"))
    scenario_files = {f.stem: json.loads(f.read_text(encoding="utf-8"))
                      for f in sorted((DATA / "scenarios").glob("*.json"))}

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
        "analysis": build_analysis(base, shops),
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
