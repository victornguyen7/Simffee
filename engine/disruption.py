"""SPEC 2.2 — how big is today's gap between expectation and reality.

Expectation is the world as the twin remembers it from the 30-day what-log,
which the engine pins to the day-1 resolved shop state. Reality is today's
resolved shop state. The score is the MAX over sources, never a sum: a person
reacts to the largest shock, not to their arithmetic total.
"""

from __future__ import annotations

from .loader import Twin
from .schema import (
    NEW_ENTRANT_SHOCK_OPEN,
    NEW_ENTRANT_SHOCK_SHUT,
    PRICE_SHOCK_FLOOR,
    PRICE_SHOCK_GAIN,
    PRODUCT_SHOCK,
    WAIT_SHOCK_SCALE,
    Disruption,
)
from .timeutil import is_open_at


def with_new_entrant(disr: Disruption, twin: Twin, entrants: list[dict]) -> Disruption:
    """ROADMAP B2 — a shop that opened today is a shock in its own right, even though
    nothing changed at the twin's regular: 0.5 if it is open when this twin goes for
    coffee, 0.2 if it exists but not at their hour. Still a MAX, never a sum, so the v1
    hours shock (1.0) keeps winning on a day both happen."""
    if not entrants:
        return disr
    score = max(NEW_ENTRANT_SHOCK_OPEN if is_open_at(e, twin.usual_time) else NEW_ENTRANT_SHOCK_SHUT
                for e in entrants)
    return Disruption(score, "new_entrant") if score > disr.score else disr


def disruption(twin: Twin, shop_today: dict, shop_remembered: dict) -> Disruption:
    """Disruption the twin feels about ONE shop (normally their regular)."""
    scored: list[tuple[float, str]] = []

    if shop_today.get("permanently_closed"):
        scored.append((1.0, "closed"))

    if not is_open_at(shop_today, twin.usual_time):
        scored.append((1.0, "hours"))

    item = twin.usual_order
    if item not in shop_today["products"]:
        scored.append((PRODUCT_SHOCK, "product"))
    else:
        old = shop_remembered["price"].get(item)
        new = shop_today["price"].get(item)
        if old and new and new > old:
            rise = (new - old) / old
            if rise >= PRICE_SHOCK_FLOOR:
                scored.append((min(1.0, rise * PRICE_SHOCK_GAIN), "price"))

    tolerance = twin.profile["wait_tolerance_min"]
    wait = shop_today["avg_wait_min"]
    if wait > tolerance:
        scored.append((min(1.0, (wait - tolerance) / WAIT_SHOCK_SCALE), "wait"))

    if not scored:
        return Disruption(0.0, "none")
    score, source = max(scored, key=lambda pair: pair[0])
    return Disruption(score, source)
