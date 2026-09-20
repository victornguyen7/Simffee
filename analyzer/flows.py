"""ROADMAP B3 — where the focus shop's customers went, day by day, and why.

Every flow is a day-over-day transition of one twin, relative to the focus shop:

    lost_to[o]      chose the focus shop yesterday, chose `o` today   (o is a shop or "none")
    gained_from[o]  chose `o` yesterday, chose the focus shop today
    returned        gained, by a twin who had been a focus-shop customer earlier in the run
    net             gained - lost on that day

Each flow carries the drivers the moving twins gave, so "who did I lose to them, when, why"
is answered from the rows and not inferred. The computation is generic: it reads any run's
rows (S1 output too) and needs nothing but the focus shop id. Fallback rows are counted --
a fallback is a real trajectory step -- but the report says how many there were, so a
caller can decide whether to trust the drivers.

Designed so a later crowd module (ROADMAP E) can feed the same shape: nothing here knows
what a twin is beyond an id, a day, a choice and a driver.
"""

from __future__ import annotations

from typing import Any


def _by_twin_day(rows: list[dict[str, Any]]) -> dict[str, dict[int, dict[str, Any]]]:
    out: dict[str, dict[int, dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["twin"], {})[r["day"]] = r
    return out


def _drivers(moves: list[dict[str, Any]]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for r in moves:
        hist[r["primary_driver"]] = hist.get(r["primary_driver"], 0) + 1
    return dict(sorted(hist.items(), key=lambda kv: (-kv[1], kv[0])))


def _group(moves: list[tuple[dict[str, Any], str]]) -> dict[str, dict[str, Any]]:
    """(row, other shop) pairs -> {other: {twins, count, drivers}} in a stable order."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for r, other in moves:
        groups.setdefault(other, []).append(r)
    return {o: {"twins": sorted(r["twin"] for r in rs), "count": len(rs), "drivers": _drivers(rs)}
            for o, rs in sorted(groups.items())}


def flows(rows: list[dict[str, Any]], focus: str, days: int | None = None) -> dict[str, Any]:
    """Per-day flows relative to `focus`, with totals and an end-of-run summary."""
    table = _by_twin_day(rows)
    if days is None:
        days = max((r["day"] for r in rows), default=0)
    ever_customer: set[str] = {t for t, per in table.items() if per.get(1, {}).get("choice") == focus}
    by_day = []
    lost_twins: dict[str, set[str]] = {}
    gained_twins: dict[str, set[str]] = {}
    returned_all: list[str] = []
    fallbacks = 0
    for day in range(2, days + 1):
        lost, gained, returned = [], [], []
        for twin in sorted(table):
            prev, cur = table[twin].get(day - 1), table[twin].get(day)
            if prev is None or cur is None:
                continue
            a, b = prev["choice"], cur["choice"]
            if a == b:
                continue
            if a == focus and b != focus:
                lost.append((cur, b))
                if cur.get("llm_failed"):
                    fallbacks += 1
            elif b == focus and a != focus:
                gained.append((cur, a))
                if twin in ever_customer:
                    returned.append(twin)
                if cur.get("llm_failed"):
                    fallbacks += 1
        for r, o in lost:
            lost_twins.setdefault(o, set()).add(r["twin"])
        for r, o in gained:
            gained_twins.setdefault(o, set()).add(r["twin"])
        returned_all.extend(returned)
        # Anyone who bought here today is a customer someone could later "return".
        ever_customer |= {t for t, per in table.items() if per.get(day, {}).get("choice") == focus}
        by_day.append({
            "day": day,
            "lost_to": _group(lost),
            "gained_from": _group(gained),
            "returned": sorted(returned),
            "lost": len(lost), "gained": len(gained), "net": len(gained) - len(lost),
        })

    first = {t: per.get(1, {}).get("choice") for t, per in table.items()}
    last = {t: per.get(days, {}).get("choice") for t, per in table.items()}
    twins = sorted(table)
    start_customers = sorted(t for t in twins if first[t] == focus)
    end_customers = sorted(t for t in twins if last[t] == focus)
    end = {
        "start_customers": start_customers,
        "end_customers": end_customers,
        "kept": sorted(t for t in twins if all(per.get("choice") == focus for per in table[t].values())),
        "lost": {o: sorted(t for t in start_customers if last[t] == o)
                 for o in sorted({last[t] for t in start_customers if last[t] != focus}, key=str)},
        "gained": {o: sorted(t for t in end_customers if first[t] == o)
                   for o in sorted({first[t] for t in end_customers if first[t] != focus}, key=str)},
        "net": len(end_customers) - len(start_customers),
    }
    return {
        "focus_shop": focus,
        "days": days,
        "by_day": by_day,
        "totals": {
            "lost_to": {o: sorted(ts) for o, ts in sorted(lost_twins.items())},
            "gained_from": {o: sorted(ts) for o, ts in sorted(gained_twins.items())},
            "returned": sorted(set(returned_all)),
            "moves": sum(d["lost"] + d["gained"] for d in by_day),
            "fallback_moves": fallbacks,
        },
        "end": end,
    }


def agreement(rows_a: list[dict[str, Any]], rows_b: list[dict[str, Any]],
              from_day: int = 1) -> dict[str, Any]:
    """ROADMAP B6 — `hero_agreement`: the share of twin-days on which two runs made the same
    choice, plus the same for reappraisal rows only (autopilot agrees by construction, so
    the second number is the one that says whether the model reacted to the mechanism or to
    the name). Fallback twin-days are excluded from both: a fallback is not a decision."""
    a, b = _by_twin_day(rows_a), _by_twin_day(rows_b)
    same = total = same_re = total_re = excluded = 0
    diverged: list[dict[str, Any]] = []
    for twin in sorted(set(a) & set(b)):
        for day in sorted(set(a[twin]) & set(b[twin])):
            if day < from_day:
                continue
            ra, rb = a[twin][day], b[twin][day]
            if ra.get("llm_failed") or rb.get("llm_failed"):
                excluded += 1
                continue
            total += 1
            agree = ra["choice"] == rb["choice"]
            same += agree
            if ra["mode"] == "reappraisal" or rb["mode"] == "reappraisal":
                total_re += 1
                same_re += agree
            if not agree:
                diverged.append({"twin": twin, "day": day, "a": ra["choice"], "b": rb["choice"]})
    return {
        "value": round(same / total, 3) if total else None,
        "reappraisal_value": round(same_re / total_re, 3) if total_re else None,
        "twin_days": total, "reappraisal_twin_days": total_re, "excluded_fallbacks": excluded,
        "diverged": diverged,
        "unmeasured": total == 0,
    }
