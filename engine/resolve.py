"""Resolve shop state for a given day. SPEC 3.3.

Parent overrides apply first, then the child's, each ordered by from_day.
An override key may be dotted ("price.latte") to reach into a nested field.
"""

from __future__ import annotations

import copy
from typing import Any

from .loader import Scenario


def _set_dotted(target: dict[str, Any], dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    node = target
    for part in parts[:-1]:
        if part not in node or not isinstance(node[part], dict):
            raise KeyError(f"override path {dotted!r} does not exist on this shop")
        node = node[part]
    if parts[-1] not in node:
        raise KeyError(f"override path {dotted!r} does not exist on this shop")
    node[parts[-1]] = value


def resolve(
    shops: dict[str, dict[str, Any]],
    chain: list[Scenario],
    day: int,
) -> dict[str, dict[str, Any]]:
    """Shop state as it is on `day`, with every override up to and including it."""
    today = copy.deepcopy(shops)
    for scenario in chain:                      # root first
        for ov in sorted(scenario.overrides, key=lambda o: o["from_day"]):
            if day < ov["from_day"]:
                continue
            shop = today.get(ov["shop"])
            if shop is None:
                raise KeyError(f"override targets unknown shop {ov['shop']!r}")
            for dotted, value in ov["set"].items():
                _set_dotted(shop, dotted, value)
    return today
