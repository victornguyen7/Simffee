"""SPEC 10.1 — content-addressed cache for LLM calls.

The key covers everything that can change an answer, so changing one twin
parameter invalidates only the days after it. `cache/` is committed: anyone who
clones the repo can rebuild the demo with no API key.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

CACHE = Path(__file__).resolve().parent.parent / "cache"


def key(
    twin_id: str,
    day: int,
    scenario_id: str,
    seed: int,
    state_before: dict[str, Any],
    shops_today: dict[str, Any],
) -> str:
    payload = json.dumps(
        {
            "twin": twin_id, "day": day, "scenario": scenario_id, "seed": seed,
            "state": state_before, "shops": shops_today,
        },
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def get(cache_key: str, cache_dir: Path = CACHE) -> dict[str, Any] | None:
    path = cache_dir / f"{cache_key}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def put(cache_key: str, value: dict[str, Any], cache_dir: Path = CACHE) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"{cache_key}.json").write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
    )
