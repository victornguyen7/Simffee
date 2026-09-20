"""Frozen contract between B1 (engine) and B2 (analyzer).

B2 imports this module. Changing anything here is a single commit that touches
both sides, announced out loud. See spec/BACKEND_PLAN.md section 2.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# --- Mechanism constants (SPEC 2.1, 4.2) ------------------------------------

ALPHA = 0.15              # habit reinforcement on the chosen shop
DELTA = 0.05              # habit decay on every other shop
HABIT_AUTOPILOT = 0.60    # habit[current] at or above this -> autopilot is possible
SKIP_LATENT_FLOOR = 0.20  # in reappraisal, max(latent) below this + hours shock -> skip
SEEK_CHANGE_GAP = 0.30    # latent[o] > habit[current] + this -> acts without a shock
GOSSIP_WEIGHT = 0.10      # latent_interest delta per unit of reported valence
MARKETING_CAP = 0.05      # max latent_interest gain per day from marketing
AUTOPILOT_VALENCE = 0.30  # valence recorded for an uneventful autopilot day
PRICE_SHOCK_FLOOR = 0.05  # price increases below 5% are not a disruption at all
PRICE_SHOCK_GAIN = 4.0    # SPEC 2.2: min(1, dPrice/old * 4)
PRODUCT_SHOCK = 0.70
WAIT_SHOCK_SCALE = 10.0
DAYS = 7
SEEDS = (0, 1, 2, 3, 4)

# --- Enums ------------------------------------------------------------------

DRIVERS = frozenset({
    "habit", "hours", "price", "distance", "wait",
    "product", "curiosity", "social", "quality",
})
MODES = frozenset({"autopilot", "reappraisal"})
DISRUPTION_SOURCES = frozenset({"none", "hours", "price", "product", "wait", "closed"})

Mode = Literal["autopilot", "reappraisal"]

# --- Row --------------------------------------------------------------------


@dataclass
class Disruption:
    score: float
    source: str

    def to_dict(self) -> dict[str, Any]:
        return {"score": round(self.score, 4), "source": self.source}


@dataclass
class Row:
    """One twin, one day, one scenario, one seed. SPEC 3.4."""

    scenario: str
    seed: int
    day: int
    twin: str
    mode: str
    disruption: Disruption
    state_before: dict[str, dict[str, float]]
    choice: str                      # shop id, or "none"
    spent: int
    abandoned: bool
    primary_driver: str
    secondary_driver: str | None
    valence: float
    reasoning: str
    state_after: dict[str, dict[str, float]] = field(default_factory=dict)
    told: list[str] = field(default_factory=list)
    llm_failed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "scenario": self.scenario,
            "seed": self.seed,
            "day": self.day,
            "twin": self.twin,
            "mode": self.mode,
            "disruption": self.disruption.to_dict(),
            "state_before": _round_state(self.state_before),
            "choice": self.choice,
            "spent": self.spent,
            "abandoned": self.abandoned,
            "primary_driver": self.primary_driver,
            "secondary_driver": self.secondary_driver,
            "valence": round(self.valence, 3),
            "reasoning": self.reasoning,
            "state_after": _round_state(self.state_after),
            "told": list(self.told),
            "llm_failed": self.llm_failed,
        }


def _round_state(state: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    return {k: {s: round(v, 4) for s, v in inner.items()} for k, inner in state.items()}


# --- Validation -------------------------------------------------------------

REQUIRED_KEYS = {
    "scenario", "seed", "day", "twin", "mode", "disruption", "state_before",
    "choice", "spent", "abandoned", "primary_driver", "secondary_driver",
    "valence", "reasoning", "state_after", "told", "llm_failed",
}


def validate_row(row: dict[str, Any], shop_ids: frozenset[str]) -> list[str]:
    """Return a list of human-readable problems. Empty list means valid."""
    problems: list[str] = []
    where = f"{row.get('scenario')}/{row.get('seed')} day {row.get('day')} {row.get('twin')}"

    missing = REQUIRED_KEYS - set(row)
    if missing:
        problems.append(f"{where}: missing keys {sorted(missing)}")
        return problems

    if row["mode"] not in MODES:
        problems.append(f"{where}: bad mode {row['mode']!r}")
    if row["choice"] not in shop_ids | {"none"}:
        problems.append(f"{where}: bad choice {row['choice']!r}")
    if row["primary_driver"] not in DRIVERS:
        problems.append(f"{where}: bad primary_driver {row['primary_driver']!r}")
    if row["secondary_driver"] is not None and row["secondary_driver"] not in DRIVERS:
        problems.append(f"{where}: bad secondary_driver {row['secondary_driver']!r}")
    if row["disruption"]["source"] not in DISRUPTION_SOURCES:
        problems.append(f"{where}: bad disruption source {row['disruption']['source']!r}")
    if not 0.0 <= row["disruption"]["score"] <= 1.0:
        problems.append(f"{where}: disruption score out of range")
    if not -1.0 <= row["valence"] <= 1.0:
        problems.append(f"{where}: valence out of range")

    # Invariants B2 depends on (BACKEND_PLAN 2.1)
    if row["spent"] is None:
        problems.append(f"{where}: spent is null; use 0")
    elif row["choice"] == "none" and row["spent"] != 0:
        problems.append(f"{where}: choice none but spent {row['spent']}")
    elif row["choice"] != "none" and row["spent"] <= 0:
        problems.append(f"{where}: chose {row['choice']} but spent {row['spent']}")

    for layer in ("state_before", "state_after"):
        if "habit" not in row[layer] or "latent_interest" not in row[layer]:
            problems.append(f"{where}: {layer} needs habit and latent_interest")

    if len(row["reasoning"].split()) > 45:
        problems.append(f"{where}: reasoning over 45 words")

    return problems
