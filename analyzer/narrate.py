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
    """Two sentences, or None with a reason. Never raises on a bad reply.

    `complete_json` is injected so this is testable without an API key; it defaults to
    the engine's transport.
    """
    if complete_json is None:
        from engine.llm import complete_json as default_transport
        complete_json = default_transport

    payload = payload_for(analysis)
    user = json.dumps(payload, ensure_ascii=False, indent=2)

    last = None
    for attempt in range(retries + 1):
        try:
            reply, _usage = complete_json(SYSTEM, user, SCHEMA, 0.7 if attempt == 0 else 0.3)
        except Exception as exc:
            last = f"transport failed: {exc}"
            continue

        text = (reply.get("narration") or "").strip()
        if not text:
            last = "empty narration"
            continue

        bad = unsupported_numbers(text, payload)
        if bad:
            last = f"invented numbers {bad}"
            continue

        return {"narration": text, "attempts": attempt + 1, "rejected": None}

    return {"narration": None, "attempts": retries + 1, "rejected": last}
