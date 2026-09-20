"""SPEC_FUNCTIONAL 5 / ROADMAP A3 — the what-if service behind the local API.

    translate -> fork from the parent's snapshot -> run N seeds -> analyse -> answer

No HTTP here; `api/server.py` is a thin wrapper so this is testable in-process with a
stubbed translator transport and --offline runs.

Layout on disk:
    library/                the promoted run directory (baseline, cf_null, ... with snapshots + rows)
    live/registry.json      every user scenario that has been run: id -> {scenario, run_dir}
    live/<run_id>/runs/     a copy of the parent chain's rows + snapshots, then the new scenario's
    live/<run_id>/cost_ledger.jsonl

The parent chain is copied, not symlinked, so a live run can never write into the library.
"""

from __future__ import annotations

import concurrent.futures
import copy
import json
import pathlib
import shutil
import sys
import threading
import time
import uuid
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_runs  # noqa: E402
from analyzer import review as reviewer
from analyzer.flows import flows  # noqa: E402
from engine import loop, translate  # noqa: E402
from engine.cache import CACHE  # noqa: E402
from engine.loader import DATA, Scenario, load_chain, load_shops, scenario_from_dict  # noqa: E402
from engine.schema import coverage  # noqa: E402
from tools import cost_report  # noqa: E402
from tools.validate import check_file  # noqa: E402


class WhatIfService:
    def __init__(self, library: pathlib.Path, cache_dir: pathlib.Path = CACHE,
                 live_dir: pathlib.Path | None = None, data: pathlib.Path = DATA,
                 offline: bool = False, timeout_s: float = 240.0, translator=None):
        self.library = pathlib.Path(library)
        self.cache_dir = pathlib.Path(cache_dir)
        self.live_dir = pathlib.Path(live_dir) if live_dir else ROOT / "runs" / "live"
        self.data = pathlib.Path(data)
        self.offline = offline
        self.timeout_s = timeout_s
        self.translator = translator or translate.translate     # injectable for tests
        self.shops = load_shops(self.data)
        self.scenario_files = build_runs.load_scenarios(self.data / "scenarios")
        self.roles = build_runs.roles(self.scenario_files)
        self.twins = {}
        for f in sorted((self.data / "twins").glob("*.json")):
            t = json.loads(f.read_text(encoding="utf-8"))
            self.twins[t["id"]] = t
        self.library_seeds = self._library_seeds()
        self._lock = threading.Lock()
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        self.live_dir.mkdir(parents=True, exist_ok=True)
        self.registry_path = self.live_dir / "registry.json"
        self.registry: dict[str, dict[str, Any]] = (
            json.loads(self.registry_path.read_text(encoding="utf-8"))
            if self.registry_path.exists() else {})
        self._library_bundle: dict[str, Any] | None = None

    # --- library ---------------------------------------------------------------------

    def _library_seeds(self) -> list[int]:
        base = self.library / self.roles["baseline"]
        return sorted(int(p.stem) for p in base.glob("*.jsonl")) if base.exists() else []

    def library_bundle(self) -> dict[str, Any]:
        """The promoted bundle, built once from the library directory."""
        if self._library_bundle is None:
            self._library_bundle = build_runs.build(self.library, self.library_seeds,
                                                    self.scenario_files, self.shops, self.twins)
        return self._library_bundle

    def library_summary(self) -> dict[str, Any]:
        b = self.library_bundle()
        return {
            "focus_shop": b["meta"]["focus_shop"], "seeds": b["meta"]["seeds"],
            "publishable": b["meta"]["publishable"],
            "scenarios": {sid: {k: sc[k] for k in ("label", "role", "parent", "from_day", "days", "overrides")}
                          for sid, sc in b["scenarios"].items()},
            "analysis": {k: b["analysis"].get(k) for k in
                         ("break_day", "direction", "naive", "actual", "surprise", "impact", "confidence", "whatif", "narration")},
            "live": {rid: {"label": e["scenario"]["label"], "text": e["scenario"].get("source", {}).get("text"),
                           "parent": e["scenario"]["parent"], "at": e["at"]}
                     for rid, e in self.registry.items()},
        }

    def health(self) -> dict[str, Any]:
        from engine import llm
        try:
            llm_ok = (not self.offline) and llm.available()
        except Exception:      # a forbidden/broken transport is "no", not a crash
            llm_ok = False
        return {"ok": True, "offline": self.offline, "llm": llm_ok, "fresh_runs": True,
                "model": llm.decision_model(), "translator_model": llm.MODEL,
                "reasoning_effort": llm.inference_options(model=llm.decision_model()).get("reasoning", {}).get("effort"),
                "library": str(self.library), "library_seeds": self.library_seeds,
                "cache_dir": str(self.cache_dir), "cache_files": len(list(self.cache_dir.glob("*.json"))),
                "live_runs": len(self.registry)}

    # --- scenarios by id (library files + live registry) ------------------------------

    def _scenario_raw(self, sid: str) -> dict[str, Any]:
        if sid in self.scenario_files:
            return self.scenario_files[sid]
        if sid in self.registry:
            return self.registry[sid]["scenario"]
        raise KeyError(f"unknown scenario {sid!r}")

    def _extra(self) -> dict[str, Scenario]:
        return {rid: scenario_from_dict(e["scenario"]) for rid, e in self.registry.items()}

    def _run_dir_for(self, sid: str) -> pathlib.Path:
        if sid in self.scenario_files:
            return self.library
        return pathlib.Path(self.registry[sid]["run_dir"])

    # --- the two entry points --------------------------------------------------------

    def whatif(self, text: str, parent: str = "baseline", seeds: list[int] | None = None,
               fresh: bool = False) -> dict[str, Any]:
        """Free text -> translated scenario -> run -> analysis. SPEC_FUNCTIONAL 5."""
        t0 = time.monotonic()
        if fresh and self.offline:
            return {"error": "Fresh simulation requires live mode; the API is offline.",
                    "scenario": None, "fresh": True, "request_text": text, "took_ms": 0}
        if parent not in self.scenario_files and parent not in self.registry:
            return {"error": f"unknown parent {parent!r}", "took_ms": 0}
        run_id = f"user_{uuid.uuid4().hex}" if fresh else None
        options = {"refresh": True, "scenario_id": run_id} if fresh else {}
        tr = self.translator(text, parent_id=parent, data=self.data, **options)
        if tr["scenario"] is None:
            return {"scenario": None, "unsupported": tr["unsupported"], "problems": tr["problems"],
                    "translation": {"cached": tr["cached"], "attempts": tr["attempts"]},
                    "fresh": fresh, "request_text": text,
                    "took_ms": int((time.monotonic() - t0) * 1000)}
        scenario = {**tr["scenario"], "id": run_id} if fresh else tr["scenario"]
        result = self.run(scenario, seeds=seeds, deadline=t0 + self.timeout_s)
        result["fresh"] = fresh
        result["request_text"] = text
        result["translation"] = {"cached": tr["cached"], "attempts": tr["attempts"]}
        result["unsupported"] = tr["unsupported"]
        result["took_ms"] = int((time.monotonic() - t0) * 1000)
        return result

    def review(self, run_id: str, refresh: bool = False) -> dict[str, Any]:
        if not self._lock.acquire(blocking=False):
            return reviewer.unavailable("A simulation is running. Recheck once it finishes.")
        try:
            entry = self.registry.get(run_id)
            if entry is None:
                return reviewer.unavailable("This run is not available for review yet.")
            scenario = copy.deepcopy(entry["scenario"])
            seed = 0 if 0 in entry["seeds"] else entry["seeds"][0]
            rows = build_runs.load_rows(pathlib.Path(entry["run_dir"]), run_id, seed)
            chain = load_chain(run_id, self.data, self._extra())
            focus = next((sc.focus_shop for sc in reversed(chain) if sc.focus_shop), next(iter(self.shops)))
            days = entry["days"]
        finally:
            self._lock.release()
        return reviewer.evaluate(scenario, rows, focus, days, self.cache_dir,
                                 refresh=refresh, offline=self.offline)

    def run(self, scenario: dict[str, Any], seeds: list[int] | None = None,
            deadline: float | None = None) -> dict[str, Any]:
        """A structured scenario (already translated or hand-built) -> run -> analysis."""
        seeds = seeds or [0]
        scenario = copy.deepcopy(scenario)
        sid = scenario["id"]
        # A structured scenario that says nothing about its parent forks the library
        # baseline; an explicit `"parent": null` is a full rerun from day 1.
        if "parent" not in scenario:
            scenario["parent"] = self.roles["baseline"]
        parent = scenario.get("parent")
        if parent and parent not in self.scenario_files and parent not in self.registry:
            return {"error": f"unknown parent {parent!r}"}
        if sid in self.scenario_files:
            return {"error": f"{sid!r} is a library scenario; run it with the engine CLI"}
        unknown_seeds = [s for s in seeds if s not in self.library_seeds]
        if unknown_seeds:
            return {"error": f"seeds {unknown_seeds} have no library run to fork from; available {self.library_seeds}"}
        try:
            sc_obj = scenario_from_dict(scenario)
        except (ValueError, KeyError) as exc:
            return {"error": f"invalid scenario: {exc}"}

        future = self._pool.submit(self._run_and_analyse, scenario, sc_obj, seeds)
        wait = None if deadline is None else max(0.0, deadline - time.monotonic())
        try:
            return future.result(timeout=wait)
        except concurrent.futures.TimeoutError:
            # The run continues in the background and lands in the registry when done.
            return {"scenario": scenario, "fallback_used": True, "reason": "timeout",
                    "served": self.nearest_library(scenario), "pending_run_id": sid}

    # --- internals ---------------------------------------------------------------------

    def _run_and_analyse(self, scenario: dict[str, Any], sc_obj: Scenario, seeds: list[int]) -> dict[str, Any]:
        with self._lock:                       # one engine run at a time: STATS are process-global
            run_id = scenario["id"]
            run_root = self.live_dir / run_id
            out = run_root / "runs"
            if out.exists():
                shutil.rmtree(out)
            out.mkdir(parents=True)
            extra = {**self._extra(), run_id: sc_obj}
            chain = load_chain(run_id, self.data, extra)
            # Copy every ancestor's rows + snapshots (never symlink: a live run must not
            # be able to write into the library).
            for anc in chain[:-1]:
                src = self._run_dir_for(anc.id) / anc.id
                if not src.exists():
                    return {"error": f"parent run {anc.id!r} has no rows in {src.parent}"}
                shutil.copytree(src, out / anc.id)
            days = loop.scenario_days(chain)

            before = cost_report.snapshot()
            t0 = time.monotonic()
            rows_by_seed = []
            for seed in seeds:
                rows_by_seed.append(loop.run(run_id, seed, days=days, data=self.data, out=out,
                                             offline=self.offline, cache_dir=self.cache_dir, extra=extra))
            took_ms = int((time.monotonic() - t0) * 1000)
            counters = cost_report.delta(before, cost_report.snapshot())
            from engine import llm
            ledger = cost_report.row([r for rs in rows_by_seed for r in rs], counters, llm.decision_model(),
                                     label=scenario.get("label", run_id), seeds=seeds,
                                     scenarios=[run_id], took_ms=took_ms)
            cost_report.record(run_root, ledger)

            errors: list[str] = []
            for seed in seeds:
                check_file(out / run_id / f"{seed}.jsonl", set(self.twins), set(self.shops), errors, days)
            if errors:
                return {"error": f"engine output failed validation: {errors[0]}", "scenario": scenario}

            analysis = self._analyse(scenario, chain, out, seeds, days)
            entry = {"scenario": scenario, "run_dir": str(out), "seeds": seeds,
                     "at": ledger["at"], "days": days}
            self.registry[run_id] = entry
            self.registry_path.write_text(
                json.dumps(self.registry, ensure_ascii=False, indent=1), encoding="utf-8")

            per_seed = {str(s): {"rows": rs, "daily_sales": build_runs.daily_sales(rs, self.shops, days),
                                 "coverage": coverage(rs, days)} for s, rs in zip(seeds, rows_by_seed)}
            flow_seed = 0 if 0 in seeds else seeds[0]
            flow_run = per_seed[str(flow_seed)]
            focus = next((sc.focus_shop for sc in reversed(chain) if sc.focus_shop), next(iter(self.shops)))
            flow_summary = flows(flow_run["rows"], focus, days) if flow_run["coverage"]["complete"] else None
            fallback_reasons: dict[str, int] = {}
            for rs in rows_by_seed:
                for r in rs:
                    if r.get("llm_failed"):
                        why = r["reasoning"].split("]")[0].strip("[").replace("llm unavailable: ", "")
                        fallback_reasons[why] = fallback_reasons.get(why, 0) + 1
            warning = None
            if fallback_reasons:
                quota = sum(v for k, v in fallback_reasons.items() if "quota" in k or "rate limit" in k)
                warning = (f"{quota} decision(s) refused by the provider's token limit — not customer behaviour; "
                           "analysis withheld. Wait for the quota window or raise the tier, then re-run."
                           if quota else f"{sum(fallback_reasons.values())} decision(s) fell back: {fallback_reasons}")
            return {
                "warning": warning, "fallback_reasons": fallback_reasons or None,
                "run_id": run_id, "scenario": scenario, "days": days, "seeds": seeds,
                "chip": self.chip(scenario), "result": per_seed, "analysis": analysis,
                "flows": flow_summary, "flows_seed": flow_seed,
                "flows_reason": None if flow_summary is not None else
                    "Movement summary unavailable: this run contains fallback or missing decisions.",
                "cost": {k: ledger[k] for k in ("reasoned", "on_habit", "responses", "cache_hits",
                                                "fallbacks", "tokens_in", "tokens_out", "took_ms", "cost")},
                "fallback_used": False,
            }

    def _analyse(self, scenario: dict[str, Any], chain: list[Scenario], out: pathlib.Path,
                 seeds: list[int], days: int) -> dict[str, Any]:
        """Analyse the new scenario as the single what-if against the chain's root baseline
        and the library control arm, reusing build_runs.build_analysis unchanged."""
        root_id = chain[0].id
        control_id = self.roles["control"]
        root_raw = scenario if root_id == scenario["id"] else self._scenario_raw(root_id)
        files = {root_id: dict(root_raw, role="baseline")}
        if control_id:
            files[control_id] = dict(self._scenario_raw(control_id), role="control")
        if scenario["id"] != root_id:
            files[scenario["id"]] = dict(scenario, role="whatif")
        groups = {}
        for sid in files:
            src = out if (out / sid).exists() else self._run_dir_for(sid)
            groups[sid] = [build_runs.load_rows(src, sid, s) for s in seeds]
        # The user scenario may run longer than the library; the analysis window is the
        # user's `days` only if every group has that many days, else the library's.
        window = min(days, min(max(r["day"] for r in rs) for per in groups.values() for rs in per))
        files[root_id] = {**files[root_id], "days": window}
        return build_runs.build_analysis(out, self.shops, files, self.twins, groups, seeds)

    # --- presentation helpers ---------------------------------------------------------

    def chip(self, scenario: dict[str, Any]) -> str:
        """'Simulated: Simffee open 06:00 from day 5; croissant added at 30k.'"""
        bits = []
        for ov in scenario["overrides"]:
            name = self.shops[ov["shop"]]["name"]
            if "exists_from_day" in ov.get("set", {}):
                bits.append(f"{name} does not exist until it opens on day {ov['set']['exists_from_day']}")
            for k, v in ov.get("set", {}).items():
                if k == "exists_from_day":
                    continue
                if k == "open":
                    bits.append(f"{name} opens {v}")
                elif k == "close":
                    bits.append(f"{name} closes {v}")
                elif k.startswith("price."):
                    bits.append(f"{name} {k.split('.', 1)[1].replace('_', ' ')} at {v // 1000}k")
                elif k == "products":
                    bits.append(f"{name} menu: {', '.join(v)}")
                elif k == "avg_wait_min":
                    bits.append(f"{name} wait {v} min")
                elif k == "quality":
                    bits.append(f"{name} quality {v}")
                elif k == "marketing.reach":
                    bits.append(f"{name} ad reach {v}")
                elif k == "marketing.message":
                    bits.append(f"{name} ads say \"{v}\"")
                elif k == "permanently_closed":
                    bits.append(f"{name} closes for good")
                elif k.startswith("prompt."):
                    bits.append(f"{name} shown to people as \"{v}\"")
                else:
                    bits.append(f"{name} {k} = {v}")
            for k in ov.get("unset", []):
                bits.append(f"{name} {k} back to normal")
            if set(ov.get("set", {})) != {"exists_from_day"} or ov.get("unset"):
                bits[-1] += f" from day {ov['from_day']}"
        return "Simulated: " + "; ".join(bits) + "."

    def nearest_library(self, scenario: dict[str, Any]) -> dict[str, Any] | None:
        """The library what-if whose override keys overlap most with this scenario's."""
        def keys(sc):
            return {(o["shop"], k) for o in sc["overrides"] for k in list(o.get("set", {})) + list(o.get("unset", []))}
        mine = keys(scenario)
        best, score = None, -1.0
        for sid in self.roles["whatifs"]:
            theirs = keys(self.scenario_files[sid])
            j = len(mine & theirs) / len(mine | theirs) if (mine | theirs) else 0.0
            if j > score:
                best, score = sid, j
        if best is None:
            return None
        b = self.library_bundle()
        w = next((w for w in b["analysis"].get("whatif", []) if w["scenario"] == best), None)
        return {"scenario": best, "label": self.scenario_files[best].get("label", best),
                "overlap": round(score, 2), "whatif": w}
