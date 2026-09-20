"""SPEC 4.2 / 4.3 — the two ways a twin picks a shop.

`autopilot` spends no tokens. `reappraise` is the one LLM call in the engine:
cache lookup, prompt, JSON validation, one retry at a lower temperature, then a
fallback that flags the row so it never counts towards confidence.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from . import cache, llm, prompt
from .loader import Twin
from .schema import AUTOPILOT_VALENCE, DRIVERS, SKIP_LATENT_FLOOR, Disruption
from .timeutil import is_open_at, manhattan

MAX_REASONING_WORDS = 40          # SPEC 4.3

# Per-process counters, so the CLI can report what a run actually cost.
STATS = {"cache_hits": 0, "llm_calls": 0, "retries": 0, "failures": 0,
         "input_tokens": 0, "output_tokens": 0}


def reset_stats() -> None:
    for key in STATS:
        STATS[key] = 0


class Decision(dict):
    """{choice, primary_driver, secondary_driver, valence, reasoning, llm_failed}"""


# --- shared helpers ---------------------------------------------------------


def _available(twin: Twin, shop: dict) -> bool:
    return is_open_at(shop, twin.usual_time) and twin.usual_order in shop["products"]


def price_for(twin: Twin, shop: dict) -> int:
    """What this twin spends at this shop. Falls back to the cheapest item on the
    menu when their usual order is gone."""
    price = shop["price"].get(twin.usual_order)
    if price is None:
        price = min(shop["price"][p] for p in shop["products"])
    return int(price)


def options_block(
    twin: Twin,
    state: dict[str, dict[str, float]],
    shops_today: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """The per-shop facts the reappraisal prompt renders into words."""
    options = []
    for shop_id, shop in shops_today.items():
        distance = manhattan(twin.home, shop["position"])
        price = price_for(twin, shop)
        options.append({
            "shop": shop_id,
            "name": shop["name"],
            "distance": distance,
            "within_walk_tolerance": distance <= twin.profile["walk_tolerance"],
            "price": price,
            "within_budget": price <= twin.profile["daily_budget_vnd"],
            "opens": shop["open"],
            "open_at_usual_time": is_open_at(shop, twin.usual_time),
            "has_usual_order": twin.usual_order in shop["products"],
            "avg_wait_min": shop["avg_wait_min"],
            "quality": shop.get("quality"),
            "marketing": shop.get("marketing", {}).get("message"),
            "habit": round(state["habit"][shop_id], 3),
            "latent_interest": round(state["latent_interest"][shop_id], 3),
        })
    return options


# --- autopilot --------------------------------------------------------------


def autopilot(twin: Twin, regular: str, shops_today: dict[str, dict[str, Any]]) -> Decision:
    """No LLM call. If the regular shop can't serve them today but the shock still
    fell under their threshold, they go without rather than switch (SPEC 4.2)."""
    shop = shops_today[regular]
    if not _available(twin, shop):
        return Decision(
            choice="none", primary_driver="habit", secondary_driver=None,
            valence=-0.2, reasoning="My place couldn't do it today, so I skipped it.",
            llm_failed=False,
        )
    return Decision(
        choice=regular, primary_driver="habit", secondary_driver=None,
        valence=AUTOPILOT_VALENCE, reasoning="Same as every day.", llm_failed=False,
    )


# --- reappraisal ------------------------------------------------------------


def _validate(
    raw: dict[str, Any],
    twin: Twin,
    shops_today: dict[str, dict[str, Any]],
) -> Decision:
    """Turn a model reply into a Decision, or raise ValueError to trigger a retry."""
    choice = raw.get("choice")
    if choice not in set(shops_today) | {"none"}:
        raise ValueError(f"bad choice {choice!r}")

    primary = raw.get("primary_driver")
    if primary not in DRIVERS:
        raise ValueError(f"bad primary_driver {primary!r}")

    secondary = raw.get("secondary_driver")
    if secondary in ("none", "", None):
        secondary = None
    elif secondary not in DRIVERS:
        raise ValueError(f"bad secondary_driver {secondary!r}")

    try:
        valence = float(raw.get("valence"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"bad valence {raw.get('valence')!r}") from exc
    valence = max(-1.0, min(1.0, valence))

    reasoning = str(raw.get("reasoning", "")).strip()
    if not reasoning:
        raise ValueError("empty reasoning")
    words = reasoning.split()
    if len(words) > MAX_REASONING_WORDS:
        reasoning = " ".join(words[:MAX_REASONING_WORDS]).rstrip(",;:") + "..."

    # A twin cannot buy coffee from a shop that is shut when they get there.
    # The options block said so plainly, so this is a model mistake -- retry.
    if choice != "none" and not is_open_at(shops_today[choice], twin.usual_time):
        raise ValueError(f"chose {choice}, which is shut at {twin.usual_time}")

    return Decision(
        choice=choice, primary_driver=primary, secondary_driver=secondary,
        valence=valence, reasoning=reasoning, llm_failed=False,
    )


def _fallback(twin: Twin, regular: str, shops_today, reason: str) -> Decision:
    """SPEC 4.3: on a second failure, behave like autopilot and flag the row so
    the analyzer drops it from confidence rather than treating it as a signal."""
    STATS["failures"] += 1
    decision = autopilot(twin, regular, shops_today)
    decision["llm_failed"] = True
    decision["reasoning"] = f"[llm unavailable: {reason}] {decision['reasoning']}"
    return decision


def reappraise(
    twin: Twin,
    state: dict[str, dict[str, float]],
    shops_today: dict[str, dict[str, Any]],
    disr: Disruption,
    regular: str,
    rng: random.Random,
    day: int,
    scenario_id: str,
    seed: int,
    offline: bool = False,
    cache_dir: Path = cache.CACHE,
) -> Decision:
    """The habit is suspended. The twin consciously weighs the options."""
    latent = state["latent_interest"]
    highest_latent = max((v for s, v in latent.items() if s != regular), default=0.0)

    # SPEC 8, tuning note on T08. A deterministic rule, checked before the call:
    # a shock big enough to break the habit still is not enough to switch when
    # there is nothing to be curious about. Saves a token too.
    if highest_latent < SKIP_LATENT_FLOOR and disr.source == "hours":
        return Decision(
            choice="none", primary_driver="habit", secondary_driver=None,
            valence=-0.3,
            reasoning="My place wasn't open. I'd rather go without than go somewhere else.",
            llm_failed=False,
        )

    state_key = {"habit": state["habit"], "latent_interest": latent}
    cache_key = cache.key(twin.id, day, scenario_id, seed, state_key, shops_today)
    hit = cache.get(cache_key, cache_dir)
    if hit is not None:
        STATS["cache_hits"] += 1
        return Decision({k: v for k, v in hit.items() if not k.startswith("_")})

    if offline:
        return _fallback(twin, regular, shops_today, "offline, not cached")

    options = options_block(twin, state, shops_today)
    history = state.get("history", [])
    user = prompt.build(
        twin, options, disr.score, disr.source, regular, history, shops_today,
    )
    schema = prompt.response_schema(list(shops_today))

    last_error = "unknown"
    for attempt, temperature in ((1, 0.7), (2, 0.3)):     # SPEC 4.3
        try:
            raw, usage = llm.complete_json(prompt.SYSTEM, user, schema, temperature)
            STATS["llm_calls"] += 1
            STATS["input_tokens"] += usage["input_tokens"]
            STATS["output_tokens"] += usage["output_tokens"]
            decision = _validate(raw, twin, shops_today)
            cache.put(cache_key, {**decision, "_model": llm.MODEL,
                                  "_temperature": temperature, "_usage": usage}, cache_dir)
            return decision
        except llm.LLMUnavailable as exc:
            return _fallback(twin, regular, shops_today, str(exc))
        except ValueError as exc:                          # bad JSON or bad enum
            last_error = str(exc)
            if attempt == 1:
                STATS["retries"] += 1
        except Exception as exc:                           # transport, rate limit, auth
            return _fallback(twin, regular, shops_today, f"{type(exc).__name__}: {exc}")

    return _fallback(twin, regular, shops_today, f"invalid reply twice: {last_error}")
