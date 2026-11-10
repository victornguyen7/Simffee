# Codebase audit and fix plan

Audit of `main` at `19e6066` (2026-11-10). Each issue below was found by running the
project's checks and scripts, not by reading code alone. Line references point to the
code at the time of the audit unless marked otherwise.

**Status:** all 8 phases are done (committed to `main` through phase 5). Left open: #21 (local
leftovers, the owner's call) and #27 (a live fill for the non-bundle scenarios).

## Summary

The code works from a fresh clone. It failed on the maintainer's machine because the local
`.env` changed the decision-cache key. Separately, there was one real security bug
(arbitrary directory deletion through the local API), and a lot of drift between the docs,
the committed data and the code.

## What was run

| Check | Result at audit time |
| --- | --- |
| `pytest` | 82 passed, but only 4 of the 9 test files are collected (see #10) |
| The other 5 test scripts, run by hand | All pass |
| `tsc -b`, `vite build` | Clean; bundle is 697 KB |
| `oxlint` | 4 warnings, all in `src/pages/Shop.tsx` |
| `tools/serve_demo.sh` / `tools/build_demo.sh` in the working copy | Both exit with code 2 |
| The same two scripts in a fresh clone (no `.env`) | Work: 84/84 decisions replayed from `cache/` |
| `tools/check_determinism.sh` | Says "OK", but the result means little (see #12) |

## Issues, by severity

### P0: stops it running, or is a security hole

| # | Issue | Status |
| --- | --- | --- |
| 1 | **Local `.env` broke the offline demo.** `SIMFFEE_MODEL=grok-4.6` and `SIMFFEE_MAX_TOKENS=1600` are both part of the decision cache key (`engine/decide.py:227-234`). The committed cache only fully covers the default `qwen/qwen3.8-27b` with 400 tokens. With the local settings, baseline seed 2 and every `cf_null` seed missed the cache, `--require-complete` failed, and neither demo script finished. | Fixed (phase 1) |
| 2 | **The documented live setup was broken.** The default model `qwen/qwen3.8-27b` is a Groq model, but since commit `27d8e1c` all model calls went to a hard-wired `api.x.ai` address. Following the README (xAI key plus the default model) sent a Groq model name to xAI. | Fixed (phase 1) |
| 3 | **The API could delete folders outside its own directory (reproduced).** `POST /run` used the scenario `id` as a folder name and then deleted that folder's `runs/` subfolder (`api/service.py:250-253`). `"id": "../victim"` deleted a test file outside the live folder, and an absolute id like `/path` deleted `/path/runs`. The server also sent `Access-Control-Allow-Origin: *`, so any page open in the browser while the server ran could trigger this. | Fixed (phase 2) |

### P1: wrong or missing output

| # | Issue | Status |
| --- | --- | --- |
| 4 | **`public/runs.json` is stale.** Rebuilding it adds `analysis.flows`, `analysis.hero_agreement` and `analysis.question`. *Correction (phase 5):* the audit said the Ask page reads two of these from the bundle, so the static demo was missing a panel. That was wrong: `WhatIfBox.tsx:230` and `:358` read `analysis` from the live API answer, and the only reader of the bundle's `analysis` (`src/pages/Conclusion.tsx`) uses none of the new fields. The stale bundle had no visible effect, but it no longer matched what the code builds. | Fixed (phase 5) |
| 5 | **Timed-out runs are lost.** The UI says the run "is still running in the background", but nothing ever checks `GET /runs/<id>` for the finished result. | Fixed (phase 6) |
| 6 | **"Run 3 seeds" uses the wrong seed list.** It takes seeds from the static bundle (`WhatIfBox.tsx:197`) instead of the server's own list, so it can fail with "no library run to fork from". | Fixed (phase 6) |
| 7 | **Without an API key, the Ask page never simulates anything.** The frontend always requests a fresh run, which skips the translation cache, and even the README's example sentences aren't in that cache. With no key you only ever see canned sketches, while the status badge says "cached decisions only". | Fixed (phase 6) |
| 8 | **Bad input crashes the API, and only after a full engine run.** An empty `set` raises IndexError in `chip()` (`api/service.py:391` after phase 2), an unknown shop raises KeyError, and malformed seeds return a 500 instead of a 400. None of this is checked before the run starts. | Fixed (phase 3) |

### P2: tests, tooling, frontend

| # | Issue | Status |
| --- | --- | --- |
| 9 | Smaller API issues: `OPTIONS` returned a 204 with a body; `/health?x=1` returns 404; the run registry is read without a lock while other threads write it. | Fixed (204 in phase 2, rest in phase 3) |
| 10 | `pytest` doesn't collect 5 test files (`test_api`, `test_analyzer`, `test_generic`, `test_narrate`, `test_translate`, about 900 lines) because they are plain scripts with a `main()`. A green pytest run doesn't include them. | Fixed (phase 4) |
| 11 | There is no CI, so nothing would have caught #1, #4 or #10. | Fixed (phase 4) |
| 12 | `tools/check_determinism.sh` runs seeds 0-4, but the cache only covers 0-2. It passed while making 77 fallback decisions, so it mostly compares fallbacks with fallbacks. | Fixed (phase 4) |
| 13 | Docs and scripts disagree: `build_demo.sh` defaulted to offline although its header suggested otherwise; the seed ranges in comments were inconsistent; `pytest` isn't listed in `requirements.txt`. | Fixed (script headers in phase 1, `requirements-dev.txt` in phase 4, docs in phase 8) |
| 14 | `src/pages/Shop.tsx` reads refs during render (the 4 lint warnings), so its display can lag behind the simulation after a reset. | Fixed (phase 7) |
| 15 | The shop interior page runs its own random JavaScript simulation (`src/sim/world.ts`, with its own price and barista sliders). It isn't connected to the engine's results. | Fixed (phase 7) |
| 16 | `runs.json` is fetched two different ways (`src/sim/runs.ts:136` uses an absolute path, the other pages use `BASE_URL`), and up to 4 times. | Fixed (phase 7) |
| 17 | The 412 KB sketch pool (`src/sketchPool.json`) is bundled eagerly into the main JavaScript file. | Fixed (phase 7) |
| 18 | Every finished answer automatically triggers a fresh AI review call (`WhatIfBox.tsx:178`), which costs money on each run. | Fixed (phase 6) |

### P3: cleanup

| # | Issue | Status |
| --- | --- | --- |
| 19 | About 98 cache entries can't be hit by the default setup: 37 `groq/compound-mini` and 61 `grok-4.6` decisions. The 92 `grok-4.3` entries are unreachable too, now that the provider is Groq. | Fixed (phase 8): 270 unreachable entries pruned with `tools/prune_cache.py`; 90 remain, all reachable |
| 20 | Unused template assets (`src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`, `public/icons.svg`) and 11 historical plan and status docs in `spec/`. | Fixed (phase 8): 4 assets removed; 8 status/plan docs moved to `spec/archive/` |
| 21 | `runs/` holds 83 MB of old local runs. At audit time `.env` held a `GROQ_API_KEY` that nothing read; since phase 1 the Groq key is the one in use, and the xAI key is commented out and unused. | Left to the owner (phase 8): local data, not in git; see the phase 8 section |

### Found while fixing

| # | Issue | Status |
| --- | --- | --- |
| 22 | `data/shops.json` lists Starbucks' `frappuccino` with no price. `decide.price_for`'s cheapest-item fallback (`min(shop["price"][p] for p in products)`) would raise KeyError on it whenever a twin's usual order is missing at Starbucks. Adding the price would invalidate the whole cache, because base shop data is part of every decision cache key. | Fixed in code (phase 3): the fallback skips unpriced items |
| 23 | `tools/serve_demo.sh` starts the API with `--timeout 60`, but a typical live what-if takes about 3 minutes (for example, 18 model calls at 2.2 s pacing plus model latency). Most real plans therefore end in the timed-out path from #5, whose result the UI never fetches. | Fixed (phase 6) |
| 24 | The AI review failed once in browser testing, right after a burst of model calls, with an unlabelled "transport failed". It succeeded on retry and couldn't be reproduced. Groq's on-demand tier allows 7,000 input tokens per minute and a review request is about 4,000, so a review straight after a live run competes for that budget. Rate limits are retried and labelled, but this failure carried no label, because unknown transport errors threw away their class. | Made diagnosable (phase 6): unknown errors now carry their exception class, connection errors are labelled, and the review panel says why it's unavailable. Root cause unconfirmed. |
| 25 | The requested fallback model, `qwen3.8`, exists only in a 27B size (a 17.7 GB download), and this Mac has 8 GB of memory. Ollama 0.40.16 is installed and running, but no model is pulled, so the fallback currently answers "model not found" and runs fail with Groq's quota reason, as designed. | Fixed: `qwen3:4b` (2.5 GB) pulled and set as `SIMFFEE_FALLBACK_MODEL`, with thinking off; verified live (see the fallback section) |
| 26 | Two TypeScript interfaces describe `runs.json`: `Runs` in `src/types.ts` (Town, Ask) and `Runs` in `src/sim/runs.ts` (Market, Conclusion). They can drift apart silently. The shared loader takes a type parameter so both still work. | Fixed (phase 8): one `Runs` type, in `src/types.ts` |
| 27 | The three `bundle: false` scenarios (`s2_entrant`, `s2_entrant_only`, `abl_rename`) were never fully cached. Offline they replay with 14-31 fallback decisions per seed, both before and after the phase 8 prune. Their analyses (competitor entry, the rename ablation) can't be reproduced without a key. | Open: needs a live fill (roughly 280 Groq calls) if those scenarios matter |

## Fix plan

| Phase | Fixes | Done when | Status |
| --- | --- | --- | --- |
| 1. Make it run | #1: the offline replay ignores `.env` model settings, or the scripts pin the cache's model and say clearly what's configured versus what's cached. #2: pick one provider and default to a model it actually serves. Update the README. | `serve_demo.sh` works on the maintainer's machine and on a fresh clone | Done |
| 2. Security | #3: allow only ids matching `^[A-Za-z0-9_-]{1,64}$`, check that the resolved path stays inside the live folder, and limit CORS to the Vite dev server. Add a regression test. | The traversal request is rejected with a 400 | Done |
| 3. Input validation | #8, #9: check shops, empty overrides and seeds before running; return 400s; lock the registry. | Malformed requests get a 400 with no engine run | Done |
| 4. Tests and CI | #10: wrap the script tests so pytest collects them. #11: add a GitHub Actions workflow running pytest, `tsc`, `oxlint`, the build, and a clean-env demo rebuild compared with the committed copy. #12: make the determinism check fail on incomplete runs. | CI runs every check (108 pytest tests, which include the 203 checks in the script suites, plus the pipeline, determinism, bundle and frontend steps) and is green | Done |
| 5. Fresh data | #4: regenerate `public/runs.json`; the CI comparison from phase 4 keeps it fresh. | The rebuilt and committed bundles differ only in `generated_at` | Done |
| 6. Ask flow | #5 and #23: check for timed-out results, and give `serve_demo.sh` a timeout that fits a real run. #6: use the server's seed list. #7: support a cached or no-key path, or make the badge honest. #18: run the AI review only on request. | A demo with no key behaves the way the README describes | Done |
| 7. Frontend polish | #14-#17: fix the ref usage, load `runs.json` once through a shared loader, lazy-load the sketch pool, and connect the shop page to the engine data or label it as a toy. | Lint is clean and the bundle is under 500 KB | Done |
| 8. Cleanup | #13, #19-#21: prune the cache, delete unused assets, archive the old docs, align the scripts with the docs. | Repo contains only reachable cache entries and current docs | Done (#21 left to the owner) |

Phases 1 and 2 had to come first. The later phases are independent and can each be their own PR.

## What phases 1-8 changed

### Phase 1: make it run, on Groq

- **Provider:** `engine/llm.py` now calls Groq's OpenAI-compatible Chat Completions API
  (`https://api.groq.com/openai/v1`) through the existing `openai` SDK, with
  `GROQ_API_KEY`. There is no new dependency.
- **Default model:** `qwen/qwen3.8-27b` with `max_tokens` 400, exposed as
  `llm.DEFAULT_MODEL` / `llm.DEFAULT_MAX_TOKENS`. Groq serves this model, and it's the
  pair `cache/` was filled with, so live runs and offline replay agree.
- **Cache compatibility:** the default request sends no reasoning option, so the
  cache-key context is byte-identical and all 84 committed decisions still hit.
  `SIMFFEE_REASONING_EFFORT` maps to Groq's `reasoning_effort` where the model supports it
  (`low`/`medium`/`high` for `openai/gpt-oss-*`, `none`/`default` for `qwen/*`).
  Translation and review ask for `high`, which is dropped on models that can't take it.
  The grok-specific decision-model mapping is gone.
- **`engine.cli --cache-defaults`:** replays with the cache's own settings whatever
  `.env` says. Both demo scripts pass it for offline replay. Without it, an offline run
  that misses the cache under custom settings prints a hint naming the mismatch.
- **Docs:** `README.md`, `engine/README.md`, `ARCHITECTURE.md` and the script messages now
  describe Groq.

### Phase 2: security

- **Scenario ids:** validated in `engine/loader.py` (`check_scenario_id`). Ids are 1-64
  letters, digits, `_` or `-`, not starting with `-`; parents are checked the same way.
- **Path containment:** `WhatIfService._live_path` (`api/service.py`) refuses any run
  folder that resolves outside `runs/live/`, as a second layer behind the id check.
- **Local-only API** (`api/server.py`):
  - CORS is granted only to the local frontend (`localhost` / `127.0.0.1` on ports 5173
    and 4173). Add others with `--allow-origin`.
  - A request with any other `Origin` gets a 403.
  - POST bodies must be `application/json`, so a cross-site `text/plain` post can't skip
    the preflight.
  - The `Host` header must name this server, which blocks DNS rebinding.
  - `OPTIONS` returns an empty 204.
  - Clients without an `Origin` header (curl, scripts) are unaffected.
- **Tests:** `tests/test_security.py` (11 tests) includes a replay of the original
  traversal attack against a canary directory.

### Phase 3: input validation

Every malformed scenario or request is now refused with a 400 before any engine run or
model call.

- **Scenario structure** (`engine/loader.py`, `scenario_from_dict`): `overrides` must be a
  list of objects; an override must change something (no empty `set` with empty `unset`);
  `shop` must be a string; `unset` must list field names; `from_day` and `days` reject
  booleans.
- **Override values** (`engine/resolve.py`, new `check_overrides`):
  - Every `set` value is checked against the field's type in `shops.json`: prices are
    numbers >= 0, `open`/`close` are `HH:MM`, `quality` and `marketing.reach` are 0-1,
    `products` is a non-empty list of distinct names. Replacing a whole object (e.g.
    `"price": 40000`) is refused.
  - The chain is dry-resolved for every day, which reports unknown shops and unknown or
    un-unsettable fields.
  - A product the scenario adds must have a price, and a shop can't be left with no priced
    product.
  - An override that starts after the run ends is refused.
- **Service** (`api/service.py`):
  - `WhatIfService.preflight()` runs all of the above before the engine is submitted, and
    caps user runs at 28 days (`MAX_DAYS`).
  - The registry is copy-on-write: a finished run swaps in a new dict instead of mutating
    the one readers may be iterating. `registry.json` is written atomically (temp file plus
    rename), so a crash mid-write can't leave a file that stops the server starting.
- **Server** (`api/server.py`):
  - `parse_seeds` is strict: whole numbers >= 0, ascending ranges, at most 10 seeds.
    Errors raise `BadRequest`, which is answered with a 400.
  - `text`, `parent` and `run_id` must be strings.
  - A malformed `Content-Length` is a 400.
  - Routing ignores query strings, so `/health?x=1` works.
- **Engine** (`engine/decide.py`): `price_for` skips unpriced menu items (#22).
- **Tests:** `tests/test_validation.py` (10 tests, 51 subtests) covers each crash input
  from the audit and asserts that the engine is never called for them. With the
  protections disabled, 11 of its subtests fail, so the tests do catch regressions.

### Phase 4: tests and CI

- **Script-style tests collected** (#10): `test_api`, `test_analyzer`, `test_generic`,
  `test_narrate` and `test_translate` each gained a `test_all_checks()` wrapper. They still
  run by hand (`python3 tests/test_api.py`), and under pytest a failure names the failing
  checks. That brings their 203 checks into every pytest run.
- **`tests/conftest.py`:** pytest strips `GROQ_API_KEY` and the `SIMFFEE_*` model
  overrides and resets the engine to the cache defaults, so tests can't spend tokens and
  don't depend on the local `.env`.
- **`requirements-dev.txt`:** `requirements.txt` plus `pytest`.
- **Strict determinism check** (#12): `tools/check_determinism.sh` defaults to the seeds the
  cache covers (`SEEDS=0-2`), replays with `--cache-defaults`, and passes
  `--require-complete`, so a fallback fails the check. `SEEDS=0-4` now exits 2 instead of
  printing "OK".
- **`tools/check_bundle.py`:** compares a rebuilt bundle with `public/runs.json`, ignoring
  only `meta.generated_at`, and lists every path that differs. It reports exactly the 5
  stale paths from #4.
- **CI** (#11, `.github/workflows/ci.yml`): runs on pushes to `main` and on pull requests,
  with no credentials. Three jobs:
  - **Python tests:** pytest on Python 3.11 and 3.13 (the README promises 3.11+; only 3.13
    was available locally, so CI is the first run on 3.11).
  - **Demo:** `check_pipeline.py`, `check_determinism.sh`, an offline `build_demo.sh`, then
    `check_bundle.py`.
  - **Frontend:** `npm ci`, `tsc -b`, `npm run lint`, `npm run build`. Lint doesn't fail on
    warnings yet; that can be tightened once phase 7 clears the `Shop.tsx` warnings.

### Phase 5: fresh data

- `public/runs.json` regenerated with `./tools/build_demo.sh` (offline, 84/84 cache hits,
  0 fallbacks). The change is purely additive: `analysis.flows`, `analysis.question`,
  `analysis.hero_agreement` and `analysis.whatif[].flows` were added, and every value
  already in the bundle is unchanged.
- The new data matches the project's story: the baseline loses 6 regulars (4 skip coffee,
  2 go to Starbucks), and restoring the opening hours (`cf_restore_hours`) or the discount
  (`cf_discount`) wins all 6 back, with zero fallback moves. `hero_agreement` is `null`
  because it's only computed for the rename ablation, which isn't bundled.
- Two more rebuilds under `PYTHONHASHSEED` 1 and 98765 match the committed bundle, so
  CI's freshness check won't be flaky.
- From now on, CI's `check_bundle.py` step fails any change that alters the bundle without
  regenerating it.

### Phase 6: the Ask flow

- **Timed-out runs are collected** (#5):
  - `WhatIfService` keeps each run's background job, and `run_status()` reports
    `running`, `done` (with the full answer `/run` would have returned), `failed`, or
    `recorded` (finished under an earlier server process, so only the registry entry is
    left).
  - `GET /runs/<id>` returns 202 while running and 200 otherwise. It validates the id and
    no longer exposes the run's local folder path.
  - The Ask page polls every 5 s ("checked N×") and swaps the answer in, including the
    town view, when it lands. It gives up with a clear message if the API restarts or
    stops responding three times in a row.
  - The 20 most recent finished jobs are kept.
- **`serve_demo.sh --timeout 60` kept** (#23): with polling in place, 60 s just decides
  when the page switches to "still simulating", which beats a request blocked for 3-4
  minutes. The reason is now written next to the flag.
- **"Run 3 seeds"** (#6): uses the server's `library_seeds` from `/health`, falling back to
  the bundle's.
- **Honest no-key state** (#7):
  - The badge now reads "API up, no model key — illustrative sketches only (set
    GROQ_API_KEY to simulate)", "API in offline mode — …" or "local API not running — …".
  - The Ask page header says simulating needs a `GROQ_API_KEY`.
  - A real cached no-key path wasn't viable: the translation cache stores replies, not the
    original text, and a fresh run's decisions are keyed to a new run id, so a no-key run
    would mostly produce fallback rows and withheld analysis.
- **AI review on request** (#18): no automatic review after an answer or a 3-seed rerun. A
  "check this run with AI" button uses the review cache first (`refresh: false`), and the
  existing "recheck with AI (fresh call)" button forces a new call.
- **Failure reasons** (#24): `llm.complete_json` labels connection errors and appends the
  exception class to unknown transport failures. Decision rows map unknown transport
  reasons to "transport failed" rather than the misleading "LLM unavailable". The review
  panel shows a short, provider-text-free reason.
- **Tests:** `tests/test_ask_flow.py` (9 tests) covers job tracking, failed and crashed
  runs (no provider text leaks), recorded and unknown runs, the job bound, HTTP polling
  (202 then 200; malformed ids are 404), and the failure labels.

### Groq to local Ollama fallback (requested after phase 6)

- **Trigger** (`engine/llm.py`): only when Groq refuses for tokens, meaning a daily quota or
  a rate limit still refused after the existing backoff retries. Authentication errors,
  timeouts and missing models never switch.
- **Routing:** the same request goes to a local Ollama server's OpenAI-compatible API
  (`SIMFFEE_FALLBACK_URL`, default `http://localhost:11434/v1`; `SIMFFEE_FALLBACK_MODEL`,
  default `qwen3.8`; empty disables it), with its own token budget
  (`SIMFFEE_FALLBACK_MAX_TOKENS`, 2000) and its own capability flags. Groq is skipped for 15
  minutes after a quota or 1 minute after a rate limit, then tried again.
- **Honest provenance:** `take_answered_by()` reports which model answered.
  - Decisions answered by the fallback are labelled `ollama/<model>` and cached under the
    fallback's own key, so a replay finds them under that label and never as Groq's.
  - Groq's cache identity is byte-identical to before, so the committed cache still
    replays 84/84 and the bundle rebuilds unchanged.
  - Translations and reviews answered by the fallback are labelled but not cached, since
    their cache keys name the primary model.
  - A run that mixes models is analysed, but `provenance_complete` stays false, so it can't
    become the published bundle.
- **If the fallback is down too:** the call fails with Groq's reason (the root cause), even
  during the cool-down, and the fallback's reason is printed once to the server's stderr.
- **UI:** `/health` reports `fallback_model` and `fallback_active`. The badge reads
  "live · ollama/qwen3.8 (Groq out of tokens)" while the fallback is active, and an answer
  whose decisions came from more than one model says "answered by …".
- **Tests:** `tests/test_fallback.py` (9 tests) covers routing, the cool-down and its
  expiry, failures that must not switch, the fallback being down, the fallback disabled,
  real HTTP through the `openai` SDK to a stand-in local server (with a `<think>` block
  stripped), decision provenance and replay, Groq's cache keys being unchanged, and
  translation labelling.
- **Verified live:** a Groq call still answers (559 input / 72 output tokens). With a
  simulated Groq quota and the real local Ollama (no model pulled), the call fails in
  0.05 s with Groq's quota reason, and stderr shows
  `fallback ollama/qwen3.8 ... failed: LLM transport failed (model not found)`. See #25.
- **Set up with `qwen3:4b`** (#25): Ollama 0.40.16 was found uninstalled mid-session. It was
  reinstalled from ollama.com after checking its signature (Apple-notarized Developer ID,
  "Infra Technologies, Inc"), and `qwen3:4b` (2.5 GB, Q4_K_M) was pulled.
  - First live test: with thinking on, all 3 decisions failed. The model spent the whole
    2,000-token budget thinking (`finish=length`, empty content, 70-90 s each).
  - Setting `reasoning_effort: "none"` fixed it (Ollama ignores `think: false` on this
    endpoint). The default is now `SIMFFEE_FALLBACK_REASONING_EFFORT=none` with an 800-token
    budget, and both are part of the fallback's cache identity.
  - Verified through the real code path with Groq's quota refusal simulated: 3/3 valid
    decisions in 2-4 s (58-70 output tokens), with Groq tried once and then skipped for the
    cool-down.
  - A full what-if ("latte to 40k from day 5") ran on the fallback in 103 s: all 18 new
    decisions were labelled `ollama/qwen3:4b`, with 0 fallback rows, complete analysis, and
    "answered by" listing both models. It reached the same conclusion Groq did (wins back 0
    of 6). An offline replay found all 18 in the cache and reproduced them exactly.

### Phase 7: frontend polish

- **Refs during render** (#14): `Shop.tsx` creates its first world once with a lazy
  `useState` and keeps `dayLength` in the per-frame view state, so render never reads
  `worldRef.current`. All 4 lint warnings are gone.
- **Shop page labelled** (#15): it's a separate toy queue model (dollar prices, its own
  customers and baristas). Connecting it to the engine would be a new feature, so the page
  now says plainly that it's a sandbox that doesn't use the engine's ten twins or scenario
  results, and points to the town, model and why pages.
- **One `runs.json` loader** (#16): `loadRunsJson()` in `src/sim/runs.ts` fetches the file
  once per page load from `BASE_URL`, shares it across all four pages (nothing mutates
  it), and retries after a failed load. The absolute `/runs.json` path is gone.
- **Smaller first load** (#17):
  - The 1,000-sketch pool is a dynamic import, loaded the first time a sketch is needed;
    `pickMock` is now async.
  - The shop, model, why and ask pages load lazily (`React.lazy`), with a styled
    "Loading…" placeholder. The town, the landing page, stays in the main bundle.
- **Lint is strict:** `npm run lint` is now `oxlint --deny-warnings`, so CI fails on any new
  warning.
- **Result:** the main bundle went from 697 KB to 248 KB (gzip 109 → 79 KB), and Vite's
  over-500 KB warning is gone. The sketch pool is a separate 400 KB chunk (14 KB gzipped)
  that only the no-simulation path fetches.

### Phase 8: cleanup

- **Cache pruned** (#19): `tools/prune_cache.py` measures reachability rather than guessing.
  It replays every scenario, including the non-bundle ones, offline on seeds 0-4 with the
  cache's own settings, and records every key the engine looks up.
  - Of 360 entries, 90 are reachable (all `qwen/qwen3.8-27b`: the 84 library decisions
    plus 6 from the non-bundle scenarios).
  - The 270 unreachable ones were deleted: 92 `grok-4.3`, 61 `grok-4.6` and 37
    `groq/compound-mini` (models the Groq transport can't use), plus 80 `qwen` entries from
    live what-if runs whose rows were never committed (54 from the September what-if
    commit, 26 from the phase 3 live tests).
  - Git history keeps all of them. Run the tool again whenever live runs add entries.
- **Assets and docs** (#20): removed `src/assets/{hero.png,react.svg,vite.svg}` and
  `public/icons.svg`, which nothing references.
  - Archived 8 status reports and finished plans in `spec/archive/` (with a README).
  - The audit estimated 11, but `BACKEND_PLAN.md` and `ROADMAP.md` stay in `spec/`: the
    code cites their section labels 76 times, so they act as reference docs.
  - 36 relative links were rewritten. New `tools/check_links.py` (now a CI step) shows
    every Markdown link resolves.
- **One `Runs` type** (#26): `src/sim/runs.ts` re-exports the types from `src/types.ts`
  and keeps only its helpers. Its `ShopId` is kept, documented as "shops with a drawn
  interior", which is a different idea from a data shop id. `low_confidence` (emitted by
  `analyzer/confidence.py`) was added to the shared `Confidence`.
  - The stricter type exposed a latent bug in `Conclusion.tsx`: when a what-if's `returns`
    is `null` (fallback decisions, `analyzer/pairwise.py`), `Math.max` read it as 0, and the
    card would have shown " of  come back". It now excludes such a fix from "best" and
    says "not measured (fallback decisions)".
- **Docs match the scripts** (#13): the README, `engine/README.md` and `ARCHITECTURE.md`
  test sections now describe `requirements-dev.txt`, `pytest` and the CI checks.
  - Replay commands use seeds 0-2 with `--cache-defaults` (the old `0-4` example could
    never complete).
  - A documented `build_runs.py` command was missing `--seeds 0-2` and failed with "missing
    trajectory". Every documented command was run to confirm it works.
- **Local leftovers** (#21, not in git): `runs/` is 87 MB, mostly `runs/phase-ab-check`
  (61 MB), `runs/tutorial-live` (9.6 MB) and `runs/live` (8.6 MB, 14 Ask-page runs).
  `serve_demo.sh` rebuilds `runs/library` on each start. `.env` still holds the unused
  Ollama Cloud key and the commented-out xAI key. Deleting them is the owner's call.

### Verification

- After phase 8:
  - The pruned cache still replays the library 84/84 and the bundle rebuilds identically.
    `check_pipeline.py` passes, and `prune_cache.py` reports 0 unreachable.
  - The non-bundle scenarios' fallbacks are unchanged against the pre-prune cache taken
    from git (#27).
  - `tsc` passes, `oxlint --deny-warnings` passes, and `check_links.py` passes.

- After phase 7:
  - `tsc -b` and `oxlint --deny-warnings` are clean (0 warnings).
  - Browser test (headless Chromium, dev server and production `vite preview`): town,
    model, why and ask pages load, and `runs.json` was fetched once across all of them.
    The sketch pool was fetched only after asking (sketch: "best of 40 sketches (of
    1000)"). The shop page shows the sandbox label, its simulation advances (1% → 6% of
    the day) and reset works. No console or page errors.
  - In production, the town loaded with no lazy chunks, and each page's chunk arrived on
    its first visit.

- After phase 6:
  - `pytest` 117 passed (96 subtests); `tsc -b` is clean; lint shows only the 4 known
    `Shop.tsx` warnings.
  - Browser test (headless Chromium against the real `serve_demo.sh` and Groq): "cut the
    latte to 40k but keep the 7am opening" timed out at 61 s, the page showed "Still
    simulating … (checked 2×)", and the result swapped in at 192 s (18 model calls,
    $0.0067). The result: the price cut wins back 0 of 6. No `/review` request was made
    automatically; clicking "check this run with AI" sent one request with
    `refresh: false`.
  - "Run 3 seeds" sent `[0, 1, 2]`. The server's and the bundle's seed lists happen to be
    identical, so this run can't tell the old code from the new; the fix is confirmed by
    reading the code.
  - With the API up but no key, and with no API at all, the badge shows the new honest
    text and the answer is a clearly labelled illustrative sketch.
  - The review succeeded on retry (2.6 s, `needs_attention`); see #24.

- After phase 5: `tools/check_bundle.py` passes against the regenerated bundle, so the
  whole CI rehearsal is green.
- First GitHub run (run 42841786322, on `15da5ee`, before phase 5 was pushed): the
  frontend job and the Python tests on 3.11 and 3.13 passed. That's the first confirmation
  that the code runs on 3.11. The bundle check failed as designed: the committed bundle was
  still the stale one, and the Linux rebuild differed from it in exactly the 5 fields
  phase 5 adds, so the rebuild matches the regenerated file.

- After phase 4, rehearsed in a clean copy of the working tree (no `.env`, no credentials,
  no stray cache files):
  - Passed: `pytest` (108 passed, 87 subtests), `check_pipeline.py`,
    `check_determinism.sh`, `build_demo.sh`, and on the frontend `npm ci` from scratch,
    `tsc -b`, lint (4 known warnings, exit 0) and the build.
  - Failed, as intended: `check_bundle.py` exits 1 on the stale `public/runs.json` (#4).
  - Not yet run on GitHub, and not yet run on Python 3.11.

- After phase 3: `pytest` 103 passed (87 subtests); the 5 script-style tests pass. All 7
  library scenarios pass the new preflight. Three live what-ifs translated through Groq
  passed it with no false positives. "Open at 6 and add croissants at 30k" completed (it
  needed no new decisions); the other two hit the 60-second timeout (#23). One of those,
  "cut the latte to 40k", rerun with a 400-second timeout, completed with 18 model calls,
  no fallbacks, in about 3 minutes. A malformed `/run` is refused in about 1 ms.
- After phase 2: `pytest`: 93 passed (the 82 existing tests, with 7 transport tests rewritten for Groq,
  plus 11 new security tests). The 5 script-style tests pass; `tsc -b` is clean.
- `build_demo.sh`, run with a deliberately different `SIMFFEE_MODEL` and
  `SIMFFEE_MAX_TOKENS`: 84/84 cache hits, 0 fallbacks.
- `serve_demo.sh` replays the library and serves the API. A live, fresh what-if sent with
  the frontend's Origin ("open at 6 and add croissants at 30k") was translated through
  Groq and returned a complete analysis with no fallbacks.
- One direct Groq decision call returned valid structured JSON (559 input / 53 output
  tokens).

The only lint warnings left are the 4 in `Shop.tsx` (#14, phase 7).
