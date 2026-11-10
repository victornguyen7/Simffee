# B2 — Status report

Companion to [BACKEND_PLAN.md](./BACKEND_PLAN.md). Covers the Analyzer + build pipeline seat only.
Read alongside [B1_STATUS.md](./B1_STATUS.md).

## Integration update — 2026-09-20

Upstream `f6aa19f` has been reconciled with the local simulation repairs. The historical
report below describes the upstream checkpoint; these notes supersede its run commands,
confidence/fallback behavior, and narration status:

- Retained `whatif_confidence()`, the lost-customer-only cohort, `_whatif()` bundle fields,
  and the `impact.per_twin.cf_null` contract. Confidence now requires three distinct usable
  evidence seeds for both headline and branch conclusions. A branch seed with earlier
  fallback decisions is excluded even if its last-day row is successful autopilot.
- Retained fixture-derived narration test inputs, but production narration is now
  deterministic and offline. Incomplete trajectories suppress causal claims, not merely
  confidence. Do not relabel fallback drivers to manufacture the intended demo conclusion.
- `tools/build_demo.sh` now defaults to offline, strict verification in a fresh temporary
  directory. Use `--out NEW_DIRECTORY --cache DIRECTORY --model MODEL` to choose artifacts;
  a nonempty destination is rejected. `--live` is explicit and requires `GROQ_API_KEY` plus
  prior approval of model/spend. The script never promotes artifacts to `public/runs.json`.
- Both upstream and local regression cases are retained. Run `python3 tests/test_b2_sync.py -v`
  alongside the commands in `engine/README.md`. Stubbed end-to-end results are test evidence,
  not fresh model predictions; real-model verification still needs a compatible live cache.
- T08/T10 behavior and control-arm design remain review items in SPEC §8. No customer data
  was tuned during reconciliation, and the frontend remains outside the backend repair.

**Where we are: every B2 milestone that does not need an API key is done**, including the hour
7–9 items (`narrate.py`, `PROTOCOL.md`, single-source enums) that the previous version of this
report listed as "next". The analyzer runs unmodified on B1's real engine output. What remains is
one thing, and it is not ours: a live LLM run so the demo conclusion can be verified on real
model output.

---

## 1. What exists

| File | Purpose |
| --- | --- |
| `tools/fake_runs.py` | Fixture generator. 1,400 scripted rows (4 scenarios x 5 seeds x 70) plus the expected-analysis oracle |
| `tools/validate.py` | Enforces the BACKEND_PLAN 2.1 row contract. Imports the enums from `engine/schema.py`; adds file-level invariants (counts, coverage, ordering, `told` membership) |
| `tools/build_demo.sh` | **One command** for BACKEND_PLAN 6.1: engine (from cache) → validate → `runs.json` |
| `build_runs.py` | Assembles `public/runs.json`, the single file the frontend reads |
| `analyzer/breakpoint.py` | SPEC 6.1 — find the day sales broke |
| `analyzer/attribution.py` | SPEC 6.2 — naive read vs actual driver; SPEC 6.3 — evidence pair |
| `analyzer/pairwise.py` | SPEC 5.3 — twin-paired branch comparison, what-if returns/of |
| `analyzer/impact.py` | SPEC 6.4 — subtract the control arm |
| `analyzer/confidence.py` | SPEC 6.5 — 0.7 stability + 0.3 support, for the headline **and for each what-if** |
| `analyzer/narrate.py` | SPEC 6.6 — the one LLM call; rejects any narration containing a number not in its input |
| `tests/test_analyzer.py` | 37 checks pinning the analyzer to the oracle |
| `tests/test_narrate.py` | 14 checks on the number guard, retry, and dead-transport paths, against a stubbed transport |
| `PROTOCOL.md` | SPEC 7.5 — what the synthetic-data label links to |

```
python3 tools/fake_runs.py                          # 1400 rows -> tests/fixtures/runs/
python3 tools/validate.py                           # fixtures
python3 tests/test_analyzer.py                      # 37 checks
python3 tests/test_narrate.py                       # 14 checks, no key needed
python3 build_runs.py                               # runs.json from fixtures
./tools/build_demo.sh                               # engine -> validate -> runs.json from real output
./tools/build_demo.sh --offline                     # same, never calls the API
```

## 2. Milestones against the plan

| Hour | Deliverable | Status |
| --- | --- | --- |
| 0–1 | `tools/fake_runs.py` + a `public/runs.json` | **Done** |
| 1–2 | `tools/validate.py` | **Done** |
| 2–4 | `breakpoint.py`, `attribution.py`, `pairwise.py` | **Done** |
| 4–5 | `impact.py`, `confidence.py` | **Done** |
| 5–6 | `build_runs.py` end to end | **Done** |
| 6–7 | Swap to B1's real `runs/`, run `validate.py` | **Done structurally** — 1,400 real rows pass, zero analyzer edits. Results degenerate offline (section 4) |
| 7–9 | `narrate.py` + confidence tooltip fields + regenerate | **Done, stubbed.** Narration runs only when credentials exist; the live regenerate is blocked on a key |
| 9+ | Whatever the frontend is missing; `PROTOCOL.md` | `PROTOCOL.md` done. Frontend has not started (`src/` is still the Vite template), so nothing to react to yet |

## 3. Changes since the last report

- **What-if confidence** (BACKEND_PLAN 2.3 shows `confidence: 0.74` per button; SPEC 6.5 says
  "next to each conclusion"). It was missing. `confidence.whatif_confidence` now computes it:
  stability = do the twins baseline lost land on the same shop on day 7 across seeds; support =
  is the driver of each lost twin's *deciding* reappraisal in the branch present in their
  transcript. Same 0.7/0.3 weights, same `unmeasured` guard. Restricted to the lost twins so the
  six unaffected twins' agreement cannot pad the number.
- **`impact.per_twin` key renamed `control` → `cf_null`** to match the frozen contract exactly.
- **`tests/test_narrate.py` no longer reads `public/runs.json`.** It computed its expected
  payload from whatever was last built, which meant it broke the moment `runs.json` was built
  from real engine output. It now derives the payload from fixtures.
- **`tools/build_demo.sh`** is the one-command reproduction BACKEND_PLAN 6.1 asks for. Falls
  back to `--offline` automatically when there is neither a key nor a `cache/`.

## 4. Fixtures vs. B1's real offline output

Both columns come from the same analyzer code and the same `build_runs.py`.

| | Fixtures (scripted target) | B1 `runs/` (offline) |
| --- | --- | --- |
| Rows valid | 1,400 / 1,400 | 1,400 / 1,400 |
| Break day | 4 | 4 |
| Naive read | `price` 0.333 | `price` 0.333 |
| **Actual driver** | **`hours`** | **`habit`** |
| Surprise | true | true, but for the wrong reason |
| Impact | 4 lost, 3 ours, 1 anyway | 6 lost, 6 ours, 0 anyway |
| `cf_restore_hours` | 3 of 4 return, conf 0.875 | 6 of 6 return, conf **unmeasured** |
| `cf_discount` | 1 of 4 return, conf 0.875 | 0 of 6 return, conf **unmeasured** |
| Headline confidence | 0.883 (stability 0.88, support 0.89) | **unmeasured** |

**Why the real column is degenerate.** In `--offline` mode every reappraisal falls back, so all
210 reappraisal rows carry `llm_failed: true`, nobody defects, and all five seeds are identical.
The engine is behaving correctly; there is no model output to analyze. Every confidence figure
correctly reports `null` with a reason rather than a number.

**Why both fixture what-ifs read 0.875.** The fixtures were scripted to be seed-stable for the
lost twins (stability 1.0) and the same four twins make the same deciding reappraisal in both
branches. That is a property of the scripted fixture, not of the metric; on real output the two
will differ.

Done criterion #5 (restore-hours strictly beats discount) holds on both columns. Done criterion
#4 (`naive=price`, `actual=hours` in ≥4 of 5 seeds) passes 5/5 on fixtures and cannot be
evaluated offline.

## 5. Things for B1 and whoever owns content (unchanged, still open)

- **The offline fallback stamps `primary_driver: habit` on rows whose `disruption.source` is
  `hours`.** If the fallback derived the driver from the shock instead, an offline run would
  exercise the full demo conclusion before any API spend. Cheap, high value, do it before the
  live run.
- **`cf_null` is a frozen world** — no override, no disruption, no reappraisal, `lost_anyway` is 0
  by construction. The SPEC 6.4 subtraction is vacuous until the engine has ambient variation.
- **T10 cannot be reached by `cf_discount`** — disruption is computed only for a twin's regular
  shop, so a competitor's price cut never triggers her reappraisal. SPEC 8's "+1 new" is
  unreachable as written.
- **The 48k latte is load-bearing.** Price 0.333 vs hours 0.300. SPEC 7.3's 47k would flip the
  naive read; raise the price coefficient in the same commit if you go there.
- **Evidence card.** The selector picks T07 (latent 0.05) over T08 (0.15) as "resisted". If
  content wants T08, lower her latent below T07's rather than hardcoding the analyzer. B1 flags
  the same two numbers for the day-4 skip gate; fix them together.

## 6. Design note: confidence refuses to guess

SPEC 4.3 excludes `llm_failed` rows from stability. Taken literally offline, only autopilot rows
remain, which agree by construction — stability would read 1.0 on a run where the model never
decided anything. `confidence.py` reports twins with no usable rows as `unmeasured` and returns
`value: null` with a reason when nothing is measurable. This now applies to the what-if
confidences too, and there is a regression test for each.

## 7. Open items on our side

- The fixture's day-4 drop is 76% against "~40%" in SPEC 7. The spec's own sequence puts 6 of 8
  regulars out the door, so 76% is what its numbers imply. Nothing depends on it (the break rule
  needs 25%); the spec line should be reconciled.
- `runs.json` is 704 KB from fixtures, 749 KB from real offline output — well under the 2 MB
  budget even before `reasoning` strings shrink to real LLM lengths.

## 8. Risk not in the plan

`Simffee — Nghiên cứu & chiến lược điểm đột phá.md` (2026-09-20) proposes a different demo:
Starbucks *opens* on day 4, a 500-agent crowd on a 20×20 grid, and a new `category_interest`
variable producing a demand-increasing channel. None of that is in SPEC.md yet. If it is adopted,
B2 needs three new computations — `stolen`, `activated`, `spillover`, `net` (strategy doc, Hướng
A §2) — and the row contract needs crowd rows or a separate crowd summary. The current analyzer
is untouched by that pivot until the spec changes; flagging it so it is a decision, not a surprise.

## 9. Next

Nothing on B2 is blocked or pending. The one open thing — verifying the demo conclusion on real
model output — needs a key and a live baseline run (B1's step 2), after which:

1. `./tools/build_demo.sh` regenerates `runs.json` with narration.
2. Check done criteria #4 and #6 on the live output.
3. Commit `cache/`.
