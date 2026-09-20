"""Fixture generator: schema-valid fake trajectories (BACKEND_PLAN 3, B2 hour 0-1).

Emits the SPEC 7.1 target scenario as scripted rows so the analyzer can be built and
tested before the engine produces anything. EXPECTED_ANALYSIS below is the oracle the
real analyzer must reproduce from these rows.

Canonical seed-0 story, baseline:
  day 4   simffee opens 07:00 (+3k latte). Six twins with usual_time < 07:00 are
          disrupted at score 1.0, source hours. Four switch, two skip.
  day 5-7 T06 and T07 come back to simffee; T01/T02/T05 stay at Starbucks; T08 keeps
          skipping. Day-7 split is simffee 4 / starbucks 5 / none 1, per SPEC 8.
  lost    T01, T02, T05, T08. T05 also leaves under cf_null, so 3 are ours and 1 was
          going anyway.
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "tests" / "fixtures" / "runs"

SEEDS = [0, 1, 2, 3, 4]
DAYS = 7
ALPHA = 0.15
DELTA = 0.05

# --- the scripted canonical run (seed 0) -------------------------------------------
# twin -> day -> (choice, primary, secondary). Absent day = autopilot at the regular shop.
# `none` means the twin skipped.

BASELINE = {
    "T01": {4: ("starbucks", "hours", "curiosity"),
            5: ("starbucks", "curiosity", "habit"),
            6: ("starbucks", "habit", "curiosity"),
            7: ("starbucks", "habit", None)},
    "T02": {4: ("starbucks", "hours", "social"),
            5: ("starbucks", "social", "curiosity"),
            6: ("starbucks", "habit", "social"),
            7: ("starbucks", "habit", None)},
    "T05": {4: ("starbucks", "hours", "curiosity"),
            5: ("starbucks", "curiosity", "quality"),
            6: ("starbucks", "habit", "curiosity"),
            7: ("starbucks", "habit", None)},
    "T06": {4: ("starbucks", "hours", "price"),
            5: ("simffee", "price", "habit"),
            6: ("simffee", "habit", None),
            7: ("simffee", "habit", None)},
    "T07": {4: ("none", "hours", "habit"),
            5: ("simffee", "habit", "wait"),
            6: ("simffee", "habit", None),
            7: ("simffee", "habit", None)},
    "T08": {4: ("none", "habit", None),
            5: ("none", "habit", None),
            6: ("none", "habit", None),
            7: ("none", "habit", None)},
}

# cf_null: nothing changes, so nobody is disrupted -- except T05, who hits a wait
# disruption on day 6 and leaves anyway. See KNOWN_GAPS.
CF_NULL = {
    "T05": {6: ("starbucks", "wait", "curiosity"),
            7: ("starbucks", "curiosity", "habit")},
}

# Forks share baseline days 1-4, then diverge from day 5 (SPEC 5.1).
CF_RESTORE_HOURS = {
    "T01": {5: ("simffee", "habit", "hours"), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
    "T02": {5: ("simffee", "habit", "hours"), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
    "T05": {5: ("starbucks", "curiosity", "quality"), 6: ("starbucks", "habit", "curiosity"), 7: ("starbucks", "habit", None)},
    "T06": {5: ("simffee", "habit", "hours"), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
    "T07": {5: ("simffee", "habit", None), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
    "T08": {5: ("simffee", "habit", None), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
}

CF_DISCOUNT = {
    "T01": {5: ("starbucks", "curiosity", "habit"), 6: ("starbucks", "habit", "curiosity"), 7: ("starbucks", "habit", None)},
    "T02": {5: ("simffee", "price", "habit"), 6: ("simffee", "habit", "price"), 7: ("simffee", "habit", None)},
    "T05": {5: ("starbucks", "curiosity", "quality"), 6: ("starbucks", "habit", "curiosity"), 7: ("starbucks", "habit", None)},
    "T06": {5: ("simffee", "price", "habit"), 6: ("simffee", "habit", None), 7: ("simffee", "habit", None)},
    "T07": {5: ("none", "hours", "habit"), 6: ("simffee", "habit", "wait"), 7: ("simffee", "habit", None)},
    "T08": {5: ("none", "habit", None), 6: ("none", "habit", None), 7: ("none", "habit", None)},
}

SCRIPTS = {
    "baseline": BASELINE,
    "cf_null": CF_NULL,
    "cf_discount": CF_DISCOUNT,
    "cf_restore_hours": CF_RESTORE_HOURS,
}

# Per-seed wobble on the break day, so stability is < 1.0 and actually measures something
# (SPEC 6.5). seed -> twin -> day -> replacement (choice, primary, secondary).
WOBBLE = {
    1: {"T06": {4: ("none", "hours", "habit")}},
    2: {"T07": {4: ("starbucks", "hours", "curiosity")}},
    3: {"T06": {4: ("none", "hours", "habit")},
        "T02": {4: ("simffee", "habit", "hours")}},
    4: {"T07": {4: ("starbucks", "hours", "curiosity")},
        "T05": {4: ("none", "hours", "habit")}},
}

REASONING = {
    ("T01", 4): "My place wasn't open at 6:45. I had to go somewhere anyway, and Starbucks has that cold brew Linh keeps talking about.",
    ("T02", 4): "Shut at 6:40. My sister swears by the fall menu, so I walked over. I have to be at school by 7:30 regardless.",
    ("T05", 4): "Six thirty and the door was locked. My break is nine minutes. Starbucks opens at six, so that's where I went.",
    ("T06", 4): "Closed when I got there. Went to Starbucks instead, but seventy thousand for a cold brew is absurd.",
    ("T07", 4): "Not open. I couldn't name anywhere else nearby and I wasn't walking across town, so I skipped it today.",
    ("T08", 4): "Locked at 6:40. I don't go anywhere else. I'll just go without today.",
    ("T05", 6): "Queue was out the door and my shift starts at seven. Walked to Starbucks instead and it was quicker.",
}

DEFAULT_REASONING = {
    "autopilot": "Same as every day.",
    "simffee": "Back to my usual. It's closer and I know the order.",
    "starbucks": "Stayed where I went yesterday. It works well enough.",
    "none": "Skipped it again today.",
}

# The oracle. The real analyzer must reproduce this from the seed-0 fixture rows.
EXPECTED_ANALYSIS = {
    "break_day": 4,
    "naive": {"driver": "price", "magnitude": 0.333, "label": "Price +3k"},
    "actual": {"driver": "hours", "histogram": {"hours": 5.0, "habit": 1.5, "curiosity": 1.0, "price": 0.5, "social": 0.5}},
    "surprise": True,
    "impact": {"lost_total": 4, "lost_by_decision": 3, "lost_anyway": 1,
               "lost_twins": ["T01", "T02", "T05", "T08"], "anyway_twins": ["T05"]},
    "whatif": {"cf_restore_hours": {"returns": 3, "of": 4}, "cf_discount": {"returns": 1, "of": 4}},
    "day7_split": {"simffee": 4, "starbucks": 5, "none": 1},
}

# Things the fixture asserts that the engine cannot currently produce. See the report.
KNOWN_GAPS = [
    "cf_null is a frozen world under SPEC 2.3: with no disruption nobody ever reappraises, "
    "so the control arm loses zero customers by construction and lost_anyway can never be "
    "non-zero. This fixture gives T05 a day-6 wait disruption to make the subtraction in "
    "SPEC 6.4 testable. The engine needs some natural source of variation in cf_null.",
    "T10 cannot be pulled in by cf_discount: habit[starbucks] 0.867 keeps her on autopilot, "
    "and disruption is only ever computed for a twin's regular shop. She stays at Starbucks "
    "in every branch here, so cf_discount shows no offsetting new customer.",
]


def load():
    twins = {}
    for f in sorted((DATA / "twins").glob("*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        twins[t["id"]] = t
    shops = json.loads((DATA / "shops.json").read_text(encoding="utf-8"))
    scenarios = {}
    for f in sorted((DATA / "scenarios").glob("*.json")):
        s = json.loads(f.read_text(encoding="utf-8"))
        if s.get("bundle", True):           # the S2 family is run by the engine, not scripted
            scenarios[s["id"]] = s
    return twins, shops, scenarios


def resolve(shops, scenarios, scenario_id, day):
    """SPEC 3.3: parent overrides then child, ordered by from_day, dotted keys."""
    chain = []
    sid = scenario_id
    while sid:
        chain.append(scenarios[sid])
        sid = scenarios[sid].get("parent")
    state = json.loads(json.dumps(shops))
    for sc in reversed(chain):
        for ov in sorted(sc["overrides"], key=lambda o: o["from_day"]):
            if day < ov["from_day"]:
                continue
            for key, val in ov["set"].items():
                node = state[ov["shop"]]
                parts = key.split(".")
                for p in parts[:-1]:
                    node = node[p]
                node[parts[-1]] = val
    return state


def regular_of(twin):
    h = twin["mechanism"]["habit"]
    return max(h, key=h.get)


def disruption_for(twin, scenario_id, day):
    """Only the sources this fixture actually exercises."""
    if scenario_id == "cf_null":
        if twin["id"] == "T05" and day >= 6:
            return {"score": 0.6, "source": "wait"}
        return {"score": 0.0, "source": "none"}
    hours_changed = day >= 4 and (scenario_id != "cf_restore_hours" or day < 5)
    if hours_changed and regular_of(twin) == "simffee":
        if twin["profile"]["usual_time"] < "07:00":
            return {"score": 1.0, "source": "hours"}
    return {"score": 0.0, "source": "none"}


def script_for(scenario_id, seed):
    """Baseline days 1-4 are shared by every fork (SPEC 5.1); forks own days 5-7.

    cf_null has no parent and no overrides, so it carries none of the baseline script.
    """
    if scenario_id == "cf_null":
        return {t: dict(d) for t, d in CF_NULL.items()}

    script = {t: dict(d) for t, d in BASELINE.items()}
    if scenario_id != "baseline":
        for t in set(script) | set(SCRIPTS[scenario_id]):
            shared = {d: v for d, v in script.get(t, {}).items() if d <= 4}
            shared.update(SCRIPTS[scenario_id].get(t, {}))
            script[t] = shared

    for twin, days in WOBBLE.get(seed, {}).items():
        script.setdefault(twin, {}).update(days)
    return script


def run(scenario_id, seed, twins, shops, scenarios):
    script = script_for(scenario_id, seed)
    habit = {t: dict(tw["mechanism"]["habit"]) for t, tw in twins.items()}
    latent = {t: dict(tw["mechanism"]["latent_interest"]) for t, tw in twins.items()}
    rows = []

    for day in range(1, DAYS + 1):
        today = resolve(shops, scenarios, scenario_id, day)
        for tid in sorted(twins):
            tw = twins[tid]
            regular = regular_of(tw)
            entry = script.get(tid, {}).get(day)
            disr = disruption_for(tw, scenario_id, day)

            if entry is None:
                choice, primary, secondary = regular, "habit", None
                mode = "autopilot"
            else:
                choice, primary, secondary = entry
                mode = "reappraisal"

            order = tw["profile"]["usual_order"]
            spent = 0 if choice == "none" else today[choice]["price"][order]
            state_before = {"habit": {k: round(v, 3) for k, v in habit[tid].items()},
                            "latent_interest": {k: round(v, 3) for k, v in latent[tid].items()}}

            if choice != "none":
                habit[tid][choice] = habit[tid][choice] + ALPHA * (1 - habit[tid][choice])
                for other in habit[tid]:
                    if other != choice:
                        habit[tid][other] *= (1 - DELTA)
                if choice in latent[tid]:
                    latent[tid][choice] = 0.0
            else:
                for other in habit[tid]:
                    habit[tid][other] *= (1 - DELTA)

            if choice == "none":
                valence = -0.5
            elif mode == "autopilot":
                valence = 0.3
            elif tid == "T06" and choice == "starbucks":
                valence = -0.4
            elif choice == "starbucks":
                valence = 0.4
            else:
                valence = 0.2

            reasoning = REASONING.get((tid, day))
            if reasoning is None:
                reasoning = DEFAULT_REASONING["autopilot"] if mode == "autopilot" else DEFAULT_REASONING[choice]

            told = []
            if mode == "reappraisal" or day >= 4:
                links = tw["mechanism"]["social_links"]
                if tw["mechanism"]["talkativeness"] >= 0.4 and links:
                    told = [links[(day + seed) % len(links)]]

            rows.append({
                "scenario": scenario_id, "seed": seed, "day": day, "twin": tid,
                "mode": mode,
                "disruption": disr,
                "state_before": state_before,
                "choice": choice, "spent": spent, "abandoned": choice == "none",
                "primary_driver": primary, "secondary_driver": secondary,
                "valence": valence,
                "reasoning": reasoning,
                "state_after": {"habit": {k: round(v, 3) for k, v in habit[tid].items()},
                                "latent_interest": {k: round(v, 3) for k, v in latent[tid].items()}},
                "told": told,
                "llm_failed": False,
            })
    return rows


def main():
    twins, shops, scenarios = load()
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for sid in ("baseline", "cf_null", "cf_discount", "cf_restore_hours"):
        d = OUT / sid
        d.mkdir(parents=True, exist_ok=True)
        for seed in SEEDS:
            rows = run(sid, seed, twins, shops, scenarios)
            assert len(rows) == len(twins) * DAYS, (sid, seed, len(rows))
            (d / f"{seed}.jsonl").write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
            total += len(rows)
    (OUT.parent / "expected_analysis.json").write_text(
        json.dumps(EXPECTED_ANALYSIS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {total} rows to {OUT.relative_to(ROOT)}")
    print(f"oracle: {(OUT.parent / 'expected_analysis.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
