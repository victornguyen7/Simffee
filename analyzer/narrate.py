"""SPEC 6.6 — the one LLM call in the analyzer, and the only place prose is generated.

It receives the computed analysis and returns two sentences. It is never allowed to
produce a number: BACKEND_PLAN 4 requires that a narration containing a digit sequence
absent from its input be rejected and retried once. That check is `unsupported_numbers`
below, and it is the reason this module exists as its own file rather than a prompt
inlined in build_runs.

Transport is engine.llm.complete_json, the same client B1 uses, so there is one place
that talks to the API.
"""

import json
import re

SYSTEM = """You write two sentences for a dashboard panel explaining why a coffee shop's \
sales fell and what actually caused it.

Rules, all mandatory:
- Exactly two sentences. Plain past tense. No heading, no preamble, no bullet points.
- Use ONLY numbers that appear in the JSON you are given. Never compute, round, \
restate as a percentage, or invent a figure.
- Prefer naming no numbers at all over naming a wrong one.
- Say what the obvious reading was, and what the mechanism actually turned out to be.
- Never mention twins by id, the simulation, seeds, models, or yourself."""

SCHEMA = {
    "type": "object",
    "properties": {"narration": {"type": "string"}},
    "required": ["narration"],
    "additionalProperties": False,
}

NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _numbers_in(value):
    """Every digit sequence anywhere in a nested structure, normalised."""
    out = set()
    if isinstance(value, dict):
        for v in value.values():
            out |= _numbers_in(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            out |= _numbers_in(v)
    elif isinstance(value, bool) or value is None:
        pass
    elif isinstance(value, (int, float)):
        out.add(_normalise(value))
        if isinstance(value, float):
            out.add(_normalise(round(value * 100)))   # 0.76 may be written as 76
    elif isinstance(value, str):
        for m in NUMBER.findall(value):
            out.add(_normalise(m))
    return out


def _normalise(token):
    text = str(token).replace(",", "")
    try:
        number = float(text)
    except ValueError:
        return text
    return str(int(number)) if number == int(number) else str(number)


def unsupported_numbers(text, payload):
    """Digit sequences in `text` that do not appear anywhere in `payload`."""
    allowed = _numbers_in(payload)
    return sorted({_normalise(m) for m in NUMBER.findall(text)} - allowed)


def payload_for(analysis):
    """The narrow slice the model is allowed to see. Nothing else reaches the prompt."""
    return {
        "break_day": analysis["break_day"],
        "obvious_reading": analysis["naive"]["label"],
        "obvious_driver": analysis["naive"]["driver"],
        "actual_driver": analysis["actual"]["driver"],
        "customers_lost": analysis["impact"]["lost_total"],
        "lost_due_to_the_change": analysis["impact"]["lost_by_decision"],
        "lost_anyway": analysis["impact"]["lost_anyway"],
        "switchers": len(analysis["actual"]["switchers"]),
    }


def narrate(analysis, complete_json=None, retries=1):
    """Render two factual sentences without a model; legacy transport arguments are ignored."""
    result = {"narration": None, "attempts": 0, "rejected": None, "source": "deterministic"}
    if not analysis.get("complete") or analysis.get("break_day") is None:
        return {**result, "rejected": "incomplete evidence or no measured break"}
    if analysis.get("confidence", {}).get("unmeasured", True):
        return {**result, "rejected": "confidence is unmeasured"}
    drivers = {
        "hours": "opening hours", "price": "price", "habit": "habit",
        "curiosity": "curiosity", "social": "word of mouth", "wait": "waiting time",
        "distance": "distance", "product": "product availability", "quality": "quality",
        "marketing": "marketing", "closed": "the closure",
    }
    payload = payload_for(analysis)
    if any(type(payload[k]) is not int or payload[k] < 0 for k in
           ("break_day", "customers_lost", "lost_due_to_the_change", "lost_anyway")):
        return {**result, "rejected": "invalid analysis counts"}
    if payload["customers_lost"] != payload["lost_due_to_the_change"] + payload["lost_anyway"]:
        return {**result, "rejected": "inconsistent impact counts"}
    naive, actual = drivers.get(payload["obvious_driver"]), drivers.get(payload["actual_driver"])
    if naive is None or actual is None:
        return {**result, "rejected": "driver is unmeasured"}
    verb = "jumped" if analysis.get("direction") == "rise" else "broke"
    text = (
        f"Sales {verb} on day {payload['break_day']}; the obvious explanation was {naive}. "
        f"Recorded decisions pointed to {actual}; {payload['customers_lost']} customers were lost, "
        f"with {payload['lost_due_to_the_change']} attributed to the change and "
        f"{payload['lost_anyway']} also lost in the control."
    )
    entrant_text = _entrant_sentence(analysis, drivers)
    if entrant_text:
        text = entrant_text + " " + text
    return {**result, "narration": text}


def _entrant_sentence(analysis, drivers):
    """ROADMAP B5 — the S2 template leads with the flows: who went to the entrant, and why.
    Every number is a count read straight from `analysis['flows']`."""
    question = analysis.get("question") or {}
    entrant = question.get("entrant")
    flow = analysis.get("flows")
    if not entrant or not flow:
        return None
    to_them = flow["totals"]["lost_to"].get(entrant["shop"], [])
    back = flow["totals"]["returned"]
    kept = flow["end"]["kept"]
    lost_drivers = {}
    for day in flow["by_day"]:
        for driver, n in day["lost_to"].get(entrant["shop"], {}).get("drivers", {}).items():
            lost_drivers[driver] = lost_drivers.get(driver, 0) + n
    why = max(lost_drivers, key=lambda d: (lost_drivers[d], d), default=None)
    why_text = f", mostly citing {drivers.get(why, why)}" if why else ""
    return (
        f"A competitor opened on day {entrant['day']}; {len(to_them)} customers went to it at "
        f"least once{why_text}, {len(kept)} never left, and {len(back)} came back."
    )
