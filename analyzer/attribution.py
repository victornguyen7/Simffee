"""SPEC 6.2 — the naive read against the actual driver.

Two independent computations that get compared. `naive_read` is what a founder staring
at the scenario table would blame; price carries a deliberately high coefficient because
price is the first thing anyone looks at. `actual_driver` counts the drivers the twins who
actually moved gave. When they disagree, that is the mechanism surprise the demo turns on.
"""

import json
import pathlib

SECONDARY_WEIGHT = 0.5

WEIGHTS_PATH = pathlib.Path(__file__).resolve().parent.parent / "data" / "naive_weights.json"

# Used if data/naive_weights.json is absent; identical to the v1 constants.
DEFAULT_WEIGHTS = {
    "price": {"driver": "price", "per_fraction": 5.0},
    "open": {"driver": "hours", "fixed": 0.3},
    "close": {"driver": "hours", "fixed": 0.3},
    "products_removed": {"driver": "product", "fixed": 0.5},
    "products_added": {"driver": "product", "fixed": 0.2},
    "avg_wait_min": {"driver": "wait", "per_unit": 0.05},
    "quality": {"driver": "quality", "per_unit": 2.0},
    "marketing.reach": {"driver": "marketing", "per_unit": 1.0},
    "marketing.message": {"driver": "marketing", "fixed": 0.05},
    "permanently_closed": {"driver": "closed", "fixed": 1.0},
}


def load_weights(path=WEIGHTS_PATH):
    if path and pathlib.Path(path).exists():
        loaded = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        return {k: v for k, v in loaded.items() if not k.startswith("_")}
    return DEFAULT_WEIGHTS


def _get(shop, dotted):
    node = shop
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _score(shop, key, new, weights):
    """One override key -> one scored entry, or None if it is not a change."""
    if key.startswith("price."):
        item = key.split(".", 1)[1]
        old = shop.get("price", {}).get(item)
        w = weights["price"]
        if old:
            delta = abs(new - old) / old
            return {"driver": w["driver"], "magnitude": round(delta * w["per_fraction"], 4),
                    "label": f"Price {'+' if new > old else '-'}{abs(new - old) // 1000:.0f}k",
                    "detail": f"{item} {old} -> {new}"}
        return {"driver": w["driver"], "magnitude": round(weights["products_added"]["fixed"], 4),
                "label": f"New item {item} at {new // 1000:.0f}k", "detail": f"{item} added"}
    if key in ("open", "close"):
        w = weights[key]
        return {"driver": w["driver"], "magnitude": w["fixed"],
                "label": f"Opens {new}" if key == "open" else f"Closes {new}",
                "detail": f"{key} {shop.get(key)} -> {new}"}
    if key == "products":
        before = shop.get("products", [])
        dropped = [p for p in before if p not in new]
        added = [p for p in new if p not in before]
        if dropped:
            w = weights["products_removed"]
            return {"driver": w["driver"], "magnitude": w["fixed"],
                    "label": f"Dropped {', '.join(dropped)}", "detail": f"products -> {new}"}
        if added:
            w = weights["products_added"]
            return {"driver": w["driver"], "magnitude": w["fixed"],
                    "label": f"Added {', '.join(added)}", "detail": f"products -> {new}"}
        return None
    if key in weights and "per_unit" in weights[key]:
        old = _get(shop, key)
        if old is None or new == old:
            return None
        w = weights[key]
        return {"driver": w["driver"], "magnitude": round(abs(new - old) * w["per_unit"], 4),
                "label": f"{key.split('.')[-1].replace('_', ' ').capitalize()} {old} -> {new}",
                "detail": key}
    if key in weights and "fixed" in weights[key]:
        old = _get(shop, key)
        if new == old:
            return None
        w = weights[key]
        label = (f"Competitor opens day {new}" if key == "exists_from_day"
                 else f"{key.split('.')[-1].replace('_', ' ').capitalize()} changed")
        return {"driver": w["driver"], "magnitude": w["fixed"], "label": label,
                "detail": f"{key} {old} -> {new}"}
    return None


def naive_read(overrides, shops_before, weights=None):
    """Highest-magnitude override active on the break day.

    `overrides` is the list of override blocks in force, `shops_before` the shop state they
    were applied to. Every overridable field has a weight in data/naive_weights.json; a key
    with no weight is not a naive candidate (it cannot be "blamed" from the change list).
    `unset` blocks restore the base value; against `shops_before` (the base) that is no
    change, so they contribute nothing here.
    """
    weights = weights or load_weights()
    scored = []
    for ov in overrides:
        shop = shops_before[ov["shop"]]
        for key, new in ov.get("set", {}).items():
            entry = _score(shop, key, new, weights)
            if entry:
                scored.append(entry)

    if not scored:
        return {"driver": None, "magnitude": 0.0, "label": "No change", "considered": []}
    scored.sort(key=lambda s: s["magnitude"], reverse=True)
    top = dict(scored[0])
    top["considered"] = scored
    return top


def switchers(rows, day):
    """Twins whose choice on `day` differs from their choice the day before."""
    prev = {r["twin"]: r["choice"] for r in rows if r["day"] == day - 1}
    return [r for r in rows if r["day"] == day and prev.get(r["twin"]) not in (None, r["choice"])]


def actual_driver(rows, day, secondary_weight=SECONDARY_WEIGHT):
    if any(r.get("llm_failed") for r in rows if r["day"] <= day):
        return {"driver": None, "histogram": {}, "switchers": [], "complete": False,
                "reason": "fallback decisions affect the break-day trajectory"}
    moved = switchers(rows, day)
    hist = {}
    for r in moved:
        hist[r["primary_driver"]] = hist.get(r["primary_driver"], 0) + 1
        if r["secondary_driver"]:
            hist[r["secondary_driver"]] = hist.get(r["secondary_driver"], 0) + secondary_weight
    ranked = sorted(hist.items(), key=lambda kv: (-kv[1], kv[0]))
    return {
        "driver": ranked[0][0] if ranked else None,
        "histogram": {k: float(v) for k, v in hist.items()},
        "switchers": [r["twin"] for r in moved],
    }


def compare(naive, actual):
    return {
        "naive": naive,
        "actual": actual,
        "surprise": bool(naive["driver"] and actual["driver"] and naive["driver"] != actual["driver"]),
    }


def select_evidence(rows, day, driver, shop):
    """SPEC 6.3 — one twin who moved for `driver`, one who took the same shock and did not.

    "Did not switch" means did not defect to a competitor; skipping counts as holding.
    The resisted twin is the one with the least latent interest to act on, because the
    claim the pair makes is that a shock alone does not move anyone — curiosity does.
    """
    if any(r.get("llm_failed") for r in rows if r["day"] <= day):
        return []
    moved = switchers(rows, day)
    on_driver = [r for r in moved if r["primary_driver"] == driver]
    switcher = max(on_driver or moved, key=lambda r: len(r["reasoning"]), default=None)

    def latent(r):
        vals = r["state_before"].get("latent_interest", {}).values()
        return max(vals) if vals else 0.0

    held = [r for r in rows if r["day"] == day and r["disruption"]["score"] > 0
            and r["choice"] in (shop, "none") and r is not switcher]
    resisted = min(held, key=latent, default=None)

    out = []
    if switcher:
        out.append(dict(switcher, kind="switcher"))
    if resisted:
        out.append(dict(resisted, kind="resisted"))
    return out
