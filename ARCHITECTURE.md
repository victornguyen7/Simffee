# Simffee — Architecture and Tech Stack

> Backend-focused overview of the working tree reviewed on 2026-09-20. This describes the implementation, including current local changes, rather than treating every feature in `spec/` as shipped.

## 1. What the project does

Simffee is an agent-based coffee-shop simulation for exploring business changes: opening hours, prices, menu, waiting time, marketing, and competitor entry. Synthetic customers (“twins”) live through a scenario day by day. The system records their choices and stated reasons, compares alternative scenarios, and visualizes the results.

The central design is **deterministic behavioral rules plus selective LLM decisions**:

- Routine purchases follow habit without a model call.
- Disruption, weak habit, or sufficient curiosity can trigger conscious reappraisal.
- Reappraisal uses a validated, cached model response, unless a deterministic skip rule applies.
- Analysis is computed from recorded trajectories; the model does not calculate dashboard metrics.

The supplied population is **10 synthetic twins and two shops**, Simffee Coffee and Starbucks. The standard scenario runs for seven days: 70 rows per scenario/seed. Run length and scenario definitions are configurable. Results are exploratory signals, **not validated forecasts of real customers or sales**; see [PROTOCOL.md](PROTOCOL.md).

## 2. Architecture at a glance

The backend is a **file-based Python modular monolith**, usable both as a batch CLI and through a local HTTP service. Engine and analyzer are Python packages, not separate deployed services. There is no database, message broker, or external job queue in the current implementation.

```text
                              Authored JSON
                       data/shops.json, twins/, scenarios/
                                      |
                  +-------------------+-------------------+
                  |                                       |
          Batch: engine.cli                      Interactive: React UI
                  |                                POST /whatif or /run
                  |                                       |
                  |                                 api/server.py
                  |                                       |
                  |                                api/service.py
                  |                                       |
                  |                       /whatif: engine/translate.py
                  |                       text -> actions -> scenario
                  |                                       |
                  +--------------> engine/loop.py <-------+
                                      |
                      resolve world -> update each twin
                                      |
                         +------------+------------+
                         |                         |
                    Habit / rule              Reappraisal
                    no model call          cache -> LLM if needed
                         |                         |
                         +------------+------------+
                                      |
                       JSONL trajectories + JSON snapshots
                                      |
                       analyzer/ + build_runs.py functions
                                      |
                         +------------+------------+
                         |                         |
                   Static runs.json           HTTP JSON answer
                         |                         |
                         +------------+------------+
                                      |
                             React visualization
```

Only [engine/llm.py](engine/llm.py) constructs the provider client. Both text translation and customer reappraisal use that transport. Analysis and current narration are local computations.

### Two delivery paths

| Path | How it works | Runtime backend needed? |
| --- | --- | --- |
| Precomputed demo | Engine generates trajectories; `build_runs.py` packages them into a bundle; the browser fetches `public/runs.json`. | No, once the bundle is built and served. |
| Interactive what-if | Browser submits text or a structured scenario; the API executes it and returns rows, analysis, coverage, and cost information. | Yes, the local Python API. New model decisions need provider access. |

## 3. Tech stack

Versions below are declared dependency ranges or source defaults, not a claim about the currently installed environment.

| Layer | Technology | Role |
| --- | --- | --- |
| Backend runtime | Python 3.11+ documented in `engine/README.md` | Simulation, translation, analysis, API, tooling. |
| Backend dependencies | `openai>=1.66.0` in [requirements.txt](requirements.txt) | The sole declared third-party Python dependency, used for live model requests. There is no Python dependency lockfile. |
| HTTP server | Standard-library `http.server.ThreadingHTTPServer` | Small JSON API bound to `127.0.0.1`, port `8765` by default. Not FastAPI, Flask, Django, or ASGI. |
| Domain modeling | `dataclasses`, type hints, dictionaries, local validators | `Twin`, `Scenario`, `Row`, and `Disruption`; no ORM or Pydantic dependency. |
| Execution | Sequential simulation loop; `ThreadPoolExecutor` and `threading.Lock` in the API | Background execution with serialized engine runs. |
| LLM transport | OpenAI Python SDK pointed at xAI's Responses API | `client.responses.create`, structured JSON when supported, local validation in all cases. Using this SDK does not mean requests go to OpenAI. |
| Model selection | `SIMFFEE_MODEL`; source fallback `qwen/qwen3.8-27b` | Environment-configurable. Provider/model compatibility must be checked before live use; the source fallback is not a verified provider capability. |
| Persistence | JSON and JSONL on the local filesystem | Input records, cached decisions, trajectories, daily snapshots, live-run registry, and cost ledgers. |
| Frontend | React / React DOM `^19.2.8`, TypeScript `~6.0.2` | Dashboard, playback, what-if controls, and town visualization. |
| Frontend tooling | Vite `^8.3.0`, `@vitejs/plugin-react` `^6.1.1`, Oxlint `^1.81.0`, npm lockfile | Development server, production bundle, type checking, linting. |
| Testing | Python `unittest`, `unittest.mock`, standalone assertion scripts | Offline engine, API, analysis, translation, and integration checks. No declared pytest dependency. |
| Orchestration | Bash scripts in `tools/` | Demo assembly, local serving, determinism checks. |

No implemented Elasticsearch integration, vector store, Redis, container deployment, or cloud infrastructure configuration was found. Elasticsearch is a proposal in [spec/ELASTIC_PLAN.md](spec/ELASTIC_PLAN.md), not part of the runtime stack.

## 4. Repository map and backend boundaries

| Location | Responsibility |
| --- | --- |
| [data/](data/) | Authored shops, synthetic twin records, scenario definitions, allowed translator actions, naive-attribution weights. |
| [engine/](engine/) | Domain contracts, world resolution, simulation, prompts, model transport, caching, translation, CLI. |
| [analyzer/](analyzer/) | Break detection, attribution, counterfactual comparisons, flows, confidence heuristics, deterministic narration. |
| [api/server.py](api/server.py) | HTTP parsing, routing, JSON responses, CORS, server startup. |
| [api/service.py](api/service.py) | Library access, live-run orchestration, ancestor copying, analysis, timeout response, registry, cost recording. No HTTP implementation inside this layer. |
| [build_runs.py](build_runs.py) | Validates trajectory files and assembles frontend bundles. Its analysis functions are also reused by the API. |
| `cache/` | Content-addressed model decisions; `cache/translations/` holds translation replies. Intended to be committed for replay. |
| `runs/` | Generated trajectories, snapshots, and live outputs; Git-ignored. |
| [public/runs.json](public/runs.json) | Static bundle consumed by the browser. |
| [src/](src/) | React application and TypeScript representations of backend output. |
| [tests/](tests/) and [tools/](tools/) | Regression tests, synthetic fixtures, pipeline checks, validation, cost reporting, demo scripts. |
| [spec/](spec/) | Product specifications, historical plans, status reports, and future work. Some statements predate the current implementation. |

### Engine modules

| Module | Responsibility |
| --- | --- |
| `schema.py` | Shared row contract, enums, mechanism constants, validation, completeness/provenance reporting. |
| `loader.py` | Loads and checks inputs; discovers scenarios; resolves parent chains and rejects cycles. |
| `resolve.py` | Applies parent then child overrides, handles dotted keys and `unset`, excludes shops that do not yet exist. |
| `loop.py` | Runs days and twins in stable order; updates state; writes trajectories and snapshots; forks parent runs. |
| `habit.py`, `disruption.py`, `gossip.py` | Habit reinforcement/decay, disruption scoring, marketing, entrant curiosity, delayed social influence. |
| `decide.py` | Autopilot, skip rule, reappraisal cache lookup, decision validation, retry, and flagged fallback. |
| `prompt.py` | Builds grounded prompts from identity, behavior/interview data, current world, options, and recent memory. |
| `llm.py`, `cache.py` | Provider boundary and content-addressed decision storage. |
| `translate.py` | Plain text -> closed action vocabulary -> checked scenario overrides. |
| `cli.py` | Batch entry point, scenario/seed selection, coverage reporting, strict completion gate. |

## 5. Domain model and storage contracts

### Inputs

**Shop:** identity/name, position, opening/closing times, product list, VND prices, quality, average wait, and marketing reach/message. Scenario overrides may introduce existence timing, permanent closure, or prompt-only labels.

**Twin:** identity/home, purchase profile, historical `what_log`, interview-style `why_transcript`, optional say/do gap, and mechanism parameters. Parameters include per-shop habit and latent interest, disruption threshold, social links, talkativeness, and ad sensitivity. The current engine reads authored parameters; it does not ingest real POS data or automatically derive personas from interviews.

**Scenario:** an ID, optional parent, timed overrides, and optional metadata such as `days`, `focus_shop`, `label`, `role`, and `source`. For example:

```json
{
  "id": "example_reopen",
  "parent": "baseline",
  "label": "Reopen earlier",
  "role": "whatif",
  "days": 7,
  "focus_shop": "simffee",
  "overrides": [
    {"from_day": 5, "shop": "simffee", "set": {"open": "06:00"}}
  ]
}
```

Parent changes apply first; child changes take precedence. `unset` restores a field to its base value in `data/shops.json`, not merely to the immediately preceding parent value.

### Mutable simulation state

Each twin has per-shop `habit` and `latent_interest`, an inbox for next-day gossip, the last three days of decision history, and persistent `visited` shops. A snapshot saves all twins' state plus the Python RNG state.

```text
<run-directory>/
  <scenario>/
    <seed>.jsonl
    <seed>/state_day<day>.json

cache/<decision-hash>.json
cache/translations/<translation-hash>.json

runs/live/
  registry.json
  <run-id>/
    runs/<scenario>/...
    cost_ledger.jsonl
```

### Trajectory row: the main backend contract

[engine/schema.py](engine/schema.py) defines one row per `(scenario, seed, day, twin)`:

- Identity: `scenario`, `seed`, `day`, `twin`.
- Mechanism: `mode`, `disruption`, `state_before`, `state_after`.
- Outcome: `choice`, `spent`, `abandoned`, `valence`.
- Explanation: `primary_driver`, `secondary_driver`, `reasoning`, `told`.
- Provenance: `llm_failed`, `decision_source`, `llm_model`, `llm_cache_key`.

A choice is a shop ID or `none`. Skipping means zero spending; a purchase must have positive spending. Rows are ordered by day then twin ID. Reasoning is limited to 40 words. `decision_source` distinguishes `autopilot`, `rule`, `llm`, and `fallback`; cached model decisions retain `llm` provenance rather than changing the trajectory on replay.

[tools/validate.py](tools/validate.py) adds file-level checks: known twins/shops, ordering, unique twin/day pairs, full day coverage, and valid gossip recipients.

## 6. How a simulation runs

### Daily decision cycle

1. Resolve today's shop state from the scenario chain.
2. For each twin in sorted ID order, apply yesterday's gossip, today's marketing, and any opening-day curiosity bump.
3. Select the regular shop from habit and compute disruption. Disruption is the **maximum** source, not a sum: hours, price, product, wait, closure, or new entrant. Existing shops are compared against remembered day-one conditions; later entrants are remembered from their opening day.
4. Choose autopilot if habit is at least `0.60`, disruption does not exceed the twin's threshold, and alternative curiosity has not exceeded regular-shop habit by more than `0.30`. Otherwise enter reappraisal.
5. Resolve the choice. An hours shock with low alternative interest can produce a deterministic skip when no experienced alternative is open. Other reappraisals use the decision cache or model.
6. Compute spending from shop data, reinforce/decay habit, record visits, convert alternative curiosity into experience, and retain a three-day memory.
7. After all twins act, generate word of mouth for the next day. Write the day's snapshot and eventually the scenario's JSONL trajectory.

The model chooses a shop, drivers, valence, and explanation. It does **not** directly mutate habit, calculate spending, or decide which overrides apply.

### Scenario forks and reproducibility

A normal child scenario loads its parent's snapshot from the day before its first override. It copies the earlier trajectory rows with the child scenario ID, then continues with the parent's saved random state. The parent must already have the needed rows and snapshot.

Existence changes are different: declaring that a competitor did not exist earlier changes the initial world. These scenarios restart from day one. The translator constructs a root scenario with inherited overrides inlined and retains lineage in `derived_from`.

Reproducibility comes from stable ordering, saved RNG state, and cached model decisions. **A seed alone does not make fresh remote LLM responses deterministic**; it seeds local simulation randomness and participates in cache identity, but is not sent as a provider sampling seed.

### Supplied scenarios

| Scenario | Purpose | Default bundle? |
| --- | --- | --- |
| `baseline` | Simffee opens later and raises the latte price from day four. Despite its name, this is the changed-world story. | Yes |
| `cf_null` | Control without those changes, but with its own day-six wait spike. | Yes |
| `cf_restore_hours` | Fork on day five: restore earlier opening, retain the higher price. | Yes |
| `cf_discount` | Fork on day five: restore opening and reduce latte price to 38,000 VND. | Yes |
| `s2_entrant` | Competitor appears on day four alongside Simffee's hours/price changes. | No |
| `s2_entrant_only` | Entrant appears, but Simffee's hours/price changes are removed. | No |
| `abl_rename` | Same entrant mechanics with a prompt-only “Shop B” label; measures choice agreement. | No |

The optional scenarios are included with `--include-all`. Demo assembly defaults to seeds `0-2`; the general bundle builder defaults to `0-4`, so pass seeds explicitly when using a three-seed library.

## 7. LLM boundary, translation, and caching

### Customer decisions

The decision cache hashes scenario/seed/day, twin data, mutable state, shop facts, prompts, response schema, model, output-token cap, temperature policy, and transport version. Cache entries are checked locally before reuse; malformed or incompatible entries are misses.

On a live miss, reappraisal requests structured JSON at temperature `0.7`, with one validation retry at `0.3`. The transport can drop unsupported temperature or structured-output parameters, while keeping local validation. SDK retries are disabled; the transport implements pacing and bounded rate-limit backoff itself.

Offline cache misses and exhausted failures produce explicitly flagged fallback rows. They are diagnostic output, not evidence of customer preferences. Provider errors are classified/sanitized before entering decision rows. Requests set `store=False`; this is a request setting, not a blanket guarantee about provider retention policies.

### Natural-language translation

[data/actions.json](data/actions.json) defines the allowed vocabulary: hours, prices, adding/removing products, wait, quality, marketing, closure, restoration, and entry of a known competitor. The LLM selects actions and values; deterministic code compiles them into overrides and applies limits such as at most six actions and valid time/price ranges.

Unsupported requests are returned with reasons rather than silently introducing new mechanics. Partially supported requests can produce a scenario plus explicit unsupported items. Translation replies use a separate cache keyed by normalized text, parent ID, shop data, action definitions, and model; replies are compiled again when loaded.

### Configuration

The transport loads an allowlisted set of variables from the private repository `.env`. Existing shell variables win; the engine CLI's `--model` wins over both.

| Variable | Source default / purpose |
| --- | --- |
| `XAI_API_KEY` | Required for live transport; no embedded credential. |
| `SIMFFEE_MODEL` | `qwen/qwen3.8-27b`; choose a model supported by the configured xAI endpoint. |
| `SIMFFEE_MAX_TOKENS` | `400` output tokens per request. |
| `SIMFFEE_MIN_INTERVAL` | `2.2` seconds minimum request spacing. |
| `SIMFFEE_TIMEOUT_S` | `180` seconds per provider request. |
| `VITE_API_URL` | Frontend API address; defaults to `http://127.0.0.1:8765`. Not loaded by the backend's `.env` parser. |

Keep credentials local and never use a `VITE_` prefix for secrets: Vite-prefixed values are browser configuration. Model, prompt, and token-budget changes can invalidate decision-cache reuse.

## 8. Analysis and bundle assembly

The analyzer consumes trajectories rather than asking another model to infer conclusions:

| Module | Computation |
| --- | --- |
| `breakpoint.py` | First sales rise/drop of at least 25% versus the preceding three-day average, excluding matching control movement. |
| `attribution.py` | Compares a weighted naive reading of overrides with the drivers recorded by customers who changed choices; selects evidence rows. |
| `pairwise.py`, `impact.py` | Identifies lost/returning customers and compares baseline, control, and intervention outcomes. |
| `confidence.py` | Heuristic score: `0.7 × cross-seed stability + 0.3 × interview support`. Support uses keyword matching, not embeddings or learned retrieval. |
| `flows.py` | Day-over-day losses, gains, returns, net movement, driver breakdowns, and named-versus-renamed choice agreement. |
| `templates.py` | Selects the analysis question for the situation. |
| `narrate.py` | Deterministic fact-based prose. Its historical LLM-oriented docstring does not describe the current `narrate()` implementation. |

Confidence needs at least three usable seeds and qualifying reappraisal evidence. It is **not a calibrated probability**. A single-seed answer can show outcomes while leaving confidence unmeasured.

Fallback-dependent attribution, impact, intervention conclusions, and narration are withheld. Descriptive flow reports can remain available and expose fallback-move counts. `meta.publishable` additionally checks completeness, model/cache provenance, and whether the run is a test/stub artifact; this flag does not validate real-world predictive accuracy.

The bundle has five main sections: `meta`, `shops`, `twins`, `scenarios`, and `analysis`. Each scenario contains per-seed rows, daily sales, and coverage. All bundle builds are offline. The static build also renders narration; the live service calls the shared analysis builder directly and does not run that final narration step.

## 9. Local API and execution model

| Endpoint | Current behavior |
| --- | --- |
| `GET /health` | Configuration/availability summary, library seeds, cache count, and live-run count. `llm: true` means a client can be constructed, not that a model request was verified. |
| `GET /library` | Promoted library summary, selected analysis, and live-run listings; not the full static bundle. |
| `POST /whatif` | Accepts `text`, optional `parent`, and `seeds`; translates, simulates, validates, analyzes, and returns the answer. |
| `POST /run` | Accepts a structured `scenario` and `seeds`; skips translation. |
| `GET /runs/<run_id>` | Returns persisted registry metadata such as scenario, run directory, seeds, and timestamp, **not** the original full answer. |

A successful live execution returns a human-readable override `chip`, per-seed rows/sales/coverage, analysis, model-cost counters, and warnings. Requested seeds must be available in the promoted library. Ancestor rows and snapshots are copied into an isolated live-run directory, so execution does not write into the library or `public/`.

The HTTP server is threaded and the service has a two-worker executor, but a lock serializes engine runs because statistics are process-global. This is not a durable queue or a multi-user worker architecture.

For `/whatif`, exceeding the wait deadline (`--timeout`, default 240 seconds) normally returns a labeled nearest-library result plus `pending_run_id`; the background run continues. Matching uses overlap of overridden shop/field keys, not semantic search. Translation is synchronous, so the deadline is not a hard end-to-end cancellation boundary. Direct `/run` calls currently have no equivalent service wait deadline. The browser aborts POST waits after 300 seconds.

The API writes per-run cost ledgers from transport-counter deltas and pricing data in `tools/pricing.json`. Translation happens before that snapshot, so this is not complete end-to-end request billing. The engine CLI prints usage statistics but does not itself persist these ledger rows.

## 10. Frontend and deployment boundary

The frontend is already a working dashboard, not just the original Vite starter:

- [src/App.tsx](src/App.tsx) loads the static bundle and merges successful live answers into its in-memory scenario set.
- [src/api.ts](src/api.ts) calls the local API with native `fetch`.
- [src/types.ts](src/types.ts) describes backend payloads in TypeScript; these types are maintained separately, not generated from Python contracts.
- `src/components/` provides playback controls, analysis, what-if input, town rendering, and shop interiors.
- `src/town/` handles presentation and browser-local town state. Painting the town is not an API operation that changes simulation shop positions.

`npm run build` type-checks and produces a static `dist/` site. Vite and the Python API run separately; there is no Vite API proxy configured. Static playback can be hosted independently, but interactive operation needs a reachable API and the correct build-time `VITE_API_URL`.

The backend is presently a **trusted local-demo service**: loopback binding, wildcard CORS, no authentication, no tenant isolation, and filesystem persistence. Internet-facing deployment would require input/path hardening, authentication, restricted origins, durable job handling, and stronger storage/concurrency controls. No production deployment manifests or CI workflow were found.

## 11. Local workflows and verification

Run commands from the repository root. Use an existing Python environment or create an isolated one outside the tracked source; install `requirements.txt` there if live transport is needed. Offline replay and stubbed tests do not require credentials. The frontend uses `npm ci` and the committed npm lockfile.

### Generate an isolated offline demo

```bash
./tools/build_demo.sh --offline --out /tmp/simffee-architecture-demo
```

The destination must be new or empty. The script defaults to three seeds, runs strict engine generation, validates rows, and writes `/tmp/simffee-architecture-demo/runs.json`. It **does not replace** `public/runs.json`. A strict offline cache miss fails rather than publishing a fallback-heavy demo. Local model/token overrides must match the cache being replayed.

The equivalent explicit stages are:

```bash
python3 -m engine.cli --all --seeds 0-2 --offline --require-complete --out /tmp/simffee-architecture-demo/runs --cache cache
python3 tools/validate.py /tmp/simffee-architecture-demo/runs
python3 build_runs.py /tmp/simffee-architecture-demo/runs --seeds 0-2 --offline --require-complete --out /tmp/simffee-architecture-demo/runs.json
```

Choose either the script or the explicit stages, and use a fresh output location. For custom-length scenarios, the validator's `check_file(..., days=...)` supports the scenario length, while its standalone CLI currently assumes seven days.

### Serve the UI and a generated library

```bash
python3 -m api.server --library /tmp/simffee-architecture-demo/runs --cache cache --live-dir /tmp/simffee-architecture-live --offline
npm run dev
```

Run the commands in separate terminals. The UI still reads the repository's `public/runs.json`; generating a separate library does not synchronize that static file. Promoting a new bundle is an explicit step.

**Offline caveat:** `engine.cli --offline` never requests model decisions, and `build_runs.py` is always local. In the API, `--offline` is passed to the engine but **not to the text translator**: an uncached `/whatif` can still attempt a provider call. For guaranteed no-network API use, submit structured scenarios through `/run` with the server offline. Remove `--offline` only when live simulation calls and spend are intended.

`tools/serve_demo.sh` is another convenience entry point, but it deletes and rebuilds `runs/library`, starts an API capable of live calls, and overrides the what-if wait timeout to 60 seconds. Do not treat it as a non-destructive or fully offline launcher.

### Verification commands

```bash
python3 tests/test_repairs.py -v
python3 tests/test_b2_sync.py -v
python3 tests/test_environment.py -v
python3 tests/test_phase_b.py -v
python3 tests/test_analyzer.py
python3 tests/test_narrate.py
python3 tests/test_generic.py
python3 tests/test_translate.py
python3 tests/test_api.py
python3 tools/check_llm_path.py
python3 tools/check_pipeline.py --out /tmp/simffee-architecture-pipeline
npm run lint
npm run build
```

These Python checks use fixtures, offline paths, or injected model stubs. Some are standalone scripts, so unittest discovery alone does not execute every test suite. The pipeline destination must be new or empty; it checks generated trajectories, forks, strict bundling, and warm-cache replay across processes. Synthetic test success verifies mechanics, not model realism. `tools/check_translate_live.py` is a separate live-provider check and is not part of this offline list.

## 12. Current scope and important limitations

**Implemented:** habit/reappraisal simulation, scenario inheritance, disk caching, snapshot forks, variable run lengths, text-to-action translation, local what-if API, counterfactual analysis, customer flows, competitor entry, rename ablation, and a React dashboard.

**Planned rather than implemented:** dormant/non-coffee populations, focus-shop launch modeling, generated crowds, loyalty balances, delivery/pre-order mechanics, time-windowed prices, bundle purchases, and Elasticsearch-backed ingestion/evidence retrieval. See [spec/ROADMAP.md](spec/ROADMAP.md).

Keep these implementation boundaries in mind:

- Quality and competitor discounts can affect deliberation, but do not independently trigger the regular-shop disruption gate. Adding a menu item does not introduce a multi-item shopping basket; spending still uses the usual item or cheapest available alternative.
- The control scenario has an independent day-six wait shock. That modeling choice needs review before interpreting control subtraction as calibrated causal evidence.
- Structured scenarios do not receive all the translator's action-level validation. This API is not a hardened arbitrary-input execution boundary.
- Structured live-to-live forks are supported, but the translator resolves parents from authored scenario files rather than the live registry; free-text follow-ups on live parents are not fully wired.
- Live run IDs identify filesystem output and registry entries. Re-running the same ID replaces its trajectory directory; results are not immutable versioned records.
- Scenario lengths are supported in the engine and per-seed reporting, but aggregate bundle coverage currently uses the seven-day default. Non-seven-day bundles need review before relying on `publishable` or strict aggregate gates.
- Flat-file caches and registry writes have no database transactions or cross-process coordination. The API lock is only in-process.

For changes, start with the owning layer: mechanisms in `engine/`, supported user actions in `data/actions.json` and `engine/translate.py`, metrics in `analyzer/`, bundle shape in `build_runs.py`, and API orchestration in `api/service.py`. A trajectory-contract change must be coordinated across `engine/schema.py`, analyzer consumers, tests, and `src/types.ts`.
