"""Clock helpers. Times are "HH:MM" strings everywhere in /data."""

from __future__ import annotations


def minutes(hhmm: str) -> int:
    hours, mins = hhmm.split(":")
    return int(hours) * 60 + int(mins)


def is_open_at(shop: dict, hhmm: str) -> bool:
    return not shop.get("permanently_closed", False) and minutes(shop["open"]) <= minutes(hhmm) < minutes(shop["close"])


def manhattan(a, b) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])
