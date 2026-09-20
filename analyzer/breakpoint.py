"""SPEC 6.1 — find the day sales broke.

The break is the first day daily sales fall at least `threshold` below the trailing
`window`-day average, AND the control arm does not fall similarly on the same day.
That second clause is what stops a market-wide dip being read as our own doing.
"""

THRESHOLD = 0.25
WINDOW = 3


def daily_sales(rows, shop, days=7):
    out = [0] * days
    for r in rows:
        if r["choice"] == shop:
            out[r["day"] - 1] += r["spent"]
    return out


def _drop(sales, day, window):
    """Fractional fall on `day` (1-indexed) against the preceding `window` days."""
    prior = sales[day - 1 - window:day - 1]
    if len(prior) < window:
        return None
    avg = sum(prior) / window
    if avg == 0:
        return None
    return (avg - sales[day - 1]) / avg


def find_break(baseline_rows, control_rows, shop, days=7, threshold=THRESHOLD, window=WINDOW):
    base = daily_sales(baseline_rows, shop, days)
    ctrl = daily_sales(control_rows, shop, days)

    candidates = []
    for day in range(window + 1, days + 1):
        b = _drop(base, day, window)
        c = _drop(ctrl, day, window)
        if b is None or b < threshold:
            continue
        control_fell = c is not None and c >= threshold
        candidates.append({"day": day, "drop": round(b, 4),
                           "control_drop": None if c is None else round(c, 4),
                           "control_fell_too": control_fell})

    break_day = next((c["day"] for c in candidates if not c["control_fell_too"]), None)
    return {
        "break_day": break_day,
        "daily_sales": base,
        "control_daily_sales": ctrl,
        "drop": next((c["drop"] for c in candidates if c["day"] == break_day), None),
        "candidates": candidates,
    }
