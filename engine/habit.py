"""SPEC 2.1 — inertia. Rises with repetition, decays with absence."""

from __future__ import annotations

from .schema import ALPHA, DELTA


def regular_shop(habit: dict[str, float], present: dict | set | None = None) -> str:
    """argmax habit, ties broken by shop id so runs stay deterministic.

    `present` restricts the choice to shops that exist today (ROADMAP B1): a habit for a
    shop that has not opened yet cannot be anyone's regular."""
    candidates = sorted(s for s in habit if present is None or s in present)
    return max(candidates, key=lambda s: habit[s])


def apply_habit(habit: dict[str, float], choice: str) -> None:
    """Mutates in place. A skip ("none") reinforces nothing and decays everything:
    going without is how a habit dissolves."""
    for shop in habit:
        if shop == choice:
            habit[shop] += ALPHA * (1.0 - habit[shop])
        else:
            habit[shop] *= (1.0 - DELTA)
        habit[shop] = min(1.0, max(0.0, habit[shop]))
