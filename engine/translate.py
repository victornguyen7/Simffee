"""SPEC_FUNCTIONAL 4 / ROADMAP A2 — a sentence becomes a scenario.

One LLM call picks *actions* from the closed list in data/actions.json and fills their
values. Everything after that is deterministic: the actions are validated against the
shops, compiled into override blocks, and wrapped in a Scenario. The model never writes
an override key; it can only choose an action id, a shop, a day, an item, a value.

When a request does not map, the model lists it under `unsupported` with a reason and the
nearest action it *can* run. The caller shows that. Saying no is a feature.

Transport is engine.llm.complete_json — the same client the twins use. Translations are
cached by sha1(text, parent, shops, actions, model) under cache/translations/, so the same
question twice costs nothing.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from functools import partial
from pathlib import Path
from typing import Any

from . import llm
from .loader import DATA, Scenario, load_chain, load_shops, scenario_from_dict
from .loop import scenario_days
from .resolve import EXISTS, resolve

ACTIONS_PATH = DATA / "actions.json"
TRANSLATION_CACHE = Path(__file__).resolve().parent.parent / "cache" / "translations"

TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SLUG_RE = re.compile(r"[^a-z0-9]+")


def load_actions(path: Path = ACTIONS_PATH) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


# --- the request the model answers ------------------------------------------------------

SYSTEM = """You turn a coffee-shop owner's plain-language plan into a list of ACTIONS from a fixed menu.

Rules, all mandatory:
- Use ONLY action ids from the menu. If part of the request needs something not on the menu, put it \
under `unsupported` with a one-sentence reason and the nearest menu action (or null). Never improvise.
- Every action names a shop id from the shop list. "we", "our", "my shop", "I" mean the focus shop.
- `from_day` is the simulated day the action starts. Default is the day after the current break \
(given below). Never before day 2. "From tomorrow" means the default. "A week later" adds 7.
- Prices are integers in VND. "40k" is 40000. A percentage change applies to the shop's current price \
of that item; compute the integer.
- Times are "HH:MM", 24-hour. "6am" is "06:00"; "6" alone for an opening time is "06:00".
- `item` is a lowercase slug (latte, cold_brew, croissant). For a new product use add_item with its price.
- `restore` undoes an earlier change in this chain: its `value` is the field to restore (open, price.latte, ...).
- `shop_enters` means a shop OTHER than the focus shop did not exist until `from_day`, the day it opens \
("Starbucks opens on day 4" -> shop starbucks, from_day 4). Only for a competitor; never for the focus shop.
- `label` is at most 8 words, in the owner's voice.
- `situation` is "incumbent_change" if only the focus shop changes, "competitor_change" if only another \
shop changes, "competitor_enters" if a shop_enters action is present, "mixed" if both kinds change.
Return only the JSON object described by the schema."""


def response_schema(shop_ids: list[str], action_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "situation": {"type": "string", "enum": ["incumbent_change", "competitor_change", "competitor_enters", "mixed", "unsupported"]},
            "focus_shop": {"type": "string", "enum": sorted(shop_ids)},
            "label": {"type": "string"},
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": sorted(action_ids)},
                        "shop": {"type": "string", "enum": sorted(shop_ids)},
                        "from_day": {"type": "integer"},
                        "item": {"type": ["string", "null"]},
                        "value": {"type": ["string", "number", "null"]},
                    },
                    "required": ["action", "shop", "from_day", "item", "value"],
                    "additionalProperties": False,
                },
            },
            "unsupported": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "reason": {"type": "string"},
                        "nearest": {"type": ["string", "null"]},
                    },
                    "required": ["text", "reason", "nearest"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["situation", "focus_shop", "label", "actions", "unsupported"],
        "additionalProperties": False,
    }


def changes_in_effect(chain: list[Scenario], shops: dict[str, dict[str, Any]], day: int) -> list[str]:
    """Human-readable list of what this chain has already changed by `day`, base -> now,
    so the model knows what `restore` can undo."""
    now = resolve(shops, chain, day)
    lines = []
    for sc in chain:
        for ov in sc.overrides:
            if ov["from_day"] > day:
                continue
            sid = ov["shop"]
            for field in ov.get("set", {}):
                base = _dotted(shops[sid], field)
                cur = _dotted(now[sid], field)
                lines.append(f"- {sid}: `{field}` {base!r} -> {cur!r} (since day {ov['from_day']})")
            for field in ov.get("unset", []):
                lines.append(f"- {sid}: `{field}` restored to base on day {ov['from_day']}")
    return lines


def _dotted(node: Any, dotted: str) -> Any:
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def user_message(text: str, shops_now: dict[str, dict[str, Any]], focus: str,
                 default_day: int, days: int, actions: dict[str, Any],
                 changes: list[str] | None = None) -> str:
    menu = "\n".join(
        f"- {aid}: sets `{a['field']}`; value is {a['value'] or 'none'}"
        + ("; needs `item`" if a.get("needs_item") else "")
        + f". e.g. {' / '.join(a['phrases'][:3])}"
        for aid, a in actions["actions"].items()
    )
    shop_lines = []
    for sid, s in shops_now.items():
        prices = ", ".join(f"{k} {v:,}" for k, v in s["price"].items())
        shop_lines.append(
            f"- {sid} ({s['name']}){' — the focus shop, i.e. \"we\"' if sid == focus else ''}: "
            f"open {s['open']}–{s['close']}; prices {prices}; products {', '.join(s['products'])}; "
            f"wait {s['avg_wait_min']} min; quality {s.get('quality')}; "
            f"marketing reach {s.get('marketing', {}).get('reach')}"
        )
    examples = "\n".join(f"- \"{u['text']}\" → {u['reason']}" for u in actions["unsupported_examples"])
    changed = ("\n".join(changes) if changes
               else "- nothing; every shop is at its base state, so `restore` has nothing to undo")
    return (
        f"## Shops as they stand today (day {default_day - 1})\n" + "\n".join(shop_lines) +
        f"\n\n## Changes already in effect in this scenario (what `restore` can undo)\n{changed}" +
        f"\n\n## Action menu\n{menu}\n\n"
        f"## Things that are NOT on the menu (say so, do not improvise)\n{examples}\n\n"
        f"## Timing\nThe run is {days} days long. The default `from_day` for new actions is {default_day}.\n\n"
        f"## The owner's request\n\"{text.strip()}\""
    )


# --- deterministic compile + validate ---------------------------------------------------

def slug(item: str | None) -> str | None:
    if item is None:
        return None
    return SLUG_RE.sub("_", str(item).strip().lower()).strip("_") or None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    if isinstance(value, str):
        m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*([kK])?\s*", value)
        if m:
            n = float(m.group(1).replace(",", "."))
            return int(round(n * (1000 if m.group(2) else 1)))
    return None


def _as_fraction(value: Any) -> float | None:
    """0–1 as given; an explicit '85%' or a whole number 2–100 reads as a percentage.
    1.7 is neither and is rejected rather than silently becoming 0.017."""
    if isinstance(value, bool):
        return None
    percent = isinstance(value, str) and value.strip().endswith("%")
    if isinstance(value, str):
        try:
            v = float(value.strip().rstrip("%"))
        except ValueError:
            return None
    elif isinstance(value, (int, float)):
        v = float(value)
    else:
        return None
    if percent:
        return v / 100
    if v <= 1.0:
        return v
    if 2 <= v <= 100 and v.is_integer():
        return v / 100
    return None


def _as_time(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    s = value.strip().lower().replace(" ", "")
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?(am|pm)?", s)
    if not m:
        return None
    h, mnt, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    t = f"{h:02d}:{mnt:02d}"
    return t if TIME_RE.match(t) else None


def compile_actions(reply: dict[str, Any], parent_chain: list[Scenario],
                    shops: dict[str, dict[str, Any]], actions: dict[str, Any],
                    scenario_id: str, source_text: str) -> tuple[dict[str, Any] | None, list[str]]:
    """Reply -> (scenario dict, problems). A non-empty problems list means invalid."""
    limits = actions["limits"]
    menu = actions["actions"]
    problems: list[str] = []
    acts = reply.get("actions") or []
    if len(acts) > limits["max_actions"]:
        problems.append(f"too many actions ({len(acts)} > {limits['max_actions']})")
        acts = acts[:limits["max_actions"]]

    parent = parent_chain[-1] if parent_chain else None
    parent_days = scenario_days(parent_chain) if parent_chain else 7
    default_day = (parent.from_day + 1) if parent else 2

    focus = reply.get("focus_shop") if reply.get("focus_shop") in shops else next(iter(shops))

    # Group by (shop, day) into override blocks; keep insertion order for readability.
    blocks: dict[tuple[str, int], dict[str, Any]] = {}
    entrants: dict[str, int] = {}          # ROADMAP B5: shop -> the day it opens
    max_day = 0
    for i, a in enumerate(acts):
        aid, sid = a.get("action"), a.get("shop")
        if aid not in menu:
            problems.append(f"action {i}: unknown action {aid!r}")
            continue
        if sid not in shops:
            problems.append(f"action {i}: unknown shop {sid!r}")
            continue
        if aid == "shop_enters":
            open_day = a.get("from_day") if isinstance(a.get("from_day"), int) else _as_int(a.get("value"))
            if sid == focus:
                problems.append(f"action {i}: shop_enters is for a competitor; launching the focus shop "
                                f"itself is not simulatable yet (roadmap C)"); continue
            if open_day is None or open_day < limits["min_from_day"]:
                problems.append(f"action {i}: shop_enters needs the opening day (>= {limits['min_from_day']})"); continue
            if any(ov["shop"] == sid and EXISTS in ov.get("set", {}) for sc in parent_chain for ov in sc.overrides):
                problems.append(f"action {i}: {sid!r} already enters mid-run in this chain"); continue
            entrants[sid] = open_day
            max_day = max(max_day, open_day)
            continue
        day = a.get("from_day")
        if not isinstance(day, int):
            day = default_day
        if day < limits["min_from_day"]:
            problems.append(f"action {i}: from_day {day} is before day {limits['min_from_day']}")
            continue
        max_day = max(max_day, day)
        block = blocks.setdefault((sid, day), {"from_day": day, "shop": sid, "set": {}, "unset": []})
        # The shop as it would stand the day before this action, along this chain plus
        # earlier blocks of this plan -- so add_item builds on the real product list.
        provisional = scenario_from_dict({"id": "_p", "parent": parent.id if parent else None,
                                          "overrides": [b for b in blocks.values() if b["from_day"] < day]})
        state = resolve(shops, parent_chain + [provisional], day - 1)[sid] if parent_chain else \
            resolve(shops, [provisional], day - 1)[sid]
        item = slug(a.get("item"))
        val = a.get("value")
        spec = menu[aid]

        if aid in ("set_open", "set_close"):
            t = _as_time(val)
            if not t:
                problems.append(f"action {i}: {aid} needs a time, got {val!r}"); continue
            block["set"][spec["field"]] = t
        elif aid == "set_price":
            n = _as_int(val)
            if not item or n is None:
                problems.append(f"action {i}: set_price needs item and VND value"); continue
            planned = set(state["products"]) | {k.split(".", 1)[1] for k in block["set"] if k.startswith("price.")}
            if item not in planned:
                problems.append(f"action {i}: {item!r} is not on {sid}'s menu; use add_item"); continue
            base = shops[sid]["price"].get(item)
            lo, hi = limits["price_ratio"]
            if base and not (base * lo <= n <= base * hi):
                problems.append(f"action {i}: price {n} for {item} is outside {lo}x–{hi}x of {base}"); continue
            block["set"][f"price.{item}"] = n
        elif aid == "add_item":
            n = _as_int(val)
            lo, hi = limits["new_item_price_vnd"]
            if not item or n is None or not (lo <= n <= hi):
                problems.append(f"action {i}: add_item needs item and a price between {lo} and {hi}"); continue
            products = list(block["set"].get("products", state["products"]))
            if item not in products:
                products.append(item)
            block["set"]["products"] = products
            block["set"][f"price.{item}"] = n
        elif aid == "drop_item":
            products = list(block["set"].get("products", state["products"]))
            if not item or item not in products:
                problems.append(f"action {i}: {item!r} is not on {sid}'s menu to drop"); continue
            products.remove(item)
            if not products:
                problems.append(f"action {i}: cannot drop the last product"); continue
            block["set"]["products"] = products
        elif aid == "set_wait":
            n = _as_int(val)
            lo, hi = limits["wait_min"]
            if n is None or not (lo <= n <= hi):
                problems.append(f"action {i}: wait must be {lo}–{hi} minutes"); continue
            block["set"]["avg_wait_min"] = n
        elif aid in ("set_quality", "set_marketing_reach"):
            f = _as_fraction(val)
            lo, hi = limits["fraction"]
            if f is None or not (lo <= f <= hi):
                problems.append(f"action {i}: {aid} must be a fraction {lo}–{hi}"); continue
            block["set"][spec["field"]] = round(f, 3)
        elif aid == "set_marketing_message":
            if not isinstance(val, str) or not val.strip():
                problems.append(f"action {i}: marketing message must be text"); continue
            block["set"]["marketing.message"] = val.strip()[:120]
        elif aid == "close_permanently":
            block["set"]["permanently_closed"] = True
        elif aid == "restore":
            want = str(val or item or "").strip().lower()
            if not want:
                problems.append(f"action {i}: restore needs a field"); continue
            changed = _changed_fields(parent_chain, sid)
            fields = _match_restore(want, changed)
            if not fields:
                problems.append(f"action {i}: {want!r} was never changed on {sid} in this chain "
                                f"(changed: {sorted(changed) or 'nothing'}); nothing to restore"); continue
            block["unset"].extend(f for f in fields if f not in block["unset"])

    if not blocks and not entrants and not problems:
        problems.append("no supported actions")
    overrides = []
    for b in sorted(blocks.values(), key=lambda b: (b["from_day"], b["shop"])):
        out = {"from_day": b["from_day"], "shop": b["shop"]}
        if b["set"]:
            out["set"] = b["set"]
        if b["unset"]:
            out["unset"] = b["unset"]
        if len(out) > 2:
            overrides.append(out)
    if not overrides and not entrants and not problems:
        problems.append("no supported actions")

    days = max(parent_days, max_day + 2) if max_day else parent_days
    scenario = {
        "id": scenario_id,
        "parent": parent.id if parent else None,
        "label": (reply.get("label") or "User what-if").strip()[:60],
        "role": "whatif",
        "days": days,
        "focus_shop": focus,
        "situation": reply.get("situation", "incumbent_change"),
        "source": {"kind": "user", "text": source_text, "translator_model": llm.MODEL},
        "overrides": overrides,
        "unsupported": [u for u in (reply.get("unsupported") or []) if isinstance(u, dict)],
    }
    if entrants:
        # A shop that is absent on days 1-3 cannot be forked from a parent whose days 1-3
        # had it present, so the plan becomes a ROOT scenario: the parent chain's overrides
        # are inlined (the S1 story still happens), the entrant is declared from day 1, and
        # the whole thing reruns from day 1. `derived_from` keeps the lineage readable.
        inherited = [copy.deepcopy(ov) for sc in parent_chain for ov in sc.overrides]
        declared = [{"from_day": 1, "shop": sid, "set": {EXISTS: d}} for sid, d in sorted(entrants.items())]
        scenario.update({
            "parent": None,
            "derived_from": parent.id if parent else None,
            "situation": "competitor_enters",
            "days": max(days, max(entrants.values()) + 3),
            "overrides": declared + inherited + overrides,
        })
    return (scenario if scenario["overrides"] else None), problems


def _match_restore(want: str, changed: set[str]) -> list[str]:
    """Map a loose field name onto the changed dotted keys it plausibly means."""
    if want in changed:
        return [want]
    want_slug = slug(want) or want
    out = []
    for f in sorted(changed):
        leaf = f.split(".")[-1]
        if want_slug == leaf or want_slug == slug(f):
            out.append(f)
    if out:
        return out
    if want_slug in ("price", "prices"):
        return sorted(f for f in changed if f.startswith("price."))
    if want_slug in ("hours", "opening_hours", "opening", "time", "times"):
        return sorted(f for f in changed if f in ("open", "close"))
    if want_slug in ("menu", "products", "items"):
        return sorted(f for f in changed if f == "products" or f.startswith("price."))
    if want_slug in ("marketing", "ads", "advertising"):
        return sorted(f for f in changed if f.startswith("marketing."))
    return []


def _changed_fields(chain: list[Scenario], shop: str) -> set[str]:
    out: set[str] = set()
    for sc in chain:
        for ov in sc.overrides:
            if ov["shop"] == shop:
                out |= set(ov.get("set", {}))
    return out


# --- the public call -------------------------------------------------------------------

def _cache_key(text: str, parent_id: str | None, shops: dict, actions: dict) -> str:
    payload = json.dumps({"v": 1, "text": text.strip().lower(), "parent": parent_id,
                          "shops": shops, "actions": actions, "model": llm.MODEL, **llm.inference_options("high")},
                         sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def translate(text: str, parent_id: str | None = "baseline", data: Path = DATA,
              complete_json=None, cache_dir: Path = TRANSLATION_CACHE,
              scenario_id: str | None = None, retries: int = 1, refresh: bool = False) -> dict[str, Any]:
    """Sentence -> {"scenario": {...} | None, "unsupported": [...], "problems": [...],
    "reply": raw, "cached": bool, "attempts": int}.

    `complete_json` is injected for tests; default is the engine transport.
    """
    shops = load_shops(data)
    actions = load_actions()
    chain = load_chain(parent_id, data) if parent_id else []
    parent = chain[-1] if chain else None
    focus = (parent.focus_shop if parent and parent.focus_shop else None) or next(iter(shops))
    days = scenario_days(chain) if chain else 7
    default_day = (parent.from_day + 1) if parent else 2
    shops_now = resolve(shops, chain, default_day - 1) if chain else shops
    sid = scenario_id or f"user_{_cache_key(text, parent_id, shops, actions)[:10]}"

    key = _cache_key(text, parent_id, shops, actions)
    cpath = cache_dir / f"{key}.json"
    if cpath.exists() and not refresh:
        reply = json.loads(cpath.read_text(encoding="utf-8"))
        scenario, problems = compile_actions(reply, chain, shops, actions, sid, text)
        return {"scenario": scenario, "unsupported": reply.get("unsupported", []),
                "problems": problems, "reply": reply, "cached": True, "attempts": 0}

    if complete_json is None:
        complete_json = partial(llm.complete_json, reasoning_effort="high") if llm.inference_options("high") else llm.complete_json
    schema = response_schema(list(shops), list(actions["actions"]))
    user = user_message(text, shops_now, focus, default_day, days, actions,
                        changes_in_effect(chain, shops, default_day - 1) if chain else [])

    last_problems: list[str] = []
    reply: dict[str, Any] = {}
    scenario = None
    attempts = 0
    for attempt in range(retries + 1):
        attempts = attempt + 1
        prompt = user if not last_problems else \
            user + "\n\n## Your previous answer had problems; fix them\n- " + "\n- ".join(last_problems)
        try:
            reply, _usage = complete_json(SYSTEM, prompt, schema, 0.3 if attempt == 0 else 0.0)
        except Exception as exc:  # transport or JSON failure: no scenario, say why
            return {"scenario": None, "unsupported": [], "problems": [f"transport failed: {exc}"],
                    "reply": {}, "cached": False, "attempts": attempts}
        scenario, problems = compile_actions(reply, chain, shops, actions, sid, text)
        if scenario and not problems:
            if not refresh:
                cache_dir.mkdir(parents=True, exist_ok=True)
                cpath.write_text(json.dumps(reply, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"scenario": scenario, "unsupported": reply.get("unsupported", []),
                    "problems": [], "reply": reply, "cached": False, "attempts": attempts}
        last_problems = problems
        # A reply that is entirely `unsupported` is a valid, final answer: nothing to retry.
        if not reply.get("actions") and reply.get("unsupported"):
            break

    # Out of retries. Run what compiled cleanly; surface the rest as unsupported so the
    # user sees "we simulated X; we could not do Y" rather than a silently smaller plan.
    unsupported = list(reply.get("unsupported", []))
    unsupported += [{"text": text, "reason": p, "nearest": None} for p in last_problems
                    if p != "no supported actions"]
    if scenario:
        scenario["unsupported"] = unsupported
    return {"scenario": scenario, "unsupported": unsupported,
            "problems": last_problems, "reply": reply, "cached": False, "attempts": attempts}
