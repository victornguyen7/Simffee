"""SPEC 4.1 — the 7-day loop, and SPEC 5.1 — snapshot and fork.

One day = one pass over the twins in fixed id order, then one word-of-mouth
pass. Nothing inside a day runs concurrently, so a given seed always replays
identically.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from . import cache, decide
from .disruption import disruption
from .gossip import apply_inbox, apply_marketing, gossip
from .habit import apply_habit, regular_shop
from .loader import DATA, Scenario, Twin, load_chain, load_shops, load_twins
from .resolve import resolve
from .schema import DAYS, HABIT_AUTOPILOT, SEEK_CHANGE_GAP, Row

RUNS = Path(__file__).resolve().parent.parent / "runs"


# --- state ------------------------------------------------------------------


def init_state(twins: list[Twin]) -> dict[str, Any]:
    return {
        "habit": {t.id: dict(t.mechanism["habit"]) for t in twins},
        "latent_interest": {t.id: dict(t.mechanism["latent_interest"]) for t in twins},
        "inbox": {t.id: [] for t in twins},
        "history": {t.id: [] for t in twins},
    }


def _twin_view(state: dict[str, Any], twin_id: str) -> dict[str, Any]:
    """The slice of state one twin can see: their own two layers, plus the
    3-day memory the reappraisal prompt reads back to them."""
    return {
        "habit": state["habit"][twin_id],
        "latent_interest": state["latent_interest"][twin_id],
        "history": state["history"][twin_id],
    }


def _snapshot_path(out: Path, scenario_id: str, seed: int, day: int) -> Path:
    return out / scenario_id / str(seed) / f"state_day{day}.json"


def save_snapshot(state, out, scenario_id, seed, day, rng) -> None:
    path = _snapshot_path(out, scenario_id, seed, day)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "day": day,
        "habit": state["habit"],
        "latent_interest": state["latent_interest"],
        "inbox": state["inbox"],
        "history": state["history"],
        "rng_state": rng.getstate(),
    }, ensure_ascii=False, indent=2))


def _retuple(value):
    """json turns the rng tuple into lists; random.setstate demands tuples."""
    if isinstance(value, list):
        return tuple(_retuple(v) for v in value)
    return value


def load_snapshot(out: Path, scenario_id: str, seed: int, day: int):
    raw = json.loads(_snapshot_path(out, scenario_id, seed, day).read_text())
    state = {
        "habit": raw["habit"],
        "latent_interest": raw["latent_interest"],
        "inbox": raw["inbox"],
        "history": raw["history"],
    }
    rng = random.Random()
    rng.setstate(_retuple(raw["rng_state"]))
    return state, rng


# --- one day ----------------------------------------------------------------


def run_day(
    day: int,
    twins: list[Twin],
    state: dict[str, Any],
    shops_today: dict[str, dict[str, Any]],
    remembered: dict[str, dict[str, Any]],
    rng: random.Random,
    scenario_id: str,
    seed: int,
    offline: bool = False,
    cache_dir: Path = cache.CACHE,
) -> list[Row]:
    rows: list[Row] = []
    outgoing: dict[str, list[dict[str, Any]]] = {t.id: [] for t in twins}
    pending: list[tuple[Twin, str, float]] = []

    for twin in twins:
        view = _twin_view(state, twin.id)
        habit, latent = view["habit"], view["latent_interest"]

        # Yesterday's gossip lands now, then today's marketing.
        apply_inbox(latent, state["inbox"][twin.id])
        state["inbox"][twin.id] = []
        regular = regular_shop(habit)
        apply_marketing(latent, twin, shops_today, regular)

        disr = disruption(twin, shops_today[regular], remembered[regular])
        state_before = {"habit": dict(habit), "latent_interest": dict(latent)}

        # SPEC 2.5 / 4.1: three gates into reappraisal -- weak habit, a shock
        # bigger than this twin's threshold, or curiosity that has outgrown the
        # habit outright.
        seeks_change = any(
            v > habit[regular] + SEEK_CHANGE_GAP for s, v in latent.items() if s != regular
        )
        if habit[regular] >= HABIT_AUTOPILOT and disr.score <= twin.disruption_threshold \
                and not seeks_change:
            mode = "autopilot"
            decision = decide.autopilot(twin, regular, shops_today)
        else:
            mode = "reappraisal"
            decision = decide.reappraise(
                twin, view, shops_today, disr, regular, rng, day, scenario_id, seed,
                offline=offline, cache_dir=cache_dir,
            )

        choice = decision["choice"]
        if choice != "none":
            # SPEC 2.3: a first visit converts curiosity into experience.
            if latent.get(choice, 0.0) > 0.0 and choice != regular:
                latent[choice] = 0.0
        apply_habit(habit, choice)

        spent = 0 if choice == "none" else decide.price_for(twin, shops_today[choice])
        rows.append(Row(
            scenario=scenario_id, seed=seed, day=day, twin=twin.id, mode=mode,
            disruption=disr, state_before=state_before, choice=choice, spent=spent,
            abandoned=(choice == "none"),
            primary_driver=decision["primary_driver"],
            secondary_driver=decision["secondary_driver"],
            valence=decision["valence"], reasoning=decision["reasoning"],
            state_after={"habit": dict(habit), "latent_interest": dict(latent)},
            told=[], llm_failed=decision.get("llm_failed", False),
        ))
        pending.append((twin, choice, decision["valence"]))

        state["history"][twin.id] = (state["history"][twin.id] + [{
            "day": day, "choice": choice, "valence": decision["valence"],
            "reasoning": decision["reasoning"],
        }])[-3:]

    # One word-of-mouth pass, after every twin has acted. Lands tomorrow.
    for row, (twin, choice, valence) in zip(rows, pending):
        row.told = gossip(twin, choice, valence, rng, outgoing)
    for twin_id, messages in outgoing.items():
        state["inbox"][twin_id].extend(messages)

    return rows


# --- a whole scenario -------------------------------------------------------


def run(
    scenario_id: str,
    seed: int,
    days: int = DAYS,
    data: Path = DATA,
    out: Path = RUNS,
    offline: bool = False,
    cache_dir: Path = cache.CACHE,
) -> list[dict[str, Any]]:
    """Run one scenario at one seed. Forks load the parent's snapshot and the
    parent's random stream, so the override is the ONLY difference between the
    two branches (SPEC 5.1)."""
    chain = load_chain(scenario_id, data)
    scenario: Scenario = chain[-1]
    shops = load_shops(data)
    twins = load_twins(data, shop_ids=frozenset(shops))

    remembered = resolve(shops, chain, 1)   # the world the 30-day log remembers

    start_day = scenario.from_day if scenario.parent else 1
    rows: list[dict[str, Any]] = []

    if scenario.parent and start_day > 1:
        state, rng = load_snapshot(out, scenario.parent, seed, start_day - 1)
        rows.extend(_read_rows(out, scenario.parent, seed, before_day=start_day, as_scenario=scenario_id))
    else:
        state = init_state(twins)
        rng = random.Random(seed)

    for day in range(start_day, days + 1):
        shops_today = resolve(shops, chain, day)
        day_rows = run_day(
            day, twins, state, shops_today, remembered, rng, scenario_id, seed,
            offline=offline, cache_dir=cache_dir,
        )
        rows.extend(r.to_dict() for r in day_rows)
        save_snapshot(state, out, scenario_id, seed, day, rng)

    _write_rows(out, scenario_id, seed, rows)
    return rows


def _read_rows(out: Path, parent: str, seed: int, before_day: int, as_scenario: str):
    """A fork inherits the parent's earlier days verbatim, relabelled, so every
    scenario file holds a full twins x days grid (BACKEND_PLAN 2.1)."""
    path = out / parent / f"{seed}.jsonl"
    if not path.exists():
        raise FileNotFoundError(
            f"fork needs the parent run first: {path} is missing. "
            f"Run --scenario {parent} --seed {seed} before {as_scenario}."
        )
    inherited = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row["day"] < before_day:
            row["scenario"] = as_scenario
            inherited.append(row)
    return inherited


def _write_rows(out: Path, scenario_id: str, seed: int, rows) -> None:
    path = out / scenario_id / f"{seed}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["day"], r["twin"]))
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
