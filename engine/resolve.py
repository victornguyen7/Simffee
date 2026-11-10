"""Resolve shop state for a given day. SPEC 3.3, SPEC_FUNCTIONAL 2.

Parent overrides apply first, then the child's, each ordered by from_day.
An override key may be dotted ("price.latte") to reach into a nested field.

Two additive extensions:
- `unset: [dotted, ...]` restores the base shops.json value for those keys. It is how a
  fork *removes* a parent's change (keep the entrant, drop the hours shift).
- The `prompt.*` namespace (e.g. `prompt.shop_label`) may be created on a shop even though
  shops.json does not carry it. It is text the LLM sees; the engine never reads it.
- `exists_from_day: N` (ROADMAP B1) makes a shop absent before day N: it is dropped from the
  resolved day entirely, so it is not an option, runs no marketing, and shocks nobody. Set it
  from day 1 (`{"from_day": 1, "shop": "x", "set": {"exists_from_day": 4}}`); the shop then
  appears on day 4 with whatever else the chain has set on it by then.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

from .loader import Scenario

# Namespaces that may be created on a shop even though shops.json does not carry them.
CREATABLE_ROOTS = frozenset({"prompt"})
# Existing dicts under which a NEW leaf may be added: a price for a new menu item.
CREATABLE_LEAF_PARENTS = frozenset({"price"})
# Top-level flags a scenario may introduce without shops.json carrying them (keeping
# shops.json unchanged keeps v1 cache keys unchanged).
EXISTS = "exists_from_day"
CREATABLE_LEAVES = frozenset({"permanently_closed", EXISTS})


def _walk(target: dict[str, Any], parts: list[str], dotted: str, create: bool) -> dict[str, Any]:
    node = target
    for part in parts:
        if part not in node or not isinstance(node[part], dict):
            if create and part in CREATABLE_ROOTS and part not in node:
                node[part] = {}
            else:
                raise KeyError(f"override path {dotted!r} does not exist on this shop")
        node = node[part]
    return node


def _leaf_creatable(parts: list[str]) -> bool:
    return (parts[0] in CREATABLE_ROOTS
            or (len(parts) == 2 and parts[0] in CREATABLE_LEAF_PARENTS)
            or (len(parts) == 1 and parts[0] in CREATABLE_LEAVES))


def _set_dotted(target: dict[str, Any], dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    node = _walk(target, parts[:-1], dotted, create=parts[0] in CREATABLE_ROOTS)
    if parts[-1] not in node and not _leaf_creatable(parts):
        raise KeyError(f"override path {dotted!r} does not exist on this shop")
    node[parts[-1]] = value


def _get_dotted(source: dict[str, Any], dotted: str) -> tuple[bool, Any]:
    node = source
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def _unset_dotted(target: dict[str, Any], base: dict[str, Any], dotted: str) -> None:
    found, value = _get_dotted(base, dotted)
    parts = dotted.split(".")
    if found:
        _set_dotted(target, dotted, copy.deepcopy(value))
        return
    # Not in the base shop: keys that a scenario could have created are removed outright.
    if _leaf_creatable(parts):
        ok, parent = _get_dotted(target, ".".join(parts[:-1])) if len(parts) > 1 else (True, target)
        if ok and isinstance(parent, dict):
            parent.pop(parts[-1], None)
        return
    raise KeyError(f"unset path {dotted!r} does not exist on the base shop")


def resolve(
    shops: dict[str, dict[str, Any]],
    chain: list[Scenario],
    day: int,
    include_absent: bool = False,
) -> dict[str, dict[str, Any]]:
    """Shop state as it is on `day`, with every override up to and including it."""
    today = copy.deepcopy(shops)
    for scenario in chain:                      # root first
        for ov in sorted(scenario.overrides, key=lambda o: o["from_day"]):
            shop = today.get(ov["shop"])
            if shop is None:
                raise KeyError(f"override targets unknown shop {ov['shop']!r}")
            # Existence is a property of the whole run, not of the day a block starts:
            # "starbucks opens on day 4" must make it absent on days 1-3 whatever from_day
            # the block carries.
            if EXISTS in ov.get("unset", []):
                _unset_dotted(shop, shops[ov["shop"]], EXISTS)
            if EXISTS in ov.get("set", {}):
                shop[EXISTS] = ov["set"][EXISTS]
            if day < ov["from_day"]:
                continue
            for dotted in ov.get("unset", []):
                if dotted != EXISTS:
                    _unset_dotted(shop, shops[ov["shop"]], dotted)
            for dotted, value in ov.get("set", {}).items():
                if dotted != EXISTS:
                    _set_dotted(shop, dotted, value)
    return today if include_absent else {sid: shop for sid, shop in today.items() if exists_on(shop, day)}


def exists_on(shop: dict[str, Any], day: int) -> bool:
    """A shop with `exists_from_day` is absent before that day. v1 shops always exist."""
    return day >= int(shop.get("exists_from_day", 1))


def opening_today(chain: list[Scenario], shops: dict[str, dict[str, Any]], day: int) -> list[str]:
    """Shop ids that exist on `day` and did not exist on `day - 1`. Nothing opens on day 1."""
    if day <= 1:
        return []
    yesterday = resolve(shops, chain, day - 1)
    return sorted(sid for sid in resolve(shops, chain, day) if sid not in yesterday)


def display_name(shop: dict[str, Any]) -> str:
    """What the LLM calls this shop. `prompt.shop_label` overrides `name` for text only."""
    return shop.get("prompt", {}).get("shop_label") or shop["name"]


# --- preflight ----------------------------------------------------------------------------
# A scenario is checked before any engine run so a bad override is a 400 at the door, not a
# crash on day 5 after the model calls have been paid for (AUDIT_FIX_PLAN #8).

_HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
_UNIT_INTERVAL = frozenset({"quality", "marketing.reach"})


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _value_problem(dotted: str, value: Any, base: dict[str, Any]) -> str | None:
    """Why `value` cannot be assigned to `dotted` on a shop shaped like `base`, or None."""
    parts = dotted.split(".")
    if dotted == EXISTS:
        ok = isinstance(value, int) and not isinstance(value, bool) and value >= 1
        return None if ok else "must be a day number >= 1"
    if dotted == "permanently_closed":
        return None if isinstance(value, bool) else "must be true or false"
    if parts[0] in CREATABLE_ROOTS:
        return None if isinstance(value, str) else "must be text"
    if dotted in ("open", "close"):
        return None if isinstance(value, str) and _HHMM.fullmatch(value) else "must be a time like 06:30"
    if parts[0] == "price" and len(parts) == 2:
        return None if _is_number(value) and value >= 0 else "must be a price >= 0"
    found, current = _get_dotted(base, dotted)
    if not found:
        return None                      # the dry resolve reports the unknown path
    if isinstance(current, dict):
        return f"is a group of fields; set one of them instead (e.g. {dotted}.{next(iter(current), 'x')})"
    if isinstance(current, bool):
        return None if isinstance(value, bool) else "must be true or false"
    if _is_number(current):
        if not _is_number(value) or value < 0:
            return "must be a number >= 0"
        return "must be between 0 and 1" if dotted in _UNIT_INTERVAL and value > 1 else None
    if isinstance(current, str):
        return None if isinstance(value, str) and value.strip() else "must be non-empty text"
    if isinstance(current, list):
        if dotted == "products":
            ok = (isinstance(value, list) and value and len(set(map(str, value))) == len(value)
                  and all(isinstance(v, str) and v for v in value))
            return None if ok else "must be a non-empty list of distinct product names"
        ok = isinstance(value, list) and len(value) == len(current) and all(map(_is_number, value))
        return None if ok else f"must be a list of {len(current)} numbers"
    return None


def check_overrides(shops: dict[str, dict[str, Any]], chain: list[Scenario], days: int) -> list[str]:
    """Problems that would make the engine fail or silently ignore part of this chain."""
    problems: list[str] = []
    leaf = chain[-1]
    for scenario in chain:
        for i, ov in enumerate(scenario.overrides):
            where = f"{scenario.id} override {i} ({ov['shop']})"
            base = shops.get(ov["shop"])
            if base is None:
                problems.append(f"{where}: unknown shop; known shops are {', '.join(sorted(shops))}")
                continue
            for dotted, value in ov.get("set", {}).items():
                why = _value_problem(dotted, value, base)
                if why:
                    problems.append(f"{where}: {dotted} {why}")
            if scenario is leaf and ov["from_day"] > days:
                problems.append(f"{where}: starts on day {ov['from_day']} but the run has {days} days")
    if problems:
        return problems
    for day in range(1, days + 1):
        try:
            today = resolve(shops, chain, day, include_absent=True)
        except KeyError as exc:
            return [f"day {day}: {exc.args[0] if exc.args else exc}"]
        for sid, shop in today.items():
            products, prices = shop.get("products", []), shop.get("price", {})
            # shops.json itself lists an unpriced item (Starbucks' frappuccino), and base shop
            # data is part of every cache key, so only what the scenario adds is held to this.
            added = [p for p in products if p not in prices and p not in shops[sid].get("products", [])]
            if added:
                return [f"day {day}: {sid} adds {', '.join(added)} with no price (set price.{added[0]})"]
            if products and not any(p in prices for p in products):
                return [f"day {day}: {sid} has no priced product on its menu"]
    return []
