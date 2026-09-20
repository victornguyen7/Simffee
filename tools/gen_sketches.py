"""Generate src/sketchPool.json: ~1000 illustrative F&B customer-movement sketches.

Each sketch = lever (what changed) x segment (who moves) x variant (how many, how fast).
`{shop}` / `{rival}` are filled in by the frontend from the loaded set-up. Tags drive the
relevance scoring in src/mockAnswers.ts; they are not shown to the user.

    python tools/gen_sketches.py
"""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "sketchPool.json"

# (id, plural noun, singular noun, where they otherwise go, tags)
SEGMENTS = [
    ("commuters", "commuters", "commuter", "the kiosk by the bus stop", ["commuters", "morning", "office", "rush", "work"]),
    ("students", "students", "student", "the campus canteen", ["students", "budget", "cheap", "young", "campus"]),
    ("laptop", "laptop workers", "laptop worker", "the co-working cafe", ["laptop", "freelancers", "wifi", "remote", "afternoon"]),
    ("parents", "parents on the school run", "parent on the school run", "the park kiosk", ["parents", "families", "kids", "school", "stroller"]),
    ("retirees", "older regulars", "older regular", "the bakery", ["older", "retirees", "regulars", "cash", "chat"]),
    ("tourists", "walk-in tourists", "walk-in tourist", "the chain across the square", ["tourists", "walk-ins", "visitors", "first-timers", "passing"]),
    ("evening", "after-work customers", "after-work customer", "the convenience store", ["evening", "after-work", "night", "late", "shift"]),
    ("gym", "early gym-goers", "early gym-goer", "the juice bar", ["gym", "early", "fitness", "healthy", "runners"]),
]

# (n, m, timing phrase)
VARIANTS = [
    (2, 0, "within the first two days"),
    (3, 1, "by the end of the first week"),
    (2, 0, "only after payday, once the difference is noticed"),
    (4, 2, "gradually over the second week"),
    (2, 1, "on day 3, and it sticks"),
]

# Each lever: id, tags, setup needs, s1 (final-day sign of the n primary movers), s2 (final-day sign of
# the m people in the secondary line: +1/-1 when they are extra customers gained/lost by the final day,
# 0 when the line describes a subset of the primary movers or people who end where they started),
# headline, primary line, secondary line (m>0), secondary line (m==0), drivers.
LEVERS = [
    dict(id="price_cut", tags=["price", "cut", "cheaper", "discount", "lower", "reduce", "40k", "35k"],
         setup=["price"], s1=+1, s2=-1,
         headline="A cheaper cup at {shop} pulls in {seg}",
         primary="{n} {seg} who defaulted to {origin} start choosing {shop} for the price",
         secondary="{m} of your regulars read the cut as a quality drop and drift to {rival}",
         secondary0="your regulars pay less and change nothing else",
         drivers=["price", "value"]),
    dict(id="price_raise", tags=["price", "raise", "increase", "expensive", "higher", "70k", "60k"],
         setup=["price"], s1=-1, s2=+1,
         headline="Raising prices at {shop} is felt first by {seg}",
         primary="{n} {seg} notice at the till and move to {origin}",
         secondary="{m} customers read the higher price as better coffee and come over from {rival}",
         secondary0="everyone else pays without checking the board",
         drivers=["price", "habit"]),
    dict(id="open_earlier", tags=["hours", "opening", "earlier", "early", "6am", "dawn"],
         setup=["hours"], s1=+1, s2=+1,
         headline="Opening earlier catches {seg} before anyone else is up",
         primary="{n} {seg} who used to grab coffee at {origin} now start their day at {shop}",
         secondary="{m} of them bring a colleague within the week",
         secondary0="the extra hour is quiet apart from them",
         drivers=["opening hours", "convenience"]),
    dict(id="open_later", tags=["hours", "opening", "later", "9am", "10am", "sleep in"],
         setup=["hours"], s1=-1, s2=0,
         headline="Opening later hands {seg} to whoever is already open",
         primary="{n} {seg} arrive to a closed door and go to {origin} instead",
         secondary="{m} of them had been your most regular faces at the counter",
         secondary0="nobody else's routine changes",
         drivers=["opening hours", "habit"]),
    dict(id="close_later", tags=["hours", "closing", "later", "evening", "night", "8pm", "9pm", "10pm"],
         setup=["hours"], s1=+1, s2=0,
         headline="Staying open later gives {seg} a reason to stop by {shop}",
         primary="{n} {seg} who ended up at {origin} after 6pm now come to {shop}",
         secondary="{m} of them also start coming on weekends",
         secondary0="mornings are unchanged; the gain is entirely after dark",
         drivers=["opening hours", "routine"]),
    dict(id="close_earlier", tags=["hours", "closing", "earlier", "early", "afternoon", "5pm", "4pm"],
         setup=["hours"], s1=-1, s2=0,
         headline="Closing earlier quietly loses {seg}",
         primary="{n} {seg} who came late find the shutter down and settle at {origin}",
         secondary="{m} of them stop coming in the morning too, once the routine breaks",
         secondary0="your morning crowd never notices",
         drivers=["opening hours", "routine"]),
    dict(id="add_pastries", tags=["product", "pastries", "pastry", "croissant", "bakery", "cake", "breakfast"],
         setup=["product:croissant", "product:pastry"], s1=+1, s2=-1,
         headline="Pastries at {shop} turn a coffee stop into breakfast for {seg}",
         primary="{n} {seg} who bought breakfast at {origin} now get everything at {shop}",
         secondary="{m} regulars find the queue slower with food orders and try {rival}",
         secondary0="regulars add a croissant to their usual order and nothing else moves",
         drivers=["product range", "convenience"]),
    dict(id="add_lunch", tags=["product", "lunch", "sandwich", "sandwiches", "bowls", "salad", "noon"],
         setup=["product:sandwich"], s1=+1, s2=+1,
         headline="A lunch menu makes {shop} a second daily stop for {seg}",
         primary="{n} {seg} who ate lunch at {origin} and skipped coffee now come to {shop} at noon",
         secondary="{m} people who never came for coffee come for lunch and then stay for the coffee",
         secondary0="lunch traffic is new; the morning line is unchanged",
         drivers=["product range", "convenience"]),
    dict(id="add_cold", tags=["product", "cold", "iced", "cold brew", "matcha", "bubble tea", "summer"],
         setup=["product:cold brew", "product:iced tea"], s1=+1, s2=0,
         headline="Cold drinks win {seg} who never wanted a hot coffee",
         primary="{n} {seg} who went to {origin} for something cold switch to {shop}",
         secondary="{m} of your regulars swap their afternoon latte for the new drink",
         secondary0="your regulars stick to their hot order",
         drivers=["product range", "novelty"]),
    dict(id="add_milk_alt", tags=["product", "oat", "milk", "soy", "vegan", "dairy", "lactose"],
         setup=["product:latte"], s1=+1, s2=-1,
         headline="Oat and soy options open {shop} up to {seg}",
         primary="{n} {seg} who avoided dairy and drank at {origin} start ordering flat whites at {shop}",
         secondary="{m} regulars grumble about the surcharge and take their custom to {rival}",
         secondary0="regulars ask for dairy and stay once they can have it",
         drivers=["product range", "inclusivity"]),
    dict(id="loyalty", tags=["loyalty", "card", "stamp", "stamps", "rewards", "points", "free coffee"],
         setup=[], s1=+1, s2=0,
         headline="A loyalty card locks in {seg} who were already half-loyal",
         primary="{n} {seg} who split their week between {shop} and {origin} consolidate on {shop}",
         secondary="{m} customers come more often just to fill the card faster",
         secondary0="people who never had a routine ignore the card",
         drivers=["loyalty", "habit"]),
    dict(id="student_discount", tags=["discount", "student", "students", "promo", "promotion", "deal"],
         setup=[], s1=+1, s2=-1,
         headline="A targeted discount spreads by word of mouth among {seg}",
         primary="{n} {seg} hear about it from a friend and leave {origin} for {shop}",
         secondary="{m} full-price regulars feel overcharged and try {rival}",
         secondary0="full-price regulars do not notice",
         drivers=["price", "word of mouth"]),
    dict(id="rival_opens", tags=["competitor", "rival", "opens", "new shop", "across the street", "chain", "starbucks", "day 4"],
         setup=["rival"], s1=-1, s2=0,
         headline="{rival} opening nearby draws the curious among {seg}",
         primary="{n} {seg} try {rival} in its first week and do not come back",
         secondary="{m} customers try it, dislike the wait, and return to {shop} for good",
         secondary0="your regulars glance at the new sign and keep walking",
         drivers=["novelty", "competition"]),
    dict(id="rival_raises", tags=["competitor", "rival", "raises", "raise", "increase", "their price", "70k"],
         setup=["rival", "price"], s1=+1, s2=+1,
         headline="{rival} raising prices sends {seg} looking for value",
         primary="{n} {seg} who paid {rival} out of habit switch to {shop} once the bill changes",
         secondary="{m} tablemates who never came before follow them over",
         secondary0="{rival} loyalists pay up and stay",
         drivers=["price", "competition"]),
    dict(id="rival_promo", tags=["competitor", "rival", "promotion", "promo", "two-for-one", "deal", "their discount"],
         setup=["rival"], s1=-1, s2=0,
         headline="A promotion at {rival} borrows {seg} for as long as it runs",
         primary="{n} {seg} switch to {rival} for the deal and keep going after it ends",
         secondary="{m} more only go while it runs and drift back to {shop} the day it ends",
         secondary0="everyone else ignores the flyer",
         drivers=["price", "novelty"]),
    dict(id="revert", tags=["revert", "back", "undo", "original", "before", "was", "used to"],
         setup=["rival"], s1=+1, s2=0,
         headline="Putting things back wins back some of {seg}, not all",
         primary="{n} {seg} who had left return within a week of the old set-up coming back",
         secondary="{m} others who left have settled at {rival} by now and stay there",
         secondary0="nobody else moves; the ones who stayed never noticed the change",
         drivers=["habit", "trust"]),
    dict(id="marketing", tags=["marketing", "ads", "advert", "sign", "flyer", "flyers", "social", "instagram", "reach"],
         setup=[], s1=+1, s2=0,
         headline="Louder marketing reaches {seg} who did not know {shop} existed",
         primary="{n} {seg} who defaulted to {origin} try {shop} for the first time",
         secondary="{m} of them come back a second time; the rest were curious once",
         secondary0="existing regulars are unmoved by the message",
         drivers=["awareness", "marketing"]),
    dict(id="bad_review", tags=["review", "reviews", "reputation", "rating", "complaint", "online", "stars"],
         setup=[], s1=-1, s2=0,
         headline="A bad review changes the minds of {seg} who had not decided yet",
         primary="{n} {seg} read it and pick {origin} instead",
         secondary="{m} regulars ask you about it but keep coming",
         secondary0="regulars trust their own cup and change nothing",
         drivers=["reputation", "habit"]),
    dict(id="wifi_seating", tags=["wifi", "seating", "seats", "sofa", "tables", "chairs", "sit", "space"],
         setup=[], s1=+1, s2=-1,
         headline="Better seating and wifi turn {shop} into a place {seg} linger",
         primary="{n} {seg} who used to sit at {origin} move their afternoons to {shop}",
         secondary="{m} grab-and-go regulars find no free table and go to {rival}",
         secondary0="turnover per seat drops while the room fills up",
         drivers=["amenities", "dwell time"]),
    dict(id="remove_seating", tags=["seating", "remove", "sofa", "tables", "takeaway", "standing", "counter", "window"],
         setup=[], s1=-1, s2=+1,
         headline="Removing the seating clears out {seg}",
         primary="{n} {seg} who came to sit move to {origin}",
         secondary="{m} takeaway customers who avoided the crowded room come back from {rival}",
         secondary0="the queue moves faster but the room feels empty by 3pm",
         drivers=["seating", "dwell time"]),
    dict(id="faster_service", tags=["wait", "queue", "faster", "speed", "staff", "mobile", "app", "second machine"],
         setup=[], s1=+1, s2=+1,
         headline="A shorter wait wins back {seg} who could not spare five minutes",
         primary="{n} {seg} who had given up on the queue at {shop} return from {origin}",
         secondary="{m} walk-ins who saw the shorter line come in on impulse",
         secondary0="regulars notice nothing except that they leave sooner",
         drivers=["wait time", "convenience"]),
    dict(id="slower_service", tags=["wait", "queue", "slower", "understaffed", "short-staffed", "busy", "delay"],
         setup=[], s1=-1, s2=+1,
         headline="A longer wait at {shop} pushes out {seg} first",
         primary="{n} {seg} give up after one too many slow mornings and go to {origin}",
         secondary="{m} of them come back once they hear the line is shorter",
         secondary0="the ones with time to spare stay and complain",
         drivers=["wait time", "patience"]),
    dict(id="quality_up", tags=["quality", "beans", "roast", "better", "machine", "barista", "upgrade", "specialty"],
         setup=[], s1=+1, s2=0,
         headline="Better coffee at {shop} is noticed by {seg} who care about the cup",
         primary="{n} {seg} who drank at {origin} out of convenience switch once they taste the difference",
         secondary="{m} of them start ordering the more expensive pour-over",
         secondary0="most customers cannot tell and carry on as before",
         drivers=["quality", "taste"]),
    dict(id="quality_down", tags=["quality", "worse", "barista leaves", "burnt", "cheaper beans", "machine broke", "inconsistent"],
         setup=[], s1=-1, s2=+1,
         headline="Slipping quality at {shop} costs you {seg} who notice",
         primary="{n} {seg} get two bad cups in a row and move to {origin}",
         secondary="{m} of them return once the old barista is back",
         secondary0="the rest never noticed; the loss is only the people who care",
         drivers=["quality", "trust"]),
    dict(id="weather_access", tags=["rain", "weather", "roadworks", "construction", "heat", "storm", "access", "parking"],
         setup=[], s1=-1, s2=+1,
         headline="Weather and street works reshuffle {seg} by distance alone",
         primary="{n} {seg} pick whichever shop is closest to cover, which is {origin}",
         secondary="{m} people who normally pass {rival} now pass {shop} instead",
         secondary0="both drifts reverse the first dry morning",
         drivers=["distance", "weather"]),
]

VARIANT_EXTRA = [
    "the move happens {when}",
    "the shift shows up {when}",
    "{when}, the pattern is set",
    "it builds {when}",
    "you see it {when}",
]


def net_line(net: int) -> str:
    if net == 0:
        return "0 customers on the final day vs day 1"
    sign = "+" if net > 0 else "\u2212"
    return f"{sign}{abs(net)} customer{'s' if abs(net) != 1 else ''} on the final day vs day 1"


def main() -> None:
    pool = []
    for lever in LEVERS:
        for seg_id, seg, seg_one, origin, seg_tags in SEGMENTS:
            for vi, (n, m, when) in enumerate(VARIANTS):
                fill = dict(n=n, m=m, seg=seg, origin=origin, shop="{shop}", rival="{rival}", when=when)
                primary = lever["primary"].format(**{**fill, "seg": seg_one if n == 1 else seg})
                secondary = (lever["secondary"] if m else lever["secondary0"]).format(**fill)
                extra = VARIANT_EXTRA[vi].format(**fill)
                net = lever["s1"] * n + lever["s2"] * m
                pool.append({
                    "headline": lever["headline"].format(**fill),
                    "movements": [primary, secondary, extra],
                    "drivers": lever["drivers"],
                    "net": net_line(net),
                    "lever": lever["id"],
                    "segment": seg_id,
                })
    out = {
        # tags[0] is the broad topic ("price", "hours"...); the rest are the specific direction/details.
        "levers": {l["id"]: {"tags": l["tags"], "setup": l["setup"]} for l in LEVERS},
        "segments": {s[0]: s[4] for s in SEGMENTS},
        "sketches": pool,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(pool)} sketches -> {OUT}")


if __name__ == "__main__":
    main()
