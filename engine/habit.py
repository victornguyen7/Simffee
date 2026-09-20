"""SPEC 2.1 — inertia. Rises with repetition, decays with absence."""

from __future__ import annotations

from .schema import ALPHA, DELTA


def regular_shop(habit: dict[str, float]) -> str:
    """argmax habit, ties broken by shop id so runs stay deterministic."""
    return max(sorted(habit), key=lambda s: habit[s])


def apply_habit(habit: dict[str, float], choice: str) -> None:
    """Mutates in place. A skip ("none") reinforces nothing and decays everything:
    going without is how a habit dissolves."""
    for shop in habit:
        if shop == choice:
            habit[shop] += ALPHA * (1.0 - habit[shop])
        else:
            habit[shop] *= (1.0 - DELTA)
        habit[shop] = min(1.0, max(0.0, habit[shop]))
