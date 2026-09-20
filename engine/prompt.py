"""SPEC 4.3 — the reappraisal prompt.

Four blocks in a fixed order: identity, today, options, 3-day memory. Built as
plain text so the whole prompt is readable in the cache file: when a twin
behaves oddly, you read the exact prompt that produced it.
"""

from __future__ import annotations

from typing import Any

from .loader import Twin
from .schema import DRIVERS
from .timeutil import is_open_at

# Which why-transcript lines matter depends on what shocked the twin today.
# Keyword match, no embeddings (SPEC 4.3 block 1).
SOURCE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "hours": ("open", "opens", "early", "morning", "late", "closed", "time", "schedule", "rush"),
    "price": ("price", "cost", "expensive", "cheap", "money", "budget", "pay", "spend", "k "),
    "product": ("order", "menu", "drink", "latte", "americano", "cold brew", "usual"),
    "wait": ("wait", "queue", "line", "slow", "quick", "fast", "minutes"),
    "closed": ("closed", "shut", "gone"),
    "none": ("habit", "always", "every day", "routine", "same", "switch", "hassle"),
}

SYSTEM = """You are role-playing one specific person deciding where to get coffee this morning.

Rules, in order of importance:
1. Answer AS THIS PERSON, in the first person. Never mention being an AI, a model, or an assistant.
2. `primary_driver` must be the REAL reason visible in your own reasoning, not the flattering one.
   If your reasoning is "my place wasn't open, and I was curious anyway", the drivers are
   `hours` and `curiosity` -- NOT `price`. People rationalise; this field does not.
3. Your behaviour log outranks anything you say about yourself. Where the two conflict,
   act like the log, not like the self-description.
4. `reasoning` is at most 40 words, first person, plain and specific.

Return only the JSON object described by the schema."""


def _relevant_lines(twin: Twin, source: str, limit: int = 3) -> list[dict[str, str]]:
    keywords = SOURCE_KEYWORDS.get(source, SOURCE_KEYWORDS["none"])
    scored = []
    for i, line in enumerate(twin.why_transcript):
        text = f"{line['q']} {line['a']}".lower()
        score = sum(1 for kw in keywords if kw in text)
        scored.append((-score, i, line))          # -score, then original order: stable
    scored.sort(key=lambda item: (item[0], item[1]))
    return [line for _, _, line in scored[:limit]]


def _habit_in_words(habit: float, shop_name: str) -> str:
    days = round(habit * 30)
    if habit >= 0.6:
        return f"you have gone to {shop_name} about {days} of the last 30 days"
    if habit >= 0.2:
        return f"you go to {shop_name} now and then, maybe {days} days in 30"
    return f"you almost never go to {shop_name}"


def _latent_in_words(latent: float, shop_name: str, twin: Twin, target_shop: str) -> str:
    """Give latent interest magnitude and context."""
    if latent >= 0.55:
        # High interest - add context about why
        reason = _latent_reason(twin, target_shop)
        return f"you are strongly drawn to {shop_name} — {reason}"
    if latent >= 0.4:
        return f"you have been meaning to try {shop_name} for a while"
    if latent >= 0.2:
        return f"you are mildly curious about {shop_name}"
    if latent > 0.0:
        return f"{shop_name} barely registers with you"
    return f"you have no particular interest in {shop_name}"


def _latent_reason(twin: Twin, shop_id: str) -> str:
    """Determine why the twin has latent interest in a shop."""
    # Check social links who might have mentioned it
    # Check marketing
    # Default fallback
    return "your recorded interest is high, but no specific endorsement is recorded"


def build(
    twin: Twin,
    options: list[dict[str, Any]],
    disr_score: float,
    disr_source: str,
    regular: str,
    history: list[dict[str, Any]],
    shops_today: dict[str, dict[str, Any]],
) -> str:
    p = twin.profile
    out: list[str] = []

    # 1 — identity
    out.append("## Who you are")
    out.append(
        f"{twin.name}, {p['age']}, {p['occupation']}. You normally leave for coffee at "
        f"{p['usual_time']} and order a {p['usual_order']}. You have about "
        f"{p['daily_budget_vnd']:,}d to spend on it, you will walk up to "
        f"{p['walk_tolerance']} blocks, and you lose patience after "
        f"{p['wait_tolerance_min']} minutes of queueing."
    )
    for line in _relevant_lines(twin, disr_source):
        out.append(f"- Asked \"{line['q']}\" you said: \"{line['a']}\"")

    if twin.say_do_gap:
        gap = twin.say_do_gap
        out.append(
            f"\nYou describe yourself this way: \"{gap.get('says', '')}\". "
            f"Your actual 30-day log shows: {gap.get('log_shows', gap.get('does', ''))} "
            f"Act like the log."
        )

    # 2 — today
    out.append("\n## This morning")
    regular_name = shops_today[regular]["name"]
    if disr_source == "none":
        out.append(f"It is {p['usual_time']}. Nothing unusual about {regular_name} today.")
    else:
        out.append(
            f"It is {p['usual_time']}. Something is off at {regular_name}, "
            f"your usual place: {_shock_sentence(disr_source, shops_today[regular], twin)}"
        )
    if not is_open_at(shops_today[regular], twin.usual_time):
        out.append("Your usual place cannot serve you today. You must choose between an alternative or go without coffee.")
    elif twin.usual_order not in shops_today[regular]["products"]:
        out.append("Your usual item is unavailable; consider another item, another shop, or skipping.")

    # 3 — options
    out.append("\n## Your options")
    for opt in options:
        blocks = "block" if opt["distance"] == 1 else "blocks"
        bits = [
            f"{opt['distance']} {blocks} away",
            (f"{opt['price']:,}d for your {p['usual_order']}" if opt["has_usual_order"]
             else f"{opt['price']:,}d for the cheapest available item")
            + ("" if opt["within_budget"] else f" ({opt['price'] - p['daily_budget_vnd']:,}d more than your daily budget)"),
            f"opens {opt['opens']}"
            + ("" if opt["open_at_usual_time"] else f" -- shut at {p['usual_time']}"),
            f"about {opt['avg_wait_min']} min wait",
        ]
        if not opt["has_usual_order"]:
            bits.append(f"no {p['usual_order']} on the menu")
        if opt["marketing"]:
            bits.append(f"currently advertising \"{opt['marketing']}\"")
        label = f"{opt['name']} (your usual place)" if opt["shop"] == regular else opt["name"]
        out.append(f"- **{label}**: " + "; ".join(bits) + ".")
        # Curiosity about the place you already go to every day is not a thing,
        # so the regular shop gets the habit sentence only.
        sense = _habit_in_words(opt["habit"], opt["name"])
        if opt["shop"] != regular:
            if opt.get("visited"):
                sense += "; you have visited before; weigh your experience, not just curiosity"
            else:
                sense += f"; {_latent_in_words(opt['latent_interest'], opt['name'], twin, opt['shop'])}"
        out.append(f"  {sense}.")
    out.append(f"- **Skip it**: no coffee at all today, and you have your full routine ahead of you.")

    # 4 — three-day memory
    if history:
        out.append("\n## The last few mornings")
        for entry in history:
            where = entry["choice"] if entry["choice"] != "none" else "skipped coffee"
            mood = "it was good" if entry["valence"] > 0.2 else (
                "it was not great" if entry["valence"] < -0.2 else "it was fine")
            out.append(f"- Day {entry['day']}: {where}, {mood}. \"{entry['reasoning']}\"")

    out.append(
        f"\nDecide where you go this morning. Allowed drivers: {', '.join(sorted(DRIVERS))}."
    )
    return "\n".join(out)


def _shock_sentence(source: str, shop: dict, twin: Twin) -> str:
    if source == "hours":
        return f"it does not open until {shop['open']}, and you are there at {twin.usual_time}."
    if source == "price":
        return f"the {twin.usual_order} has gone up to {shop['price'][twin.usual_order]:,}d."
    if source == "product":
        return f"they have stopped doing the {twin.usual_order}."
    if source == "wait":
        return f"the queue is running about {shop['avg_wait_min']} minutes."
    if source == "closed":
        return "it has closed for good."
    return "something feels different."


# The response schema the API is constrained to. SPEC 4.3.
DRIVER_ENUM = sorted(DRIVERS)


def response_schema(shop_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "choice": {"type": "string", "enum": sorted(shop_ids) + ["none"]},
            "primary_driver": {"type": "string", "enum": DRIVER_ENUM},
            "secondary_driver": {"type": "string", "enum": DRIVER_ENUM + ["none"]},
            "valence": {"type": "number", "minimum": -1, "maximum": 1},
            "reasoning": {"type": "string"},
        },
        "required": ["choice", "primary_driver", "secondary_driver", "valence", "reasoning"],
        "additionalProperties": False,
    }
