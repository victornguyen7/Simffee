# Simffee — Detailed Change Report and Simulation Run Guide

**Report date:** 2026-09-20

**Repository:** `/Users/hiennguyen/Simffee`

**Comparison baseline:** `f6aa19fea22a3e78b83296c6a37695dee20e9442` (`f6aa19f`, “B2: what-if confidence, contract fixes, one-command demo build”)

**Scope:** All tracked modifications and non-ignored untracked files present when this review began. This is a working-tree report, not a changelog for every historical commit.

## 1. Executive summary

The working tree substantially revises the Python simulation backend and its analysis/build pipeline. The main changes are:

1. **Groq replaces Anthropic for live decisions.** Credentials are loaded locally, requests are paced, retries are bounded, unsupported API features are handled, and usage is reported without inventing a cost estimate.
2. **Previous experience survives the curiosity reset.** A customer who has visited an alternative shop is no longer automatically prevented from reconsidering it just because their curiosity was reset to zero.
3. **Cache reuse becomes stricter.** Cache identity includes the actual decision inputs, prompt, model, schema, and transport settings. Old or invalid responses are not silently reused.
4. **Technical failures are separated from customer behavior.** Fallbacks are explicitly marked, coverage is exported, and incomplete trajectories cannot produce the normal causal analysis or narration.
5. **Confidence requires meaningful sample coverage.** Three distinct usable seeds are required, and stable autopilot behavior cannot substitute for usable deliberation evidence.
6. **Narration is deterministic and offline.** It renders computed facts rather than asking another model to write potentially unsupported conclusions.
7. **Demo generation is isolated and strict.** The wrapper defaults to offline operation, refuses nonempty output directories, and does not overwrite the public demo bundle.
8. **Regression and end-to-end verification are expanded.** New tests cover the repair, B2 integration, environment loading, fork fairness, cache replay, and strict rejection of incomplete evidence.

### Current readiness

- The offline unit, fixture, and synthetic pipeline checks passed during this review.
- The checked-in frontend remains the React/Vite starter page; there is no simulation dashboard yet.
- The existing 43 cache files are untracked, identify `openai/gpt-oss-20b`, and lack the new `_version: 2` metadata. They are not a compatible replay cache for the current engine.
- A fresh offline diagnostic run produced valid row structure, but **not complete model evidence**. Strict release checks correctly rejected it.
- No live API requests were made for this report. A real-model run requires an approved model, provider access, and spending decision.

### Inventory at the start of the review

| Category | Count | Notes |
| --- | ---: | --- |
| Modified tracked files | 26 | 813 added lines, 351 removed lines |
| New/untracked test, tool, and planning files | 5 | Three test files, one pipeline tool, one fix plan |
| Untracked cache JSON files | 43 | Legacy response artifacts, listed in Appendix A |
| Other untracked artifact | 1 | `=0.5.0`, a pip output log |
| Total non-ignored changed/untracked files | 75 | 26 modified plus 49 untracked |
| Staged changes | 0 | All reviewed tracked modifications were unstaged |
| Deleted tracked files | 0 | No tracked deletions were present |

This report itself, `spec/CHANGE_REPORT.md`, was added afterward and is not included in those counts. No application source, scenario data, existing cache file, or public bundle was changed while preparing it.

## 2. How the simulation fits together

```text
Shop, customer, and scenario JSON in data/
                    |
                    v
engine.cli -> scenario/day loop -> autopilot or reappraisal
                                      |
                            compatible cache / Groq
                                      |
                    v
JSONL trajectories + state/RNG snapshots
                    |
                    v
tools/validate.py -> build_runs.py -> analyzer modules
                                      |
                    v
Bundle: metadata, shops, twins, rows, sales, analysis
```

The population has **10 synthetic twins**, simulated over **7 days**, normally using **5 seeds** (`0-4`) and **4 scenarios**. A full bundle therefore contains **20 trajectory files and 1,400 rows**.

| Scenario | Behavior | Dependency |
| --- | --- | --- |
| `baseline` | From day 4, Simffee opens at 07:00 instead of 06:30 and latte price becomes 48,000 VND instead of 45,000 VND. | Independent run |
| `cf_null` | Does not apply the baseline hours/price change; from day 6, Simffee's average wait becomes 12 minutes. | Independent run |
| `cf_discount` | Inherits baseline through day 4; from day 5, latte price becomes 38,000 VND while the later opening remains. | Baseline rows and day-4 snapshot for the same seed |
| `cf_restore_hours` | Inherits baseline through day 4; from day 5, opening returns to 06:30 while the 48,000 VND latte remains. | Baseline rows and day-4 snapshot for the same seed |

`--all` runs these in the required order. The two treatment branches restore the parent's state and random-number-generator state before continuing. They include inherited early rows in their own JSONL files.

The label “Cut prices 15%” is approximate: the implemented price is explicitly 38,000 VND. The control's separate wait shock is a modeling assumption that still needs review, not proof of a clean causal experiment.

## 3. Modified tracked files: detailed report

Line counts below are additions/removals relative to `f6aa19f`; they are not total file sizes.

### 3.1 Runtime dependencies and credential handling

| File | Diff | Changes and effect |
| --- | --- | --- |
| `.gitignore` | +2 / -0 | Adds `.env` and `.env.*` so local credential/configuration files are not accidentally staged. Existing ignores for generated runs, Python bytecode, and frontend build output remain. `cache/` is not ignored. |
| `requirements.txt` | +1 / -1 | Replaces `anthropic>=1.7.0` with `groq>=0.5.0`. Offline simulation, analysis, validation, and mocked tests use the standard library; live calls require the Groq SDK. The requirement is a lower bound, not a reproducible version pin. |
| `engine/llm.py` | +156 / -49 | Replaces the Anthropic transport with Groq chat completions. Adds local environment loading, request pacing, bounded rate-limit backoff, per-model capability handling, sanitized failures, and transport usage counters. |

**Details of `engine/llm.py`:**

- Reads the repository-root `.env` and accepts only `GROQ_API_KEY`, `SIMFFEE_MODEL`, `SIMFFEE_MAX_TOKENS`, and `SIMFFEE_MIN_INTERVAL`.
- Supports quoted values, `export KEY=...`, and comments. It does not execute shell commands or expand shell variables.
- Existing process environment variables take precedence over `.env`. A CLI `--model` argument takes precedence over both model settings.
- Defaults to `groq/compound-mini`, a 1,600-token response cap, a 30-second client timeout, and a 2.2-second minimum request interval.
- Constructs the Groq client only when needed and disables SDK retries to avoid multiplying the engine's retry policy.
- Allows up to four attempts in the rate-limit backoff loop; suggested waits above 75 seconds are not followed. Unsupported request-shape probing and invalid-decision retries are separate bounded layers, so four is not the maximum total attempts for an entire decision.
- Omits `temperature` or `response_format` after an unsupported-feature response for the active model. Switching models resets capability probing.
- Counts response usage before JSON parsing, so malformed JSON responses still contribute to reported tokens.
- Avoids embedding raw provider errors or model response text in diagnostic exception messages.

### 3.2 Decision behavior, prompting, and state

| File | Diff | Changes and effect |
| --- | --- | --- |
| `engine/decide.py` | +63 / -26 | Adds persistent experience awareness to reappraisal, strengthens response validation, expands cache inputs, validates cache hits, and attaches explicit decision provenance. Sanitizes fallback reasons. |
| `engine/prompt.py` | +29 / -8 | Makes prompts better grounded in availability, actual item prices, prior visits, and behavior logs. Changes the framing of budgets, interest, and skipping. |
| `engine/loop.py` | +7 / -0 | Initializes, updates, snapshots, and restores `visited` shop lists. Includes `decision_source`, `llm_model`, and `llm_cache_key` in output rows. |
| `engine/timeutil.py` | +1 / -1 | Makes `is_open_at()` return false for a shop marked `permanently_closed`, even if its daily hours otherwise match. |

**Decision repair:** Previously, clearing alternative-shop curiosity after a visit could cause the next hours-shock reappraisal to take the low-interest skip rule. The new rule skips only when alternative interest is below `0.20`, the shock is `hours`, and **no previously experienced alternative is open**.

Experience is assembled from the original what-log, recent history, and persistent `visited` state. It allows the model/cache decision path to run; it does not force a purchase. Negative experience can still produce a deliberate skip.

**Additional decision checks:**

- Requires the expected decision fields and checks choice/driver types and allowed values.
- Rejects non-finite or out-of-range valence rather than silently clamping it.
- Requires nonempty text reasoning; newly validated decisions are capped at 40 words.
- Rejects unavailable choices, including permanently closed shops.
- Uses the cheapest actually available product when the usual item is absent, rather than using a stale price entry for a removed item.
- Marks deterministic skips as `decision_source=rule`, model/cache decisions as `llm`, and technical fallbacks as `fallback` with `llm_failed=true`.

**Prompt changes:**

- Reads `say_do_gap.log_shows`, with compatibility for the older `does` field.
- Says a usual shop cannot serve the twin only when it is actually closed at their usual time.
- Distinguishes an unavailable usual item from complete shop unavailability.
- Replaces a binary over-budget warning with the actual VND budget gap and removes the walk-tolerance warning from option text.
- Adds a stronger interest tier at `0.55`, but explicitly avoids inventing an endorsement when none is recorded.
- Identifies previously visited alternatives as experience-based options rather than treating them as untried curiosity.
- Frames skipping as going through the day's routine without coffee.

These prompt and customer-input changes can alter model behavior; they invalidate old responses and are not merely formatting changes.

### 3.3 Cache, row contract, and command-line reporting

| File | Diff | Changes and effect |
| --- | --- | --- |
| `engine/cache.py` | +8 / -2 | Adds a version-2 canonical cache payload and optional decision context. Malformed JSON, invalid encoding, and non-object cache contents become misses rather than usable responses. |
| `engine/schema.py` | +64 / -2 | Adds row provenance fields, a shared 40-word limit, additional type/consistency validation, and the `coverage()` report. |
| `engine/cli.py` | +23 / -9 | Adds `--require-complete`, per-scenario/seed coverage even with `--quiet`, and separate API-attempt/token reporting. Removes the old calculated dollar estimate. |

The effective cache key now includes the twin record, scenario/seed/day, full decision state, history, visited shops, current shop facts, regular shop, disruption, rendered prompts, response schema, model, token cap, temperature policy, and transport version.

A cache hit must carry matching `_model` and `_version: 2` metadata and pass local decision validation. Legacy, corrupt, incompatible, or invalid entries are not deleted automatically; they are ignored as misses.

New row fields are:

| Field | Meaning |
| --- | --- |
| `decision_source` | `autopilot`, `rule`, `llm`, or `fallback` |
| `llm_model` | Configured model identifier for a model-derived decision |
| `llm_cache_key` | Cache identity associated with that decision |
| `llm_failed` | Whether a technical fallback substituted for deliberation |

Live generation and warm-cache replay intentionally use the same `llm` provenance so the resulting rows can be byte-identical. The model field records the configured identifier; it is not an independent attestation of the provider's internal model routing.

`coverage()` reports row/grid completeness, reappraisals, fallbacks, model identifiers, missing provenance, and skip categories. A complete grid alone is not sufficient: fallback-free coverage and consistent provenance are separate checks. A short diagnostic run is not a complete seven-day run.

### 3.4 Analysis and confidence

| File | Diff | Changes and effect |
| --- | --- | --- |
| `analyzer/attribution.py` | +5 / -0 | Withholds the actual driver and evidence cards if fallbacks occur on or before the break day. Prevents placeholder decisions from becoming causal evidence. |
| `analyzer/impact.py` | +4 / -0 | Returns unavailable impact counts and a reason when either baseline or control contains fallbacks in the analysis window. |
| `analyzer/pairwise.py` | +3 / -0 | Withholds what-if return counts when baseline or branch trajectories contain fallbacks. |
| `analyzer/confidence.py` | +48 / -12 | Adds a three-distinct-seed minimum, detailed sample accounting, reappraisal-evidence requirements, and stronger branch exclusion rules. |
| `analyzer/narrate.py` | +27 / -32 | Replaces live model narration with deterministic, two-sentence rendering from computed fields. Incomplete or unsupported evidence yields null narration with a reason. |

**Confidence behavior:**

- Deduplicates observations by seed ID; supplying the same seed repeatedly does not create additional evidence.
- Records usable seed count, total seed count, observed modes, and usable reappraisal seed count per twin, even when that twin is unmeasured.
- Requires at least three usable seeds for a twin's stability score.
- Requires usable reappraisal evidence across at least three seeds before that twin can contribute headline support. Autopilot stability alone cannot make confidence measured.
- Retains the weighted formula `0.7 × stability + 0.3 × support` when the evidence is measurable.
- Restricts what-if stability to the baseline-lost cohort rather than letting unaffected customers inflate it.
- Excludes a branch seed if its earlier trajectory contains a fallback, even if its final row is successful autopilot.
- Resolves the selected default seed by seed ID rather than assuming its list position.
- Exports low-sample, fallback, and partial-coverage reasons along with the detailed evidence.

**Narration behavior:**

Narration uses the measured break day, naive and actual drivers, and the three impact counts. Counts must be nonnegative integers and satisfy `lost_total = lost_by_decision + lost_anyway`. Drivers must be recognized, analysis complete, and confidence measured. Legacy transport arguments remain accepted but are ignored; no narration API request is made.

### 3.5 Bundle construction and tooling

| File | Diff | Changes and effect |
| --- | --- | --- |
| `build_runs.py` | +76 / -35 | Adds an explicit CLI, pre-build validation, strict completeness/provenance gating, synthetic labeling, coverage metadata, configurable output, and offline narration. Analysis uses the same loaded rows that are exported. |
| `tools/validate.py` | +21 / -54 | Delegates shared row rules to `engine.schema.validate_row()`. Adds safer malformed-row handling, external-path support, continued JSON error collection, and full ordered day/twin-grid checks. |
| `tools/build_demo.sh` | +39 / -10 | Defaults to offline strict generation. Adds `--live`, `--out`, `--cache`, and `--model`; checks live client configuration, refuses a nonempty destination, and writes isolated artifacts instead of promoting a public bundle. |

`build_runs.py` requires all four scenarios and all five expected seeds, validates each trajectory, and checks row scenario/seed identities. If any required run has incomplete coverage, it suppresses causal analysis, confidence conclusions, evidence cards, what-if results, and narration while retaining diagnostic data.

Bundle metadata now includes:

- `meta.coverage`: aggregate completeness and provenance details.
- `meta.synthetic_run`: test/fixture/stub labeling.
- `meta.publishable`: true only for complete, provenance-consistent, non-synthetic output.
- Per-scenario/seed `coverage` next to `rows` and `daily_sales`.

Fixture input is automatically classified as synthetic, as are model IDs beginning with `test-`; `--synthetic` provides explicit labeling. Strict completeness can pass for a properly labeled synthetic pipeline test, but that bundle still has `publishable=false`.

The `publishable` flag is a mechanical evidence-quality gate, not a claim that the behavioral model or counterfactual design is calibrated. Non-strict legacy-data builds may still calculate analysis while failing provenance/publication checks; always inspect metadata.

### 3.6 Scenario and customer data

| File | Diff | Before | After | Significance |
| --- | --- | --- | --- | --- |
| `data/scenarios/cf_null.json` | +4 / -2 | No overrides | Simffee `avg_wait_min=12` from day 6; description updated | Introduces control-arm ambient variation, but the shock is not shared by treatment arms. |
| `data/twins/T01.json` | +2 / -2 | Budget 60,000 VND; wait tolerance 6 minutes | Budget 70,000 VND; wait tolerance 8 minutes | Makes a Starbucks visit more feasible for T01 under the current facts. |
| `data/twins/T05.json` | +1 / -1 | Wait tolerance 5 minutes | Wait tolerance 8 minutes | Removes a previously tighter wait constraint for T05. |

These changes were already present when this report began. They were not made by the reporting process. They change model inputs and should be reviewed as modeling choices rather than treated as proof that a target customer split is correct.

### 3.7 Existing tests and documentation

| File | Diff | Changes and effect |
| --- | --- | --- |
| `tests/test_analyzer.py` | +17 / -1 | Adds a regression ensuring a twin with only one usable seed is listed as unmeasured; retains the existing analyzer/what-if fixture checks. |
| `tests/test_narrate.py` | +33 / -23 | Builds a complete fixture analysis with confidence and tests deterministic fact binding, zero transport use, exactly two sentences, and evidence-based suppression. Replaces the old model-retry narration expectations. |
| `engine/README.md` | +123 / -67 | Rewrites runtime guidance around Groq, safe local environment loading, isolated outputs, versioned cache behavior, strict coverage gates, deterministic narration, and offline verification. Documents modeling limitations. |
| `spec/B2_STATUS.md` | +23 / -0 | Adds a dated integration update that supersedes historical command, confidence, fallback, and narration descriptions while preserving the historical report below it. |
| `spec/SPEC.md` | +33 / -14 | Documents visit persistence, provenance, Groq defaults, strict completeness, confidence rules, deterministic narration, current cache/build contracts, corrected initial customer split, and unresolved T08/T10/control issues. |

Some older comments and historical documents still describe Anthropic-era or live-narration behavior. The current executable code, the integration update, and this guide take precedence over those stale descriptions.

## 4. Added/untracked files and artifacts

### 4.1 New code and planning documents

| File | Purpose and coverage |
| --- | --- |
| `tests/test_repairs.py` | 27 unit tests for the central repairs and transport behavior: repeat visitors, skip rules, snapshot persistence, availability, prompt grounding, cache invalidation/validation, error sanitization, malformed rows, sample coverage, fallback suppression, strict CLI/build behavior, deterministic narration, credentials, unsupported capabilities, and bounded rate limiting. |
| `tests/test_b2_sync.py` | 8 unit tests preserving B2 contracts: lost-customer confidence cohort, minimum seed coverage, upstream fallback exclusion, default-seed lookup, `impact.per_twin.cf_null`, empty cohorts, and safe demo-wrapper behavior. |
| `tests/test_environment.py` | 6 unit tests for supported `.env` keys, environment precedence, empty/missing configuration, comments/export syntax, literal shell-substitution text, and sanitized malformed-value errors. |
| `tools/check_pipeline.py` | An offline end-to-end verifier using a deterministic stub. Generates all scenarios/seeds, validates rows and branch fairness, checks cross-process replay, builds a strict synthetic bundle, compares old/new skip-gate behavior, and verifies rejection of the incompatible real cache. Writes logs and `verification.json` to a fresh output directory. |
| `spec/FIX_PLAN.md` | A historical diagnosis and proposed work order, including old measurements, prompt/confidence/control hypotheses, proposed data edits, live-run plans, and illustrative acceptance targets. It is not a current completion report. |

**Important qualification for `spec/FIX_PLAN.md`:** its old cache counts/model references, cost estimate, live-narration statements, cache-clearing recommendation, and target-driven calibration instructions do not describe the current verified state. Do not use it as permission to delete cache data, spend API credits, or force the simulator to match illustrative counts.

### 4.2 Cache artifacts

There are **43 untracked JSON files in `cache/`**, individually listed in Appendix A. The metadata identifies `openai/gpt-oss-20b`; the entries include decision fields and usage information but no `_version: 2` marker.

The current replay test had **zero cache hits**. Selecting the old model name alone is not enough to make these entries compatible: both cache identity and required metadata have changed. Keep them as historical artifacts unless separately deciding to archive or remove them. Generate a new compatible cache in a separate directory for a real release.

### 4.3 Stray installation artifact

`=0.5.0` contains pip “Requirement already satisfied” output. It is not source code, configuration, or a simulation input. Its name is consistent with an unquoted shell command such as `pip install groq>=0.5.0`, where `>` is interpreted as output redirection.

Use `python3 -m pip install -r requirements.txt` instead. This file was not deleted during the review.

### 4.4 Local and generated files outside the Git diff

The workspace also contains ignored `.env`, local tool settings, generated `runs/`, Python bytecode, `node_modules/`, and `dist/`. Git does not provide a historical content diff for these ignored artifacts, so they are not counted as versioned additions or modifications in this report.

The private `.env` contents were not opened or reproduced for this report. Tests exercise the loader without exposing credentials. `public/runs.json` is tracked but unchanged relative to the comparison baseline; it was not rebuilt or promoted during this review. The files under `src/` are also unchanged.

## 5. How to run the simulation

Run the following commands from the repository root. Examples deliberately use fresh temporary output directories to avoid overwriting existing runs or the public bundle.

### 5.1 Prerequisites

- **Python 3.11+** according to the engine documentation. This review used Python **3.13.7**.
- **Groq SDK and a locally configured key only for live generation.** Offline tests and analysis do not require API access.
- **Node.js only for the frontend.** The installed Vite package requires `^20.19.0 || >=22.12.0`; this review used Node **24.11.1** and npm **11.11.1**.

```bash
cd "/Users/hiennguyen/Simffee"
python3 --version
```

For an isolated live-generation Python environment, create a dedicated environment outside the repository. If it already exists, activate it rather than recreating it:

```bash
python3 -m venv "$HOME/.venvs/simffee"
source "$HOME/.venvs/simffee/bin/activate"
python3 -m pip install -r requirements.txt
```

The current requirements file is not locked to one SDK version. For reproducible releases, record/review the resolved dependency versions separately.

### 5.2 Recommended first run: fully offline mechanics verification

This is the most useful end-to-end check available immediately. It uses synthetic decisions, not the API:

```bash
CHECK_DIR="$(mktemp -d /tmp/simffee-check.XXXXXX)"
python3 tools/check_pipeline.py --out "$CHECK_DIR"
printf 'Verification artifacts: %s\n' "$CHECK_DIR"
```

Expected final messages include:

```text
PASS: 1400 rows, 15 fork prefixes, 10 fork RNG states, two byte-identical replays
SYNTHETIC paired gate check: day-5 forced skips 6 -> 0
Offline production completeness correctly rejected
```

Useful outputs include `verification.json`, `stubbed-bundle.json`, `stubbed-runs/`, `stubbed-cache/`, `replay-0/`, `replay-777/`, and `offline-diagnostic-bundle.json`.

The stub's customer choices prove pipeline mechanics, not realistic preferences or calibrated confidence. The tool currently expects the repository cache to be incompatible and the real-cache strict run to fail. If a complete compatible cache is introduced later, that particular expectation needs review.

### 5.3 Offline diagnostic simulation using the current cache

```bash
DIAG_DIR="$(mktemp -d /tmp/simffee-diagnostic.XXXXXX)"
python3 -m engine.cli --all --seeds 0-4 --offline --quiet \
  --out "$DIAG_DIR/runs" --cache cache
python3 tools/validate.py "$DIAG_DIR/runs"
python3 build_runs.py "$DIAG_DIR/runs" --offline \
  --out "$DIAG_DIR/runs.json"
printf 'Diagnostic bundle: %s/runs.json\n' "$DIAG_DIR"
```

This creates all 20 trajectories and a diagnostic bundle without network requests. With the reviewed cache, expect incomplete coverage and `meta.publishable=false`; causal analysis and narration are withheld.

A normal diagnostic engine exit code of zero means execution/row validation succeeded. It does **not** mean enough model evidence exists. Add `--require-complete` when incomplete output must fail the command.

For a smaller seven-day baseline-only diagnostic:

```bash
ONE_DIR="$(mktemp -d /tmp/simffee-baseline.XXXXXX)"
python3 -m engine.cli --scenario baseline --seeds 0 --offline \
  --out "$ONE_DIR/runs" --cache cache
python3 tools/validate.py "$ONE_DIR/runs"
```

A single baseline run cannot be passed to the full bundle builder, which expects four scenarios and five seeds. `--days 1` is useful for engine debugging but will not satisfy full-grid validation or strict seven-day completeness.

### 5.4 Build a fixture bundle without generating decisions

```bash
FIXTURE_DIR="$(mktemp -d /tmp/simffee-fixture.XXXXXX)"
python3 tools/validate.py tests/fixtures/runs
python3 build_runs.py tests/fixtures/runs --offline --synthetic \
  --out "$FIXTURE_DIR/runs.json"
```

This is suitable for inspecting the analyzer/bundle contract. The fixture trajectories are not newly generated model results and lack current model provenance, so do not add `--require-complete` expecting them to pass a production gate.

Avoid calling `python3 build_runs.py` without thinking about its defaults: it reads fixtures and writes `public/runs.json`. Supplying both an input directory and `--out` makes the intended operation explicit.

### 5.5 Configure live generation locally

Live generation is optional and was not executed for this report. Decide on an available Groq model and acceptable spend first. Model availability and pricing were not verified with the provider during this review.

The engine supports these settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | None | Required for live client creation |
| `SIMFFEE_MODEL` | `groq/compound-mini` | Requested model; overridden by CLI `--model` |
| `SIMFFEE_MAX_TOKENS` | `1600` | Response token cap; part of cache identity |
| `SIMFFEE_MIN_INTERVAL` | `2.2` | Minimum seconds between API request attempts |

Enter credentials locally in the existing private `.env` using an editor, or supply them through your shell's secure secret-management workflow. Do not paste a real key into chat or commit it. Preserve unrelated existing settings and keep the file owner-only:

```bash
chmod 600 .env
```

Non-secret settings may look like:

```dotenv
SIMFFEE_MODEL=groq/compound-mini
SIMFFEE_MAX_TOKENS=1600
SIMFFEE_MIN_INTERVAL=2.2
```

A `GROQ_API_KEY` value must also be configured locally for live calls. Do not use a `VITE_` prefix: that is intended for frontend-exposed settings. You do not need to `source .env`; the engine loads its supported keys without shell evaluation.

### 5.6 Generate a complete live simulation after approval

Set `APPROVED_MODEL` to the model identifier you have approved and confirmed is available. Then use a new output/cache location:

```bash
APPROVED_MODEL="groq/compound-mini"
LIVE_DIR="$(mktemp -d /tmp/simffee-live.XXXXXX)"
bash tools/build_demo.sh --live --model "$APPROVED_MODEL" \
  --out "$LIVE_DIR" --cache "$LIVE_DIR/cache"
```

The example model is the code default, not a guarantee of account access or current provider availability.

The wrapper performs:

1. Local Groq client-configuration check. This does not itself authenticate a request with the provider.
2. All four scenarios and seeds `0-4`, with strict completeness enabled.
3. Row/grid validation.
4. Offline analysis and strict bundle creation at `$LIVE_DIR/runs.json`.

If the engine returns incomplete coverage, the wrapper stops before validation/build stages because it uses fail-fast shell behavior. Diagnostic trajectories and any successful cache responses remain available for investigation. Do not treat the partial run as complete, and do not delete the cache to fix authentication or rate-limit problems.

You can retry into a **new** output directory while referencing the successful version-2 cache from the earlier attempt, provided all decision settings/inputs remain the same. The wrapper refuses reuse of nonempty output directories.

### 5.7 Replay a compatible cache without API requests

After a successful live run, retain the same model and token-cap settings, data, prompts, and code version:

```bash
REPLAY_DIR="$(mktemp -d /tmp/simffee-replay.XXXXXX)"
bash tools/build_demo.sh --offline --model "$APPROVED_MODEL" \
  --out "$REPLAY_DIR" --cache "$LIVE_DIR/cache"
```

Expected properties are zero API attempts, no fallback rows, complete coverage, and consistent provenance. This command depends on the successful cache from section 5.6; the repository's current legacy `cache/` does not satisfy that prerequisite.

For a quick strict check of the repository cache:

```bash
bash tools/build_demo.sh --offline
```

The current reviewed state is expected to exit `2`, not produce a complete demo. The wrapper allocates a fresh temporary destination and prints it.

Warm-cache JSONL trajectories and snapshots are designed to replay byte-for-byte. The entire bundle is not guaranteed byte-identical because `meta.generated_at` contains a fresh timestamp.

### 5.8 Output layout and inspection

```text
OUTPUT_DIRECTORY/
  runs/
    baseline/
      0.jsonl
      0/state_day1.json ... state_day7.json
      ... seeds 1-4
    cf_null/
      ... trajectories and day 1-7 snapshots
    cf_discount/
      ... full trajectories; newly simulated day 5-7 snapshots
    cf_restore_hours/
      ... full trajectories; newly simulated day 5-7 snapshots
  runs.json
  cache/                         if selected as the cache destination
```

Each full trajectory file has 70 rows, ordered by day and twin ID. State snapshots contain habit, latent interest, inbox, recent history, persistent visited shops, and RNG state. The bundle embeds trajectory rows and analysis; it does not replace the separate full state/RNG snapshot files.

To summarize a generated bundle, substitute the desired bundle path:

```bash
python3 - "$DIAG_DIR/runs.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    bundle = json.load(handle)

print(json.dumps({
    "publishable": bundle["meta"].get("publishable"),
    "synthetic_run": bundle["meta"].get("synthetic_run"),
    "coverage": bundle["meta"].get("coverage"),
    "analysis_complete": bundle["analysis"].get("complete"),
    "analysis_reason": bundle["analysis"].get("reason"),
    "confidence": bundle["analysis"].get("confidence"),
    "narration": bundle["analysis"].get("narration"),
}, indent=2, ensure_ascii=False))
PY
```

For model-backed output, check `meta.coverage.complete`, `meta.coverage.provenance_complete`, `meta.publishable`, `analysis.complete`, and any confidence/narration reasons. A synthetic test may have complete mechanical coverage while deliberately remaining non-publishable.

### 5.9 Running the frontend

On a fresh checkout without installed Node dependencies:

```bash
npm ci
npm run dev
```

If dependencies are already installed, start with `npm run dev`. Open the local address printed by Vite. This starts the frontend dev server; it does not start the Python simulation or call Groq.

**Current limitation:** `src/App.tsx` still renders the starter content and counter. There is no implemented visualization, what-if interface, or bundle-loading dashboard. A successful frontend build is not proof of simulation UI functionality.

For an isolated frontend production build that does not replace the existing `dist/`:

```bash
WEB_BUILD_DIR="$(mktemp -d /tmp/simffee-web.XXXXXX)"
npm run lint
npm run build -- --outDir "$WEB_BUILD_DIR"
```

Promoting a verified bundle to `public/runs.json` is a separate deliberate action. None of the safe run recipes above replaces it automatically.

## 6. Verification performed for this report

All checks below were actually executed against the reviewed working tree on 2026-09-20. No live provider request was used.

| Verification | Result |
| --- | --- |
| `python3 -m unittest discover -s tests -v` | **PASS: 41 tests** — 27 repair/transport, 8 B2 integration/wrapper, 6 environment tests |
| `python3 tests/test_analyzer.py` | **PASS:** existing fixture analysis, what-if, evidence, and added low-sample checks |
| `python3 tests/test_narrate.py` | **PASS:** deterministic narration, field binding, suppression, and no transport dependency |
| `python3 tools/check_llm_path.py` | **PASS:** stubbed success, cache replay, validation retries, fallback, and row generation |
| `python3 tools/validate.py` | **PASS: 1,400 fixture rows across 20 files** |
| `python3 tools/check_pipeline.py --out NEW_DIRECTORY` | **PASS:** full synthetic generation, fork fairness, replay, strict synthetic build, and incomplete-real-cache rejection |
| `npm run lint` | **PASS:** 0 warnings, 0 errors |
| `npm run build -- --outDir NEW_DIRECTORY` | **PASS:** TypeScript build and Vite production build; existing `dist/` was not replaced |
| `git diff --check` | **PASS:** no whitespace errors in the tracked patch |

The legacy analyzer and narration scripts use their own `main()` checks, so `unittest discover` does not replace running those scripts explicitly.

### Pipeline evidence

Artifacts from this review are at:

- `/private/tmp/simffee-report-check.O7VgFp/verification.json`
- `/private/tmp/simffee-report-check.O7VgFp/stubbed-bundle.json`
- `/private/tmp/simffee-report-check.O7VgFp/offline-diagnostic-bundle.json`
- Frontend build: `/tmp/simffee-report-web.YKHz3P`

These are local temporary artifacts and may be removed by normal operating-system cleanup.

The pipeline verified:

- 1,400 generated synthetic rows.
- 15 matching branch/control prefixes.
- 10 matching treatment-branch parent/RNG states at the day-5 fork.
- Byte-identical replay of **120 output files per replay**, under `PYTHONHASHSEED=0` and `777`.
- A paired deterministic-stub regression where day-5 forced skips among previous switchers changed from **6 to 0** after the gate repair. This is a mechanics result, not a real-model behavioral finding.
- A complete synthetic bundle with narration, explicitly marked non-publishable.
- Rejection of the incomplete repository-cache strict run and refusal to create the requested strict bundle.

### Actual offline-cache diagnostic results

| Scenario | Reappraisal/fallback rows per seed | Across five seeds |
| --- | ---: | ---: |
| `baseline` | 24 | 120 |
| `cf_null` | 4 | 20 |
| `cf_discount` | 24 | 120 |
| `cf_restore_hours` | 6 | 30 |
| **Total exported fallback rows** | | **290** |

The CLI reported **0 API attempts, 0 responses, 0 cache hits, and 230 fallback executions**. The larger output-row total is expected: treatment branches include inherited baseline fallback rows without executing those decisions again.

The diagnostic JSONL data passed structural validation, but its bundle was correctly non-publishable with causal impact and narration withheld. “Valid rows” and “complete evidence” are different outcomes.

### Re-run the main verification suite

```bash
python3 -m unittest discover -s tests -v
python3 tests/test_analyzer.py
python3 tests/test_narrate.py
python3 tools/check_llm_path.py
python3 tools/validate.py
VERIFY_DIR="$(mktemp -d /tmp/simffee-verify.XXXXXX)"
python3 tools/check_pipeline.py --out "$VERIFY_DIR"
npm run lint
```

## 7. Limitations, troubleshooting, and release checklist

### 7.1 Known limitations

1. **No fresh real-model verification.** Passing mocked tests does not establish realistic customer behavior, model availability, or live rate-limit resilience for a particular account.
2. **The repository cache is incompatible and untracked.** A clean-clone, key-free model replay is not yet available from the current repository state.
3. **T08 is not guaranteed to resist switching.** Current marketing increases her alternative interest above the low-interest threshold by day 4; the skip rule cannot guarantee the scripted role.
4. **T10 acquisition is not implemented as described in the illustrative narrative.** Disruption is computed for the current regular shop, so a competitor discount does not directly trigger deliberation for a Starbucks regular.
5. **Control design needs review.** The separate day-6 wait shock in `cf_null` is not shared with treatment arms; arithmetic subtraction alone does not establish calibrated causal attribution.
6. **The confidence score is a heuristic.** Improved coverage guards do not turn it into a calibrated statistical probability.
7. **Live randomness is not fixed by the Python seed alone.** Warm-cache replay is deterministic, but fresh model requests are separate samples; the transport does not send the simulation seed as a provider sampling seed.
8. **Some documentation remains historical or contradictory.** For example, old module/script headers still mention live narration or public-output behavior. The fix plan also contains superseded measurements and actions.
9. **No simulation dashboard is implemented.** Frontend lint/build success concerns the starter application only.

### 7.2 Troubleshooting

| Symptom | Meaning / next step |
| --- | --- |
| Engine or wrapper exits `2` | With strict mode, coverage or model provenance is incomplete. Inspect per-seed fallbacks and the selected cache/model. Wrapper argument/configuration errors can also return `2`. |
| Bundle builder exits `1` | Missing trajectories, invalid rows, or mismatched scenario/seed identities. Generate the required four scenarios and five seeds, then validate. |
| Validator passes but bundle is non-publishable | Structural validity is not model-evidence completeness. Check fallbacks, missing/mixed provenance, and synthetic labeling. |
| `impact`, `confidence.value`, or `narration` is null | Evidence was incomplete, insufficiently sampled, lacked a measured break/driver, or failed a narration consistency check. Read the associated reason; do not insert fixture counts. |
| Zero hits from an existing cache | It may be legacy, use a different model/token cap, or reflect different prompts, data, or state. Do not assume a populated directory is compatible. |
| Fork cannot load a parent snapshot | Run baseline for the same seed into the same fresh output tree before the branch, or use `--all`. The flag is `--seeds`, not `--seed`. |
| Wrapper refuses the destination | It is not a new/empty directory. Choose another output directory; retain the old one for diagnosis. |
| API authorization fails | Correct provider access locally. The local `available()` check only constructs a client; it does not validate the key against the service. |
| API rate limits produce fallbacks | Review account quotas and pacing. A bounded retry may still fail; do not interpret the resulting fallback as a customer choice. |
| Replaying after changing settings misses cache | Model and token-cap settings are cache inputs; restore the generation settings or perform a separately authorized regeneration. |
| `npm run dev` shows the starter page | Expected current frontend behavior, not a Python simulation failure. |

### 7.3 Before calling the demo release-ready

- [ ] Review and approve the T01/T05 data changes and control-arm design.
- [ ] Resolve or clearly qualify the illustrative T08/T10 narrative claims.
- [ ] Approve the live model and spending policy; verify account/model access.
- [ ] Generate a fresh compatible cache and all required trajectories in an isolated directory.
- [ ] Pass row validation, strict engine coverage, and strict bundle construction.
- [ ] Inspect real-model behavior without forcing fixture target counts.
- [ ] Review confidence coverage and the distinction between mechanical publishability and model validity.
- [ ] Replay offline with matching configuration and verify trajectory/snapshot determinism.
- [ ] Review cache contents and deliberately decide which reproducibility artifacts to version.
- [ ] Deliberately promote an approved bundle; do not overwrite `public/runs.json` as a side effect of diagnosis.
- [ ] Implement the frontend separately if an interactive demo is required.

## Appendix A. Complete untracked cache-file manifest

All 43 files below share the legacy-cache qualification in section 4.2. They are listed individually to account for every added/untracked file rather than treating `cache/` as one file.

```text
cache/0b97ad8b421deef923cadb1aa0dcca38d6001e0a.json
cache/13913fe5ce30ee6d125cc82a6d392d4775d65c86.json
cache/13c26596dd0685c5f36989eb11162db97341018c.json
cache/1e9efef0a3875d4a5c8f32240ae9ae215c5b4650.json
cache/26e3ae6de9ec047519338295758e82b929a02e1a.json
cache/2836e0fe5e5a79a32252fd6edbc7264125d89271.json
cache/2f799eccf7639fc68ba0bb1afb2755f9918af0d9.json
cache/3124cb96a23d012e082ad899190f10063214ccd8.json
cache/35c2a50b56f3ec7345c99a34905c111d95a2024e.json
cache/38420442f81bdf9799eb870521f5d958ddc9eb2f.json
cache/45f6f5f95fcdecd91b213d80e9ea9cd933e8d48e.json
cache/4967a9d93179560ae58e3a239f80c65e721abaad.json
cache/5cc63134e9cfa9ac80e222c843a4b9b9b22782e6.json
cache/5f59ea442b2240ba7548c7bf4b562bf360091ee8.json
cache/692a71c4dec6f149423407e23c08df49f8dacd9e.json
cache/696a86b33664d28d096b680a6a1478efd240b616.json
cache/6d35ec4a454088ef3b946ea3495b2165fe080d09.json
cache/6ff9b8fd3a9d79f4658bb3e749982be2635a5e48.json
cache/711afdf3bf7f18ba469e36625a24f2f6395740f3.json
cache/7c6341ca1267bc5edd985db69f9c5764fa900956.json
cache/7cda45fe08e38f9177d2ae97bf3bd1dcfe22edc1.json
cache/8cc8256b17ef724a054ebd3f65d8c6218f1aa5d6.json
cache/8e007fba04e4a925a3e8ab3e9a6c5dee87472f8e.json
cache/90722d21e3e41101bd47ce53482d9a36656f1cf6.json
cache/95b1f8db9362536886c299be07367537b8aac6c1.json
cache/9becc2253eb2ad772afa80f7092854b048ff0e30.json
cache/a7ff30ad3200bf8065903b3ef3cd326b5bcb2734.json
cache/bfb6292962d6e7dba0a61f0a437f1c0e4cac6238.json
cache/c1599b0e3a9648dba0a2e6a6006a38996e680214.json
cache/c23297bd82486c997e28d5b1522d2ef0040b14e9.json
cache/cb596250f70d0817da5b2933242a0e65f77e6d26.json
cache/ce5a72709dd61759697cd2f7c6635aa1088b0d24.json
cache/d35e3a10d04183d62b894284c19b46e46d4b0942.json
cache/d7a074a114c5e8a730d30dbb3f904457b611a275.json
cache/d7f1bc419453e22735d71ccd708c4fc49cff7117.json
cache/dae0ae2c97d67acfb220fb22e1960b81f13af96a.json
cache/dee126a1c1e3cfd07489d255374671fd12c3b397.json
cache/e34dc2f612252bba98ef794757af3fccf3fa6409.json
cache/e6f9dd69a3c29858f8b6ec9861d1dec2d19ba470.json
cache/e90ed251d6c562e64ec33961d7e9c57bda409598.json
cache/f2e172f9e91a08c84551100da3e85e26eacc4ae0.json
cache/f46f238ee473d1c9c8a43100d3e8f8c368523f31.json
cache/fb227caeeb361247213bbde278dfae11552031fd.json
```
