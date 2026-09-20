# Change report — rate-limit repair, Phase B (competitor enters), xAI transport

2026-09-20 · working tree on top of `e2c67c0` · nothing committed yet

Four pieces of work, in the order they happened. Every item is verified offline; the live
verification of the xAI transport is at the end, with what is still running.

---

## 1. LLM budget: why the what-if box said "rate limit", and the fix

**Symptom.** *Can't simulate that yet. transport failed: LLM transport failed (rate limit)*
right after a new Groq key was installed.

**Cause.** Not the key. The `groq/compound-mini` tier allowed **250 requests/day** and
70k tokens/minute (read from the `x-ratelimit-*` response headers). Pacing was 2.2 s per
call at ~3.1k tokens per decision ≈ 85k tokens/min, over the per-minute cap, so the engine
was 429'd repeatedly — and **every 429 still consumed one of the 250 daily requests**. The
previous run's ledger showed it: `api_attempts 44, responses 17` (27 wasted). A what-if typed
while the previous run was still finishing in the background hit the saturated window four
times and gave up.

**Fix** — `engine/llm.py`
- Token-aware pacing: every response (and every 429) records `x-ratelimit-remaining-tokens`
  / `x-ratelimit-reset-tokens`; before a call, if the estimated request (prompt + max
  tokens) does not fit the remaining window, the call waits for the window to reset instead
  of being sent and refused. Zero extra requests or tokens; no-ops on providers that do not
  send those headers. `_duration()` parses `5ms` / `2.19s` / `1m2.5s` / `4h36m28.8s`.
- Same number of *successful* calls, none wasted on 429s.

**Timeouts** — a live run takes 1.5–3 min at this pacing, so the 45 s fallback always fired.
- `api/server.py --timeout` and `api/service.py timeout_s` default **45 → 240 s**.
- `src/api.ts` what-if fetch **120 → 300 s** so the fallback answer still arrives.
- `spec/SPEC_FUNCTIONAL.md` default updated.

---

## 2. Phase B — competitor enters (ROADMAP §5 B1–B6)

All six steps implemented. v1 rows are **byte-identical** before and after (checked on
seeds 0–2, all four scenarios) and the committed cache still replays **84/84 hits**: no v1
cache key changed.

| Step | What | Files |
| --- | --- | --- |
| B1 | `exists_from_day` on a shop. Absent shop is dropped from the resolved day: not an option, no marketing, no disruption source. Existence is **run-wide** whatever `from_day` the override block carries. Day-1 state zeroes habit / curiosity / visits for a shop that is not there yet; `regular_shop` only considers present shops; a late shop is "remembered" as it was on its opening day. | `engine/resolve.py` (`EXISTS`, `exists_on`, `opening_today`), `engine/loop.py` (`init_state(present=)`, `run_day(opening=)`, remembered world), `engine/habit.py` |
| B2 | Sixth disruption source **`new_entrant`**: 0.5 if the entrant is open at the twin's usual time, 0.2 otherwise; still a MAX with the other sources so the v1 hours shock wins on day 4. Opening-day `latent_interest += 0.15` within 2 × walk tolerance. Prompt: "a new coffee shop opened today: …", option line "opened today -- brand new". | `engine/schema.py` (enum + 4 constants), `engine/disruption.py` (`with_new_entrant`), `engine/gossip.py` (`apply_opening`), `engine/prompt.py`, `engine/decide.py` (`options_block(day=)`, `opened_today`) |
| B3 | **`analyzer/flows.py`**: per day, per other shop (and `none`), `lost_to` / `gained_from` / `returned` / `net`, each with a driver histogram; totals; end-of-run `kept` / `lost` / `gained`. Generic — runs on S1 output too. `agreement()` for B6. Wired into `build_analysis` (reported even when the causal analysis is withheld), every what-if button, and therefore `/whatif`. | `analyzer/flows.py`, `build_runs.py` |
| B4 | Scenarios `s2_entrant` (Starbucks absent days 1–3, opens day 4 alongside the v1 hours/price shift), `s2_entrant_only` (control via `unset`; shares days 1–3 byte for byte). Both `bundle: false` — run on demand, never in the promoted `runs.json`. | `data/scenarios/s2_entrant*.json` |
| B5 | Translator learns **`shop_enters`** (menu row in `data/actions.json`; the old "competitor opens" `unsupported` example is removed). Compiling it makes the plan a **root** scenario: parent `null`, the parent chain's overrides inlined so the S1 story still happens, `derived_from: baseline`, `situation: competitor_enters`, full rerun from day 1. `analyzer/templates.py` picks the S2 question; `narrate.py` leads with a flows sentence. Chip text for the entrant. | `engine/translate.py`, `data/actions.json`, `analyzer/templates.py`, `analyzer/narrate.py`, `api/service.py` (`chip`) |
| B6 | `abl_rename` (`prompt.shop_label: "Shop B"`, `from_day 1` so it is a full rerun and no day carries the real name; `role: ablation`, `compare_to: s2_entrant`). `analysis.hero_agreement[abl_rename]` = share of twin-days with the same choice (all rows and reappraisal rows only), per seed and mean; fallback twin-days excluded. | `data/scenarios/abl_rename.json`, `analyzer/flows.py`, `build_runs.py` |

Supporting changes
- `data/naive_weights.json`: `exists_from_day → curiosity, 0.6` ("everyone went to try the
  new place" is what a founder blames); label *Competitor opens day N* in `attribution.py`.
- `bundle: false` handling: `build_runs.load_scenarios(bundle_only=True)`,
  `loader.discover_scenarios(include_all=False)`, CLI `--all --include-all`,
  `build_runs.py --include-all`, `tools/fake_runs.py` filter. `--all` still means the
  promoted set, so `check_determinism.sh`, `check_pipeline.py`, `build_demo.sh` are unchanged.
- Frontend: `Analysis.question / flows / hero_agreement` types; a **flows panel** under a
  what-if answer ("Since Starbucks opened: lost N to … — mostly curiosity; N came back; N
  never left"); a new example sentence. `src/types.ts`, `src/components/WhatIfBox.tsx`,
  `src/App.css`.
- Docs: `spec/SPEC_FUNCTIONAL.md §3` (now matches ROADMAP §7.1), `engine/README.md`.

Design call to review
- T09/T10's data makes them Starbucks regulars. In S2 their Starbucks habit starts at 0,
  so on days 1–3 they are weak-habit Simffee customers who **reappraise every day** (extra
  LLM calls) and their `what_log` still marks Starbucks as "visited" on day 4. Honest given
  the data; the alternative is S2-specific twin variants.

How to run the S2 family
```bash
python3 -m engine.cli --all --include-all --seeds 0-2 --out runs/s2            # live
python3 build_runs.py runs/s2 --include-all --seeds 0-2 --out /tmp/s2.json       # bundle + hero_agreement
```

---

## 3. Provider: Groq → xAI Responses API

`engine/llm.py` is the only place a model is called, so the swap is contained.

- `openai` SDK (already installed, 2.38) with `base_url = https://api.x.ai/v1`, calling
  `client.responses.create(...)`.
- Request: `input` (system + user), `max_output_tokens`, `store: False` (nothing about a
  twin is kept server-side), `temperature`, structured output via
  `text.format = {type: json_schema, strict: true, schema}`. The existing probe-and-drop
  logic still applies if a model rejects temperature or the schema format; local validation
  stays mandatory.
- Reply parsed from `output_text` / `output[].content[].text` (reasoning items skipped);
  usage from `input_tokens` / `output_tokens`.
- Key: **`XAI_API_KEY`** (`.env` allowlist). Client timeout 30 → 60 s for reasoning models.
  xAI returns a bad key as `400 invalid-argument … Incorrect API key`, so the classifier now
  labels any "api key" message as `authentication`.
- `requirements.txt` → `openai>=1.66.0`. Groq removed entirely (SDK, key, messages in
  `tools/build_demo.sh`, `tools/serve_demo.sh`, `tools/check_translate_live.py`,
  `engine/README.md`). `tools/pricing.json` → `provider: xai`; **no grok-* price rows yet**,
  so the ledger reports "no price on file".
- `.env`: `XAI_API_KEY=` line added, `SIMFFEE_MODEL=grok-4.6`. The `GROQ_API_KEY` line is
  now ignored by the loader.

> **Action needed:** the old Groq key was echoed into the session transcript while
> inspecting `.env`. Revoke it in the Groq console and delete the line.

Cache consequence: the model name is in every cache key, so **every scenario is fully live
the first time** under `grok-4.6`. The committed `cache/` (qwen, 400 tokens) is untouched
and still replays offline with `SIMFFEE_MODEL=qwen/qwen3.8-27b SIMFFEE_MAX_TOKENS=400`.

---

## 4. Verification

Offline (all green)
- `python3 -m unittest discover -s tests` — **62 tests** (21 new in `tests/test_phase_b.py`:
  exists_from_day, run-wide existence, unset, v1 untouched, init_state zeroing, entrant shock
  MAX, opening bump radius, offline S2 run incl. control fork sharing days 1–3 and the rename
  ablation, flows on hand-built rows and S1 fixtures, agreement, templates, bundle filter,
  hero_agreement, S2 narration, translator `shop_enters` compile / rejections / schema).
- `tests/test_translate.py`, `test_generic.py`, `test_analyzer.py`, `test_narrate.py`,
  `test_api.py`; `tools/check_determinism.sh`; `tools/check_llm_path.py`;
  `tools/check_pipeline.py` (passes under the committed-cache config).
- v1 offline runs byte-identical; 84/84 cache hits preserved.
- End-to-end through `WhatIfService` (offline, stubbed translator): S2 sentence → root
  scenario, 70 rows, single shop on days 1–3, `new_entrant` on day 4, flows + S2 question.
- `tsc -b`, `oxlint`, `vite build` clean.

Live against xAI (`grok-4.6`)
- One-line check: `{"ok": true}` returned first attempt; `structured ok: True`,
  `temperature ok: True`. Cost shape: 762 in / 156 out for a trivial prompt — reasoning is
  billed as output.
- Phase A translator (`open at 6 and add croissants at 30k`): correct overrides on attempt 1
  (2.8k in / 635 out, 9 s).
- Phase A what-if via the service: ran, but the **analysis is withheld** — `runs/library`
  (the promoted baseline a what-if forks from) was built offline, so its inherited day-4
  rows are `offline, not cached` fallbacks. A **live library refill (ROADMAP A5)** is
  required before any forked what-if can be analysed. Not a transport problem.
- Phase B what-if via the service (*Starbucks opens across the street on day 4. I open at 6
  and add pastries at 30k*): translation succeeded and the full rerun from day 1 was in
  progress (snapshots through day 5 written under `/tmp/xai_live/user_b20014880d/`) when
  the session was interrupted; the answer, if it finished, is at `/tmp/xai_s2.log` and
  `/tmp/xai_s2_answer.json`. ~40 live decisions at 2.2 s pacing plus model time ≈ 6–8 min.

---

## 5. Open items

1. Revoke the exposed Groq key; remove `GROQ_API_KEY` from `.env`.
2. Live library refill with `grok-4.6` (baseline, cf_null, cf_restore_hours, cf_discount ×
   3 seeds), then promote — until then forked what-ifs report incomplete trajectories.
3. Add `grok-4.6` input/output prices to `tools/pricing.json` so the ledger shows $.
4. B4/B6 live: `s2_entrant`, `s2_entrant_only`, `abl_rename` × 3 seeds; read
   `hero_agreement`.
5. Retune `SIMFFEE_MIN_INTERVAL` / `SIMFFEE_MAX_TOKENS` for the xAI tier once a full run's
   ledger exists (reasoning output is long; 1600 is the current cap).
6. Decide on S2-specific twin variants for T09/T10 (section 2, design call).
