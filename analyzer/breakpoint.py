"""SPEC 6.1 — find the day sales broke.

The break is the first day daily sales move at least `threshold` away from the trailing
`window`-day average, AND the control arm does not move the same way on the same day.
That second clause is what stops a market-wide shift being read as our own doing.

Direction-agnostic (SPEC_FUNCTIONAL 6): a drop and a rise are both breaks. `drop` stays
in the output as the signed fraction (positive = fell) so v1 readers are unchanged;
`direction` and `magnitude` are the additive keys.
"""

THRESHOLD = 0.25
WINDOW = 3


def daily_sales(rows, shop, days=7):
    out = [0] * days
    for r in rows:
        if r["choice"] == shop:
            out[r["day"] - 1] += r["spent"]
    return out


def _change(sales, day, window):
    """Signed fractional change on `day` (1-indexed) against the preceding `window` days.

    Positive means sales fell, negative means they rose. None when there is no baseline.
    """
    prior = sales[day - 1 - window:day - 1]
    if len(prior) < window:
        return None
    avg = sum(prior) / window
    if avg == 0:
        return None
    return (avg - sales[day - 1]) / avg


def find_break(baseline_rows, control_rows, shop, days=7, threshold=THRESHOLD, window=WINDOW):
    base = daily_sales(baseline_rows, shop, days)
    ctrl = daily_sales(control_rows, shop, days) if control_rows else None

    candidates = []
    for day in range(window + 1, days + 1):
        b = _change(base, day, window)
        if b is None or abs(b) < threshold:
            continue
        c = _change(ctrl, day, window) if ctrl is not None else None
        same_way = c is not None and abs(c) >= threshold and (c > 0) == (b > 0)
        candidates.append({"day": day, "drop": round(b, 4),
                           "direction": "drop" if b > 0 else "rise",
                           "magnitude": round(abs(b), 4),
                           "control_drop": None if c is None else round(c, 4),
                           "control_fell_too": same_way})

    hit = next((c for c in candidates if not c["control_fell_too"]), None)
    return {
        "break_day": hit["day"] if hit else None,
        "daily_sales": base,
        "control_daily_sales": ctrl,
        "drop": hit["drop"] if hit else None,
        "direction": hit["direction"] if hit else None,
        "magnitude": hit["magnitude"] if hit else None,
        "candidates": candidates,
    }
