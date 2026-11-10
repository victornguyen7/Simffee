# Simffee — LLM cost plan (The Token Company challenge)

2026-09-20 · companion to [SPEC.md](./SPEC.md), [BACKEND_PLAN.md](./BACKEND_PLAN.md),
[ELASTIC_PLAN.md](./ELASTIC_PLAN.md)

## Update — after `36b724e` (Groq, deterministic narration, v2 cache key, strict gates)

What changed underneath this plan, and what it does to each lever:

| Change | Effect on this plan |
| --- | --- |
| **Provider is Groq**, model via `SIMFFEE_MODEL` (default `groq/compound-mini`), `SIMFFEE_MAX_TOKENS` default 1600, 2.2 s pacing | All $ figures below were Anthropic Haiku list price — now illustrative only. `cli.py` no longer prints a $ estimate; `cost_report.py` must carry a dated Groq price table. Anthropic-specific items (prompt caching, Message Batches) are replaced by their Groq equivalents or removed |
| **Legacy cache shows the real problem:** `openai/gpt-oss-20b` spent **1,049 in / 775 out** tokens on a 40-word JSON answer | Output was 13× the plan's ~60-token assumption — hidden reasoning tokens. **The single biggest lever is model class: a non-reasoning instruct model, or `reasoning_effort: low`.** This is RUN_PLAN D2/D3 and it happens before any other lever |
| **Narration is deterministic** — zero LLM calls | The "one narration call" lever is now "zero narration calls". Report it as such: the analyzer's prose costs nothing and cannot hallucinate. §3.1 row updated |
| **v2 cache key includes the twin record, rendered prompt, model, `max_tokens`, temperature policy** | Every prompt-shape lever (§3.2 condensed memory, table options, Token Company compression) and every model/token change **invalidates the entire cache**. Levers must be chosen *before* the fill in RUN_PLAN §4, and the fidelity comparison is a *second* fill against a *second* cache dir — budget it (≈ +$0.20 and +10 min per variant) |
| **Strict gates:** any `llm_failed` row suppresses analysis; rows carry `decision_source` | A "saving" that produces fallbacks fails the demo outright, not just fidelity. C1/C2/C3 introduce new decision paths and must extend `decision_source` (`distilled`, `seeded`, `pruned`) and teach `schema.coverage()` that those are complete evidence with provenance — a `schema.py` change, coordinated with B1 |
| **`build_demo.sh` writes to a fresh dir, never promotes** | The ledger is written to `$OUT/cost_ledger.jsonl`, and `meta.cost` is read from there by `build_runs.py`. Nothing appends to a tracked file as a side effect |
| **Rate limit is the wall-clock cost.** 2.2 s × ~230 calls ≈ 9 min per fill | Groq's Batch API (async, discounted, no per-minute pacing) replaces the Anthropic Batches row — and buys back the time as well as the money |

Order of operations is therefore: **RUN_PLAN §1–§5 first** (pick model + tokens, fill once,
prove replay). Then §6 steps 1–2 here (ledger + fidelity harness) on the real token numbers.
Only then any lever that changes the cache key.

## 0. The thesis

**We don't make the LLM cheaper. We make it think less often — and the thing that decides when
it thinks is the same mechanism the product is about.**

SPEC 2.5 already says it: a twin only reasons when its habit is weak or shocked. Autopilot is
zero tokens. That is not a cost hack bolted on afterwards; it is the behavioural claim (people
run on habit and only deliberate when something breaks) implemented as a router. The cost
saving *is* the model of human behaviour. That is the creative angle for this track, and
everything below is either measuring it, extending it, or protecting it.

The submission is a number and a comparison: **this demo cost $X; the naive way of building the
same product costs $Y; here is every lever and what each one saved, with proof that the answer
did not change.**

## 1. What a naive build of this product costs

Three designs a judge would assume, all of which a team could plausibly ship:

| Naive design | LLM calls | Why someone would build it |
| --- | --- | --- |
| **N1 — every agent thinks every day.** 10 twins × 7 days × 4 scenarios × 5 seeds | 1,400 | "It's a simulation, agents decide daily" |
| **N2 — synthetic respondents.** Interview every persona about every scenario and what-if (3 questions × 10 twins × 5 seeds), plus a summariser | ~160, but each call is long (whole transcript + all scenarios in context, ~3k tokens in, ~300 out) | The Synthetic Users / Aaru pattern |
| **N3 — the strategy doc's crowd, done wrong.** 510 agents × 21 days × 3 scenarios × 5 seeds with an LLM each | ~160,000 | "More agents = more realism" |

Simffee today, offline count: **210 reappraisal twin-days out of 1,400** — 15% of N1 before any
cache. With the fork sharing days 1–4 across `cf_*` and the cache committed, the *demo* itself
makes **0 calls**.

## 2. The ledger — measure before claiming

Nothing in this plan counts until it shows up in a number the judge can read.

| Piece | What it does |
| --- | --- |
| `engine/decide.STATS` (exists) | `llm_calls`, `cache_hits`, `retries`, `failures`, `input_tokens`, `output_tokens` per process |
| `tools/cost_report.py RUN_DIR` (new) | After a fill, write `RUN_DIR/cost_ledger.jsonl`: scenario, seeds, twin-days, API attempts, responses, cache hits, tokens in/out, `decision_source` histogram, model, `max_tokens`, $, and which levers were on. Also computes the N1/N2/N3 counterfactual cost for the same run size. Reads the CLI's transport counters, which already separate attempts from responses |
| `build_runs.py` → `meta.cost` (new) | Reads `RUN_DIR/cost_ledger.jsonl` if present and puts the latest row in the bundle |
| UI cost meter (frontend) | One line, bottom corner, next to the synthetic label: *"This run: 214 decisions reasoned, 1,186 on habit · $0.31 · naive equivalent $2.10"* |

Pricing lives in one dated table (`tools/pricing.json`: provider, model, $/M in, $/M out,
`as_of`). `cli.py` deliberately stopped estimating $ because it does not know the price;
`cost_report.py` is where the price is allowed to exist, and the bundle says which sheet it used.

**Fidelity check, mandatory for every lever:** run baseline seed 0 with the lever off and on.
Report (a) decision agreement — fraction of reappraisal twin-days where `choice` and
`primary_driver` are unchanged — and (b) analyzer agreement — `naive`, `actual`, `surprise`,
`whatif.returns` unchanged. **A saving that changes the answer is not a saving.** This is the
"your own measure of better" the judges ask for.

## 3. Levers

Grouped by whether they exist, are cheap to add, or are the creative ones worth the pitch.

### 3.1 Already built — measure and show

| Lever | Mechanism | Expected effect |
| --- | --- | --- |
| **Habit gating** (SPEC 2.5) | `habit ≥ 0.6` and `disruption ≤ threshold` → no call | ~85% of twin-days at 0 tokens |
| **Hybrid crowd** (strategy doc 3b, if adopted) | 500 crowd agents run the same 4-variable mechanism through a logit; only 10 hero twins call the LLM | N3 → ~0.3% of its calls; same emergent cascade |
| **Fork, don't rerun** (SPEC 5.1) | `cf_*` load the day-4 snapshot; days 1–4 are never recomputed | 3 counterfactuals cost 3 days each, not 7 |
| **Content-addressed cache** (SPEC 10.1, v2) | Key covers twin record, state, prompt, model, `max_tokens`; `cache/` committed → demo is 0 calls, replay byte-identical | Demo costs nothing. Honest caveat: the v2 key is strict, so tuning a twin or the prompt re-buys *all* of that twin's / everyone's decisions, not just downstream days — the trade for never replaying a stale answer |
| **Non-reasoning model, tight output** (SPEC 4.3, RUN_PLAN D2/D3) | A Groq instruct model with JSON mode, `SIMFFEE_MAX_TOKENS` 400, `reasoning ≤ 40 words`, enum drivers | ~60–100 output tokens per decision. **Against the legacy cache's 775, this alone is −85% on output tokens** — the largest measured lever in the repo, and it is a config change |
| **Retrieval, not the whole transcript** (SPEC 4.3 block 1) | 3 most relevant why-lines by keyword (ES relevance later, per ELASTIC_PLAN §4) | Identity block ~⅓ of the full transcript |
| **Zero narration calls** (SPEC 6.6, now deterministic) | Prose is rendered from computed fields; no model, no retry, no invented numbers possible | Was 1–2 calls per build; now 0, and the hallucination surface is gone with it |

The first row needs one `.env` line. The rest need `cost_report.py` and an honest before/after.

### 3.2 Cheap to add

| Lever | Mechanism | Expected effect | Notes |
| --- | --- | --- | --- |
| **Groq Batch API** | The whole run is a batch job (BACKEND_PLAN §0). Within a day, every twin's reappraisal is independent (gossip applies at end of day), so all reappraisals for day *d* across every scenario and seed go in one JSONL batch | Groq's batch discount on every token (**verify the current % on their pricing page** before quoting) **and** no 2.2 s pacing — the 9-minute fill becomes one submit + one poll | Engine loop changes from twin-by-twin to day-by-day-collect-then-submit; `llm.py` grows a `complete_json_batch`. Determinism unchanged: same inputs, same cache keys. Retry-at-0.3 becomes a second small batch for the invalid replies |
| **Condensed 3-day memory** (block 4) | Store each day's decision as `day 5: starbucks, +0.4, "closed, tried cold brew"` — 12 tokens, not the 40-word reasoning | ~−100 input tokens/call | Already "condensed" per spec; verify it is |
| **Options block as a table** | Render the two shops as a 2-row fixed-width table, not prose | ~−60 input tokens/call | Test fidelity: the LLM must still read `latent` in words |
| **Token Company compression** on the Identity block | Compress the profile + selected transcript lines through their model; keep the system prompt verbatim | Their claimed ratio on prose; measure | The one place their product plugs in honestly. Run fidelity check — persona voice must survive |
| **Drop `secondary_driver` from the schema when disruption source is `hours`/`closed`** | It is null-heavy there; ask for it only when the naive read is ambiguous | ~−8 output tokens/call | Marginal; do last |

**Not applicable, say so:** provider-side prompt caching. Groq's prefix caching (where offered)
and Anthropic's both want a long stable prefix; our prompts are ~900–1,100 tokens with a
~300-token system prompt. It would only pay if we *inflated* the prompt, which defeats the point.
Listed here so a judge doesn't think we forgot it.

**Also not a lever — a correction:** the plan's earlier "Options block as a table" and any
prompt-shortening must be checked against FIX_PLAN §2. The veto-list bug was a prompt-*shape*
problem; the fix made the options block *longer* (magnitudes instead of flags). Shortening it
back is how you re-introduce the bug. Fidelity gate is not optional here.

### 3.3 Creative — the ones to pitch

**C1 — Autopilot distillation: the twin learns its own habit.**
After a twin has made *k* LLM reappraisals (k = 3), fit a per-twin logit on its own decisions
(inputs: the same four variables plus disruption source and price gap; output: choice). From
then on, when the logit is confident (`p ≥ 0.85`), route to the logit and log
`mode: reappraisal, via: distilled`. When it is uncertain, call the LLM — and add that decision to
the twin's training set. Cost falls *over the course of the simulation the same way habit forms*,
which is exactly the behavioural claim. Report it as a curve: calls per day, decaying. This is
also the track's "self-improvement: learn from previous runs" in one mechanism.
Fidelity gate: distilled decisions must agree with a held-out LLM decision ≥ 90% on the fixtures
before it is allowed to route.

**C2 — Uncertainty-targeted seeding.**
Five seeds exist to measure stability (SPEC 6.5), but most twins are not marginal — T03 is going
to Simffee whatever the seed. Run seed 0 in full. For seeds 1–4, call the LLM only for twins
whose seed-0 decision was *close* (logit margin between the top two options < 0.3, or the
disruption score within 0.1 of the threshold); everyone else reuses seed 0's answer with a
`seeded_from: 0` flag. Stability is measured where it can actually vary and assumed 1.0 where
nothing could have changed. Saves ~60–70% of seeds-1–4 calls while making the confidence score
*more* honest, not less — it stops paying to re-confirm the obvious.
Fidelity gate: `analysis.confidence.value` within ±0.03 of the full-seed run on fixtures.

**C3 — Counterfactual pruning.**
For a `cf_*` fork, a twin whose day-`from_day` state is identical to baseline *and* who was on
autopilot in baseline for every remaining day will be on autopilot in the fork too, unless the
override touches its regular shop. Detect that before running and skip the fork for those twins
entirely (copy baseline rows, flag `pruned: true`). In the demo scenario 4 of 10 twins never
enter reappraisal after day 4; `cf_discount` and `cf_restore_hours` never need to look at them.
Zero fidelity risk by construction — it is the same rule the loop would have applied.

**C4 — Reasoning on demand.**
The analyzer needs `reasoning` for exactly two evidence cards and the twin inspector. It needs
`choice` and drivers for everything. Ask for `choice + drivers + valence` only (~15 output
tokens), and make a second, tiny call for the 40-word reasoning **only** for rows the analyzer
selects as evidence or that the UI is showing. Output tokens are 5× the price of input; this
removes ~75% of them on the bulk path. Cost: the evidence-card call happens at build time, not
run time, so the trajectory row is written in two steps.
Fidelity risk: the LLM's `primary_driver` may be less honest without having to write the
reasoning first (chain-of-thought effect). **Test this** — if driver agreement drops below 95%,
keep reasoning in the bulk call and drop C4. Report the result either way; a negative result
with a number is still a finding.

## 4. Expected savings — to be replaced by measured numbers

Illustrative only — replace every cell with `cost_report.py` output after RUN_PLAN §4. Shape
assumed: 1,400 twin-days, a Groq 70B instruct model at roughly $0.6/M in, $0.8/M out (dated
sheet in `tools/pricing.json`), ~1,050 in / ~90 out per call. The **N0** row is the legacy cache's
measured shape (gpt-oss-20b, 775 out) run naively — the configuration the repo actually had.

| Stage | Calls | Out tok/call | $ | vs N0 |
| --- | --- | --- | --- | --- |
| N0 naive, reasoning model as found | 1,400 | 775 | ~1.75 | — |
| N1 naive, instruct model | 1,400 | 90 | ~0.98 | −44% |
| + habit gating (built) | ~230 | 90 | ~0.16 | −91% |
| + fork sharing (built) | ~200 | 90 | ~0.14 | −92% |
| + C3 pruning | ~160 | 90 | ~0.11 | −94% |
| + C2 targeted seeding | ~80 | 90 | ~0.06 | −97% |
| + C1 distillation | ~55 | 90 | ~0.04 | −98% |
| + Groq Batch | ~55 | 90 | ~0.02–0.03 | −98–99% |
| + C4 reasoning on demand (if it passes) | ~55 + 2 | 15 | ~0.02 | −99% |
| **Demo replay from committed cache** | **0** | — | **0** | **−100%** |

Against N3 (the crowd done with LLMs, ~160k calls, ~$190), the hybrid architecture alone is
−99.7% and is the biggest single number in the deck — if the crowd pivot is adopted.

The absolute dollars are small because the demo is small. Report **ratio and mechanism**, and
show what the same ratios mean at the strategy doc's buyer scale (a 20-store chain, 10,000 crowd
agents, 90-day horizon, weekly reruns): N1 there is ~$40k/year; Simffee's architecture is
~$400. That is the number the judges remember.

## 5. Demo moment (10 seconds, added to the existing script)

After the confidence beat: the cost meter in the corner, then one slide.

> "1,400 morning decisions were simulated. 214 of them needed a language model. The other 1,186
> ran on habit — because that's what people do. The whole thing cost thirty-one cents, and the
> demo you just watched cost nothing: it's replayed from cache."

The slide: N1 / N2 / N3 bars vs Simffee, log scale, with each lever labelled on the descent.

## 6. Build order

| # | Step | Done when | Hours |
| --- | --- | --- | --- |
| 0 | **RUN_PLAN §1–§5** — pick model/tokens, fill once, prove replay. Nothing below is measurable before this | Publishable bundle exists | — |
| 1 | `tools/cost_report.py RUN_DIR` + `tools/pricing.json` + `meta.cost` in `runs.json` | Ledger row for the real fill; N0/N1/N2/N3 counterfactuals computed | 2 |
| 2 | Fidelity harness `tools/fidelity.py A_DIR B_DIR`: diff two fills' decisions + analyzer output | Reports agreement % and the analyzer diff; also runs as a strict gate (any fallback in B = fail) | 2 |
| 3 | C3 pruning — adds `decision_source: pruned`, extends `schema.coverage()` | Same rows, fewer calls, 100% agreement, `publishable` still true | 2 + B1 |
| 4 | Groq Batch in `llm.py` + day-collect loop | Same cache keys, same rows, discounted $ and no pacing on the ledger | 3–4, B1 |
| 5 | C2 targeted seeding | Confidence within ±0.03 on fixtures | 3 |
| 6 | C1 distillation | ≥90% held-out agreement gate; calls-per-day curve in the ledger | 4 |
| 7 | Token Company compression on the Identity block + measured ratio | Fidelity report, positive or negative | 2 |
| 8 | C4 reasoning on demand — run the experiment, keep or drop on the number | Fidelity report | 3 |
| 9 | Cost meter in UI + the one slide | — | frontend |

Steps 1–2 are prerequisites and are worth doing regardless of the track. Steps 3–6 need the
engine, which is B1's — coordinate; each touches `engine/loop.py`, `decide.py`, or `schema.py`.
Steps 3, 5, 6, 7, 8 all change either which rows call the LLM or what the prompt says; under
the v2 key that means **a full refill per variant, into its own cache dir** — ~$0.20 and ~10 min
each with pacing, less with Batch. The fidelity harness compares two such dirs. Plan the
variants you actually want to show and fill them once each; do not iterate on the promoted cache.

## 7. Rules

- **No saving without a fidelity number next to it.** The comparison run is the product.
- **Never route around the LLM on the evidence-card twins.** T01's and T08's day-4 decisions are
  the demo; they stay full-cost, full-reasoning, always.
- **The number guard stays.** Cheaper narration that invents a figure is not cheaper.
- **Report negative results.** If C4 hurts driver honesty, that finding — with the percentage —
  goes in the deck. It is a better story than a lever that silently worked.
- **Pricing is dated.** Every $ figure names the price sheet and date it came from.
