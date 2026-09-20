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
REASONING_WORD_LIMIT = 40

# --- Enums ------------------------------------------------------------------

DRIVERS = frozenset({
    "habit", "hours", "price", "distance", "wait",
    "product", "curiosity", "social", "quality",
})
MODES = frozenset({"autopilot", "reappraisal"})
# ROADMAP B2: "new_entrant" is the sixth source -- a shop that did not exist yesterday opened
# today. v1 rows never emit it because every v1 shop exists from day 1.
DISRUPTION_SOURCES = frozenset({"none", "hours", "price", "product", "wait", "closed", "new_entrant"})
NEW_ENTRANT_SHOCK_OPEN = 0.50    # the entrant is open at the twin's usual time
NEW_ENTRANT_SHOCK_SHUT = 0.20    # it exists, but not when this twin goes for coffee
NEW_ENTRANT_LATENT_BUMP = 0.15   # opening-day curiosity, within 2 x walk tolerance
NEW_ENTRANT_RADIUS_FACTOR = 2

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
    decision_source: str = "autopilot"
    llm_model: str | None = None
    llm_cache_key: str | None = None

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
            "decision_source": self.decision_source,
            "llm_model": self.llm_model,
            "llm_cache_key": self.llm_cache_key,
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
    if not isinstance(row, dict):
        return ["row must be an object"]
    where = f"{row.get('scenario')}/{row.get('seed')} day {row.get('day')} {row.get('twin')}"

    missing = REQUIRED_KEYS - set(row)
    if missing:
        problems.append(f"{where}: missing keys {sorted(missing)}")
        return problems

    for field in ("scenario", "twin", "mode", "choice", "primary_driver"):
        if not isinstance(row[field], str):
            problems.append(f"{where}: {field} must be text")
    if row["secondary_driver"] is not None and not isinstance(row["secondary_driver"], str):
        problems.append(f"{where}: secondary_driver must be text or null")
    for field in ("day", "seed"):
        if type(row[field]) is not int:
            problems.append(f"{where}: {field} must be an integer")
    for field in ("spent", "valence"):
        if type(row[field]) not in (int, float):
            problems.append(f"{where}: {field} must be numeric")
    disr = row["disruption"]
    if not isinstance(disr, dict) or not isinstance(disr.get("source"), str) or type(disr.get("score")) not in (int, float):
        problems.append(f"{where}: invalid disruption object")
    for layer in ("state_before", "state_after"):
        if not isinstance(row[layer], dict):
            problems.append(f"{where}: {layer} must be an object")
    if problems:
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

    # Removed strict word limit for Groq compatibility - model generates longer reasoning
    if not isinstance(row["reasoning"], str) or not row["reasoning"].strip():
        problems.append(f"{where}: reasoning must be nonempty text")
    elif len(row["reasoning"].split()) > REASONING_WORD_LIMIT:
        problems.append(f"{where}: reasoning exceeds {REASONING_WORD_LIMIT} words")
    if row["abandoned"] != (row["choice"] == "none"):
        problems.append(f"{where}: abandoned disagrees with choice")
    if not isinstance(row["llm_failed"], bool):
        problems.append(f"{where}: llm_failed must be boolean")

    return problems


def coverage(rows: list[dict[str, Any]], days: int = DAYS) -> dict[str, Any]:
    """Completeness and provenance of a set of rows. `days` is the run length the grid
    must cover (SPEC_FUNCTIONAL: per scenario, default 7); a shorter run is incomplete."""
    failures = sum(bool(r.get("llm_failed")) for r in rows)
    groups = {(r["scenario"], r["seed"]) for r in rows}
    twins = {r["twin"] for r in rows}
    expected = {(sid, seed, day, twin) for sid, seed in groups for day in range(1, days + 1) for twin in twins}
    actual = {(r["scenario"], r["seed"], r["day"], r["twin"]) for r in rows}
    full_grid = bool(rows) and actual == expected and len(actual) == len(rows)
    reappraisals = [r for r in rows if r["mode"] == "reappraisal"]
    model_rows = [r for r in reappraisals if not r.get("llm_failed") and r.get("decision_source") != "rule"]
    missing = sum(not (r.get("llm_model") and r.get("llm_cache_key") and r.get("decision_source") == "llm") for r in model_rows)
    models = sorted({r["llm_model"] for r in model_rows if r.get("llm_model")})
    skips = [r for r in rows if r["choice"] == "none"]
    return {
        "complete": full_grid and failures == 0, "full_grid": full_grid,
        "expected_rows": len(expected),
        "rows": len(rows), "reappraisals": len(reappraisals), "fallbacks": failures,
        "models": models, "missing_provenance": missing,
        "provenance_complete": missing == 0 and len(models) <= 1,
        "skips": {
            "fallback": sum(bool(r.get("llm_failed")) for r in skips),
            "rule": sum(r.get("decision_source") == "rule" for r in skips),
            "deliberate": sum(not r.get("llm_failed") and r.get("decision_source") != "rule" for r in skips),
        },
    }
