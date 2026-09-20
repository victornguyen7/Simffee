"""Read and validate /data. Fail loudly at load time, never mid-run."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Twin:
    id: str
    name: str
    home: tuple[int, int]
    profile: dict[str, Any]
    what_log: list[dict[str, Any]]
    why_transcript: list[dict[str, str]]
    mechanism: dict[str, Any]
    say_do_gap: dict[str, str] | None
    role: str = ""

    @property
    def usual_time(self) -> str:
        return self.profile["usual_time"]

    @property
    def usual_order(self) -> str:
        return self.profile["usual_order"]

    @property
    def disruption_threshold(self) -> float:
        return float(self.mechanism["disruption_threshold"])

    @property
    def social_links(self) -> list[str]:
        return list(self.mechanism["social_links"])

    @property
    def talkativeness(self) -> float:
        return float(self.mechanism["talkativeness"])

    @property
    def ad_sensitivity(self) -> float:
        return float(self.mechanism["ad_sensitivity"])


@dataclass(frozen=True)
class Scenario:
    id: str
    parent: str | None
    overrides: list[dict[str, Any]]
    description: str = ""
    # SPEC_FUNCTIONAL 2 — all optional, all additive. None means "inherit / default".
    days: int | None = None
    focus_shop: str | None = None
    label: str | None = None
    role: str | None = None
    source: dict[str, Any] | None = None

    @property
    def from_day(self) -> int:
        """First day this scenario's own overrides bite. 1 when it has none."""
        return min((o["from_day"] for o in self.overrides), default=1)


def scenario_from_dict(raw: dict[str, Any]) -> Scenario:
    """Build a Scenario from its JSON shape; validates the override blocks."""
    overrides = raw.get("overrides", [])
    for i, ov in enumerate(overrides):
        for key in ("from_day", "shop"):
            if key not in ov:
                raise ValueError(f"scenario {raw.get('id')!r} override {i} missing {key!r}")
        if not isinstance(ov["from_day"], int) or ov["from_day"] < 1:
            raise ValueError(f"scenario {raw.get('id')!r} override {i}: from_day must be an int >= 1")
        if "set" not in ov and "unset" not in ov:
            raise ValueError(f"scenario {raw.get('id')!r} override {i} has neither set nor unset")
        if not isinstance(ov.get("set", {}), dict) or not isinstance(ov.get("unset", []), list):
            raise ValueError(f"scenario {raw.get('id')!r} override {i}: set must be an object, unset a list")
    days = raw.get("days")
    if days is not None and (not isinstance(days, int) or days < 1):
        raise ValueError(f"scenario {raw.get('id')!r}: days must be an int >= 1")
    return Scenario(
        id=raw["id"],
        parent=raw.get("parent"),
        overrides=overrides,
        description=raw.get("description", ""),
        days=days,
        focus_shop=raw.get("focus_shop"),
        label=raw.get("label"),
        role=raw.get("role"),
        source=raw.get("source"),
    )


def load_shops(data: Path = DATA) -> dict[str, dict[str, Any]]:
    shops = json.loads((data / "shops.json").read_text())
    for sid, shop in shops.items():
        for key in ("name", "position", "price", "open", "close", "products", "avg_wait_min"):
            if key not in shop:
                raise ValueError(f"shop {sid} missing {key}")
    return shops


def load_twins(data: Path = DATA, shop_ids: frozenset[str] | None = None) -> list[Twin]:
    twins: list[Twin] = []
    for path in sorted((data / "twins").glob("T*.json")):
        raw = json.loads(path.read_text())
        mech = raw["mechanism"]
        if shop_ids:
            # Normalise: every shop has an entry in both layers, so the engine
            # never has to guess a default mid-run. Sorted, never set order --
            # Python randomises string hashing per process, so iterating a set
            # here would make two runs of the same seed differ in key order.
            ordered = sorted(shop_ids)
            mech["habit"] = {s: float(mech["habit"].get(s, 0.0)) for s in ordered}
            mech["latent_interest"] = {
                s: float(mech["latent_interest"].get(s, 0.0)) for s in ordered
            }
        twins.append(Twin(
            id=raw["id"],
            name=raw["name"],
            home=tuple(raw["home"]),
            profile=raw["profile"],
            what_log=raw["what_log"],
            why_transcript=raw["why_transcript"],
            mechanism=mech,
            say_do_gap=raw.get("say_do_gap"),
            role=raw.get("role", ""),
        ))
    if not twins:
        raise ValueError(f"no twins found in {data / 'twins'}")

    ids = {t.id for t in twins}
    for t in twins:
        unknown = set(t.social_links) - ids
        if unknown:
            raise ValueError(f"{t.id} links to unknown twins {sorted(unknown)}")
        if t.id in t.social_links:
            raise ValueError(f"{t.id} links to itself")
    return twins


def load_scenario(scenario_id: str, data: Path = DATA,
                  extra: dict[str, Scenario] | None = None) -> Scenario:
    """A scenario by id: from `extra` (ad-hoc, e.g. a user's what-if) first, then data/."""
    if extra and scenario_id in extra:
        return extra[scenario_id]
    path = data / "scenarios" / f"{scenario_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"no scenario {scenario_id!r} in {data / 'scenarios'}")
    return scenario_from_dict(json.loads(path.read_text()))


def load_scenario_file(path: Path) -> Scenario:
    """A scenario from any JSON file, for --scenario-file and the live API."""
    return scenario_from_dict(json.loads(Path(path).read_text()))


def load_chain(scenario_id: str, data: Path = DATA,
               extra: dict[str, Scenario] | None = None) -> list[Scenario]:
    """Root-first chain of scenarios, e.g. [baseline, cf_discount]."""
    chain: list[Scenario] = []
    seen: set[str] = set()
    current: str | None = scenario_id
    while current:
        if current in seen:
            raise ValueError(f"scenario cycle at {current}")
        seen.add(current)
        sc = load_scenario(current, data, extra)
        chain.append(sc)
        current = sc.parent
    return list(reversed(chain))


def discover_scenarios(data: Path = DATA) -> list[str]:
    """Every scenario id under data/scenarios, parents before children, then by `order`.

    The old ALL_SCENARIOS constant, computed. A fork reads its parent's snapshot, so the
    parent must run first; ties are broken by the optional `order` key, then by id.
    """
    raws = {}
    for path in sorted((data / "scenarios").glob("*.json")):
        raw = json.loads(path.read_text())
        raws[raw["id"]] = raw
    depth: dict[str, int] = {}

    def _depth(sid: str, trail: tuple[str, ...] = ()) -> int:
        if sid in depth:
            return depth[sid]
        if sid in trail:
            raise ValueError(f"scenario cycle at {sid}")
        parent = raws[sid].get("parent")
        if parent and parent not in raws:
            raise ValueError(f"scenario {sid!r} has unknown parent {parent!r}")
        depth[sid] = 0 if not parent else _depth(parent, trail + (sid,)) + 1
        return depth[sid]

    return sorted(raws, key=lambda s: (_depth(s), raws[s].get("order", 99), s))
