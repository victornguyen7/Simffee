# Simffee — Fix plan: getting the demo conclusion out of the engine

2026-09-20 · companion to [SPEC.md](./SPEC.md), [BACKEND_PLAN.md](./BACKEND_PLAN.md),
[B1_STATUS.md](./B1_STATUS.md), [B2_STATUS.md](./B2_STATUS.md)

This is a work order, not a status report. Everything below was measured against the
working tree as of today, which is **ahead of both status reports**: `engine/llm.py`
and `engine/cli.py` are modified, `cache/` holds 18 live responses from
`qwen/qwen3.8-27b` via Groq, `runs/` was regenerated at 01:31, and `narrate.py` now
produces real narration. `public/runs.json` is stale against `runs/` — it was built at
22:54 from the older all-offline output.

---

## 1. Where the output actually stands

Rebuilt from the current `runs/` (`python3 build_runs.py runs`), against the oracle in
`tests/fixtures/expected_analysis.json`:

| | Target | Now | |
| --- | --- | --- | --- |
| Rows valid | 1,400 | 1,400 | ok |
| Break day | 4 | 4 | ok |
| Naive read | `price` 0.333 | `price` 0.333 | ok |
| Actual driver | `hours` | `hours` (6.0, wait 2.0) | ok |
| Surprise | true | true | ok |
| Narration | 2 sentences, no invented numbers | present and clean | ok |
| Day-4 defections to Starbucks | 4 | **2, and only on seed 0** | **fail** |
| lost_total / by_decision / anyway | 4 / 3 / 1 | 6 / 6 / 0 | **fail** |
| `cf_restore_hours` | 3 of 4 | 6 of 6 | **fail** |
| `cf_discount` | 1 of 4 | 0 of 6 | **fail** |
| Day-7 split | 4 / 5 / 1 | 2 / 2 / 6 | **fail** |
| Confidence | ~0.78, honest | 0.933, stability 1.0 | **fail** |

Against BACKEND_PLAN §6: #1–#4 pass. **#5 fails** — 6/6 against 0/6 is not a comparison,
it is a tautology. **#6 fails in spirit** — 0.933 is a worse outcome than B2's earlier
honest `null`, because it now looks credible while measuring a world where nothing varies.

### The one number that matters

Baseline seed 0, day by day: `8/2/0 → 8/2/0 → 8/2/0 → 2/4/4 → 2/2/6 → 2/2/6 → 2/2/6`
(Simffee / Starbucks / skipped).

Two twins defect on day 4 and both are back to skipping by day 5. On day 7, the only
twins at Starbucks are T09 and T10, who were already there on day 1. **No twin in the
entire simulation is ever pulled from Simffee to Starbucks and stays there.** SPEC §1
says simulation must beat static analysis; the current output concludes *"we closed, so
people didn't buy coffee,"* which is exactly the static-analysis answer.

---

## 2. Root cause: the options block is a veto list

Day-4 reappraisals on seed 0 — the only seed with live model output — split perfectly
along one line:

| Twin | Starbucks over budget? | Over wait tolerance? | latent | Choice |
| --- | --- | --- | --- | --- |
| T02 Hà | no (65k ≤ 70k) | no (7 ≤ 8) | 0.60 | **starbucks** |
| T06 Đức | no (65k ≤ 80k) | no (7 ≤ 8) | 0.46 | **starbucks** |
| T01 Minh | **yes** (65k > 60k) | **yes** (7 > 6) | 0.55 | none |
| T05 Ngọc | no (65k ≤ 70k) | **yes** (7 > 5) | 0.68 | none |
| T07 Vy | **yes** (65k > 55k) | **yes** (7 > 6) | 0.25 | none |
| T08 Mai | **yes** (65k > 60k) | no (7 ≤ 7) | 0.23 | none |

**Every twin with zero constraint flags defected. Every twin with one or more flags
skipped. `latent_interest` did not discriminate at all** — T05 has the highest latent
interest in the town (0.68) and still skipped, on a single wait-tolerance flag.

The mechanism is in `engine/prompt.py:113-138`. Each option is rendered with hard
parenthetical flags — `(over your daily budget)` at line 121, `(further than you usually
walk)` at line 119 — while `latent_interest` is rendered as soft prose by
`_latent_in_words` (line 60): *"you have been meaning to try Starbucks for a while."* A
model told to role-play a real, time-pressured person will take one hard constraint over
one soft nudge every time. The cached reasonings say so almost verbatim:

> *"Simffee is closed. Starbucks is over budget, too far, and the wait is too long. I skip it."*
> *"Simffee is shut and Starbucks violates my 5-minute limit. I won't wait for coffee at 6:30 AM."*

Sixteen of eighteen cached responses chose `none`.

Two aggravating factors in the same block:

- **`- **Skip it**: no coffee today.`** (line 138) is presented as a frictionless peer
  option. Every shop carries an itemised list of costs; skipping carries none. The prompt
  is structurally biased toward skipping.
- The flags fire against the **day-1 anchored expectation** (B1_STATUS §2 item 3), so they
  describe a normal morning. On a morning when your usual place is shut, your budget and
  patience are exactly the things that stretch. Nothing tells the model that.

No walk-tolerance flag is actually firing today — every twin's Starbucks distance is
within their `walk_tolerance`. The model says *"too far"* on its own, from the raw
`5 blocks away` string.

---

## 3. Root cause: stability divides by the wrong denominator

`analyzer/confidence.py:54` — `scores[twin] = top / len(usable)`, where `usable` excludes
`llm_failed` rows per SPEC 4.3.

Only seed 0 has live model output. Seeds 1–4 are 100% fallback on day 4. So for T02:
seed 0 says `starbucks`, seeds 1–4 say `none`, but four of those five rows are dropped as
fallbacks, leaving one row, which agrees with itself. `1/1 = 1.0`.

**Stability 1.0 is currently reporting perfect agreement across a set of one.** B2's
`unmeasured` guard (§6 of B2_STATUS) was the right instinct but only fires when a twin has
*zero* usable rows — it does not fire at one. The headline confidence of 0.933 is the most
misleading number in the build, and SPEC 6.5 exists specifically to prevent it.

---

## 4. Root cause: the control arm is a straight line

`data/scenarios/cf_null.json` has `"overrides": []`. Measured: **0 reappraisals in 350
rows**. No overrides → no disruption → nobody ever deliberates → `lost_anyway` is 0 *by
construction*, and the SPEC 6.4 subtraction is arithmetic on nothing.

SPEC §5.2 calls `cf_null` "the most important scenario and the easiest to forget." It is
currently the easiest to forget. The fixture already models the fix: a day-6 `wait`
disruption on T05.

---

## 5. The fixes, in dependency order

Each step's cache invalidation is noted, because every change to `data/` invalidates every
cached response for the days after it (B1_STATUS §2 warning). Do 5.1 through 5.4 in one
pass, then spend once.

### 5.1 Decide the gossip roll — first, before any spend

Still open from B1_STATUS §2 item 1. Per-neighbour vs one-roll-per-twin changes the random
stream, changes `state_before`, changes the cache key, invalidates everything. The spec
says per-neighbour; B1 recommends changing the code to match. **Do it now or declare it
won't change.** Cost of deciding late: the entire cache.

### 5.2 Stop the options block from reading as a veto list

`engine/prompt.py`. Three edits, no data changes:

1. **Make the flags proportionate.** Replace `(over your daily budget)` with the actual
   gap — `(20,000d more than you'd normally spend on coffee)` — and drop the
   walk-tolerance flag entirely, since it never fires. A stated magnitude can be weighed;
   a flag can only be obeyed.
2. **Price the skip.** Change line 138 from `- **Skip it**: no coffee today.` to something
   that carries its own cost, e.g. `- **Skip it**: no coffee at all today, and you have
   [the twin's routine] ahead of you.` The option list should be symmetric in framing.
3. **Give latent interest a magnitude.** `_latent_in_words` currently tops out at *"you
   have been meaning to try it for a while"* for anything ≥ 0.4, so 0.46 and 0.68 read
   identically — which is exactly why T05 and T06 behaved the same way despite a 0.22
   gap. Add a tier above ~0.55 with real pull, and state *why* the interest exists (the
   neighbour who praised it, the ad they saw), since that is what makes it weighable
   against a concrete cost.

Also worth adding to the **This morning** block: an explicit line that the usual place
cannot serve them today, so the decision is between an alternative and nothing — not
between an alternative and the usual.

*Invalidates: every cached reappraisal (the prompt text is not in the cache key, but the
responses were produced by the old prompt and would be silently reused). Clear `cache/`
when this lands.*

### 5.3 Fix the four twins the spec names as switchers

`data/twins/`. The goal is that T01, T02, T05, T06 can all plausibly reach Starbucks on a
shut-out morning, and that T07/T08 still can't. Minimum viable set:

| Twin | Change | Why |
| --- | --- | --- |
| T01 | `daily_budget_vnd` 60,000 → 70,000 | Removes the budget veto; SPEC §8 casts him as the lead switcher and the day-4 evidence card |
| T01 | `wait_tolerance_min` 6 → 8 | Removes the second veto. With both gone he matches the T02/T06 profile that already defects |
| T05 | `wait_tolerance_min` 5 → 8 | Her only flag. Highest latent in town (0.68) and she still skips — she is the clearest evidence the mechanism isn't reachable |
| T07 | leave as is | She *should* skip on day 4; SPEC §8 has her switching then returning, but the oracle only needs her not lost |
| T08 | leave as is | She must skip. Budget flag + low latent is exactly the intended outcome |

Alternative to touching five numbers: drop `starbucks.avg_wait_min` from 7 to 5 in
`data/shops.json`, which clears T01, T05 and T07 in one edit. Cheaper, but it also weakens
the `wait` disruption source and makes Starbucks globally more attractive, including to
T09/T10. Prefer the per-twin edits.

**Do not touch T07/T08's `latent_interest` or `ad_sensitivity` in the same pass without
re-checking the 0.20 skip gate** — B1_STATUS §5 and B2_STATUS §5 both flag that they drift
across it by day 4 (T07 0.20, T08 0.21 against a floor of 0.20 in
`engine/schema.py:17`). Measured today: T07 0.25, T08 0.23 on day 4, so **neither is
hitting the deterministic skip gate at `engine/decide.py:176` any more** — they are
skipping via the model, not via the rule. If T08 is to remain the *"same shock, no switch"*
evidence card on the strength of the rule rather than a model whim, lower her
`ad_sensitivity` from 0.05 until day-4 latent lands under 0.20.

*Invalidates: days 4–7 of every scenario for the twins touched.*

### 5.4 Give `cf_null` something to control for

`data/scenarios/cf_null.json`. Add ambient variation that has nothing to do with the
decision under test — the fixture's choice is a day-6 `wait` spike, which is realistic and
already has an analyzer path:

```json
{"from_day": 6, "shop": "simffee", "set": {"avg_wait_min": 12}}
```

Target: `cf_null` loses exactly 1 customer, so `lost_total` 4 / `lost_by_decision` 3 /
`lost_anyway` 1, and the SPEC §5.2 faint line on the chart means something.

Note this makes `cf_null` no longer a literal "changed nothing" world. That is the point —
it is the control arm, not the null world. Update the `description` field and SPEC §5.2
wording in the same commit.

*Invalidates: `cf_null` days 6–7 only.*

### 5.5 Make stability refuse a sample of one

`analyzer/confidence.py`. Add a minimum-usable-seeds guard alongside the existing
zero-rows guard:

```python
MIN_SEEDS_FOR_STABILITY = 3

if len(usable) < MIN_SEEDS_FOR_STABILITY:
    unmeasured.append(twin)
    continue
```

and surface the count in the `reason` string, e.g. *"3 of 10 twins measurable; 7 had fewer
than 3 usable seeds."* A `low_confidence` label on a real number is not the same signal as
*"we did not sample this enough to say."* Add a regression test next to the existing one in
`tests/test_analyzer.py`: one twin with one usable seed must come back `unmeasured`, not
1.0.

This one is independent of everything else and can land now.

### 5.6 Finish the live run

Only after 5.1–5.4. Today's `cache/` holds 18 responses against ~300 reappraisals — 96 of
120 baseline reappraisals fell back, and seeds 1–4 have no live data at all. The run was
interrupted, and none of the seed-to-seed variance SPEC 6.5 needs exists yet.

Sequence: clear `cache/`, run `--scenario baseline --seeds 0-4`, check the day-4 split
before spending on the counterfactuals, then run the three `cf_*` scenarios. B1_STATUS §6
measures ~900 input / ~60 output tokens per call, so the full 20 runs stay well under $1
even with an empty cache.

Then: rebuild `public/runs.json`, re-run `tools/validate.py`, and commit `cache/` —
SPEC §10.4 calls it the demo, and it is still untracked (`git status` shows `?? cache/`).

---

## 6. Acceptance

The build is done when, from a clean clone with no API key:

1. `python3 build_runs.py` reproduces `public/runs.json` from committed `cache/`.
2. Day-4 baseline shows **4 twins at Starbucks**, 2 skipping, in ≥ 4 of 5 seeds.
3. Day 7 shows a split near 4 / 5 / 1 — specifically, at least 3 twins who started at
   Simffee are at Starbucks and stay there.
4. `whatif` reads `cf_restore_hours` 3 of 4 against `cf_discount` 1 of 4, or any pair
   where both numbers are non-trivial and restore-hours wins by ≥ 2.
5. `impact.lost_anyway ≥ 1`, so the control arm subtracts something.
6. `confidence.stability` is computed from ≥ 3 usable seeds per measured twin, and the
   headline `value` lands between 0.5 and 0.9. Above 0.9 on this scenario means something
   collapsed again.

## 7. Housekeeping still open from the status reports

Not blocking, but they are the cheapest items in the repo and both status reports ask
for them:

- **Stale file trees** — SPEC §10.4 and BACKEND_PLAN §3 still list `engine/reappraise.py`
  and `engine/autopilot.py` (actually `decide.py`, `prompt.py`, `llm.py`) and `web/`
  (actually repo root). B1_STATUS §4 has the table; apply it.
- **The eight spec gaps** in B1_STATUS §2 — seven of the eight are "change the spec," and
  they are one editing pass.
- **SPEC 4.3 names no model.** The code now pins a Groq model, not the `claude-haiku-4-5`
  B1_STATUS §3 describes. Whichever it is, write it down, along with the fact that
  `temperature` moves through `extra_body`.
- **`=0.5.0`** in the repo root is a stray pip log from a shell redirect. Delete it.
- **T10 is unreachable by `cf_discount`** (B2_STATUS §5): disruption is only computed for a
  twin's own regular shop, so a competitor's price cut can never reach a Starbucks
  regular. SPEC §8's "+1 new customer" is unreachable as written — either cut the claim or
  add a cross-shop attention rule.
