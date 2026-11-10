"""Which committed decision-cache entries can the current code still reach? (AUDIT_FIX_PLAN #19)

    python3 tools/prune_cache.py            # report only
    python3 tools/prune_cache.py --delete   # remove the unreachable entries

"Reachable" is measured, not guessed: every scenario (including the `bundle: false` ones) is
replayed offline with the committed cache's own settings (--cache-defaults) on seeds 0-4,
recording every cache key the engine looks up. An entry nobody looks up -- a model the
provider no longer serves, an older prompt or schema, or a live what-if whose run rows were
never committed -- can never be hit again and is only weight. Git history keeps what is
deleted. cache/translations/ is left alone: its keys need the original request text, which
is not stored.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import cache, cli, decide  # noqa: E402


def reachable_keys(seeds: str = "0-4") -> set[str]:
    looked: set[str] = set()
    real_get = cache.get

    def spy(key: str, cache_dir: Path = cache.CACHE):
        looked.add(key)
        return real_get(key, cache_dir)

    with tempfile.TemporaryDirectory() as out:
        argv = ["engine.cli", "--all", "--include-all", "--seeds", seeds, "--offline",
                "--cache-defaults", "--quiet", "--out", out, "--cache", str(cache.CACHE)]
        saved = sys.argv, decide.cache.get
        sys.argv, decide.cache.get = argv, spy
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                cli.main()
        finally:
            sys.argv, decide.cache.get = saved
    return looked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--delete", action="store_true", help="remove the unreachable entries")
    args = ap.parse_args()

    entries = {p.stem: p for p in cache.CACHE.glob("*.json")}
    reachable = reachable_keys() & set(entries)
    unreachable = sorted(set(entries) - reachable)

    def models(keys):
        out: Counter = Counter()
        for k in keys:
            try:
                out[json.loads(entries[k].read_text(encoding="utf-8")).get("_model", "?")] += 1
            except ValueError:
                out["(unreadable)"] += 1
        return dict(out)

    print(f"{len(entries)} decision entries in {cache.CACHE}")
    print(f"  reachable:   {len(reachable)} {models(reachable)}")
    print(f"  unreachable: {len(unreachable)} {models(unreachable)}")
    if args.delete:
        for k in unreachable:
            entries[k].unlink()
        print(f"deleted {len(unreachable)} unreachable entries")
    elif unreachable:
        print("run with --delete to remove them (git history keeps them)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
