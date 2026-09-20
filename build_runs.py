"""runs/ + data/ -> public/runs.json, the one file the frontend reads (BACKEND_PLAN 2.3).

    python3 build_runs.py                  # from fixtures
    python3 build_runs.py runs             # from B1's real output

Everything here is computed from rows by analyzer/. `narration` is the one remaining
gap: it needs a live LLM call (SPEC 6.6) and stays null until then.
"""

import argparse
import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from analyzer import attribution, breakpoint, confidence, impact, narrate, pairwise  # noqa: E402
from engine.schema import coverage  # noqa: E402
from tools.validate import check_file  # noqa: E402

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


def build_analysis(base, shops, scenario_files, twins, groups=None):
    """SPEC 6 — compute conclusions only from a complete set of trajectories."""
    if groups is None:
        groups = {sid: [load_rows(base, sid, seed) for seed in SEEDS] for sid in SCENARIO_LABELS}
    reports = {sid: {str(seed): coverage(rs) for seed, rs in zip(SEEDS, runs)}
               for sid, runs in groups.items()}
    complete = all(r["complete"] for seeds in reports.values() for r in seeds.values())
    if not complete:
        return {
            "complete": False, "coverage": reports, "break_day": None, "drop": None,
            "reason": "incomplete trajectories: fallback decisions prevent causal conclusions",
            "naive": None, "actual": None, "surprise": None, "impact": None,
            "evidence": [], "confidence": {"value": None, "unmeasured": True,
                                           "reason": "incomplete trajectories"},
            "narration": None, "whatif": [],
        }
    baseline = groups["baseline"][SEEDS.index(DEFAULT_SEED)]
    control = groups["cf_null"][SEEDS.index(DEFAULT_SEED)]

    brk = breakpoint.find_break(baseline, control, SHOP, DAYS)
    break_day = brk["break_day"]
    if break_day is None:
        return {"complete": True, "coverage": reports, "break_day": None,
                "narration": None, "reason": "no day fell far enough below its trailing average"}

    active = [o for o in scenario_files["baseline"]["overrides"] if o["from_day"] <= break_day]
    naive = attribution.naive_read(active, shops)
    actual = attribution.actual_driver(baseline, break_day)
    imp = impact.impact(baseline, control, SHOP, DAYS)
    conf = confidence.confidence(groups["baseline"], break_day, twins, DEFAULT_SEED)

    return {
        "complete": True, "coverage": reports,
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
        "confidence": conf,
        "narration": None,   # filled by _narrate below, which needs the assembled block
        "whatif": [_whatif(base, s, baseline, imp["lost_twins"], scenario_files[s], twins, groups[s])
                   for s in WHATIF_ORDER],
    }


def _whatif(base, scenario, baseline, lost_twins, scenario_file, twins, by_seed=None):
    """One what-if button: returns/of from seed 0, confidence from all seeds (SPEC 6.5)."""
    if by_seed is None:
        by_seed = [load_rows(base, scenario, s) for s in SEEDS]
    ret = pairwise.returns(baseline, by_seed[SEEDS.index(DEFAULT_SEED)], SHOP, DAYS)
    conf = confidence.whatif_confidence(by_seed, lost_twins, from_day(scenario_file), DAYS,
                                        twins, DEFAULT_SEED)
    return {
        "scenario": scenario,
        "label": SCENARIO_LABELS[scenario],
        "returns": ret["returns"],
        "of": ret["of"],
        "returned": ret["returned"],
        "confidence": conf["value"],
        "confidence_detail": {k: conf.get(k) for k in ("stability", "support", "unmeasured", "reason", "partial", "detail")},
    }


def _narrate(analysis):
    """SPEC 6.6. Deterministic facts only; never constructs an LLM client."""
    result = narrate.narrate(analysis)
    analysis["narration"] = result["narration"]
    analysis["narration_source"] = result["source"]
    analysis["narration_reason"] = result["rejected"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", type=pathlib.Path, default=ROOT / "tests/fixtures/runs")
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    ap.add_argument("--offline", action="store_true", help="explicitly offline; all bundle builds are local")
    ap.add_argument("--require-complete", action="store_true", help="refuse fallbacks or missing/mixed provenance")
    ap.add_argument("--synthetic", action="store_true", help="label stubbed/test trajectories; never publishable")
    args = ap.parse_args()
    base = args.base
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

    errors = []
    for sid in SCENARIO_LABELS:
        for seed in SEEDS:
            path = base / sid / f"{seed}.jsonl"
            if not path.exists():
                errors.append(f"missing trajectory: {path}")
                continue
            check_file(path, set(twin_records), set(shops), errors)
    if errors:
        print(f"invalid input: {len(errors)} errors; first: {errors[0]}")
        return 1

    scenarios = {}
    all_rows = []
    for sid, sc in scenario_files.items():
        seeds = {}
        for seed in SEEDS:
            rows = load_rows(base, sid, seed)
            if any(r["scenario"] != sid or r["seed"] != seed for r in rows):
                print(f"trajectory identity mismatch: {sid}/{seed}")
                return 1
            all_rows.extend(rows)
            seeds[str(seed)] = {"rows": rows, "daily_sales": daily_sales(rows, shops), "coverage": coverage(rows)}
        scenarios[sid] = {
            "label": SCENARIO_LABELS[sid],
            "parent": sc.get("parent"),
            "from_day": from_day(sc),
            "seeds": seeds,
        }

    report = coverage(all_rows)
    verified = report["complete"] and report["provenance_complete"]
    if args.require_complete and not verified:
        print(f"INCOMPLETE: {report['fallbacks']} fallbacks; {report['missing_provenance']} decisions lack provenance; models {report['models']}")
        return 2
    synthetic = args.synthetic or base.resolve() == (ROOT / "tests/fixtures/runs").resolve() or any(m.startswith("test-") for m in report["models"])
    doc = {
        "meta": {
            "twins": len(list((DATA / "twins").glob("*.json"))),
            "days": DAYS,
            "seeds": SEEDS,
            "default_seed": DEFAULT_SEED,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "synthetic_label": SYNTHETIC_LABEL,
            "coverage": report, "synthetic_run": synthetic,
            "publishable": verified and not synthetic,
        },
        "shops": shops,
        "twins": build_twins(),
        "scenarios": scenarios,
        "analysis": build_analysis(base, shops, scenario_files, twin_records,
                                   {sid: [sc["seeds"][str(seed)]["rows"] for seed in SEEDS]
                                    for sid, sc in scenarios.items()}),
    }
    _narrate(doc["analysis"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size = args.out.stat().st_size
    print(f"wrote {args.out}  {size / 1024:.0f} KB  "
          f"({len(scenarios)} scenarios x {len(SEEDS)} seeds)")
    if size > 2_000_000:
        print("WARNING: over the ~2MB budget (BACKEND_PLAN 4). Ship seed 0 only for cf_* branches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
