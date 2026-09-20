"""COST_PLAN 2 — the ledger. One row per run: what the model was asked, what it cost, and
what the naive builds of the same run would have cost.

    python3 tools/cost_report.py RUN_DIR            # summarise rows already in RUN_DIR/cost_ledger.jsonl
    (the engine CLI and the API call `record()` after each run)

Pricing comes from tools/pricing.json and is labelled unverified until someone checks it
against the provider page. The engine itself never prints a dollar figure.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PRICING_PATH = ROOT / "tools" / "pricing.json"
LEDGER_NAME = "cost_ledger.jsonl"


def load_pricing(path: pathlib.Path = PRICING_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def price_for(model: str, pricing: dict[str, Any] | None = None) -> dict[str, Any] | None:
    pricing = pricing or load_pricing()
    return pricing["models"].get(model)


def dollars(tokens_in: int, tokens_out: int, model: str, pricing: dict[str, Any] | None = None) -> dict[str, Any]:
    p = price_for(model, pricing)
    if not p:
        return {"usd": None, "verified": False, "note": f"no price on file for {model}"}
    usd = tokens_in / 1e6 * p["input"] + tokens_out / 1e6 * p["output"]
    return {"usd": round(usd, 5), "verified": bool(p.get("verified")), "as_of": p.get("as_of"),
            "note": p.get("note")}


def snapshot() -> dict[str, int]:
    """Current process-wide counters, so a caller can diff before/after a run."""
    from engine import decide, llm
    return {**{f"decide.{k}": v for k, v in decide.STATS.items()},
            **{f"llm.{k}": v for k, v in llm.STATS.items()}}


def delta(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    return {k: after[k] - before.get(k, 0) for k in after}


def row(rows: list[dict[str, Any]], counters: dict[str, int], model: str, *, label: str,
        seeds: list[int], scenarios: list[str], took_ms: int | None = None,
        levers: list[str] | None = None, pricing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build one ledger row from the rows a run produced and the counter delta it caused."""
    pricing = pricing or load_pricing()
    twin_days = len(rows)
    by_source: dict[str, int] = {}
    for r in rows:
        by_source[r.get("decision_source", "?")] = by_source.get(r.get("decision_source", "?"), 0) + 1
    tokens_in = counters.get("llm.input_tokens", 0)
    tokens_out = counters.get("llm.output_tokens", 0)
    responses = counters.get("llm.responses", 0)
    avg_in = round(tokens_in / responses) if responses else None
    avg_out = round(tokens_out / responses) if responses else None
    actual = dollars(tokens_in, tokens_out, model, pricing)

    # Naive counterfactuals for the same run size (COST_PLAN 1).
    nb = pricing.get("naive_baselines", {})
    n1_calls = twin_days * nb.get("N1_calls_per_twin_day", 1)
    ref_in = avg_in or 1050
    ref_out = avg_out or 90
    n1 = dollars(n1_calls * ref_in, n1_calls * ref_out, model, pricing)
    n0 = dollars(n1_calls * ref_in, n1_calls * nb.get("N0_output_tokens_per_call", 775), model, pricing)

    return {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "label": label, "scenarios": scenarios, "seeds": seeds, "model": model,
        "twin_days": twin_days, "decision_source": by_source,
        "reasoned": by_source.get("llm", 0), "on_habit": by_source.get("autopilot", 0) + by_source.get("rule", 0),
        "api_attempts": counters.get("llm.attempts", 0), "responses": responses,
        "cache_hits": counters.get("decide.cache_hits", 0), "fallbacks": counters.get("decide.failures", 0),
        "tokens_in": tokens_in, "tokens_out": tokens_out, "avg_in": avg_in, "avg_out": avg_out,
        "took_ms": took_ms, "levers": levers or ["habit_gating", "fork", "cache"],
        "cost": actual,
        "naive": {"N1_every_twin_every_day": {"calls": n1_calls, **n1},
                  "N0_reasoning_model_shape": {"calls": n1_calls, **n0}},
        "saving_vs_N1": None if not (actual["usd"] is not None and n1["usd"]) else round(1 - actual["usd"] / n1["usd"], 4),
    }


def record(run_dir: pathlib.Path, entry: dict[str, Any]) -> pathlib.Path:
    run_dir = pathlib.Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / LEDGER_NAME
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return path


def read(run_dir: pathlib.Path) -> list[dict[str, Any]]:
    path = pathlib.Path(run_dir) / LEDGER_NAME
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    entries = read(pathlib.Path(sys.argv[1]))
    if not entries:
        print("no ledger rows")
        return 1
    tot_in = sum(e["tokens_in"] for e in entries)
    tot_out = sum(e["tokens_out"] for e in entries)
    tot_usd = sum(e["cost"]["usd"] or 0 for e in entries)
    reasoned = sum(e["reasoned"] for e in entries)
    habit = sum(e["on_habit"] for e in entries)
    print(f"{len(entries)} runs · {reasoned:,} decisions reasoned, {habit:,} on habit · "
          f"tokens {tot_in:,} in / {tot_out:,} out · ${tot_usd:.4f}"
          f"{'' if all(e['cost']['verified'] for e in entries) else '  (pricing unverified)'}")
    for e in entries[-10:]:
        print(f"  {e['at']}  {e['label'][:40]:40}  reasoned {e['reasoned']:4}  habit {e['on_habit']:4}  "
              f"calls {e['responses']:3}  hits {e['cache_hits']:3}  ${e['cost']['usd'] or 0:.4f}"
              f"  vs N1 −{(e['saving_vs_N1'] or 0):.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
