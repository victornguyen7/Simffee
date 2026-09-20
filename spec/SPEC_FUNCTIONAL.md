# Simffee — Spec: functional backend (open-ended what-ifs)

2026-09-20 · branch `version-1-functional` · builds on [SPEC.md](./SPEC.md) (v1, the floor) and
takes from *Spec v2: Starbucks mở cạnh bên, crowd 500* what makes the backend general. v2 items
are marked **[v2]**; deferred v2 items are listed in §10 with the reason.

## 1. What changes and what does not

v1 proved the mechanism on real model output (3 seeds, 0 fallbacks, surprise in 3/3, confidence
0.89). It did so on **four scenarios whose names are baked into `build_runs.py`, the analyzer's
naive-read table, and the frontend.** The engine is already general — scenarios are JSON overrides,
and `engine/` contains no shop name outside one print line in `cli.py`.

This spec makes the rest of the stack match the engine: **any override on any shop on any day,
described in plain language, simulated live, analysed by the same rules.** The four v1 scenarios
become the first four entries in a library, not the definition of the product.

Non-negotiables, carried from v1 and v2:

- Every number on screen is computed by the engine or the analyzer from state. The LLM decides
  as a person and translates a request; it never produces an analysis number.
- **[v2]** No rule in the engine or analyzer may contain a shop id. A shop is its fields. Test:
  rename both shops in `data/` and every test still passes.
- `runs.json` and the row contract change additively. The version-1 frontend renders v3 output
  with zero edits.
- Strict gates stay: a fallback row suppresses analysis; provenance on every row; deterministic
  narration; `publishable` is mechanical, not a claim of calibration.
- Determinism: same inputs, same seed, byte-identical trajectories.
- The synthetic label on every screen; the translator's output shown next to every answer.

| Quantity | v1 | functional |
| --- | --- | --- |
| Scenarios | 4 files | any override JSON; library of cached ones + live |
| Who writes a scenario | a developer | a judge, in a sentence |
| Shops | 2, both present all week | any number present all run; entry/exit deferred (§10) |
| Days | 7 fixed | `days` per scenario, default 7 **[v2]** |
| Analyzer target shop | `SHOP = "simffee"` | `focus_shop` from the scenario or the request |
| Break detection | drop only | drop or rise |
| Naive-read table | 4 override kinds | every overridable field |
| Live path | none | `POST /whatif` → ~15 calls → answer in <30 s |
| Live-run cost proof | none | ledger row per run (COST_PLAN) |

## 2. Scenario schema — additive extensions

The v1 shape stays valid. New optional keys:

```json
{
  "id": "user_20260920_183012",
  "label": "Open at 06:00 and add a morning pastry",
  "parent": "baseline",
  "days": 7,
  "focus_shop": "simffee",
  "source": {"kind": "user", "text": "what if we open an hour earlier and sell croissants?",
             "translator_model": "qwen/qwen3.8-27b", "translated_at": "..."},
  "overrides": [
    {"from_day": 5, "shop": "simffee", "set": {"open": "06:00"}},
    {"from_day": 5, "shop": "simffee", "set": {"products": ["latte","americano","cold_brew","croissant"],
                                               "price.croissant": 30000}},
    {"from_day": 5, "shop": "starbucks", "unset": ["marketing.reach"]}
  ]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `days` **[v2]** | 7 | Run length. Forks inherit the parent's if absent |
| `focus_shop` | first shop in `shops.json` | The shop whose sales the analyzer watches and whose customers "lost/returned" refer to |
| `source` | `{"kind": "authored"}` | Where the scenario came from. `user` scenarios carry the original text and the translator model so the UI can show *"you asked → we simulated"* |
| `overrides[].unset` **[v2]** | — | Restore the base `shops.json` value for these dotted keys. Lets a fork *remove* a parent's change (v2's `v2_null`: keep the entrant, drop the hours shift) |
| `prompt.shop_label.<id>` **[v2]** | `shops[id].name` | Text the LLM sees for a shop. Engine, cache ids, analyzer never see it. Exists for the brand-prior test (§8) |

Overridable fields, the closed list the translator may target: `open`, `close`, `price.<item>`,
`products`, `avg_wait_min`, `quality`, `marketing.reach`, `marketing.message`,
`permanently_closed`. Anything else is rejected at validation.

## 3. Disruption sources

v1's five (`hours`, `price`, `product`, `wait`, `closed`) stay as written. **Nothing is added.**
Decision (2026-09-20): hold the line at five. A judge asking *"what if a competitor opens"* gets
`unsupported` with the reason *"the model has no competitor-entry mechanism yet"* — an honest
answer, and the same sentence the strategy doc's Direction A would need a real build to change.
v2's `new_entrant` / `exists_from_day` are in §10 as deferred, schema slot reserved.

Not added either: a generic LLM-estimated shock. A shock the analyzer cannot attribute is a shock
the demo cannot explain.

## 4. The translator — `engine/translate.py`

One LLM call. Input: free text + the current `shops.json` + the closed field list + the day
range. Output: a scenario JSON per §2, strict JSON mode, validated locally before anything runs.

Rules:
- Output schema is the override schema. The model chooses `shop`, `from_day`, and values from
  enumerated options; it invents nothing outside the field list.
- `from_day` defaults to the parent's `from_day + 1` (the morning after the break), never earlier
  than day 2.
- `label` ≤ 8 words, `focus_shop` inferred ("we/our" → the first shop; a named shop → that shop).
- If the request cannot be expressed in the field list, return `{"unsupported": true,
  "reason": "...", "nearest": <a scenario it *can* run, or null>}`. The UI shows the reason.
  Saying no is a feature.
- Validation rejects: unknown shop, unknown field, `from_day` outside `[2, days]`, a price
  outside `[0.3×, 3×]` of the base, more than 4 overrides. Rejected → one retry at lower
  temperature with the validator's message appended → then `unsupported`.
- The translation is cached by `sha1(text, shops, field_list, model)`. Same question twice, same
  scenario, zero calls.
- **Every answer shows the JSON.** The chip under the result reads *"Simulated: Simffee open
  06:00 from day 5; croissant added at 30k."* The judge sees what was run, not what they typed.

Cost: ~600 in / ~150 out tokens. One call.

## 5. The live path — `api/server.py`

Stdlib `http.server`, one process, on the demo laptop, key from `.env`. No GPU: the engine is
arithmetic; the model runs at Groq.

```
POST /whatif      {"text": "...", "parent": "baseline", "seed": 0}
  → 200 {"scenario": {...§2...}, "run_id": "...", "rows": [...], "daily_sales": {...},
         "analysis": {...same shape as runs.json analysis, single seed...},
         "cost": {"calls": 14, "cache_hits": 6, "tokens_in": 15200, "tokens_out": 1100, "took_ms": 31400},
         "fallback_used": false}
  → 200 {"scenario": {"unsupported": true, ...}}
  → 200 {..., "fallback_used": true, "served": "cf_restore_hours", "reason": "timeout"}
GET  /library     → cached scenarios (the v1 four + every user scenario run so far)
GET  /health      → {"llm": true, "cache_dir": "...", "model": "..."}
```

Flow per request: translate → validate → fork from `parent`'s `state_day{from_day−1}` snapshot
(never re-run days 1–4) → run 1 seed → `index_runs`-style validation → analyzer on
`(parent, child)` → return. Snapshot-forking is what keeps it to ~12–15 calls (days 5–7, 6
reappraisers). At 2.2 s pacing that is ~30 s; at a paid-tier interval of 0.5 s, ~8 s.

Single-seed answers are labeled so: `analysis.confidence` is `unmeasured` with reason
*"one seed — run 3 for confidence"*, and a button offers exactly that (≈ +30 calls).

Fallback: if translate or run fails or exceeds `timeout_s` (default 45), serve the nearest
library scenario by override-field overlap, with `fallback_used: true` and the reason. The UI
says *"live run unavailable — showing the closest cached scenario"*. Never silently.

Everything the server writes goes under `runs/live/{run_id}/`; nothing touches `public/`.

## 6. Analyzer generalization

v1 functions keep their signatures and tests. Changes are parameterization, not new math.

| Module | v1 | Functional |
| --- | --- | --- |
| `build_runs.py` | `SHOP = "simffee"`, `SCENARIO_LABELS` dict, `WHATIF_ORDER` list, requires 4 named scenarios × 5 seeds | `focus_shop` from scenario; labels from scenario files; any set of scenarios; `--seeds` accepted (3 is the confidence floor; 1 is allowed with `unmeasured`); control arm = the scenario with `role: "control"` or `cf_null` if present |
| `breakpoint.find_break` | first day ≥ 25 % *below* trailing avg, control does not fall | direction-agnostic: `|Δ| ≥ 25 %` and control does not move the same way; returns `direction: "drop" \| "rise"`. A competitor closing produces a rise; the surprise logic still applies |
| `attribution.naive_read` | 4 override kinds | every field in §2's list has a magnitude: `price` Δ%×5, `open/close` 0.3, `products` removed 0.5 / added 0.2, `avg_wait_min` Δmin×0.05, `quality` Δ×2, `marketing.reach` Δ, `permanently_closed` 1.0. Coefficients in `data/naive_weights.json`, not code |
| `attribution.actual_driver` | unchanged | unchanged — it counts `primary_driver`, which is already scenario-agnostic |
| `impact`, `pairwise` | shop passed in | unchanged; `focus_shop` threaded through |
| `confidence` | unchanged | unchanged; `whatif_confidence` already takes the branch |
| **`flows.py` [v2], generalized** | — | For `focus_shop` vs each other shop, per day: `lost_to[s]`, `gained_from[s]`, `returned`, `net`. v2's `stolen/activated/spillover` are the two-shop special case with a dormant population; the generic form works for two shops without dormant agents today and extends when §10's crowd lands |
| **`money.py` [v2 §7.5]** | — | `data/economics.json`: `avg_ticket`, `visits_per_year_regular`, labeled *assumption*. Per what-if: `regulars_at_stake × ticket × visits` and, for a price override, annualized revenue given up. The two numbers under each button |
| `narrate` | deterministic, two sentences | unchanged; the sentence template takes `direction` and `focus_shop.name` |

Test: `tests/test_generic.py` runs the whole analyzer on the fixtures **with both shops renamed**
(`shop_a`, `shop_b`) and on a synthetic three-shop fixture. Same numbers, no exceptions.

## 7. Frontend contract (additive)

`runs.json` gains:

```json
"meta": {"version": 3, "focus_shop": "simffee", "live": {"endpoint": "http://localhost:8765", "enabled": true}},
"scenarios": {"<id>": {"label": "...", "parent": "...", "from_day": 5, "days": 7,
                       "source": {...}, "overrides": [...], "seeds": {...}}},
"analysis": {"...v1...", "direction": "drop", "flows": {...}, "money": {...}}
```

The 54 hardcoded references in `src/` to `simffee|starbucks|cf_*` become lookups on
`meta.focus_shop`, `shops`, and `scenarios[*].label`. The what-if panel renders one button per
scenario in `scenarios` with `parent != null`, plus the text box that hits `/whatif`. Each
answer shows the override chip and, if `fallback_used`, the notice.

## 8. Proof that the mechanism, not the brand, is doing the work — [v2 §11.2]

`prompt.shop_label` makes this a scenario, not a special mode: `abl_rename` = baseline with
`{"shop":"starbucks","set":{"prompt.shop_label":"Shop B"}}`. Run seed 0–2; report
`hero_agreement` = fraction of (day, twin) hero choices equal to baseline's. ≥ 0.9: *"renaming
the competitor changes X % of decisions — the mechanism drives."* < 0.8: lead with that finding.
Either ships. ~60 calls. It is the credibility of the whole LLM layer and costs nothing to keep.

## 9. Cost and evidence, per run

Every run — library or live — writes a ledger row (COST_PLAN §2): calls, cache hits, tokens,
`decision_source` histogram, model. `/whatif` returns it; the UI shows *"this answer: 14
decisions reasoned, 56 on habit, 31 s"*. The habit-gating story becomes visible on every
question a judge asks, not on one slide.

## 10. Taken from v2, deferred from v2

| v2 item | Decision | Why |
| --- | --- | --- |
| `unset`, `days`, `shop_label`, no-shop-id rule, flows, money, rename test, additive `runs.json` | **Taken** (§2, §6, §8) | Each is small, generic, and makes more judge questions answerable or more answers defensible |
| `exists_from_day`, `new_entrant` | **Deferred — decision: hold at 5 sources** | Competitor entry is a sixth mechanism, not a new value of an existing one. Translator returns `unsupported` with that reason. Schema slot reserved on `shops.<id>` |
| `category_interest`, dormant state, T11–T13 non-drinkers | **Deferred** | This is the demand-increasing channel. It needs new twins, a new gate, and only shows up with a population; without the crowd it is 3 agents. Schema slot reserved: `mechanism.category_interest` default 1.0 |
| Crowd 500 logit, 20×20 grid, one network | **Deferred, designed for** | Biggest build in v2 (2–5 h B1 + calibration). `flows.py` is written so crowd choice strings plug in. Also the same logit is COST_PLAN's C1 distillation — build it once for both |
| Ablations `abl_reach`, `abl_nogossip`, `abl_far` | **Free once §2 lands** | They are scenarios. Run them when there is budget; no code |
| Sweep over populations | **Deferred with the crowd** | Needs populations |
| 21-day default | **Not taken** | `days` is per scenario; 7 stays the default until a scenario needs more |

## 11. Build order

Hours from now on `version-1-functional`. Each row leaves a working demo.

| # | Step | Files | Done when | Spend |
| --- | --- | --- | --- | --- |
| 1 | Analyzer generalization: `focus_shop`, direction-agnostic break, weights table, labels from files, `--seeds` | `build_runs.py`, `analyzer/breakpoint.py`, `analyzer/attribution.py`, `data/naive_weights.json`, `tests/test_generic.py` | fixtures pass renamed; the 3-seed live output in `/tmp` builds a bundle with `--seeds 0-2` | 0 |
| 2 | Schema additions: `days`, `focus_shop`, `source`, `unset`, `shop_label` | `engine/schema.py`, `resolve.py`, `loader.py`, `prompt.py`, `loop.py` | v1 scenarios byte-identical (cache key unchanged for them); a scenario using `unset` and `days: 10` runs offline | 0 |
| 3 | `translate.py` + validator + translation cache | `engine/translate.py`, `tests/test_translate.py` (stubbed transport, 15 phrasings incl. 3 unsupported) | 12/15 map to the intended override; 3/15 return `unsupported` with a reason | ~15 calls to check live |
| 4 | `api/server.py` with fork-from-snapshot, timeout, library fallback, ledger | `api/`, `tools/cost_report.py` | `curl /whatif` returns an analysed answer in <45 s from the 3-seed cache | ~15 calls/question |
| 5 | `flows.py`, `money.py`, `data/economics.json` | `analyzer/` | numbers under each button; fixtures pinned | 0 |
| 6 | Frontend: de-hardcode, text box, override chip, fallback notice, money lines | `src/` | judge types a sentence, sees an answer | — |
| 7 | `abl_rename` × 3 seeds; ledger for the whole library | data + runs | `hero_agreement` in the bundle | ~60 |
| 8 | Fix `cf_discount` so it restores hours too (both branches fix the door; discount is the *extra*); refill 3 seeds; promote | `data/scenarios/cf_discount.json`, `public/runs.json`, `cache/` | 6/6 vs 0/6 becomes a real comparison | ~100 |

Steps 1, 2, 5 are offline and can start now. Step 8 is the one v1 loose end and belongs in the
same commit as the promoted cache.

## 12. Definition of done

1. `bash tools/build_demo.sh --offline` from a fresh clone: exit 0, `publishable: true`, from
   committed `cache/`, with both shops renamed in a test copy of `data/`.
2. `POST /whatif` with each of the six canonical sentences below returns an analysed answer with
   the override chip in < 45 s, or `unsupported` with a reason for the two that should be:
   *open at 6 / cut the latte to 40k / raise the wait to 10 minutes / drop cold brew from the menu*
   (supported) · *Starbucks opens across the street* (unsupported: no competitor-entry mechanism) ·
   *add a loyalty card* (unsupported: no field).
3. Single-seed live answers are labeled `unmeasured`; the "run 3 seeds" button produces a
   measured confidence.
4. `abl_rename.hero_agreement` reported.
5. v1 frontend on `version-1` renders the v3 `runs.json` unchanged.
6. Every answer, live or cached, carries its ledger row.
