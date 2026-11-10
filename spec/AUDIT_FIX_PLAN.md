# Codebase audit and fix plan

Audit of `main` at `19e6066` (2026-11-10). Each issue below was found by running the
project's checks and scripts, not by reading code alone. Line references point to the
code at the time of the audit unless marked otherwise.

**Status:** phases 1 and 2 are done on branch `fix/phase1-2-groq-and-security`.
Phases 3-8 are open.

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
| 4 | **`public/runs.json` is stale.** Rebuilding it adds `analysis.flows`, `analysis.hero_agreement` and `analysis.question`. The Ask page reads two of those (`src/components/WhatIfBox.tsx:230` and `:358`), so the static demo is missing the baseline movement panel. | Open (phase 5) |
| 5 | **Timed-out runs are lost.** The UI says the run "is still running in the background", but nothing ever checks `GET /runs/<id>` for the finished result. | Open (phase 6) |
| 6 | **"Run 3 seeds" uses the wrong seed list.** It takes seeds from the static bundle (`WhatIfBox.tsx:197`) instead of the server's own list, so it can fail with "no library run to fork from". | Open (phase 6) |
| 7 | **Without an API key, the Ask page never simulates anything.** The frontend always requests a fresh run, which skips the translation cache, and even the README's example sentences aren't in that cache. With no key you only ever see canned sketches, while the status badge says "cached decisions only". | Open (phase 6) |
| 8 | **Bad input crashes the API, and only after a full engine run.** An empty `set` raises IndexError in `chip()` (`api/service.py:391` after phase 2), an unknown shop raises KeyError, and malformed seeds return a 500 instead of a 400. None of this is checked before the run starts. | Open (phase 3) |

### P2: tests, tooling, frontend

| # | Issue | Status |
| --- | --- | --- |
| 9 | Smaller API issues: `OPTIONS` returned a 204 with a body; `/health?x=1` returns 404; the run registry is read without a lock while other threads write it. | 204 body fixed (phase 2); rest open (phase 3) |
| 10 | `pytest` doesn't collect 5 test files (`test_api`, `test_analyzer`, `test_generic`, `test_narrate`, `test_translate`, about 900 lines) because they are plain scripts with a `main()`. A green pytest run doesn't include them. | Open (phase 4) |
| 11 | There is no CI, so nothing would have caught #1, #4 or #10. | Open (phase 4) |
| 12 | `tools/check_determinism.sh` runs seeds 0-4, but the cache only covers 0-2. It passed while making 77 fallback decisions, so it mostly compares fallbacks with fallbacks. | Open (phase 4) |
| 13 | Docs and scripts disagree: `build_demo.sh` defaulted to offline although its header suggested otherwise; the seed ranges in comments were inconsistent; `pytest` isn't listed in `requirements.txt`. | Script headers fixed (phase 1); rest open (phase 8) |
| 14 | `src/pages/Shop.tsx` reads refs during render (the 4 lint warnings), so its display can lag behind the simulation after a reset. | Open (phase 7) |
| 15 | The shop interior page runs its own random JavaScript simulation (`src/sim/world.ts`, with its own price and barista sliders). It isn't connected to the engine's results. | Open (phase 7) |
| 16 | `runs.json` is fetched two different ways (`src/sim/runs.ts:136` uses an absolute path, the other pages use `BASE_URL`), and up to 4 times. | Open (phase 7) |
| 17 | The 412 KB sketch pool (`src/sketchPool.json`) is bundled eagerly into the main JavaScript file. | Open (phase 7) |
| 18 | Every finished answer automatically triggers a fresh AI review call (`WhatIfBox.tsx:178`), which costs money on each run. | Open (phase 6) |

### P3: cleanup

| # | Issue | Status |
| --- | --- | --- |
| 19 | About 98 cache entries can't be hit by the default setup: 37 `groq/compound-mini` and 61 `grok-4.6` decisions. The 92 `grok-4.3` entries are unreachable too, now that the provider is Groq. | Open (phase 8) |
| 20 | Unused template assets (`src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`, `public/icons.svg`) and 11 historical plan and status docs in `spec/`. | Open (phase 8) |
| 21 | `runs/` holds 83 MB of old local runs. At audit time `.env` held a `GROQ_API_KEY` that nothing read; since phase 1 the Groq key is the one in use, and the xAI key is commented out and unused. | Open (phase 8) |

## Fix plan

| Phase | Fixes | Done when | Status |
| --- | --- | --- | --- |
| 1. Make it run | #1: the offline replay ignores `.env` model settings, or the scripts pin the cache's model and say clearly what's configured versus what's cached. #2: pick one provider and default to a model it actually serves. Update the README. | `serve_demo.sh` works on the maintainer's machine and on a fresh clone | Done |
| 2. Security | #3: allow only ids matching `^[A-Za-z0-9_-]{1,64}$`, check that the resolved path stays inside the live folder, and limit CORS to the Vite dev server. Add a regression test. | The traversal request is rejected with a 400 | Done |
| 3. Input validation | #8, #9: check shops, empty overrides and seeds before running; return 400s; lock the registry. | Malformed requests get a 400 with no engine run | Open |
| 4. Tests and CI | #10: wrap the script tests so pytest collects them. #11: add a GitHub Actions workflow running pytest, `tsc`, `oxlint`, the build, and a clean-env demo rebuild compared with the committed copy. #12: make the determinism check fail on incomplete runs. | CI is green and runs all ~150 checks | Open |
| 5. Fresh data | #4: regenerate `public/runs.json`; the CI comparison from phase 4 keeps it fresh. | The rebuilt and committed bundles differ only in `generated_at` | Open |
| 6. Ask flow | #5: check for timed-out results. #6: use the server's seed list. #7: support a cached or no-key path, or make the badge honest. #18: run the AI review only on request. | A demo with no key behaves the way the README describes | Open |
| 7. Frontend polish | #14-#17: fix the ref usage, load `runs.json` once through a shared loader, lazy-load the sketch pool, and connect the shop page to the engine data or label it as a toy. | Lint is clean and the bundle is under 500 KB | Open |
| 8. Cleanup | #13, #19-#21: prune the cache, delete unused assets, archive the old docs, align the scripts with the docs. | Repo contains only reachable cache entries and current docs | Open |

Phases 1 and 2 had to come first. The later phases are independent and can each be their own PR.

## What phases 1 and 2 changed

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

### Verification

- `pytest`: 93 passed (the 82 existing tests, with 7 transport tests rewritten for Groq,
  plus 11 new security tests). The 5 script-style tests pass; `tsc -b` is clean.
- `build_demo.sh`, run with a deliberately different `SIMFFEE_MODEL` and
  `SIMFFEE_MAX_TOKENS`: 84/84 cache hits, 0 fallbacks.
- `serve_demo.sh` replays the library and serves the API. A live, fresh what-if sent with
  the frontend's Origin ("open at 6 and add croissants at 30k") was translated through
  Groq and returned a complete analysis with no fallbacks.
- One direct Groq decision call returned valid structured JSON (559 input / 53 output
  tokens).

The only lint warnings left are the 4 in `Shop.tsx` (#14, phase 7).
