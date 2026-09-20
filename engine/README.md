# engine/ — B1, the simulation

Turns `/data` into `{out}/{scenario}/{seed}.jsonl` and per-day state snapshots.
Contracts live in [`schema.py`](./schema.py); B2 imports that module.
Spec: [../spec/SPEC.md](../spec/SPEC.md) · Plan: [../spec/BACKEND_PLAN.md](../spec/BACKEND_PLAN.md)

## Run safely

Python 3.11+, stdlib plus `openai` (used against xAI's Responses API) for live requests (`pip install -r requirements.txt`).
Offline replay, validation, analysis, narration, and stubbed tests need no credentials.
The engine automatically reads the repository's private `.env` for `XAI_API_KEY`,
`SIMFFEE_MODEL`, `SIMFFEE_MAX_TOKENS`, `SIMFFEE_MIN_INTERVAL`, `SIMFFEE_TIMEOUT_S`, and
`SIMFFEE_REASONING_EFFORT`. Existing shell variables take precedence, and `--model` takes precedence over both. Values may
be quoted; shell commands and variable expansion are never evaluated. `.env`
and `.env.*` are Git-ignored. Keep the file owner-readable/writable only (`600`),
enter keys locally, and never use a `VITE_` prefix for a server credential.
Use a new output directory; do not overwrite an existing demo while diagnosing it.

```bash
python3 -m engine.cli --all --seeds 0-4 --offline --out /tmp/simffee-check/runs --cache cache
python3 tools/validate.py /tmp/simffee-check/runs
python3 build_runs.py /tmp/simffee-check/runs --offline --out /tmp/simffee-check/bundle.json
```

`--offline` never calls the API. A cache miss produces a flagged fallback, not a
customer preference. Every scenario/seed reports coverage even with `--quiet`.
`--all` runs the promoted set that `runs.json` is built from; add `--include-all` for the
on-demand `bundle: false` scenarios (ROADMAP B: `s2_entrant`, `s2_entrant_only`,
`abl_rename`), e.g. `python3 -m engine.cli --all --include-all --seeds 0-2 --offline --out /tmp/x`.
To bundle them: `python3 build_runs.py /tmp/x --include-all --seeds 0-2 --out /tmp/x.json`
(reports `analysis.flows`, `analysis.question`, and `analysis.hero_agreement` for the rename test).
Add `--require-complete` to the engine or bundle command for a release gate:
exit 1 means invalid data; exit 2 means incomplete/unverified trajectories.
A partial diagnostic run is not a complete seven-day run.

Live generation requires `XAI_API_KEY` and explicit approval of model and spend.
`SIMFFEE_TIMEOUT_S` defaults to 180 seconds per provider request (SDK retries remain
disabled). This is separate from the API's `--timeout` (240 seconds for the whole
what-if) and the frontend's 300-second fetch deadline; cold runs can still exceed them.
The default model is `qwen/qwen3.8-27b` with `SIMFFEE_MAX_TOKENS` 400 — the pair the
committed `cache/` was filled with; both are in the cache key, so change them only with a
refill. Override with `SIMFFEE_MODEL` / `--model` and `SIMFFEE_MAX_TOKENS`. No embedded credential fallback
exists. The CLI reports request attempts and response token usage, including
invalid JSON responses; it does not invent a dollar estimate for unknown pricing.

For `grok-4.5` and `grok-4.6`, customer decisions explicitly use low reasoning effort
instead of the provider's high default. The translator keeps high effort to interpret
multi-part situations correctly. Set `SIMFFEE_REASONING_EFFORT=high` to restore deeper
customer deliberation; `medium` is also accepted (`xhigh` only for `grok-4.6`). The effort
is part of cache identity, so changing it does not reuse decisions from another mode.
Other models omit this option, preserving the committed Qwen replay. Restart the backend
after changing code or environment settings; no frontend changes are required.

## Modules and spec mapping

| File/function | Spec | Responsibility |
| --- | --- | --- |
| `schema.Row`, `validate_row`, `coverage` | 3.4, 4.3 | Trajectory contract, provenance, validation, completeness |
| `loader.load_shops`, `load_twins` | 3.1–3.3 | Load data; normalize habit/interest by sorted shop ID |
| `resolve.resolve` | 3.3 | Parent overrides, then child overrides |
| `disruption.disruption` | 2.2 | Maximum shock against day-1 remembered conditions |
| `habit.apply_habit`, `regular_shop` | 2.1 | Habit reinforcement/decay and regular-shop selection |
| `gossip.apply_inbox`, `apply_marketing`, `gossip` | 2.3–2.4 | Social and marketing updates |
| `decide.autopilot` | 4.2 | Habit choice; unavailable usual shop/item means skipping |
| `decide.reappraise`, `experienced_shops` | 2.3, 4.3, 8 | Untried-alternative gate, cache, deliberation, validation |
| `decide._fallback` | 4.3 | Sanitized, explicitly failed diagnostic decision |
| `prompt.build` | 4.3 | Grounded identity, availability, options, three-day memory |
| `llm.complete_json` | 4.3 | Bounded xAI Responses-API transport and capability fallback |
| `cache.key`, `get`, `put` | 10.1 | Versioned decision-input cache |
| `loop.run_day`, `run` | 4.1, 5.1 | Visits, state updates, snapshots, parent forks |
| `cli.main` | 4.3 | Execution, per-seed coverage, strict completion gate |

## Decision and cache behavior

1. An hours shock with alternative curiosity below 0.20 triggers the skip rule
   only when no previously experienced alternative is open. The rule is inside
   `reappraise()`, not `autopilot()`, and does not special-case T08.
2. `visited` is initialized from the what-log, updated on purchases, and saved in
   snapshots. It survives the three-day memory window. Clearing curiosity after
   visiting an alternative must not block future deliberation about that shop.
   Experience does not force a purchase; negative experience can still lead to skipping.
3. The cache identity includes the twin record, state/history/visited shops,
   scenario/seed/day, shop facts, rendered prompts, schema, model, token cap,
   temperature policy, and transport version. Cache hits are locally validated.
   Old-format or malformed entries are misses, not silently reused or deleted.
4. Uncached model decisions use temperature 0.7; invalid output gets one retry at
   0.3. Unsupported `temperature` or `response_format` fields stay omitted for the
   model after capability probing. Rate-limit retries/backoff are bounded, with
   SDK retries disabled to prevent nested retry multiplication.
5. Failure produces `llm_failed=true`, `decision_source=fallback`. Model decisions
   carry `llm_model` and `llm_cache_key`; live and cached rows have identical
   provenance, so warm replay remains byte-identical. All reasoning is capped at
   40 words and raw provider errors never enter trajectories.

## Analysis and bundles

`build_runs.py` is always offline; narration uses deterministic fact rendering,
not a model call. `--out` chooses the destination. Input trajectories are checked
before writing, and conclusions are derived from the same rows placed in the bundle.

Fallback-dependent attribution, impact, what-if results, and narration are
withheld. Confidence requires at least three distinct usable reappraisal seeds
for a supported twin; autopilot stability cannot mask missing deliberation data.
Per-twin counts and partial-coverage reasons remain in exported confidence details.

Bundles expose `meta.coverage`, per-scenario/seed coverage, `meta.synthetic_run`,
and `meta.publishable`. Use `--synthetic` for mocked trajectories. Synthetic test
bundles are never publishable model evidence, even when mechanically complete.
A real release needs complete trajectories and consistent model/cache provenance.

## Verification

Run from the repository root:

```bash
python3 tests/test_repairs.py -v
python3 tests/test_b2_sync.py -v
python3 tests/test_analyzer.py
python3 tests/test_narrate.py
python3 tools/check_llm_path.py
python3 tools/validate.py
python3 tools/check_pipeline.py --out /tmp/simffee-pipeline-check
```

The pipeline check uses a clearly labeled deterministic stub, never the API. It
checks all four scenarios and five seeds, strict bundle construction, prefix and
random-state fork fairness, and warm-cache replay in separate processes with
different `PYTHONHASHSEED` values. It writes fresh artifacts and refuses to reuse
an existing nonempty output directory. Its customer choices test mechanics, not
realistic behavior or confidence calibration.

## Known modeling decisions still requiring review

- T08's marketing raises interest above the skip threshold before day 4; the data
  does not guarantee her scripted resistance.
- T10 never notices a competitor discount through regular-shop-only disruption;
  acquisition needs an approved attention mechanism or revised narrative.
- `cf_null` has its own day-6 wait shock, unlike the treatment arms; review this
  control design before interpreting the subtraction as calibrated causal evidence.
- Do not tune parameters to force the illustrative counts in SPEC §7.
- The existing cache requires regeneration under the new identity. Do not treat
  legacy cached decisions or a fallback-heavy offline run as a finished demo.
- The frontend is still a starter page and is outside this backend repair.

## Determinism invariants

- Ten twins × seven days gives 70 rows per scenario/seed, ordered by day then ID.
- Spending is zero exactly when the choice is `none`.
- Habit/latent maps and visited-shop lists use stable ordering.
- Gossip uses its own `Random(seed)`; forks start with the parent's saved RNG state.
- Remembered prices remain anchored to day 1. Re-anchoring is a modeling change,
  not part of this repair.
