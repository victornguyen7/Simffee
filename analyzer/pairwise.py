"""SPEC 5.3 — twin-paired comparison between two branches.

Every comparison is per twin, never an aggregate. Two branches that both end with four
customers can still have completely different twins in that four, and the aggregate hides
exactly the thing the demo is about.
"""


def choices_by_twin(rows, from_day=1):
    out = {}
    for r in rows:
        if r["day"] >= from_day:
            out.setdefault(r["twin"], {})[r["day"]] = r["choice"]
    return out


def per_twin(rows_a, rows_b, from_day=1):
    """One row per twin: its choice in each branch per day, and whether the outcome differs."""
    a, b = choices_by_twin(rows_a, from_day), choices_by_twin(rows_b, from_day)
    days = sorted({d for m in a.values() for d in m} | {d for m in b.values() for d in m})
    table = []
    for twin in sorted(set(a) | set(b)):
        pairs = [{"day": d, "a": a.get(twin, {}).get(d), "b": b.get(twin, {}).get(d)} for d in days]
        final = pairs[-1] if pairs else {"a": None, "b": None}
        table.append({
            "twin": twin,
            "days": pairs,
            "diverged": any(p["a"] != p["b"] for p in pairs),
            "outcome_changed": final["a"] != final["b"],
            "final_a": final["a"],
            "final_b": final["b"],
        })
    return table


def outcome_changes(rows_a, rows_b, from_day=1):
    table = per_twin(rows_a, rows_b, from_day)
    changed = [t["twin"] for t in table if t["outcome_changed"]]
    return {"changed": changed, "count": len(changed), "table": table}


def lost(rows, shop, days=7):
    """Twins who opened the run at `shop` and did not end there."""
    first = {r["twin"]: r["choice"] for r in rows if r["day"] == 1}
    last = {r["twin"]: r["choice"] for r in rows if r["day"] == days}
    return sorted(t for t, c in first.items() if c == shop and last.get(t) != shop)


def returns(baseline_rows, branch_rows, shop, days=7):
    """The number under a what-if button: of the customers baseline lost, how many come back."""
    gone = lost(baseline_rows, shop, days)
    branch_last = {r["twin"]: r["choice"] for r in branch_rows if r["day"] == days}
    back = [t for t in gone if branch_last.get(t) == shop]
    return {"returns": len(back), "of": len(gone), "returned": back, "still_gone": [t for t in gone if t not in back]}
