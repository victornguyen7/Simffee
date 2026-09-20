"""SPEC 2.3 + 2.4 — how latent_interest moves.

Two inputs, both resolved at the START of a day so word of mouth carries the
one-day lag the spec asks for: what is said today lands tomorrow.
"""

from __future__ import annotations

import random
from typing import Any

from .loader import Twin
from .schema import GOSSIP_WEIGHT, MARKETING_CAP


def apply_marketing(
    latent: dict[str, float],
    twin: Twin,
    shops_today: dict[str, dict[str, Any]],
    regular: str,
) -> None:
    """+ reach * ad_sensitivity, capped per day. Never on the twin's own regular."""
    for shop_id, shop in shops_today.items():
        if shop_id == regular:
            continue
        reach = shop.get("marketing", {}).get("reach", 0.0)
        gain = min(MARKETING_CAP, reach * twin.ad_sensitivity)
        latent[shop_id] = min(1.0, latent[shop_id] + gain)


def apply_inbox(latent: dict[str, float], inbox: list[dict[str, Any]]) -> None:
    """Yesterday's gossip. + 0.10 * valence, so a bad report subtracts."""
    for message in inbox:
        shop_id = message["shop"]
        if shop_id not in latent:
            continue
        latent[shop_id] = min(1.0, max(0.0, latent[shop_id] + GOSSIP_WEIGHT * message["valence"]))


def gossip(
    twin: Twin,
    choice: str,
    valence: float,
    rng: random.Random,
    inboxes: dict[str, list[dict[str, Any]]],
) -> list[str]:
    """End of day: with probability talkativeness, tell each neighbour.

    The roll is per twin, not per neighbour, so one draw from `rng` per twin per
    day keeps the random stream aligned across a fork.
    """
    if choice == "none":
        return []
    if rng.random() >= twin.talkativeness:
        return []
    told: list[str] = []
    for neighbour in twin.social_links:
        inboxes[neighbour].append({"from": twin.id, "shop": choice, "valence": valence})
        told.append(neighbour)
    return told
