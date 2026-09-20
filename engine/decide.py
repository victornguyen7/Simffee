"""SPEC 4.2 / 4.3 — the two ways a twin picks a shop.

`autopilot` spends no tokens. `reappraise` is the one LLM call in the engine:
cache lookup, prompt, JSON validation, one retry at a lower temperature, then a
fallback that flags the row so it never counts towards confidence.
"""

from __future__ import annotations

import math
import random
from dataclasses import asdict
from pathlib import Path
from typing import Any

from . import cache, llm, prompt
from .loader import Twin
from .schema import AUTOPILOT_VALENCE, DRIVERS, REASONING_WORD_LIMIT, SKIP_LATENT_FLOOR, Disruption
from .timeutil import is_open_at, manhattan
from .resolve import display_name

MAX_REASONING_WORDS = REASONING_WORD_LIMIT          # SPEC 4.3 (increased for Groq compatibility)

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
    price = shop["price"].get(twin.usual_order) if twin.usual_order in shop["products"] else None
    if price is None:
        price = min(shop["price"][p] for p in shop["products"])
    return int(price)


def experienced_shops(twin: Twin, state: dict) -> set[str]:
    return set(state.get("visited", [])) | {
        r.get("choice", r.get("shop"))
        for r in twin.what_log + state.get("history", [])
        if r.get("choice", r.get("shop")) not in (None, "none")
    }


def options_block(
    twin: Twin,
    state: dict[str, dict[str, float]],
    shops_today: dict[str, dict[str, Any]],
    day: int | None = None,
) -> list[dict[str, Any]]:
    """The per-shop facts the reappraisal prompt renders into words. `day` lets a shop
    that opened today (ROADMAP B2) say so; v1 shops never do."""
    options = []
    for shop_id, shop in shops_today.items():
        distance = manhattan(twin.home, shop["position"])
        price = price_for(twin, shop)
        opened_today = day is not None and shop.get("exists_from_day") == day and day > 1
        options.append({
            **({"opened_today": True} if opened_today else {}),
            "shop": shop_id,
            "name": display_name(shop),   # prompt.shop_label if set, else name
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
            "visited": shop_id in experienced_shops(twin, state),
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
    if not isinstance(raw, dict):
        raise ValueError("reply must be an object")
    if not {"choice", "primary_driver", "secondary_driver", "valence", "reasoning"} <= raw.keys():
        raise ValueError("reply is missing required decision fields")
    choice = raw.get("choice")
    if not isinstance(choice, str) or choice not in set(shops_today) | {"none"}:
        raise ValueError(f"bad choice {choice!r}")

    primary = raw.get("primary_driver")
    if not isinstance(primary, str) or primary not in DRIVERS:
        raise ValueError(f"bad primary_driver {primary!r}")

    secondary = raw.get("secondary_driver")
    if secondary in ("none", "", None):
        secondary = None
    elif not isinstance(secondary, str) or secondary not in DRIVERS:
        raise ValueError(f"bad secondary_driver {secondary!r}")

    try:
        valence = float(raw.get("valence"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"bad valence {raw.get('valence')!r}") from exc
    if not math.isfinite(valence) or not -1.0 <= valence <= 1.0:
        raise ValueError("valence out of range")

    reasoning = raw.get("reasoning")
    if not isinstance(reasoning, str):
        raise ValueError("reasoning must be text")
    reasoning = reasoning.strip()
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
    allowed = {"offline, not cached", "invalid reply twice", "LLM unavailable", "transport failed",
               "transport failed: quota: daily token limit", "transport failed: rate limit",
               "transport failed: authentication", "transport failed: model not found"}
    safe_reason = reason if reason in allowed else "LLM unavailable"
    decision["reasoning"] = f"[llm unavailable: {safe_reason}] {decision['reasoning']}"
    decision["decision_source"] = "fallback"
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
    highest_latent = max((v for s, v in latent.items() if s != regular and s in shops_today), default=0.0)

    # SPEC 8, tuning note on T08. A deterministic rule, checked before the call:
    # a shock big enough to break the habit still is not enough to switch when
    # there is nothing to be curious about. Saves a token too.
    experienced_alternative = any(
        s != regular and s in experienced_shops(twin, state) and is_open_at(shop, twin.usual_time)
        for s, shop in shops_today.items()
    )
    if highest_latent < SKIP_LATENT_FLOOR and disr.source == "hours" and not experienced_alternative:
        return Decision(
            choice="none", primary_driver="habit", secondary_driver=None,
            valence=-0.3,
            reasoning="My place wasn't open. I'd rather go without than go somewhere else.",
            llm_failed=False, decision_source="rule",
        )

    options = options_block(twin, state, shops_today, day)
    history = state.get("history", [])
    user = prompt.build(
        twin, options, disr.score, disr.source, regular, history, shops_today,
    )
    schema = prompt.response_schema(list(shops_today))
    context = {
        "twin": asdict(twin), "regular": regular, "disruption": disr.to_dict(),
        "system": prompt.SYSTEM, "user": user, "schema": schema,
        "model": llm.MODEL, "max_tokens": llm.MAX_TOKENS,
        "temperatures": [0.7, 0.3], "transport_version": 2,
    }
    cache_key = cache.key(twin.id, day, scenario_id, seed, state, shops_today, context)
    provenance = {"decision_source": "llm", "llm_model": llm.MODEL, "llm_cache_key": cache_key}
    hit = cache.get(cache_key, cache_dir)
    if hit is not None and hit.get("_model") == llm.MODEL and hit.get("_version") == 2:
        try:
            decision = _validate(hit, twin, shops_today)
            if hit.get("llm_failed") is not False or len(hit["reasoning"].split()) > MAX_REASONING_WORDS:
                raise ValueError("invalid cached decision")
        except (ValueError, TypeError, KeyError):
            pass
        else:
            STATS["cache_hits"] += 1
            return Decision(**decision, **provenance)

    if offline:
        return _fallback(twin, regular, shops_today, "offline, not cached")

    last_error = "unknown"
    for attempt, temperature in ((1, 0.7), (2, 0.3)):     # SPEC 4.3
        try:
            raw, usage = llm.complete_json(prompt.SYSTEM, user, schema, temperature)
            STATS["llm_calls"] += 1
            STATS["input_tokens"] += usage["input_tokens"]
            STATS["output_tokens"] += usage["output_tokens"]
            decision = _validate(raw, twin, shops_today)
            cache.put(cache_key, {**decision, "_model": llm.MODEL, "_version": 2,
                                  "_temperature": temperature, "_usage": usage}, cache_dir)
            return Decision(**decision, **provenance)
        except llm.LLMUnavailable as exc:
            return _fallback(twin, regular, shops_today, "LLM unavailable")
        except ValueError as exc:                          # bad JSON or bad enum
            last_error = str(exc)
            if attempt == 1:
                STATS["retries"] += 1
        except Exception as exc:                           # transport, rate limit, auth
            # llm.complete_json already sanitised the message and appended a class in
            # parentheses; keep only that class so the row says "quota", not a provider dump.
            kind = str(exc)[len("LLM transport failed"):].strip(" ()") if str(exc).startswith("LLM transport failed") else ""
            return _fallback(twin, regular, shops_today, f"transport failed: {kind}" if kind else "transport failed")

    return _fallback(twin, regular, shops_today, "invalid reply twice")
