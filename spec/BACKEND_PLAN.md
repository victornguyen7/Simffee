# Simffee — Backend Dev Plan (2 people)

Companion to [SPEC.md](./SPEC.md). Covers the two backend seats only. Frontend is a third person
working independently against one contract: `public/runs.json`. They own everything in `src/` and
`index.html`; nobody on backend touches those files.

Stack: **Python 3.11+**, stdlib only except the LLM SDK. No database, no server. The backend is a
batch job that turns `/data` into one cached `public/runs.json`.

---

## 1. The split

The seam is the **trajectory row** (SPEC 3.4). B1 produces rows, B2 consumes rows. Neither reads the
other's code.

| | **B1 — Simulation engine** | **B2 — Analyzer + build pipeline** |
| --- | --- | --- |
| Owns | `engine/` | `analyzer/`, `build_runs.py`, `tools/` |
| Produces | `runs/{scenario}/{seed}.jsonl`, `runs/{scenario}/{seed}/state_day{d}.json` | `public/runs.json` |
| Consumes | `data/` | `runs/` |
| Core risk | LLM output quality, scenario tuning | nothing — pure arithmetic, testable from hour 0 |

**B2 is never blocked on B1.** B2's first task is a fixture generator that emits fake but
schema-valid trajectories, so the analyzer and `runs.json` can be built and tested before the
engine produces a single real row. When B1 lands, B2 swaps the input directory. That one decision
is what makes this parallel instead of sequential.

---

## 2. Frozen contracts — agree on these in the first 15 minutes, then don't change them

Write them down as `engine/schema.py` (B1) and have B2 import it. If a contract must change, it
changes in one commit that touches both sides, announced out loud.

### 2.1 Trajectory row — `runs/{scenario}/{seed}.jsonl`, one JSON object per line

Exactly SPEC 3.4. Non-negotiable fields, with the additions the spec implies but doesn't list:

```json
{
  "scenario": "baseline", "seed": 2, "day": 4, "twin": "T01",
  "mode": "autopilot | reappraisal",
  "disruption": {"score": 1.0, "source": "hours | price | product | wait | closed | none"},
  "state_before": {"habit": {"simffee": 0.82, "starbucks": 0.08},
                   "latent_interest": {"starbucks": 0.41}},
  "choice": "simffee | starbucks | none",
  "spent": 65000, "abandoned": false,
  "primary_driver": "habit|hours|price|distance|wait|product|curiosity|social|quality",
  "secondary_driver": "<same enum, or null>",
  "valence": 0.4,
  "reasoning": "<= 40 words, first person",
  "state_after": {"habit": {...}, "latent_interest": {...}},
  "told": ["T02"],
  "llm_failed": false
}
```

Rules B2 depends on and B1 must guarantee:
- Every twin appears exactly once per day. 10 twins x 7 days = 70 rows per file, always.
- `spent` is `0` when `choice == "none"`. Never null.
- `secondary_driver` may be null; `primary_driver` never is.
- `llm_failed: true` rows still appear, still have a valid `choice` (autopilot fallback), and are
  **excluded by B2 from stability** (SPEC 4.3).
- Rows are ordered by day, then twin id.

### 2.2 State snapshot — `runs/{scenario}/{seed}/state_day{d}.json`

```json
{"day": 4, "habit": {"T01": {"simffee": 0.78, "starbucks": 0.22}, ...},
 "latent_interest": {"T01": {"starbucks": 0.0}, ...},
 "inbox": {"T01": [{"from": "T02", "shop": "starbucks", "valence": 0.4}], ...},
 "rng_state": "<opaque>"}
```

B1 writes one after every day of every scenario/seed. `cf_*` forks read `from_day - 1` (SPEC 5.1).
`rng_state` is what makes the fork share the parent's random stream — B1 owns its format, B2 never
reads it.

### 2.3 Frontend contract — `public/runs.json`

B2 owns this file and **publishes a hand-written fake version in the first hour** so frontend can
start. Shape:

```json
{
  "meta": {"twins": 10, "days": 7, "seeds": [0,1,2,3,4], "default_seed": 0,
           "generated_at": "...", "synthetic_label": "Synthetic seed population — ..."},
  "shops": { ...data/shops.json verbatim... },
  "twins": [{ "id": "T01", "name": "Minh", "home": [0,1], "profile": {...},
              "why_excerpt": [ 3 q/a pairs ], "say_do_gap": null }],
  "scenarios": {
    "baseline": {"label": "...", "parent": null, "from_day": 1,
                 "seeds": {"0": {"rows": [ ...trajectory rows... ],
                                 "daily_sales": {"simffee": [..7..], "starbucks": [..7..]}}}},
    "cf_null": {...}, "cf_discount": {...}, "cf_restore_hours": {...}
  },
  "analysis": {
    "break_day": 4,
    "naive": {"driver": "price", "magnitude": 0.33, "label": "Price +3k"},
    "actual": {"driver": "hours", "histogram": {"hours": 3.5, "curiosity": 2.0}},
    "surprise": true,
    "impact": {"lost_total": 4, "lost_by_decision": 3, "lost_anyway": 1,
               "per_twin": [{"twin":"T07","baseline":"starbucks","cf_null":"simffee"}]},
    "evidence": [{"twin":"T01","day":4,"kind":"switcher", ...full row...},
                 {"twin":"T08","day":4,"kind":"resisted", ...full row...}],
    "confidence": {"value": 0.78, "stability": 0.82, "support": 0.69},
    "narration": "two sentences",
    "whatif": [{"scenario":"cf_restore_hours","label":"Reopen at 06:30",
                "returns": 3, "of": 4, "confidence": 0.74},
               {"scenario":"cf_discount","label":"Cut prices 15%", "returns": 1, "of": 4,
                "confidence": 0.71}]
  }
}
```

Frontend reads only this. It never learns that `runs/` or `cache/` exist.

---

## 3. B1 — Simulation engine

```
engine/
  schema.py        # dataclasses + enums, the shared contract. Written first, imported by B2.
  loader.py        # read data/twins/*.json, shops.json, scenarios/*.json; validate on load
  resolve.py       # SPEC 3.3 — parent overrides then child, ordered by from_day, dotted keys
  disruption.py    # SPEC 2.2 — the 5-source table, max() not sum
  habit.py         # SPEC 2.1 — alpha 0.15, delta 0.05; plus the argmax "current shop" helper
  gossip.py        # SPEC 2.4 — own Random(seed), one-day lag via inbox
  autopilot.py     # SPEC 4.2 incl. the T08 rule: reappraisal + max(latent) < 0.2 + source == hours -> none
  reappraise.py    # SPEC 4.3 — prompt assembly, JSON validation, retry, fallback
  cache.py         # SPEC 10.1 — sha1 key, cache/{key}.json
  loop.py          # SPEC 4.1 — run(scenario, seed, start_day, state) -> writes jsonl + snapshots
  cli.py           # python -m engine.cli --scenario baseline --seeds 0-4
```

### Milestones

| Hour | Deliverable | Done when |
| --- | --- | --- |
| 0–0.25 | `schema.py` committed and pushed | B2 can import it |
| 0–2 | loader, resolve, disruption, habit, gossip, loop with **stub reappraisal** (always picks the regular shop, `mode: reappraisal`, `primary_driver: habit`) | `python -m engine.cli --scenario baseline --seed 0` writes 70 valid rows, no LLM key needed |
| 2–4 | `reappraise.py` + `cache.py` | Baseline seed 0 runs with real LLM calls; a second run makes 0 API calls |
| 4–6 | 5 seeds of baseline + tuning with content owner | Day-4 break appears via `hours` in >= 4 of 5 seeds |
| 6–8 | Snapshot/fork; `cf_null`, `cf_discount`, `cf_restore_hours` x 5 seeds | 4 scenarios x 5 seeds in `runs/`, `cache/` committed |
| 8+ | Support B2's tuning requests; then SPEC 5.4 live what-if endpoint **only if** everything else is green | — |

### Rules for B1
- **Run the stub path in CI-style before adding the LLM.** An all-autopilot 7-day run that produces
  valid rows is the single most valuable early artifact — it unblocks B2's real integration.
- Determinism is a hard requirement: twin order fixed by id, gossip uses its own `Random(seed)`,
  never the global `random`. Two runs of the same seed with a warm cache must be byte-identical.
  Add `tools/check_determinism.sh` that runs seed 0 twice and diffs.
- `cache/` is **committed** (SPEC 10.4). `runs/` is gitignored.
- Never edit `data/` numbers alone — tuning is a joint call with whoever owns content, because
  every change invalidates cache for the days after it.

---

## 4. B2 — Analyzer + build pipeline

```
analyzer/
  breakpoint.py    # SPEC 6.1 — first day >= 25% below trailing 3-day avg AND cf_null doesn't drop
  attribution.py   # SPEC 6.2 — naive magnitude table vs switcher driver histogram (secondary @ 0.5)
  impact.py        # SPEC 6.4 — twin-by-twin baseline minus cf_null
  pairwise.py      # SPEC 5.3 — per-twin choice_A vs choice_B from from_day onward -> returns/of
  confidence.py    # SPEC 6.5 — 0.7*stability + 0.3*support, keyword match against why_transcript
  narrate.py       # SPEC 6.6 — the one LLM call; forbidden to introduce a number
build_runs.py      # runs/ + data/ -> public/runs.json
tools/
  fake_runs.py     # fixture generator: schema-valid fake trajectories (B2's unblocker)
  validate.py      # asserts every row against schema.py; run on B1's real output
```

### Milestones

| Hour | Deliverable | Done when |
| --- | --- | --- |
| 0–1 | `tools/fake_runs.py` + a hand-shaped `public/runs.json` | **Frontend is unblocked.** Announce it in chat. |
| 1–2 | `tools/validate.py` | Catches a missing field, a bad enum, a wrong row count |
| 2–4 | `breakpoint.py`, `attribution.py`, `pairwise.py` against fixtures | Fixtures designed to produce a known day-4 break give `naive=price, actual=hours` |
| 4–5 | `impact.py`, `confidence.py` | Hand-computed fixture matches to 2 decimals |
| 5–6 | `build_runs.py` end to end on fixtures | `public/runs.json` matches 2.3 exactly; frontend re-points at it with no code change |
| 6–7 | Swap to B1's real `runs/`; run `validate.py` | Real data flows through with zero analyzer edits |
| 7–9 | `narrate.py` + confidence tooltip fields + regenerate | Real `runs.json` with all 4 scenarios and narration |
| 9+ | Whatever the frontend is missing; `PROTOCOL.md` (SPEC 7.5) | — |

### Rules for B2
- **Never let an LLM produce a number.** `narrate.py` receives computed JSON and returns prose; its
  prompt forbids citing any number not present in the input. Assert this: reject the narration if it
  contains a digit sequence not found in the input JSON, and retry once.
- Every analyzer function is `(rows, ...) -> dict`. No file IO inside them — `build_runs.py` does
  all reading and writing. This is what makes them testable against fixtures.
- Fixtures are committed under `tests/fixtures/` and stay in the repo after real data lands. If
  tuning changes the numbers at hour 6, fixtures are what tells you whether the analyzer broke or
  the simulation changed.
- `runs.json` must stay under ~2MB. 4 scenarios x 5 seeds x 70 rows is fine; if `reasoning` strings
  push it over, ship all seeds for `baseline` and seed 0 only for the `cf_*` branches.

---

## 5. Joint checkpoints

| When | What | Who |
| --- | --- | --- |
| Hour 0.25 | `schema.py` frozen; fake `runs.json` published to frontend | B1 + B2 |
| Hour 2 | B1's stub run produces 70 rows; B2 runs `validate.py` on them | both, 10 min |
| Hour 6 | **Decision point (SPEC 10.3).** If the day-4 break still isn't firing through `hours` after 3 tuning rounds: drop the 3k price increase, keep only the hours change, naive read becomes marketing reach. Subtract, don't add. | both + content |
| Hour 9 | Real `runs.json` handed to frontend, final | B2 |
| Hour 11 | Backup video recorded against the cached build | whole team |

## 6. Definition of done (backend)

1. `git clone` + `python build_runs.py` reproduces `public/runs.json` with **no API key**, from
   committed `cache/`.
2. Seed 0 run twice is byte-identical.
3. `tools/validate.py` passes on all 4 scenarios x 5 seeds.
4. `analysis.surprise == true` with `naive == "price"` and `actual == "hours"` in >= 4 of 5 seeds.
5. `whatif` shows restore-hours strictly greater than discount (target 3/4 vs 1/4).
6. `confidence.value >= 0.5` on the headline conclusion, or the UI labels it low-confidence.

## 7. Known risks

| Risk | Owner | Mitigation |
| --- | --- | --- |
| LLM writes `primary_driver: price` too often, killing the surprise | B1 | Drop latte to 47k (SPEC 7.3); tighten the system prompt's "real reason, not flattering reason" clause |
| Tuning at hour 6 invalidates B2's finished analyzer output | B2 | Fixtures pinned in `tests/`; `build_runs.py` is a one-command regenerate |
| B2 idles waiting for the engine | B2 | `fake_runs.py` at hour 1 — this is the whole reason it exists |
| Fork doesn't actually share the parent's random stream, so branches differ for the wrong reason | B1 | `rng_state` in the snapshot; assert `cf_null` days 1–3 are identical to baseline days 1–3 |
| Frontend blocked on schema churn | both | `runs.json` shape frozen at hour 1; additive changes only |
