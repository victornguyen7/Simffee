"""ROADMAP §2 — which question the analysis answers, chosen from the scenario, not guessed.

S1 (incumbent shocked):   sales broke -- what did the owner blame, what actually moved people,
                          who came back under which fix?
S2 (competitor enters):   who did I lose to them, when, why -- and who did I keep or gain?

The S1 template is the v1 analysis (breakpoint -> attribution -> pairwise). S2 adds the
flows block, keyed on the shop that appears mid-run. Both are computed on every run; the
template only says which one leads the answer.
"""

from __future__ import annotations

from typing import Any

EXISTS = "exists_from_day"

QUESTIONS = {
    "incumbent_change": {
        "situation": "incumbent_change",
        "question": "Sales broke -- what did the owner blame, what actually moved people, "
                    "and who came back under which fix?",
        "leads_with": ["breakpoint", "attribution", "pairwise"],
    },
    "competitor_enters": {
        "situation": "competitor_enters",
        "question": "A competitor opened -- who did I lose to them, when, why, "
                    "and who did I keep or gain?",
        "leads_with": ["flows", "breakpoint", "attribution"],
    },
}


def entrant_of(scenario_files: dict[str, dict[str, Any]], root_id: str,
               focus: str) -> dict[str, Any] | None:
    """The shop that opens mid-run in `root_id`'s chain, if any: {"shop", "day"}.

    An entrant that is the focus shop itself is S3 (launch), not S2; this returns None
    for it so the S1 template still leads until phase C lands."""
    seen: set[str] = set()
    sid: str | None = root_id
    found = None
    while sid and sid in scenario_files and sid not in seen:
        seen.add(sid)
        for ov in scenario_files[sid].get("overrides", []):
            day = ov.get("set", {}).get(EXISTS)
            if isinstance(day, int) and day > 1 and ov["shop"] != focus:
                found = {"shop": ov["shop"], "day": day}
        sid = scenario_files[sid].get("parent")
    return found


def question_for(scenario_files: dict[str, dict[str, Any]], root_id: str,
                 focus: str) -> dict[str, Any]:
    entrant = entrant_of(scenario_files, root_id, focus)
    key = "competitor_enters" if entrant else "incumbent_change"
    return {**QUESTIONS[key], "entrant": entrant}
