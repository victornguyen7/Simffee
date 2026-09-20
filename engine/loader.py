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

    @property
    def from_day(self) -> int:
        """First day this scenario's own overrides bite. 1 when it has none."""
        return min((o["from_day"] for o in self.overrides), default=1)


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


def load_scenario(scenario_id: str, data: Path = DATA) -> Scenario:
    raw = json.loads((data / "scenarios" / f"{scenario_id}.json").read_text())
    return Scenario(
        id=raw["id"],
        parent=raw.get("parent"),
        overrides=raw.get("overrides", []),
        description=raw.get("description", ""),
    )


def load_chain(scenario_id: str, data: Path = DATA) -> list[Scenario]:
    """Root-first chain of scenarios, e.g. [baseline, cf_discount]."""
    chain: list[Scenario] = []
    seen: set[str] = set()
    current: str | None = scenario_id
    while current:
        if current in seen:
            raise ValueError(f"scenario cycle at {current}")
        seen.add(current)
        sc = load_scenario(current, data)
        chain.append(sc)
        current = sc.parent
    return list(reversed(chain))
