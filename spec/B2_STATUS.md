# B2 — Status report

Companion to [BACKEND_PLAN.md](./BACKEND_PLAN.md). Covers the Analyzer + build pipeline seat only.
Read alongside [B1_STATUS.md](./B1_STATUS.md).

**Where we are: hours 0–6 of the B2 track are complete, and the analyzer has been run against
B1's real engine output.** It needed zero edits to do so — the row contract held exactly. The
remaining gap is not ours: the demo conclusion cannot be verified until someone makes a live LLM
run, because offline rows cannot produce it.

---

## 1. What exists

| File | Purpose |
| --- | --- |
| `tools/fake_runs.py` | Fixture generator. 1,400 scripted rows (4 scenarios x 5 seeds x 70) plus the expected-analysis oracle |
| `tools/validate.py` | Enforces the BACKEND_PLAN 2.1 row contract. Runs against fixtures and against B1's `runs/` |
| `build_runs.py` | Assembles `public/runs.json`, the single file the frontend reads |
| `analyzer/breakpoint.py` | SPEC 6.1 — find the day sales broke |
| `analyzer/attribution.py` | SPEC 6.2 — naive read vs actual driver; SPEC 6.3 — evidence pair |
| `analyzer/pairwise.py` | SPEC 5.3 — twin-paired branch comparison, what-if returns/of |
| `analyzer/impact.py` | SPEC 6.4 — subtract the control arm |
| `analyzer/confidence.py` | SPEC 6.5 — 0.7 stability + 0.3 support |
| `tests/test_analyzer.py` | 27 checks pinning the analyzer to the oracle |

```
python3 tools/fake_runs.py                          # 1400 rows -> tests/fixtures/runs/
python3 tools/validate.py                           # fixtures
python3 tools/validate.py runs                      # B1's real output
python3 tests/test_analyzer.py                      # all checks passed
python3 build_runs.py                               # runs.json from fixtures
python3 build_runs.py runs                          # runs.json from the real engine
```

## 2. Milestones against the plan

| Hour | Deliverable | Status |
| --- | --- | --- |
| 0–1 | `tools/fake_runs.py` + a `public/runs.json` | **Done** |
| 1–2 | `tools/validate.py` | **Done.** Catches a missing field, a bad enum, a null `spent`, a lying `abandoned`, a short file |
| 2–4 | `breakpoint.py`, `attribution.py`, `pairwise.py` | **Done** |
| 4–5 | `impact.py`, `confidence.py` | **Done** |
| 5–6 | `build_runs.py` end to end | **Done.** Every field of `analysis` is computed from rows; only `narration` is null |
| 6–7 | Swap to B1's real `runs/`, run `validate.py` | **Done structurally** — 1,400 real rows pass, analyzer ran with zero edits. Results are degenerate for the reason in section 4 |
| 7–9 | `narrate.py`, regenerate | Blocked on an API key, same blocker as B1 |

## 3. The decision that shaped everything

The plan called for fixtures that are "fake but schema-valid." We went further: **the fixtures
script the SPEC 7.1 target scenario**, and the answer they should produce is committed to
`tests/fixtures/expected_analysis.json`.

That file is the analyzer's oracle. It meant the analyzer was developed against a known-correct
answer rather than plausible noise, and it is what BACKEND_PLAN 4 asks for — after hour-6 tuning it
distinguishes "the analyzer broke" from "the simulation legitimately changed." It is also the only
reason we can currently tell that the offline engine output is degenerate rather than wrong.

## 4. Fixtures vs. B1's real offline output

Both columns are computed by the same analyzer code from the same `build_runs.py` call.

| | Fixtures (scripted target) | B1 `runs/` (offline) |
| --- | --- | --- |
| Rows valid | 1,400 / 1,400 | 1,400 / 1,400 |
| Break day | 4 | 4 |
| Naive read | `price` 0.333 | `price` 0.333 |
| **Actual driver** | **`hours`** | **`habit`** |
| Surprise | true | true, but for the wrong reason |
| Impact | 4 lost, 3 ours, 1 anyway | 6 lost, 6 ours, 0 anyway |
| `cf_restore_hours` | 3 of 4 return | 6 of 6 return |
| `cf_discount` | 1 of 4 return | 0 of 6 return |
| Confidence | 0.883 (stability 0.88, support 0.89) | **unmeasured** |

**Why the real column is degenerate.** In `--offline` mode every reappraisal falls back, so all
270 reappraisal rows carry `llm_failed: true`, all six disrupted twins skip, nobody defects to
Starbucks, and all five seeds are byte-identical. The engine is behaving correctly; there is simply
no model output to analyze.

Two things nonetheless hold on real data, and they are worth having: the **structural contract**
(1,400 rows, all valid, analyzer runs unmodified) and **done criterion #5** — restore-hours strictly
beats discount, 6/6 against 0/6.

Done criterion #4 (`naive=price`, `actual=hours` in ≥4 of 5 seeds) passes 5/5 on fixtures and
**cannot be evaluated offline at all**.

## 5. Things for B1 and whoever owns content

**The offline fallback stamps `primary_driver: habit` on rows whose `disruption.source` is `hours`.**
This one line is what makes criterion #4 unevaluable offline. If the fallback instead derived the
driver from the shock that caused the reappraisal, an offline run would exercise the whole analyzer
path and give the team a full dry run of the demo conclusion before spending anything on the API.
Cheap change, high value — recommend it before the live run, not after.

**`cf_null` is a frozen world.** Under SPEC 2.3 latent interest can only be acted on when habit is
suspended or `latent > habit + 0.3`. `cf_null` has no overrides, so nothing disrupts anyone, nobody
reappraises, and the control arm loses zero customers *by construction* — confirmed on real output,
where `lost_anyway` is 0. That makes the SPEC 6.4 subtraction vacuous and removes the control arm
SPEC 5.2 leans on. The fixture works around it with a day-6 `wait` disruption for T05; the engine
needs some genuine ambient variation.

**T10 cannot be pulled in by `cf_discount`.** `habit[starbucks]` 0.867 keeps her on autopilot, and
disruption is only computed for a twin's regular shop, so a competitor's price cut can never reach
her. SPEC 8's "+1 new against 3 who never return" is unreachable as written.

**The 48k latte is load-bearing.** Naive scores price 0.333 against hours 0.300 — a margin of 0.033.
SPEC 7.3's suggested drop to 47k would put price at 0.222, flip the naive read to `hours`, and
collapse the mechanism surprise. If 47k becomes necessary, raise the price coefficient in SPEC 6.2
in the same commit.

**The spec's evidence card may be the weaker of the two candidates.** SPEC 9 and BACKEND_PLAN 2.3
both name T08 Mai as the "resisted" card. Our selector picks the shocked twin with the least latent
interest to act on, since that is the claim the pair makes — and that is T07 Vy at 0.05, against
T08's 0.15. Either is defensible; the selector is not hardcoded to a twin, so if content prefers
T08, lower her `latent_interest` below T07's rather than special-casing the analyzer.

B1's own report also flags that T07 and T08 drift over the 0.20 skip gate by day 4. That fix and
this one touch the same two numbers, so make them together.

## 6. Design note: confidence refuses to guess

SPEC 4.3 says `llm_failed` rows are excluded from stability. Taken literally on an offline run, the
only rows left are autopilot ones, which agree across seeds by construction — so stability computes
to **1.0 on a run where the model never made a single decision**.

`confidence.py` reports twins with no usable rows as `unmeasured` rather than stable, and returns
`value: null` with a reason when no reappraising twin is measurable at all. On B1's real output it
says exactly that, instead of a confident-looking number. SPEC 6.5 wants the system to show when it
does not know; this is that, and there is a regression test for it.

## 7. Open items on our side

- `engine/schema.py` now exists and agrees with `tools/validate.py` on every invariant. Ours is a
  strict superset — it also checks `told` membership, row ordering, and per-file counts. Worth
  importing the enums from schema.py so there is one definition rather than two that agree today.
- `narration` is null until there is an API key. Everything else in `analysis` is computed.
- The fixture's day-4 drop is 76% against the "~40%" in SPEC 7. The spec's own day-4 sequence puts
  6 of 8 regulars out the door, so 76% is what its numbers imply. Nothing depends on it — the break
  rule only needs 25% — but it should be reconciled.

## 8. Next

1. Import the enums from `engine/schema.py` so the contract has one home.
2. Write `narrate.py` against fixtures with a stubbed transport, the way B1 did for its LLM path, so
   it is ready the moment a key exists.
3. `PROTOCOL.md` (SPEC 7.5), which needs nothing from anyone.

None of these are blocked. The one thing that is blocked — confirming the demo conclusion on real
model output — needs a key and a live baseline run, which is B1's step 2.
