# engine/ — B1, the simulation

Turns `/data` into `runs/{scenario}/{seed}.jsonl` + per-day state snapshots.
Contracts live in [`schema.py`](./schema.py); B2 imports that module.
Spec: [../spec/SPEC.md](../spec/SPEC.md) · Plan: [../spec/BACKEND_PLAN.md](../spec/BACKEND_PLAN.md)

## Run

```bash
python3 -m engine.cli --scenario baseline --seeds 0     # one run
python3 -m engine.cli --all --seeds 0-4                 # 4 scenarios x 5 seeds
./tools/check_determinism.sh                            # replay + fork fairness
```

Python 3.11+, stdlib plus `anthropic` (`pip install -r requirements.txt`).
`--offline` and a warm `cache/` need no API key at all.

## Modules

| File | Spec | Does |
| --- | --- | --- |
| `schema.py` | 3.4 | Constants, enums, `Row`, `validate_row`. The B1/B2 contract. |
| `loader.py` | 3.1–3.3 | Reads and validates `/data`; normalises habit/latent to every shop. |
| `resolve.py` | 3.3 | Shop state on day `d`: parent overrides, then the child's. |
| `disruption.py` | 2.2 | Max over the 5 shock sources, against the day-1 remembered world. |
| `habit.py` | 2.1 | `h += a(1-h)` on the choice, `h *= (1-d)` on the rest. |
| `gossip.py` | 2.3, 2.4 | Marketing drip, inbox from yesterday, one talkativeness roll per twin. |
| `decide.py` | 4.2, 4.3 | `autopilot()` and `reappraise()` — cache, validate, retry, fallback. |
| `prompt.py` | 4.3 | The four prompt blocks: identity, today, options, 3-day memory. |
| `llm.py` | 4.3 | The only call site. Claude Haiku 4.5, JSON-schema constrained. |
| `cache.py` | 10.1 | sha1-keyed response cache. `cache/` is committed. |
| `loop.py` | 4.1, 5.1 | The day loop, snapshots, and forking from a parent snapshot. |
| `cli.py` | — | Entry point, per-day summary, schema validation on every run. |

## The LLM call

One call per twin per day in reappraisal, and only then — autopilot days spend
nothing. `claude-haiku-4-5` (override with `SIMFFEE_MODEL` or `--model`),
`max_tokens` 300, replies constrained to a json_schema.

Order of operations in `decide.reappraise()`:

1. **The T08 gate, before any call.** Curiosity under 0.20 plus an hours shock →
   skip. Deterministic, and it saves a token.
2. **Cache lookup** on `sha1(twin, day, scenario, seed, state_before, shops_today)`.
   A warm cache means zero calls.
3. **Call at temperature 0.7**, validate enums, choice, valence, and that the
   chosen shop is actually open. On failure, **one retry at 0.3**.
4. **Two failures → autopilot fallback with `llm_failed: true`**, so the
   analyzer drops the row from confidence instead of reading it as signal.

Two capabilities are probed once per process rather than assumed, because they
vary by model and SDK version: `temperature` (dropped from the Python SDK's
typed signature in 1.x, so it goes through `extra_body`) and
`output_config.format`. If either is rejected the call retries without it —
`temperature` unsupported just makes step 3's retry a plain second attempt.
Seed variance survives either way, since each seed is its own cache key.

`python3 tools/check_llm_path.py` exercises all of this against a stubbed
transport: no API key, no spend.

## Invariants the analyzer relies on

- 10 twins x 7 days = 70 rows per file, ordered by day then twin id.
- `spent == 0` exactly when `choice == "none"`, never null.
- `primary_driver` always set; `secondary_driver` may be null.
- Same seed replays byte for byte; a fork shares its parent's random stream and
  its opening days. Both are asserted by `tools/check_determinism.sh`.

## Watch out

- Twin order is fixed by id, and gossip uses its own `Random(seed)` — never the
  global `random`.
- Never iterate a `set` of shop ids when building state: Python randomises
  string hashing per process and two runs of the same seed will differ in key
  order. Sort first.
- "Remembered" prices are pinned to the day-1 resolved world, so a price rise
  keeps reading as a shock on days 5–7. That is a deliberate tuning knob
  (SPEC 7.3), not a bug — if twins should re-anchor, change it here and say so.
