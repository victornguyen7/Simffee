"""SPEC 6.4 — subtract the control arm.

A customer only counts as lost by our decision if they left in the baseline AND stayed
in the control. Without this subtraction the headline overstates our own damage by
whatever the market was doing anyway.
"""

from analyzer.pairwise import lost


def impact(baseline_rows, control_rows, shop, days=7):
    gone = lost(baseline_rows, shop, days)
    anyway = set(lost(control_rows, shop, days))

    base_last = {r["twin"]: r["choice"] for r in baseline_rows if r["day"] == days}
    ctrl_last = {r["twin"]: r["choice"] for r in control_rows if r["day"] == days}

    by_decision = [t for t in gone if t not in anyway]
    return {
        "lost_total": len(gone),
        "lost_by_decision": len(by_decision),
        "lost_anyway": len([t for t in gone if t in anyway]),
        "lost_twins": gone,
        "by_decision_twins": by_decision,
        "anyway_twins": sorted(t for t in gone if t in anyway),
        "per_twin": [{"twin": t, "baseline": base_last.get(t), "control": ctrl_last.get(t),
                      "attributed": t not in anyway}
                     for t in gone],
    }
