"""SPEC 6.5 — c = 0.7 * stability + 0.3 * support.

stability asks whether the same twin makes the same call across seeds. support asks
whether the driver it gave is something the twin's own interview actually evidences.

Rows with llm_failed are excluded from stability (SPEC 4.3). That exclusion has a sharp
edge worth knowing about: in an offline run EVERY reappraisal row is llm_failed, so the
only rows left are autopilot ones, which agree across seeds by construction and would
report stability 1.0 on a run where the model never made a single decision. When a twin
has no usable rows it is reported as unmeasured rather than counted as stable, and if no
reappraising twin is measurable at all, `value` is None instead of a confident-looking
number. The system saying it does not know is the point (SPEC 6.5).
"""

STABILITY_WEIGHT = 0.7
SUPPORT_WEIGHT = 0.3
SUPPORT_DIVISOR = 3
MIN_SEEDS_FOR_STABILITY = 3

DRIVER_KEYWORDS = {
    "hours": ("open", "opens", "opened", "closed", "shut", "early", "late", "time", "o'clock", "am", "hour"),
    "price": ("price", "cost", "cheap", "expensive", "pay", "paid", "budget", "deal", "fee", "k ", "money"),
    "curiosity": ("try", "tried", "trying", "new", "curious", "noticed", "haven't", "never been", "look"),
    "social": ("told", "tell", "telling", "friend", "sister", "colleague", "recommend", "said", "swear", "talk"),
    "wait": ("wait", "waiting", "queue", "line", "slow", "quick", "skip"),
    "habit": ("same", "always", "every", "usual", "routine", "years", "stick", "hassle", "switch"),
    "distance": ("near", "nearest", "close", "closer", "far", "walk", "block", "minute", "door"),
    "product": ("menu", "order", "latte", "americano", "cold brew", "item", "roast"),
    "quality": ("quality", "bean", "roast", "good", "taste", "better"),
}


def _usable(rows):
    return [r for r in rows if not r.get("llm_failed")]


def _transcript_hits(twin, driver):
    words = DRIVER_KEYWORDS.get(driver, ())
    hits = 0
    for qa in twin["why_transcript"]:
        text = f"{qa['q']} {qa['a']}".lower()
        if any(w in text for w in words):
            hits += 1
    return hits


def stability(rows_by_seed, day, only=None):
    """Fraction of seeds giving the same choice on `day`, averaged over twins.

    `only` restricts the average to a set of twin ids — a what-if conclusion is about
    the customers baseline lost, so the other twins' agreement should not pad it.
    """
    per_twin = {}
    for seed_rows in rows_by_seed:
        for r in seed_rows:
            if r["day"] == day and (only is None or r["twin"] in only):
                per_twin.setdefault(r["twin"], {})[r["seed"]] = r

    scores, unmeasured, detail = {}, [], {}
    for twin, rows in sorted(per_twin.items()):
        usable = _usable(rows.values())
        detail[twin] = {"score": None, "seeds_used": len(usable), "seeds_total": len(rows),
                        "modes": sorted({r["mode"] for r in usable}),
                        "reappraisal_seeds_used": sum(r["mode"] == "reappraisal" for r in usable)}
        if len(usable) < MIN_SEEDS_FOR_STABILITY:
            unmeasured.append(twin)
            continue
        counts = {}
        for r in usable:
            counts[r["choice"]] = counts.get(r["choice"], 0) + 1
        top = max(counts.values())
        scores[twin] = top / len(usable)
        detail[twin]["score"] = round(scores[twin], 3)

    value = sum(scores.values()) / len(scores) if scores else None
    low_sample_reason = f"{len(scores)} of {len(per_twin)} twins measurable; {len(unmeasured)} had fewer than {MIN_SEEDS_FOR_STABILITY} usable seeds" if unmeasured else None
    return {
        "value": None if value is None else round(value, 4),
        "per_twin": detail,
        "unmeasured_twins": unmeasured,
        "measured": len(scores),
        "low_sample_reason": low_sample_reason,
    }


def support(rows, day, twins):
    """How much of a switcher's why-transcript evidences the driver it gave.

    `twins` maps twin id -> the twin record from data/twins/.
    """
    scores, detail = {}, {}
    for r in rows:
        if r["day"] != day or r["mode"] != "reappraisal" or r.get("llm_failed"):
            continue
        twin = twins.get(r["twin"])
        if not twin:
            continue
        hits = _transcript_hits(twin, r["primary_driver"])
        scores[r["twin"]] = min(1.0, hits / SUPPORT_DIVISOR)
        detail[r["twin"]] = {"driver": r["primary_driver"], "hits": hits,
                             "score": round(scores[r["twin"]], 3)}

    value = sum(scores.values()) / len(scores) if scores else None
    return {"value": None if value is None else round(value, 4),
            "per_twin": detail, "measured": len(scores)}


def branch_support(rows, only, from_day, twins):
    """Support for a what-if outcome: the last reappraisal each lost twin made in the
    branch is the decision that settled where they ended up, so that is the driver the
    transcript has to evidence."""
    last = {}
    for r in rows:
        if r["twin"] in only and r["day"] >= from_day and r["mode"] == "reappraisal" \
                and not r.get("llm_failed"):
            last[r["twin"]] = r
    scores, detail = {}, {}
    for twin_id, r in sorted(last.items()):
        twin = twins.get(twin_id)
        if not twin:
            continue
        hits = _transcript_hits(twin, r["primary_driver"])
        scores[twin_id] = min(1.0, hits / SUPPORT_DIVISOR)
        detail[twin_id] = {"driver": r["primary_driver"], "day": r["day"], "hits": hits,
                           "score": round(scores[twin_id], 3)}
    value = sum(scores.values()) / len(scores) if scores else None
    return {"value": None if value is None else round(value, 4),
            "per_twin": detail, "measured": len(scores)}


def _combine(stab, supp, reason=None):
    reasons = [message for message in (reason, stab.get("low_sample_reason")) if message]
    reason = ". ".join(reasons) or None
    if stab["value"] is None or supp["value"] is None:
        missing = "no supported reappraisal with enough usable seeds" if supp["value"] is None else "no measurable twins"
        reason = f"{missing}. {reason}" if reason else missing
        return {"value": None, "stability": stab["value"], "support": supp["value"],
                "unmeasured": True, "reason": reason,
                "detail": {"stability": stab, "support": supp}}

    value = STABILITY_WEIGHT * stab["value"] + SUPPORT_WEIGHT * supp["value"]
    return {
        "value": round(value, 4),
        "stability": stab["value"],
        "support": supp["value"],
        "unmeasured": False,
        "reason": reason,
        "partial": bool(reason),
        "low_confidence": value < 0.5,
        "detail": {"stability": stab, "support": supp},
    }


def confidence(rows_by_seed, day, twins, default_seed=0):
    """SPEC 6.5 on the headline conclusion: the break day."""
    stab = stability(rows_by_seed, day)
    measured_reappraisers = {
        twin for twin, detail in stab["per_twin"].items()
        if detail["reappraisal_seeds_used"] >= MIN_SEEDS_FOR_STABILITY
    }
    default_rows = next((rs for rs in rows_by_seed if rs and rs[0]["seed"] == default_seed), [])
    supp = support([r for r in default_rows if r["twin"] in measured_reappraisers], day, twins)
    failed_samples = sum(r.get("llm_failed", False) for rs in rows_by_seed for r in rs if r["day"] == day)
    reason = f"{failed_samples} break-day samples excluded as fallbacks" if failed_samples else None
    return _combine(stab, supp, reason)


def whatif_confidence(rows_by_seed, lost_twins, from_day, days, twins, default_seed=0):
    """SPEC 6.5 on a what-if conclusion ("3 of 4 return").

    stability: do the lost twins land on the same shop on the last day across seeds?
    support:   is the driver of each lost twin's deciding reappraisal in their transcript?
    """
    only = set(lost_twins)
    if not only:
        return {"value": None, "stability": None, "support": None, "unmeasured": True,
                "reason": "baseline lost nobody, so there is nothing to bring back"}
    usable_runs, excluded_seeds = [], set()
    for seed_rows in rows_by_seed:
        window = [r for r in seed_rows if r["day"] <= days]
        if any(r.get("llm_failed") for r in window):
            excluded_seeds.update(r["seed"] for r in window)
            window = [{**r, "llm_failed": True} for r in window]
        usable_runs.append(window)
    stab = stability(usable_runs, days, only)
    evidence_seeds = {twin: set() for twin in only}
    for seed_rows in usable_runs:
        for r in seed_rows:
            if r["twin"] in only and r["day"] >= from_day and r["mode"] == "reappraisal" and not r.get("llm_failed"):
                evidence_seeds[r["twin"]].add(r["seed"])
    measured = {twin for twin, seeds in evidence_seeds.items()
                if len(seeds) >= MIN_SEEDS_FOR_STABILITY
                and stab["per_twin"].get(twin, {}).get("score") is not None}
    default_rows = next((rs for rs in usable_runs if rs and rs[0]["seed"] == default_seed), [])
    supp = branch_support(default_rows, measured, from_day, twins)
    reason = f"{len(excluded_seeds)} branch seeds excluded because their trajectories contain fallbacks" if excluded_seeds else None
    return _combine(stab, supp, reason)
