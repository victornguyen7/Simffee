"""Command line entry point.

    python -m engine.cli --scenario baseline --seeds 0
    python -m engine.cli --scenario baseline --seeds 0-4
    python -m engine.cli --all --seeds 0-4                    # every scenario under data/scenarios, parents first
    python -m engine.cli --scenario-file my_whatif.json --seeds 0   # an ad-hoc scenario (SPEC_FUNCTIONAL 2)

Runs with no API key while decide.reappraise is a stub, or with --offline.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from . import decide, llm
from .cache import CACHE
from .loader import DATA, discover_scenarios, load_chain, load_scenario_file, load_shops
from .loop import RUNS, run, scenario_days
from .schema import DAYS, SEEDS, coverage, validate_row

# Parents before children: a fork reads its parent's snapshot. Computed from the data
# directory, no longer a hardcoded list (SPEC_FUNCTIONAL 6).
ALL_SCENARIOS = discover_scenarios(DATA)


def parse_seeds(text: str) -> list[int]:
    seeds: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-")
            seeds.extend(range(int(lo), int(hi) + 1))
        else:
            seeds.append(int(part))
    return seeds


def summarise(rows: list[dict], shop_ids: frozenset[str], focus: str) -> str:
    problems = [p for row in rows for p in validate_row(row, shop_ids)]
    by_day: dict[int, Counter] = {}
    sales: dict[int, int] = {}
    for row in rows:
        by_day.setdefault(row["day"], Counter())[row["choice"]] += 1
        if row["choice"] == focus:
            sales[row["day"]] = sales.get(row["day"], 0) + row["spent"]
    lines = []
    for day in sorted(by_day):
        counts = ", ".join(f"{k}:{v}" for k, v in sorted(by_day[day].items()))
        modes = sum(1 for r in rows if r["day"] == day and r["mode"] == "reappraisal")
        lines.append(
            f"  day {day}  {counts:<34} reappraisal:{modes}  {focus} sales {sales.get(day, 0):,}"
        )
    if problems:
        lines.append(f"  !! {len(problems)} schema problems, first: {problems[0]}")
    else:
        lines.append(f"  {len(rows)} rows, all valid")
    return "\n".join(lines)


def overall_coverage(rows: list[dict], days_by_scenario: dict[str, int]) -> dict:
    """Coverage across scenarios that may have different run lengths: the grid check is
    per scenario, provenance is over everything."""
    report = coverage(rows, max(days_by_scenario.values(), default=DAYS))
    per_scenario = [coverage([r for r in rows if r["scenario"] == s], d)
                    for s, d in days_by_scenario.items()]
    report["complete"] = bool(per_scenario) and all(p["complete"] for p in per_scenario)
    report["full_grid"] = bool(per_scenario) and all(p["full_grid"] for p in per_scenario)
    return report


def main() -> int:
    ap = argparse.ArgumentParser(prog="engine.cli")
    ap.add_argument("--scenario", default="baseline")
    ap.add_argument("--scenario-file", type=Path, default=None,
                    help="run an ad-hoc scenario JSON (its parent must exist under --data or --out)")
    ap.add_argument("--all", action="store_true", help="run every promoted scenario under data/scenarios, parents first")
    ap.add_argument("--include-all", action="store_true",
                    help="with --all: also the `bundle: false` scenarios (S2 situations, ablations)")
    ap.add_argument("--seeds", default="0", help="e.g. 0, 0-4, or 0,2,4")
    ap.add_argument("--days", type=int, default=None,
                    help=f"override the run length (default: the scenario's `days`, else {DAYS})")
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--out", type=Path, default=RUNS)
    ap.add_argument("--cache", type=Path, default=CACHE)
    ap.add_argument("--offline", action="store_true",
                    help="never call the API; uncached reappraisals fall back and flag the row")
    ap.add_argument("--model", default=None, help=f"override the model (default {llm.MODEL})")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--require-complete", action="store_true", help="exit 2 on fallbacks or missing/mixed model provenance")
    args = ap.parse_args()

    if args.model:
        llm.MODEL = args.model
    decide.reset_stats()
    llm.reset_stats()

    extra = {}
    if args.scenario_file:
        adhoc = load_scenario_file(args.scenario_file)
        extra[adhoc.id] = adhoc
        scenarios = [adhoc.id]
    elif args.all:
        scenarios = discover_scenarios(args.data, include_all=args.include_all)
    else:
        scenarios = [args.scenario]
    seeds = parse_seeds(args.seeds) if args.seeds else list(SEEDS)
    shops = load_shops(args.data)
    shop_ids = frozenset(shops)

    failed = False
    all_rows = []
    days_by_scenario: dict[str, int] = {}
    for scenario in scenarios:
        chain = load_chain(scenario, args.data, extra)
        # The scenario's own length is what "complete" means; --days only truncates a
        # diagnostic run and can never make a short run count as complete.
        full_days = scenario_days(chain)
        days = args.days or full_days
        days_by_scenario[scenario] = full_days
        focus = chain[-1].focus_shop or chain[0].focus_shop or next(iter(shops))
        for seed in seeds:
            rows = run(scenario, seed, days=days, data=args.data, out=args.out,
                       offline=args.offline, cache_dir=args.cache, extra=extra)
            problems = [p for row in rows for p in validate_row(row, shop_ids)]
            failed = failed or bool(problems)
            all_rows.extend(rows)
            report = coverage(rows, full_days)
            status = "complete" if report["complete"] else "incomplete"
            print(f"{scenario} seed {seed}: {status}; reappraisals {report['reappraisals']}, "
                  f"fallbacks {report['fallbacks']}, models {report['models']}, "
                  f"missing provenance {report['missing_provenance']}, skips {report['skips']}")
            if not args.quiet:
                print(f"\n{scenario} seed {seed} -> {args.out / scenario / f'{seed}.jsonl'}")
                print(summarise(rows, shop_ids, focus))
    stats = decide.STATS
    transport = llm.STATS
    report = overall_coverage(all_rows, days_by_scenario)
    print(
        f"\nconfigured model {llm.MODEL}; response models {report['models']}\n"
        f"API attempts {transport['attempts']}  responses {transport['responses']}  "
        f"cache hits {stats['cache_hits']}  retries {stats['retries']}  fallbacks {stats['failures']}\n"
        f"reported tokens in {transport['input_tokens']:,} out {transport['output_tokens']:,}; "
        "cost not estimated (provider/model pricing required)"
    )
    if not report["complete"]:
        print("  INCOMPLETE: diagnostic trajectories only; fallback decisions are not customer evidence.")
    if transport.get("quota_failures"):
        print(f"  QUOTA: {transport['quota_failures']} call(s) refused by the provider's rate/daily-token limit. "
              "Not an engine fault; wait for the window or raise the tier, then re-run with the same cache.")
    if failed:
        return 1
    return 2 if args.require_complete and not (report["complete"] and report["provenance_complete"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
