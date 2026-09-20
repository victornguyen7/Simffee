# B2 — Status report

Companion to [BACKEND_PLAN.md](./BACKEND_PLAN.md). Covers the Analyzer + build pipeline seat only.

**Where we are: hours 0–4 of the B2 track are complete and verified.** The frontend is unblocked,
the row contract is enforced by a validator, and the first three analyzer modules reproduce a known
answer from fixtures. Nothing here has ever seen B1's engine, which is the point.

---

## 1. What exists

| File | Lines | Purpose |
| --- | --- | --- |
| `tools/fake_runs.py` | 311 | Fixture generator. Emits 1,400 scripted rows (4 scenarios x 5 seeds x 70) and the expected-analysis oracle |
| `tools/validate.py` | 148 | Enforces the BACKEND_PLAN 2.1 row contract. Runs against fixtures now, B1's `runs/` later |
| `build_runs.py` | 163 | Assembles `public/runs.json`, the single file the frontend reads |
| `analyzer/breakpoint.py` | 53 | SPEC 6.1 — find the day sales broke |
| `analyzer/attribution.py` | 105 | SPEC 6.2 — naive read vs actual driver |
| `analyzer/pairwise.py` | 54 | SPEC 5.3 — twin-paired branch comparison, what-if returns/of |
| `tests/test_analyzer.py` | 83 | 14 checks pinning the analyzer to the oracle |

Run the whole thing:

```
python3 tools/fake_runs.py     # 1400 rows -> tests/fixtures/runs/
python3 tools/validate.py      # OK — 1400 rows across 20 files
python3 tests/test_analyzer.py # all checks passed
python3 build_runs.py          # public/runs.json, 704 KB
```

`runs/` and `__pycache__/` are gitignored; `tests/fixtures/` is committed, per BACKEND_PLAN 4.

## 2. Milestones against the plan

| Hour | Deliverable | Status |
| --- | --- | --- |
| 0–1 | `tools/fake_runs.py` + a `public/runs.json` | **Done.** Frontend can build against the real 2.3 shape today |
| 1–2 | `tools/validate.py` | **Done.** Verified it catches a missing field, a bad enum, a null `spent`, a lying `abandoned`, and a short file |
| 2–4 | `breakpoint.py`, `attribution.py`, `pairwise.py` against fixtures | **Done.** 14/14 checks pass |
| 4–5 | `impact.py`, `confidence.py` | Not started — next |
| 5–6 | `build_runs.py` end to end on fixtures | Partial: structure is computed from rows, `analysis` still reshapes the oracle |
| 6–7 | Swap to B1's real `runs/` | Blocked on B1 only |

## 3. The decision that shaped everything

The plan called for fixtures that are "fake but schema-valid." We went further: **the fixtures script
the SPEC 7.1 target scenario exactly**, and the answer they should produce is written to
`tests/fixtures/expected_analysis.json`.

That file is the analyzer's test oracle. It means the analyzer was developed against a known-correct
answer rather than against plausible noise, and it gives us the thing BACKEND_PLAN 4 asks for: when
hour-6 tuning changes the numbers, the oracle is what distinguishes "the analyzer broke" from "the
simulation legitimately changed."

The canonical seed-0 baseline story the fixtures encode:

- **Day 4** — simffee opens 07:00 and the latte goes to 48k. Six twins with `usual_time` before
  07:00 are disrupted at score 1.0, source `hours`. Four switch to Starbucks, two skip.
- **Days 5–7** — T06 and T07 come back; T01, T02 and T05 stay at Starbucks; T08 keeps skipping.
- **Day 7 split** — simffee 4, starbucks 5, none 1, matching SPEC 8 exactly.
- **Lost** — T01, T02, T05, T08. T05 also leaves under `cf_null`, so 3 are ours and 1 was going anyway.

## 4. Verified results

Everything below is computed by the analyzer from fixture rows, not asserted by hand.

| Check | Result |
| --- | --- |
| Break day | 4, and the control arm does not fall with it |
| Naive read | `price` at magnitude 0.333 (`latte 45000 -> 48000`) |
| Actual driver | `hours`, histogram `{hours: 5.0, habit: 1.5, curiosity: 1.0, price: 0.5, social: 0.5}` |
| Mechanism surprise | `true` |
| Impact | 4 lost total, 3 by our decision, 1 lost anyway |
| `cf_restore_hours` | 3 of 4 return |
| `cf_discount` | 1 of 4 return |
| **Done criterion #4** | **5 of 5 seeds** give `naive=price`, `actual=hours`, break on day 4 (needs 4 of 5) |
| Determinism | Two full rebuilds are byte-identical ignoring the timestamp |
| `runs.json` size | 704 KB against a ~2 MB budget |

## 5. Three things B1 needs to know

These came out of building the fixtures. The first two are mechanism gaps in the spec, not
implementation details, and they should be settled well before the hour-6 decision point. The first
two are also recorded in `KNOWN_GAPS` in `tools/fake_runs.py`.

**`cf_null` is a frozen world.** Under SPEC 2.3, latent interest can only be acted on when habit is
suspended or when `latent > habit + 0.3`. `cf_null` has no overrides, so nothing ever disrupts
anyone, so nobody ever reappraises, so the control arm loses zero customers *by construction*. That
makes `lost_anyway` structurally always 0 and the SPEC 6.4 subtraction vacuous — which removes the
control arm the demo leans on in SPEC 5.2. The fixture works around it by giving T05 a day-6 `wait`
disruption. The engine needs some genuine source of ambient variation, or `impact.py` has nothing to
subtract.

**T10 cannot be pulled in by `cf_discount`.** Her `habit[starbucks]` of 0.867 keeps her on autopilot
every day, and disruption is only ever computed for a twin's *regular* shop, so a competitor's price
cut can never reach her. The `latent > habit + 0.3` gate would need latent above 1.167. As it stands
`cf_discount` shows no offsetting new customer, and SPEC 8's "+1 new against 3 who never return" is
unreachable. Either drop her `habit[starbucks]` below 0.6 so she reappraises daily as a genuinely
deal-driven shopper, or add a disruption source for a large price drop at a non-regular shop.

**The 48k latte is load-bearing for the naive read.** Naive scores price at 0.333 against hours at
0.300 — a margin of 0.033. SPEC 7.3 suggests dropping to 47k if the LLM leans on price too hard, but
that would put price at 0.222, flip the naive read to `hours`, and collapse the mechanism surprise
that the whole demo turns on. If 47k becomes necessary, the price coefficient in SPEC 6.2 has to rise
at the same time. Don't change one without the other.

## 6. Open items on our side

- `engine/schema.py` does not exist yet, so `validate.py` and `fake_runs.py` encode the contract from
  BACKEND_PLAN 2.1 directly. When B1 pushes it, swap the imports — `DRIVERS`, `SOURCES`, `MODES`.
- `build_runs.py` still fills `analysis` from the oracle, with `confidence` and `narration` as
  explicit nulls. Frontend should not need to change when the real analyzer lands at hour 5–6.
- The fixture's day-4 drop is 76%, against the "~40%" in SPEC 7. The spec's own day-4 sequence puts
  6 of 8 regulars out the door, so 76% is what its numbers actually imply. Worth reconciling with
  whoever owns content, though nothing depends on it — the break rule only needs 25%.

## 7. Next

Hours 4–5: `impact.py` and `confidence.py`, both against the same fixtures. Confidence is the one
with a real dependency on seed spread — the per-seed wobble on the break day is already in the
fixtures so `stability` measures something instead of being 1.0 everywhere.
