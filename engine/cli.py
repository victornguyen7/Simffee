"""Command line entry point.

    python -m engine.cli --scenario baseline --seeds 0
    python -m engine.cli --scenario baseline --seeds 0-4
    python -m engine.cli --all --seeds 0-4        # baseline, then the forks

Runs with no API key while decide.reappraise is a stub.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from . import decide, llm
from .cache import CACHE
from .loader import DATA, load_shops
from .loop import RUNS, run
from .schema import DAYS, SEEDS, validate_row

# Parents before children: a fork reads its parent's snapshot.
ALL_SCENARIOS = ["baseline", "cf_null", "cf_discount", "cf_restore_hours"]


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


def summarise(rows: list[dict], shop_ids: frozenset[str]) -> str:
    problems = [p for row in rows for p in validate_row(row, shop_ids)]
    by_day: dict[int, Counter] = {}
    sales: dict[int, int] = {}
    for row in rows:
        by_day.setdefault(row["day"], Counter())[row["choice"]] += 1
        if row["choice"] == "simffee":
            sales[row["day"]] = sales.get(row["day"], 0) + row["spent"]
    lines = []
    for day in sorted(by_day):
        counts = ", ".join(f"{k}:{v}" for k, v in sorted(by_day[day].items()))
        modes = sum(1 for r in rows if r["day"] == day and r["mode"] == "reappraisal")
        lines.append(
            f"  day {day}  {counts:<34} reappraisal:{modes}  simffee sales {sales.get(day, 0):,}"
        )
    if problems:
        lines.append(f"  !! {len(problems)} schema problems, first: {problems[0]}")
    else:
        lines.append(f"  {len(rows)} rows, all valid")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(prog="engine.cli")
    ap.add_argument("--scenario", default="baseline")
    ap.add_argument("--all", action="store_true", help="run every scenario in order")
    ap.add_argument("--seeds", default="0", help="e.g. 0, 0-4, or 0,2,4")
    ap.add_argument("--days", type=int, default=DAYS)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--out", type=Path, default=RUNS)
    ap.add_argument("--cache", type=Path, default=CACHE)
    ap.add_argument("--offline", action="store_true",
                    help="never call the API; uncached reappraisals fall back and flag the row")
    ap.add_argument("--model", default=None, help=f"override the model (default {llm.MODEL})")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.model:
        llm.MODEL = args.model
    decide.reset_stats()

    scenarios = ALL_SCENARIOS if args.all else [args.scenario]
    seeds = parse_seeds(args.seeds) if args.seeds else list(SEEDS)
    shop_ids = frozenset(load_shops(args.data))

    failed = False
    for scenario in scenarios:
        for seed in seeds:
            rows = run(scenario, seed, days=args.days, data=args.data, out=args.out,
                       offline=args.offline, cache_dir=args.cache)
            problems = [p for row in rows for p in validate_row(row, shop_ids)]
            failed = failed or bool(problems)
            if not args.quiet:
                print(f"\n{scenario} seed {seed} -> {args.out / scenario / f'{seed}.jsonl'}")
                print(summarise(rows, shop_ids))
    stats = decide.STATS
    cost = stats["input_tokens"] / 1e6 * 1.00 + stats["output_tokens"] / 1e6 * 5.00
    print(
        f"\nmodel {llm.MODEL}  calls {stats['llm_calls']}  cache hits {stats['cache_hits']}  "
        f"retries {stats['retries']}  fallbacks {stats['failures']}\n"
        f"tokens in {stats['input_tokens']:,} out {stats['output_tokens']:,}  "
        f"approx ${cost:.3f}"
    )
    if stats["failures"]:
        print("  NOTE: rows with llm_failed=true are excluded from confidence by the analyzer.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
