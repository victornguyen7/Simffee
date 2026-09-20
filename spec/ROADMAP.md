# Simffee — Roadmap: from "scenario-agnostic analyzer" to "any situation, any plan"

2026-09-20 · branch `version-1-functional` · the plan for everything SPEC_FUNCTIONAL §1 lists
as *not yet*. Supersedes SPEC_FUNCTIONAL §3 (five sources) and §10–§11 where they conflict.

## 0. The product sentence

> *Describe your situation and your plan in plain words. Ten people you can read — and, later,
> five hundred you can count — live through it day by day. You see who did what, why, and what
> it cost. Change the plan, run it again.*

Everything below exists to make each clause of that sentence true, in the order that keeps a
working demo at every step.

## 1. The rule that keeps it a simulation

**A situation or an action is simulatable only if it changes something a persona can
perceive** — a shop field, a shop's existence, or a variable in the persona's own state.
Anything else is an opinion the LLM would role-play, not a behaviour the engine computes.

So both lists — situations and actions — are **closed and growing**. Each entry names the
mechanism it touches. The translator maps a sentence onto entries; when it can't, it returns
`unsupported` with the reason and the nearest thing it *can* run. "We can't simulate that yet"
is a correct answer and the UI shows it.

## 2. Situations

| # | Situation | Mechanism it needs | Analyzer question | Phase |
| --- | --- | --- | --- | --- |
| S1 | **Incumbent shocked** — hours, price, wait, menu, quality, marketing, closure change at an existing shop | v1's five disruption sources | *Sales broke — what did the owner blame, what actually moved people, who came back under which fix?* (`breakpoint` → `attribution` → `pairwise`) | **done** |
| S2 | **Competitor enters** — a shop that did not exist appears mid-run | `exists_from_day` on a shop; `new_entrant` disruption (0.5 if open at the twin's usual time, 0.2 otherwise); opening-day `latent_interest += 0.15` within 2 × walk tolerance | *Who did I lose to them, when, why — and who did I keep or gain?* (`flows.lost_to / gained_from / returned / net` + the S1 template on the focus shop) | **B** |
| S3 | **You launch in a town** — the focus shop is the entrant; residents include people who buy no coffee out | S2 + a **dormant** persona state (`max(habit) < 0.1`), `category_interest` that marketing and neighbours raise, a conversion step on first reappraisal | *Who comes, from where, how fast, does it stick — and what share never buys coffee out at all?* (`flows.gained_from` by origin: competitor / dormant; `activated`; retention curve) | **C** (hero-only), **E** (with crowd) |
| S4 | **Competitor exits / changes** — the other shop closes, raises prices, shortens hours | Already expressible: overrides on the non-focus shop; `permanently_closed` | S1 template with `direction: rise` | **done** (analyzer) — needs translator to allow non-focus shop targets |
| S5 | **Market-wide shift** — a new office opens nearby, a season starts, a road closes | Population-level: more/fewer residents, changed `usual_time` mix, changed distances | S3 flows over the whole population | **E** (needs the crowd; no honest hero-only version) |

## 3. Actions (the plan)

| # | Action the user might say | Maps to | Phase |
| --- | --- | --- | --- |
| A1 | Open earlier/later, close earlier/later | `open`, `close` | done |
| A2 | Raise / cut a price; introduce a price for a new item | `price.<item>` | done |
| A3 | Add / drop a menu item | `products` (+ `price.<item>`) | done |
| A4 | Speed up service / add staff | `avg_wait_min` | done |
| A5 | Improve quality (new beans, new machine) | `quality` | done |
| A6 | Run ads / posters / a campaign with a message | `marketing.reach`, `marketing.message` | done (reach feeds latent interest daily; message reaches the prompt) |
| A7 | Close temporarily / permanently | `permanently_closed`, or `open == close` | done |
| A8 | **Loyalty card / stamps / buy-N-get-1** | New persona variable `loyalty_balance[shop]`; each visit +1; at threshold the next visit is free (`spent: 0`) and a **positive valence bump**; in reappraisal the prompt shows *"you have 4 of 5 stamps here"*. Mechanism: a habit-side pull that only exists for people already visiting | **D** |
| A9 | **Delivery / pre-order app** | Effective `distance` for that shop → 0 for twins with `uses_app` (sampled from `ad_sensitivity`); effective wait → `pickup_wait` field. Mechanism: it removes two costs from the choice for a subset of people | **D** |
| A10 | **Happy hour / time-boxed discount** | `price.<item>` with `between: ["14:00","17:00"]`; applies only if the twin's `usual_time` is in the window. Mechanism: price as A2 but gated on time | **D** (small) |
| A11 | **Bundle / combo** (coffee + pastry) | `products` + a `bundle` price that undercuts the sum; twin's `usual_order` may match the bundle | **D** (small) |
| A12 | Events, live music, community night, "vibe" | **Unsupported.** Nothing in persona state perceives it. Translator says so and offers A6 (marketing message) as the nearest | — |
| A13 | Staff friendliness / service quality | Folded into A5 `quality` with the message *"we treat quality as one number"* | done, with caveat shown |

A plan is an **ordered list of actions with days** — `[{day 5: A1 open 06:00}, {day 5: A3 add croissant}, {day 9: A8 loyalty}]`. That is exactly a scenario's `overrides` list, so a plan *is* a scenario and a revision *is* a child scenario forked from the day before its first new action.

## 4. Personas — where they come from, per situation

| Situation | Personas | Honesty label shown |
| --- | --- | --- |
| S1, S2, S4 | The 10 hand-built twins (two data layers each) — later ES-derived per ELASTIC_PLAN | *Synthetic seed population, 10 twins* |
| S3 hero-only (phase C) | 10 twins + **T11–T13 non-drinkers** (what-log of zero coffee purchases, transcripts about why not) | *13 twins, 3 of whom do not buy coffee out* |
| S3 / S5 with crowd (phase E) | 10–13 hero twins + 500 crowd agents sampled from `data/populations/*.json` distributions; crowd uses a logit calibrated to hero LLM decisions | *500 generated agents calibrated to 13 twins, agreement N %* |
| New town with real data | ES ingest of messy POS / reviews / interviews → derived mechanism variables (ELASTIC_PLAN §3) | *Derived from N records; evidence shown per number* |

Without the crowd, S3 is 13 opinions. That is still a valid *demo* of the mechanism (v2's own build
order ships "hero-only 21 days" as a real story) — but the UI labels it as 13 people, and the
launch question gets its counts only in phase E.

## 5. Phases

Each phase ends with a demo that works if you stop there. Spend is Groq calls at ~1.1k in /
~90 out tokens; at current pacing 2.2 s per call.

### Phase A — the front door (S1 typed by a user)

| Step | Files | Done when | Spend |
| --- | --- | --- | --- |
| A1 Engine schema: `days`, `focus_shop`, `source`, `unset`, `shop_label`; `cli.py` discovers scenarios from `data/scenarios/` and from a `--scenario-file` (not `ALL_SCENARIOS`) | `engine/schema.py`, `resolve.py`, `loader.py`, `prompt.py`, `loop.py`, `cli.py` | v1 four run byte-identical against the 3-seed cache (cache key unchanged for them); a 10-day scenario with `unset` runs offline | 0 |
| A2 `translate.py`: sentence → `{situation, plan, scenario}`; closed field list; local validator; translation cache; `unsupported` path | `engine/translate.py`, `data/actions.json` (the A-table above as data), `tests/test_translate.py` (stubbed; 20 phrasings, 5 unsupported) | 15/20 map to the intended overrides, 5/20 return `unsupported` with the right reason | ~20 live to check |
| A3 `api/server.py`: `POST /whatif` → translate → fork from parent snapshot → 1 seed → analyze → answer with override chip + ledger row; `GET /library`; timeout → nearest library scenario, labeled | `api/server.py`, `tools/cost_report.py`, `tools/pricing.json` | `curl` a sentence, get an analysed answer < 45 s from the 3-seed cache | ~15/question |
| A4 Frontend: text box, override chip, fallback notice, "run 3 seeds" button, per-answer cost line; de-hardcode the 54 shop/scenario references | `src/` | a judge types *"open at 6 and add croissants"* and sees who comes back | — |
| A5 Fix `cf_discount` (restore hours **and** cut price so the two buttons differ in what they add); refill 3 seeds; promote bundle + cache | `data/scenarios/cf_discount.json`, `public/runs.json`, `cache/` | 6/6 vs 0/6 becomes a real comparison; fresh-clone offline build passes | ~100 |

**Demo after A:** the v1 story, plus a judge typing any S1/S4 plan and getting an answer.

### Phase B — competitor enters (S2)

| Step | Files | Done when | Spend |
| --- | --- | --- | --- |
| B1 `exists_from_day` on shops (absent shop: not an option, no marketing, no disruption source); overridable | `engine/loader.py`, `resolve.py`, `loop.py`, `prompt.py` | a run with `starbucks.exists_from_day: 4` shows days 1–3 with one shop | 0 |
| B2 `new_entrant` disruption + opening-day latent bump; sixth enum value; v1 rows never emit it | `engine/disruption.py`, `schema.py`, `gossip.py` | offline stub run: early-morning twins reappraise on day 4 with `source: new_entrant` | 0 |
| B3 `analyzer/flows.py`: per day, per other shop — `lost_to`, `gained_from`, `returned`, `net`; driver breakdown of each flow; wired into `build_runs` and `/whatif` | `analyzer/flows.py`, `build_runs.py` | fixtures pinned; runs on S1 output too (flows are generic) | 0 |
| B4 Scenario `s2_entrant`: Starbucks absent days 1–3, opens day 4 alongside the v1 hours shift; `s2_entrant_only` (control: entrant, no hours shift, via `unset`); what-ifs reuse A1–A6 | `data/scenarios/` | live 3 seeds, 0 fallbacks; flows non-trivial; the S1 surprise still fires | ~120 |
| B5 Translator learns S2: *"a competitor opens on day N"* → `exists_from_day`; analyzer picks the S2 question template | `engine/translate.py`, `analyzer/templates.py` | the sentence runs end to end | ~10 |
| B6 `abl_rename` (competitor labelled "Shop B" in the prompt only) × 3 seeds; `hero_agreement` in the bundle | data | number reported, whatever it is | ~60 |

**Demo after B:** *"Starbucks opens across the street on day 4. I open at 6 and add pastries."*
typed live — who I lose, who I keep, why, and whether the LLM was reacting to the mechanism or
the brand name.

### Phase C — launch into a town, hero-only (S3, 13 twins)

| Step | Files | Done when | Spend |
| --- | --- | --- | --- |
| C1 Dormant state: `max(habit) < 0.1` → never autopilot; `mode: dormant` rows (`choice: none`, no call); `category_interest` variable with marketing / contagion / decay rules (v2 §3.2); conversion on first reappraisal (v2 §3.3) | `engine/schema.py`, `habit.py`, `decide.py`, `gossip.py`, `loop.py` | T01–T10 unchanged (`category_interest: 1.0` default → byte-identical rows) | 0 |
| C2 T11–T13: non-drinker twins — zero-coffee what-logs, transcripts about *why not* (cost, habit at home, never occurred to them) | `data/twins/T11–T13.json` | loader validates; SPEC 3.1 derivation rules documented for them | 0 |
| C3 Scenario `s3_launch`: focus shop absent until day 4 (it is *us* entering), other shop present; 14 days | `data/scenarios/` | live 3 seeds; at least one of T11–T13 converts; `flows.gained_from` split into competitor vs dormant | ~150 |
| C4 Analyzer S3 template: acquisition by origin, `activated`, retention (still coming on day 14 of those who came by day 7) | `analyzer/flows.py`, `templates.py` | numbers under the launch answer | 0 |
| C5 Translator learns S3: *"I'm opening a shop at (x,y) in this town"* → focus shop = new shop, `exists_from_day`, position | `engine/translate.py` | sentence runs | ~10 |

**Demo after C:** *"I'm opening at the corner on day 4 with a 6am start and a 35k latte —
who comes?"* — with the honest label *13 people, 3 of whom don't buy coffee out.*

### Phase D — richer actions (A8–A11)

| Step | Mechanism | Done when | Spend |
| --- | --- | --- | --- |
| D1 Happy hour (A10) and bundles (A11) | price gated by `usual_time` window; bundle price when `usual_order` ∈ bundle | offline stub; translator phrases | 0 |
| D2 Loyalty (A8) | `loyalty_balance[shop]` per twin; threshold → free visit + valence bump; rendered in the prompt | live 3 seeds on S1 with a loyalty what-if; `pairwise.returns` differs from the no-loyalty branch | ~60 |
| D3 Delivery / app (A9) | `uses_app` sampled per twin; effective distance 0, wait = `pickup_wait` | live 3 seeds | ~60 |
| D4 Each new action: one row in `data/actions.json`, one translator phrase set, one fidelity check that S1 output is unchanged when the action is absent | — | the rule in §1 holds | — |

### Phase E — the crowd (S3 counts, S5)

Spec v2 §4–§5, §11 as written: `engine/crowd.py` (generate from distributions, logit choice,
arithmetic driver attribution, valence formula, compact `crowd_day{d}.json`), one gossip network
(grid radius + hero–crowd links), `tools/calibrate_logit.py` against every hero reappraisal row
already cached, determinism with an independent RNG stream. Analyzer `flows.py` reads crowd
strings alongside hero rows (designed for in B3). UI draws 500 small dots.

This is also COST_PLAN's C1 distillation and the thing that makes ELASTIC_PLAN's aggregations
worth having. Budget it as 2–3 days of B1 + calibration; the demo gains *counts* for S3/S5 and
the sweep (*"at what share of non-drinkers does the entrant help you?"*).

## 6. Order and what to cut

Dependency: **A → B → C → D → E.** B needs A's translator; C needs B's `exists_from_day`; D is
independent of C and can interleave; E needs C's dormant state.

| Deadline | Ship |
| --- | --- |
| Hackathon, tight | **A** (typed S1) |
| Hackathon, on plan | **A + B** (typed S1 + competitor enters + rename test) |
| Hackathon, stretch | **A + B + D1** (happy hour / bundle are cheap) |
| Product v1 | **+ C + D2–D3** |
| Product with counts | **+ E**, then ES-derived personas |

Never cut: the `unsupported` path, the override chip, the per-answer ledger, the synthetic label.

## 7. Decisions — taken 2026-09-20

1. **Competitor entry un-deferred.** Phase B is in scope; the disruption sources become six.
   SPEC_FUNCTIONAL §3 is superseded by this.
2. **Model:** `qwen/qwen3.8-27b` through phase B; revisit with the cost ledger.
3. **Phase C ships at 13 twins, labelled** *"13 people, 3 of whom do not buy coffee out"*.
   Counts arrive in E.
4. **Frontend (A4) is built by Devin after the backend logic (A1–A3, B1–B5) is done.** Until
   then the front door is `curl`.
