# Simffee Market Simulation — Specification v1

## 1. Goal

Answer one question:

> **Given a fixed 7-day window in a fixed small-town market, which levers should the Simffee startup change — price, quality, product novelty, or location/reach — to win sustainable repeat demand away from the incumbent?**

The run is not a forecast. It is a lever-attribution instrument. Success is a report that ranks candidate changes by the evidence in the day-by-day agent record, not a revenue number.

## 2. World model

### 2.1 Town geometry

The town is a **one-dimensional main street** of length 10.0 distance units. Every agent has a `home_location` on it; every shop has a `location` on it. Distance between agent *i* and shop *s* is `|home_location_i - location_s|`.

A 1-D street is deliberate: it makes distance effects legible in the report without a map. See §10.

### 2.2 The two shops

| Field | `brewhouse` (incumbent) | `simffee` (startup) |
|---|---|---|
| `name` | Brewhouse Corner | Simffee |
| `location` | 3.0 | 6.0 |
| `price` | 3.50 | 4.25 |
| `quality` | 0.62 | 0.80 |
| `novelty_base` | 0.00 | 1.00 |
| `novelty_decay` | 0.00 | 0.25 |
| `capacity` | 6 | 5 |
| `opens_on_day` | 1 (pre-existing) | 1 |

- `price` — one representative cup, in currency units. Single price point in v1 (see §10).
- `quality` — objective product quality, 0.0–1.0. Fixed for the run.
- `novelty_base` / `novelty_decay` — see §4.3.
- `capacity` — max agents served per day. See §5 step 4.

### 2.3 What makes Simffee's products "new"

Novelty is modeled as a **single decaying scalar**, not as a per-item menu. `world.json` carries a `menu` list per shop for report readability, with each item flagged `novel: true|false`, but the utility function reads only the shop-level `novelty_base` and `novelty_decay`. A menu item flag never enters a calculation in v1.

Simffee's novel line (cold-brew flight, oat cortado, seasonal syrup bar) is what sets `novelty_base = 1.00`. Brewhouse sells only conventional drip and espresso, so its novelty is 0.00 for the whole run.

### 2.4 Global weights and constants

Declared in `data/world.json` under `weights` and `dynamics`. All are tunable without touching agents.

| Constant | Value | Meaning |
|---|---|---|
| `w_price` | 1.00 | scales the price term |
| `w_quality` | 1.00 | scales the quality term |
| `w_novelty` | 0.80 | scales the novelty term |
| `w_habit` | 1.20 | scales the loyalty term |
| `w_distance` | 1.00 | scales the distance penalty |
| `w_perception` | 0.60 | scales the perception term |
| `reservation_utility` | 0.35 | utility of buying nothing |
| `habit_gain` | 0.25 | loyalty formed per visit |
| `loyalty_decay` | 0.10 | fractional loyalty lost per day not visited |
| `wom_threshold` | 0.15 | \|satisfaction\| needed to talk about a shop |
| `wom_transmission` | 0.15 | perception shift per word-of-mouth event |
| `seed` | 20260919 | RNG seed |

## 3. Agent model

Ten agents. Every agent carries exactly these fields — no more, no fewer. `data/agents.json` must validate against this table.

| Field | Type | Range | Meaning |
|---|---|---|---|
| `id` | string | `A01`–`A10` | stable key |
| `name` | string | — | display name |
| `archetype` | string | — | one-line label for the report |
| `home_location` | float | 0.0–10.0 | position on main street |
| `price_sensitivity` | float | 0.0–1.0 | how much cost hurts |
| `quality_sensitivity` | float | 0.0–1.0 | how much quality is valued *and* how high expectations run (§6.1) |
| `novelty_seeking` | float | 0.0–1.0 | pull of a new product |
| `loyalty_strength` | float | 0.0–1.0 | how strongly accumulated habit steers choice |
| `distance_tolerance` | float | 0.5–8.0 | distance units before the trip feels costly |
| `daily_budget` | float | 2.50–12.00 | max spend per day; also the denominator for price pain |
| `visit_frequency` | float | 0.0–1.0 | daily probability of wanting coffee at all |
| `social_susceptibility` | float | 0.0–1.0 | how much others' perception moves this agent |
| `need_window` | enum | `morning` \| `afternoon` | when this agent arrives; sets service order |
| `wom_propensity` | float | 0.0–1.0 | how loudly this agent broadcasts an opinion |
| `initial_loyalty` | object | each 0.0–1.0 | `{brewhouse, simffee}` habit at Day 1 start |
| `initial_perception` | object | each −1.0–1.0 | `{brewhouse, simffee}` signed awareness×sentiment at Day 1 start |
| `notes` | string | — | the one market behavior this agent is designed to expose |

**On `perception`.** It is a single signed scalar, not separate awareness and sentiment. `0.0` = never heard of the shop. `+1.0` = knows it and loves it. `−1.0` = knows it and has been warned off. This collapse is what lets negative word-of-mouth be modeled without a second field (§6.3).

## 4. Utility function

### 4.1 Form

For agent *i*, shop *s*, day *d*:

```
U(i,s,d) =  w_quality    * quality_sensitivity_i * quality_s
          + w_novelty    * novelty_seeking_i     * novelty_s(d)
          + w_habit      * loyalty_strength_i    * loyalty_i,s(d)
          + w_perception * social_susceptibility_i * perception_i,s(d)
          - w_price      * price_sensitivity_i   * (price_s / daily_budget_i)
          - w_distance   * (|home_location_i - location_s| / distance_tolerance_i)
```

The "buy nothing" option has fixed utility `reservation_utility = 0.35`.

Every term is a trait × world-fact product, so a weight of zero on any global weight cleanly removes that lever from the run. That is the property the report's attribution depends on.

### 4.2 Choice rule

1. Drop any shop whose `price_s > daily_budget_i`.
2. Compute `U` for each surviving shop.
3. Pick `argmax` over {shops, no-purchase}.

### 4.3 Novelty decay

```
novelty_s(d) = novelty_base_s * exp(-novelty_decay_s * (d - 1))
```

Simffee: 1.000, 0.779, 0.607, 0.472, 0.368, 0.287, 0.223 across days 1–7. Brewhouse: 0.000 throughout. Novelty is a **shop-level** property and decays for everyone at the same rate regardless of whether a given agent has visited. This is a simplification — see §10.

### 4.4 Tie-breaking

Ties within `1e-9`, resolved in order: **higher `quality_s`** → **lower `price_s`** → **lexicographic `shop_id`**. A tie against `reservation_utility` resolves to no-purchase.

### 4.5 Worked example — A01, Day 1

Agent **A01 Maya Okonkwo**: `home_location` 6.2, `price_sensitivity` 0.25, `quality_sensitivity` 0.90, `novelty_seeking` 0.60, `loyalty_strength` 0.35, `distance_tolerance` 4.0, `daily_budget` 8.00, `social_susceptibility` 0.45, `initial_loyalty` {brewhouse 0.50, simffee 0.00}, `initial_perception` {brewhouse 0.85, simffee 0.15}.

**Brewhouse** (loc 3.0, price 3.50, quality 0.62, novelty 0.00):

| Term | Arithmetic | Value |
|---|---|---|
| quality | 1.00 × 0.90 × 0.62 | +0.5580 |
| novelty | 0.80 × 0.60 × 0.00 | +0.0000 |
| habit | 1.20 × 0.35 × 0.50 | +0.2100 |
| perception | 0.60 × 0.45 × 0.85 | +0.2295 |
| price | −1.00 × 0.25 × (3.50 / 8.00) | −0.1094 |
| distance | −1.00 × (\|6.2 − 3.0\| / 4.0) = −(3.2 / 4.0) | −0.8000 |
| **U** | | **+0.0881** |

**Simffee** (loc 6.0, price 4.25, quality 0.80, novelty 1.00):

| Term | Arithmetic | Value |
|---|---|---|
| quality | 1.00 × 0.90 × 0.80 | +0.7200 |
| novelty | 0.80 × 0.60 × 1.00 | +0.4800 |
| habit | 1.20 × 0.35 × 0.00 | +0.0000 |
| perception | 0.60 × 0.45 × 0.15 | +0.0405 |
| price | −1.00 × 0.25 × (4.25 / 8.00) | −0.1328 |
| distance | −1.00 × (\|6.2 − 6.0\| / 4.0) = −(0.2 / 4.0) | −0.0500 |
| **U** | | **+1.0577** |

No-purchase: 0.3500.

**Choice: Simffee** (1.0577 > 0.3500 > 0.0881).

Post-visit, by §6.1: `expected_quality = 0.40 + 0.40 × 0.90 = 0.76`; `price_pain = 0.25 × (4.25/8.00) = 0.1328`; `satisfaction = (0.80 − 0.76) − 0.1328 = −0.0928`.

By §6.2: `loyalty(simffee) = clamp01(0.00 + 0.25 × (0.5 − 0.0928)) = 0.1018`; `loyalty(brewhouse) = 0.50 × 0.90 = 0.4500`.

By §6.3: `|−0.0928| < 0.15`, so A01 says nothing. She buys, she is not displeased, and she is also not an evangelist — the quality maximalist is won on product but lost on price-to-quality ratio. That single cell is the kind of finding the report exists to surface.

## 5. Daily tick order

For each day `d` in 1..7, strictly in this order:

1. **Novelty update** — recompute `novelty_s(d)` for both shops.
2. **Need check** — for each agent, draw `r = rng(seed, d, id)`; the agent wants coffee iff `r < visit_frequency_i`. Agents that do not want coffee take no further part in the day.
3. **Scoring** — every wanting agent computes `U` for every option per §4. Scoring is simultaneous; no agent sees another agent's Day-`d` choice.
4. **Service and capacity** — agents are served in a fixed order: all `morning` agents first, then all `afternoon`, each group ascending by `id`. An agent takes its top choice if that shop has remaining capacity. If full, it re-picks from the remaining options (other shop, or no-purchase) under the same rule. If nothing clears `reservation_utility`, the day is logged as **unmet demand** with the blocked shop recorded.
5. **Satisfaction** — each agent that purchased computes satisfaction per §6.1.
6. **Word-of-mouth** — perception updates propagate per §6.3, applied simultaneously from a snapshot so ordering within the step cannot matter.
7. **Carryover** — loyalty updates per §6.2 applied; day metrics (§7) written; state frozen as Day `d+1` input.

## 6. Feedback loops

### 6.1 Satisfaction

```
expected_quality_i   = 0.40 + 0.40 * quality_sensitivity_i
price_pain_i,s       = price_sensitivity_i * (price_s / daily_budget_i)
satisfaction_i,s     = clamp(-1, 1, (quality_s - expected_quality_i) - price_pain_i,s)
```

Expectations scale with `quality_sensitivity`, so a discerning agent is harder to delight by the same cup. This is what lets the model say "high quality is not sufficient" rather than only "high quality wins".

### 6.2 Loyalty / habit

```
chosen shop:      loyalty ← clamp01(loyalty + habit_gain * (0.5 + satisfaction))
every other shop: loyalty ← clamp01(loyalty * (1 - loyalty_decay))
```

The `0.5 +` base means a merely-neutral visit still builds some habit; only real dissatisfaction (`satisfaction < −0.5`) erodes it. Over 7 days this is what turns a novelty-driven trial into retention, or fails to.

### 6.3 Word-of-mouth

After step 5, each agent *i* that purchased and has `|satisfaction_i,s| >= wom_threshold` broadcasts about shop *s*. For every other agent *j*:

```
Δperception_j,s = wom_transmission * wom_propensity_i * social_susceptibility_j * sign(satisfaction_i,s)
perception_j,s  ← clamp(-1, 1, perception_j,s + Δperception_j,s)
```

All deltas are computed from the pre-step snapshot and summed, then applied at once. Broadcasts do not reach the broadcaster. Perception of the *unvisited* shop is untouched.

This is the only channel by which the startup reaches agents who have never visited it, and it is signed — a bad first week actively poisons reach.

## 7. Competitor behavior

**Brewhouse is static for v1.** Its price, quality, capacity, and menu never change.

*Why:* with 10 agents over 7 days, a reactive competitor makes every delta jointly caused. The run would show that something moved without being able to say which lever moved it, which defeats §1. A static incumbent makes Simffee's parameters the only independent variables.

*What it would take to change:* a `reactions` block in `world.json` (trigger condition → parameter delta → response lag in days), plus a paired-run harness that executes the same seed with reactions off and on and reports only the difference. Do not add reactive behavior without that paired-run comparison, or the attribution claim in the report becomes unsupportable.

## 8. Metrics tracked per day

Written for every day `d`:

- `visits` — count per shop.
- `revenue` — `visits × price` per shop; plus cumulative.
- `choices` — per agent: `{agent_id, wanted_coffee, chosen (brewhouse|simffee|none), utilities: {brewhouse, simffee, none}, blocked_by_capacity}`.
- `switch_events` — agents whose choice differs from their previous *purchasing* day, as `{agent_id, from, to, day}`.
- `satisfaction` — per purchasing agent, plus mean / min / max per shop.
- `unmet_demand` — count and agent ids of agents that wanted coffee and bought nothing, split by cause: `capacity` vs `below_reservation`.
- `state_snapshot` — every agent's `loyalty` and `perception` for both shops at end of day.

## 9. Output report format

The end-of-run report has exactly these sections:

1. **Headline** — one sentence: did Simffee end Day 7 with more repeat demand than it started, and is the trend rising or decaying.
2. **Seven-day trace** — a day × shop table of visits, revenue, and mean satisfaction.
3. **Trial vs. retention split** — of all Simffee visits, how many were first-time (novelty-driven) vs repeat (loyalty-driven), per day. The core diagnostic: novelty decays on a known curve (§4.3), so a Simffee visit count falling at the same rate means nothing converted.
4. **Agent ledger** — one row per agent: archetype, total visits to each shop, end-state loyalty and perception, and whether the agent was ever won.
5. **Loss analysis** — for every agent that never bought from Simffee, the single term in §4.1 with the largest negative contribution to its Simffee utility, averaged over the run. This names the blocking lever per agent.
6. **Word-of-mouth map** — which agents broadcast, in which direction, and the net perception shift they caused for each shop.
7. **Unmet demand** — capacity-blocked vs. below-reservation, by day.
8. **Recommendations** — ranked changes. Each recommendation must cite, by section number and figure, the evidence above that supports it. A recommendation with no citation into §§2–7 must not be emitted.

**Evidence rules for §9.8.** Each recommendation states the lever, the proposed direction, the agents it would flip, and the counter-cost.

| Recommendation | Only valid if |
|---|---|
| Lower price | §9.5 names the price term as the top blocker for ≥2 agents |
| Raise quality | §9.5 names the quality term as top blocker, **or** §9.2 mean satisfaction at Simffee < 0 while visits hold |
| Extend/refresh novelty | §9.3 shows visits tracking the novelty decay curve with repeat share flat |
| Improve reach / location | §9.5 names the distance or perception term as top blocker for ≥2 agents |
| Add capacity | §9.7 shows capacity-blocked demand on ≥2 days |

## 10. Non-goals and known simplifications

Recorded so v2 knows what it inherited.

1. **One purchase per agent per day, max.** No second cup, no group orders. `daily_budget` therefore functions as a price-pain scale more than a real constraint.
2. **Single price point per shop.** The `menu` in `world.json` is report decoration; no item-level choice, no attach rate, no food.
3. **1-D town, static homes.** No commute path, no workplace, no reason to pass a shop. Distance is pure home-to-shop.
4. **Novelty is shop-level and decays on a global clock**, not per-agent-exposure. An agent who never visits still "uses up" the novelty window. This understates how long a late discoverer finds Simffee new.
5. **No price-quality inference.** Agents do not read a high price as a quality signal.
6. **No time-of-day supply effects.** `need_window` only orders service; it does not change price, quality, or queueing.
7. **Static competitor** (§7).
8. **No agent entry or exit, no tourists, no weather, no weekday/weekend effect.** Day 3 is identical in structure to Day 6.
9. **Word-of-mouth is a fully-connected broadcast.** No social graph; every talker reaches all nine others, damped only by their own `wom_propensity` and the listener's `social_susceptibility`.
10. **7 days is short for habit formation.** With `habit_gain = 0.25`, loyalty saturates slowly by design; read the direction of the loyalty trend, not its level.
