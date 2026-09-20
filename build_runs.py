"""runs/ + data/ -> a runs.json bundle, the one file the frontend reads (BACKEND_PLAN 2.3).

    python3 build_runs.py                                  # fixtures -> public/runs.json
    python3 build_runs.py RUN_DIR --out X.json             # any run directory
    python3 build_runs.py RUN_DIR --seeds 0-2 --out X.json # fewer seeds (3 is the confidence floor)

Scenario-agnostic (SPEC_FUNCTIONAL 6): the scenario set, their labels, which one is the
baseline / control / what-if, the focus shop, and the run length all come from
data/scenarios/*.json. Nothing here names a shop or a scenario.

Everything is computed from rows by analyzer/. Narration is deterministic.
"""

import argparse
import datetime
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from analyzer import attribution, breakpoint, confidence, flows, impact, narrate, pairwise  # noqa: E402
from analyzer.templates import entrant_of, question_for  # noqa: E402
from engine.schema import coverage  # noqa: E402
from tools.validate import check_file  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "runs.json"

SEEDS = [0, 1, 2, 3, 4]
DEFAULT_SEED = 0
DAYS = 7
MIN_SEEDS_MEASURED = 3

SYNTHETIC_LABEL = ("Synthetic seed population — 10 synthetic twins, not real people. "
                   "Results are a pre-testing signal, not a prediction.")


# --- scenario set -------------------------------------------------------------------------

def load_scenarios(path=DATA / "scenarios", bundle_only=True):
    """Scenario files by id, in `order`. `bundle: false` marks a scenario that is run on
    demand (the S2 situation family, ablations) rather than promoted into runs.json; the
    engine CLI still discovers it, the bundle and the library API skip it."""
    files = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted(path.glob("*.json"))}
    if bundle_only:
        files = {k: v for k, v in files.items() if v.get("bundle", True)}
    return dict(sorted(files.items(), key=lambda kv: (kv[1].get("order", 99), kv[0])))


def roles(scenario_files):
    """Which scenario is the baseline, which the control, which are what-ifs.

    Explicit `role` wins. Fallbacks keep v1 data working: a parentless scenario called
    `baseline`, a parentless one called `cf_null`, and every child of the baseline.
    """
    by_role = {}
    for sid, sc in scenario_files.items():
        by_role.setdefault(sc.get("role"), []).append(sid)
    baseline = (by_role.get("baseline") or [s for s in ("baseline",) if s in scenario_files]
                or [s for s, sc in scenario_files.items() if sc.get("parent") is None and sc["overrides"]])
    if not baseline:
        raise ValueError("no baseline scenario: set role: baseline in one scenario file")
    baseline = baseline[0]
    control = (by_role.get("control") or [s for s in ("cf_null",) if s in scenario_files] or [None])[0]
    whatifs = by_role.get("whatif") or [s for s, sc in scenario_files.items()
                                        if sc.get("parent") == baseline and s != control]
    return {"baseline": baseline, "control": control, "whatifs": whatifs}


def focus_shop(scenario_files, shops, baseline_id):
    return scenario_files[baseline_id].get("focus_shop") or next(iter(shops))


def run_days(scenario_files, baseline_id):
    return int(scenario_files[baseline_id].get("days", DAYS))


def parse_seeds(text):
    out = []
    for part in str(text).split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return sorted(set(out))


# --- rows ---------------------------------------------------------------------------------

def load_rows(base, scenario, seed):
    path = base / scenario / f"{seed}.jsonl"
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def daily_sales(rows, shops, days=DAYS):
    out = {s: [0] * days for s in shops}
    for r in rows:
        if r["choice"] in out and 1 <= r["day"] <= days:
            out[r["choice"]][r["day"] - 1] += r["spent"]
    return out


def from_day(scenario):
    from engine.loader import scenario_from_dict
    return scenario_from_dict(scenario).from_day


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


# --- analysis -----------------------------------------------------------------------------

def _incomplete(reports, reason, question=None, flow=None, hero_agreement=None):
    return {
        "complete": False, "coverage": reports, "break_day": None, "drop": None,
        "direction": None, "reason": reason,
        "naive": None, "actual": None, "surprise": None, "impact": None,
        "evidence": [], "confidence": {"value": None, "unmeasured": True, "reason": reason},
        "narration": None, "whatif": [],
        "question": question, "flows": flow, "hero_agreement": hero_agreement,
    }


def _hero_agreement(scenario_files, groups, seeds):
    """ROADMAP B6 — for every `role: ablation` scenario whose `compare_to` is also in the
    run set: per-seed agreement with it, and the mean. Absent when nothing is an ablation."""
    out = {}
    for sid, sc in scenario_files.items():
        other = sc.get("compare_to")
        if sc.get("role") != "ablation" or other not in groups or sid not in groups:
            continue
        per_seed = {str(seed): flows.agreement(a, b) for seed, a, b in zip(seeds, groups[other], groups[sid])}
        values = [v["value"] for v in per_seed.values() if v["value"] is not None]
        re_values = [v["reappraisal_value"] for v in per_seed.values() if v["reappraisal_value"] is not None]
        out[sid] = {
            "compare_to": other, "label": sc.get("label", sid),
            "value": round(sum(values) / len(values), 3) if values else None,
            "reappraisal_value": round(sum(re_values) / len(re_values), 3) if re_values else None,
            "seeds": per_seed,
        }
    return out or None


def build_analysis(base, shops, scenario_files, twins, groups=None, seeds=None):
    """SPEC 6 — compute conclusions only from a complete set of trajectories.

    `groups` maps scenario id -> list of row lists, one per seed, in `seeds` order.
    """
    seeds = list(seeds or SEEDS)
    role = roles(scenario_files)
    shop = focus_shop(scenario_files, shops, role["baseline"])
    days = run_days(scenario_files, role["baseline"])
    default_ix = seeds.index(DEFAULT_SEED) if DEFAULT_SEED in seeds else 0

    if groups is None:
        groups = {sid: [load_rows(base, sid, seed) for seed in seeds] for sid in scenario_files}
    reports = {sid: {str(seed): coverage(rs, int(scenario_files[sid].get("days", days)))
                     for seed, rs in zip(seeds, runs)}
               for sid, runs in groups.items()}
    baseline = groups[role["baseline"]][default_ix]
    # ROADMAP B3 / §2: flows and the question template are generic and need no causal
    # completeness, so they are reported even when the rest is withheld.
    question = question_for(scenario_files, role["baseline"], shop)
    flow = flows.flows(baseline, shop, days)
    hero = _hero_agreement(scenario_files, groups, seeds)
    if not all(r["complete"] for per_seed in reports.values() for r in per_seed.values()):
        return _incomplete(reports, "incomplete trajectories: fallback decisions prevent causal conclusions",
                           question, flow, hero)

    control = groups[role["control"]][default_ix] if role["control"] else []

    brk = breakpoint.find_break(baseline, control, shop, days)
    break_day = brk["break_day"]
    if break_day is None:
        return {"complete": True, "coverage": reports, "focus_shop": shop, "break_day": None,
                "direction": None, "narration": None,
                "reason": "no day moved far enough from its trailing average",
                "question": question, "flows": flow, "hero_agreement": hero}

    active = [o for o in scenario_files[role["baseline"]]["overrides"] if o["from_day"] <= break_day]
    naive = attribution.naive_read(active, shops)
    actual = attribution.actual_driver(baseline, break_day)
    imp = impact.impact(baseline, control, shop, days)
    conf = confidence.confidence(groups[role["baseline"]], break_day, twins, DEFAULT_SEED)
    if len(seeds) < MIN_SEEDS_MEASURED and not conf.get("unmeasured"):
        conf = {**conf, "value": None, "unmeasured": True,
                "reason": f"{len(seeds)} seed(s) — run {MIN_SEEDS_MEASURED} for confidence"}

    return {
        "complete": True, "coverage": reports,
        "focus_shop": shop,
        "control": role["control"],
        "break_day": break_day,
        "drop": brk["drop"],
        "direction": brk["direction"],
        "magnitude": brk["magnitude"],
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
        "evidence": attribution.select_evidence(baseline, break_day, actual["driver"], shop),
        "confidence": conf,
        "narration": None,   # filled by _narrate below, which needs the assembled block
        "whatif": [_whatif(s, scenario_files[s], baseline, imp["lost_twins"], twins,
                           groups[s], shop, days, seeds)
                   for s in role["whatifs"]],
        "question": question,
        "flows": flow,
        "hero_agreement": hero,
    }


def _whatif(scenario, scenario_file, baseline, lost_twins, twins, by_seed, shop, days, seeds):
    """One what-if button: returns/of from the default seed, confidence from all seeds (SPEC 6.5)."""
    default_ix = seeds.index(DEFAULT_SEED) if DEFAULT_SEED in seeds else 0
    ret = pairwise.returns(baseline, by_seed[default_ix], shop, days)
    conf = confidence.whatif_confidence(by_seed, lost_twins, from_day(scenario_file), days,
                                        twins, DEFAULT_SEED)
    if len(seeds) < MIN_SEEDS_MEASURED and not conf.get("unmeasured"):
        conf = {**conf, "value": None, "unmeasured": True,
                "reason": f"{len(seeds)} seed(s) — run {MIN_SEEDS_MEASURED} for confidence"}
    start = from_day(scenario_file)
    revenue = _revenue(baseline, by_seed[default_ix], shop, start, days)
    return {
        "scenario": scenario,
        "label": scenario_file.get("label", scenario),
        "returns": ret["returns"],
        "of": ret["of"],
        "returned": ret["returned"],
        "revenue": revenue,
        "confidence": conf["value"],
        "confidence_detail": {k: conf.get(k) for k in ("stability", "support", "unmeasured", "reason", "partial", "detail")},
        "flows": flows.flows(by_seed[default_ix], shop, days),
    }


def _revenue(baseline_rows, branch_rows, shop, start, days):
    """Focus-shop takings from the fork day to the end, branch vs baseline.

    Two branches can win back the same people and still differ here: a discount that
    brings back exactly who reopening brings back is pure margin given away. Money is
    what tells those two buttons apart (ROADMAP §6 money; SPEC 7.2).
    """
    def total(rows):
        return sum(r["spent"] for r in rows if r["choice"] == shop and start <= r["day"] <= days)
    b, x = total(baseline_rows), total(branch_rows)
    per_day = max(1, days - start + 1)
    return {"from_day": start, "days": per_day, "baseline": b, "branch": x, "delta": x - b,
            "delta_per_day": round((x - b) / per_day)}


def _narrate(analysis):
    """SPEC 6.6. Deterministic facts only; never constructs an LLM client."""
    result = narrate.narrate(analysis)
    analysis["narration"] = result["narration"]
    analysis["narration_source"] = result["source"]
    analysis["narration_reason"] = result["rejected"]


# --- bundle -------------------------------------------------------------------------------

def build(base, seeds, scenario_files=None, shops=None, twin_records=None, synthetic=None):
    """Assemble the bundle dict. Raises ValueError on invalid input."""
    shops = shops or json.loads((DATA / "shops.json").read_text(encoding="utf-8"))
    scenario_files = scenario_files or load_scenarios()
    if twin_records is None:
        twin_records = {}
        for f in sorted((DATA / "twins").glob("*.json")):
            t = json.loads(f.read_text(encoding="utf-8"))
            twin_records[t["id"]] = t
    role = roles(scenario_files)
    shop = focus_shop(scenario_files, shops, role["baseline"])
    days = run_days(scenario_files, role["baseline"])

    errors = []
    for sid in scenario_files:
        for seed in seeds:
            path = base / sid / f"{seed}.jsonl"
            if not path.exists():
                errors.append(f"missing trajectory: {path}")
                continue
            check_file(path, set(twin_records), set(shops), errors, int(scenario_files[sid].get("days", days)))
    if errors:
        raise ValueError(f"{len(errors)} errors; first: {errors[0]}")

    scenarios, all_rows = {}, []
    for sid, sc in scenario_files.items():
        per_seed = {}
        for seed in seeds:
            rows = load_rows(base, sid, seed)
            if any(r["scenario"] != sid or r["seed"] != seed for r in rows):
                raise ValueError(f"trajectory identity mismatch: {sid}/{seed}")
            all_rows.extend(rows)
            sc_days = int(sc.get("days", days))
            per_seed[str(seed)] = {"rows": rows, "daily_sales": daily_sales(rows, shops, sc_days),
                                   "coverage": coverage(rows, sc_days)}
        scenarios[sid] = {
            "label": sc.get("label", sid),
            "role": sc.get("role"),
            "parent": sc.get("parent"),
            "from_day": from_day(sc),
            "days": int(sc.get("days", days)),
            "overrides": sc["overrides"],
            "source": sc.get("source", {"kind": "authored"}),
            "seeds": per_seed,
        }

    report = coverage(all_rows)
    verified = report["complete"] and report["provenance_complete"]
    if synthetic is None:
        synthetic = (base.resolve() == (ROOT / "tests/fixtures/runs").resolve()
                     or any(m.startswith("test-") for m in report["models"]))
    analysis = build_analysis(base, shops, scenario_files, twin_records,
                              {sid: [sc["seeds"][str(seed)]["rows"] for seed in seeds]
                               for sid, sc in scenarios.items()}, seeds)
    _narrate(analysis)
    return {
        "meta": {
            "version": 3,
            "twins": len(twin_records),
            "days": days,
            "seeds": list(seeds),
            "default_seed": DEFAULT_SEED,
            "focus_shop": shop,
            "roles": role,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "synthetic_label": SYNTHETIC_LABEL,
            "coverage": report, "synthetic_run": synthetic,
            "publishable": verified and not synthetic,
        },
        "shops": shops,
        "twins": build_twins(),
        "scenarios": scenarios,
        "analysis": analysis,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", type=pathlib.Path, default=ROOT / "tests/fixtures/runs")
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    ap.add_argument("--seeds", default=None, help="e.g. 0-4 (default), 0-2, 0")
    ap.add_argument("--offline", action="store_true", help="explicitly offline; all bundle builds are local")
    ap.add_argument("--require-complete", action="store_true", help="refuse fallbacks or missing/mixed provenance")
    ap.add_argument("--synthetic", action="store_true", help="label stubbed/test trajectories; never publishable")
    ap.add_argument("--include-all", action="store_true",
                    help="also bundle `bundle: false` scenarios (S2 situations, ablations); their runs must exist")
    args = ap.parse_args()
    base = args.base
    if not base.exists():
        print(f"no such directory: {base}")
        return 1
    seeds = parse_seeds(args.seeds) if args.seeds else SEEDS

    try:
        doc = build(base, seeds, scenario_files=load_scenarios(bundle_only=not args.include_all),
                    synthetic=True if args.synthetic else None)
    except ValueError as exc:
        print(f"invalid input: {exc}")
        return 1

    report = doc["meta"]["coverage"]
    if args.require_complete and not (report["complete"] and report["provenance_complete"]):
        print(f"INCOMPLETE: {report['fallbacks']} fallbacks; {report['missing_provenance']} decisions lack provenance; models {report['models']}")
        return 2

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size = args.out.stat().st_size
    print(f"wrote {args.out}  {size / 1024:.0f} KB  "
          f"({len(doc['scenarios'])} scenarios x {len(seeds)} seeds, focus {doc['meta']['focus_shop']})")
    if size > 2_000_000:
        print("WARNING: over the ~2MB budget (BACKEND_PLAN 4). Ship seed 0 only for what-if branches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
