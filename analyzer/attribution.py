"""SPEC 6.2 — the naive read against the actual driver.

Two independent computations that get compared. `naive_read` is what a founder staring
at the scenario table would blame; price carries a deliberately high coefficient because
price is the first thing anyone looks at. `actual_driver` counts the drivers the twins who
actually moved gave. When they disagree, that is the mechanism surprise the demo turns on.
"""

PRICE_COEFFICIENT = 5
HOURS_MAGNITUDE = 0.3
PRODUCT_MAGNITUDE = 0.5
SECONDARY_WEIGHT = 0.5


def _price_changes(shop_before, set_block):
    for key, new in set_block.items():
        if not key.startswith("price."):
            continue
        item = key.split(".", 1)[1]
        old = shop_before["price"][item]
        if old:
            yield item, old, new, abs(new - old) / old


def naive_read(overrides, shops_before):
    """Highest-magnitude override active on the break day.

    `overrides` is the list of override blocks in force, `shops_before` the shop state
    they were applied to.
    """
    scored = []
    for ov in overrides:
        shop = shops_before[ov["shop"]]
        for key, new in ov["set"].items():
            if key.startswith("price."):
                item, old, _, delta = next(
                    (c for c in _price_changes(shop, {key: new})), (None, 0, 0, 0))
                scored.append({
                    "driver": "price",
                    "magnitude": round(delta * PRICE_COEFFICIENT, 4),
                    "label": f"Price {'+' if new > old else '-'}{abs(new - old) // 1000:.0f}k",
                    "detail": f"{item} {old} -> {new}",
                })
            elif key in ("open", "close"):
                scored.append({
                    "driver": "hours",
                    "magnitude": HOURS_MAGNITUDE,
                    "label": f"Opens {new}" if key == "open" else f"Closes {new}",
                    "detail": f"{key} {shop[key]} -> {new}",
                })
            elif key == "products":
                dropped = [p for p in shop["products"] if p not in new]
                if dropped:
                    scored.append({
                        "driver": "product",
                        "magnitude": PRODUCT_MAGNITUDE,
                        "label": f"Dropped {', '.join(dropped)}",
                        "detail": f"products -> {new}",
                    })
            elif key.startswith("marketing."):
                field = key.split(".", 1)[1]
                if field == "reach":
                    old = shop["marketing"]["reach"]
                    scored.append({
                        "driver": "marketing",
                        "magnitude": round(abs(new - old), 4),
                        "label": f"Reach {old} -> {new}",
                        "detail": key,
                    })

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
