# Simffee Market Simulation — Specification v2

> **v2 changes the world model from a 1-D street to a 2-D Stardew-Valley-style tile town with player-placed structures, walkable A\* pathfinding, real-time agent movement, and enterable shop interiors whose furnishing drives capacity and quality.**
>
> **Data files are stale against this spec.** `data/agents.json` and `data/world.json` still encode v1 (`home_location` on a 1-D street, hardcoded `quality`/`capacity`, `need_window` enum). `data/town.json` exists and already conforms to §2.6. Re-deriving the data files against v2 is the next task and has not been done.

## 1. Goal

Answer one question:

> **Given a town the player laid out and a fixed 7-day window, which levers should the Simffee startup change — price, product quality, novelty, interior build-out, or siting — to win sustainable repeat demand away from the incumbent?**

The run is not a forecast. It is a lever-attribution instrument. Success is a report that ranks candidate changes by evidence in the day-by-day agent record, not a revenue number.

v2 adds two levers the player can physically manipulate: **where a shop sits** (§2) and **what is inside it** (§3).

## 2. World model

### 2.1 Grid

The town is a 2-D tile grid rendered as 16×16-pixel pixel art. `data/town.json` declares `grid.width`, `grid.height`, and `tile_size_px`. Origin `(0,0)` is top-left; `x` increases east, `y` increases south. Reference town is 40×30.

### 2.2 Terrain and movement cost

Every tile has exactly one terrain type. `default_terrain` fills the grid; `terrain_overrides` is an ordered list of `{type, rect:[x,y,w,h]}` applied in sequence, last write wins.

| Terrain | Walkable | `move_cost` | Notes |
|---|---|---|---|
| `road` | yes | 1.00 | paved; fastest |
| `dirt` | yes | 1.10 | worn path |
| `grass` | yes | 1.30 | default fill; crossable but slow |
| `water` | no | — | |
| `stone` | no | — | cliff / boulder field |

**Movement cost is the point of the road network.** Grass is 30% slower than road, so laying a path to a shop door is a real, measurable lever the report can recommend (§10, "Improve reach"). A town with no roads is playable but every trip is slow.

### 2.3 Props

`props` is a list of `{type, x, y}` decorations occupying one tile. `tree` and `rock` are **blocking**. All other prop types are walkable decoration and never affect pathfinding.

### 2.4 Structures

`structures` is a list of placed buildings:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | unique key |
| `type` | enum | `house` \| `coffee_shop` \| `tower` |
| `x`, `y`, `w`, `h` | int | footprint rectangle, top-left anchored |
| `door` | `[x, y]` | the single tile agents enter and exit from |
| `occupant` | string \| null | agent `id` for a `house`; `null` otherwise |

Every tile of a footprint is **blocking**. The `door` tile is *outside* the footprint and must be walkable — it is the only point of contact between a building and the street. All distances in this model are measured **door to door**, never centre to centre.

`tower` is a landmark with no simulation effect in v2. It exists so the editor has a non-functional structure to place, which keeps the editor's validation rules honest.

### 2.5 Pathfinding

Agent→shop distance is the **A\* least-cost walkable path from the agent's house `door` to the shop's `door`**, 4-directional (no diagonals). Path cost is the sum of `move_cost` of every tile *entered* (the start tile is not counted).

```
path_cost(i, s) = Σ move_cost(tile) over the least-cost door-to-door route
travel_time(i, s) = path_cost(i, s) / walk_speed_i      [minutes]
```

**Obstacles genuinely block.** Placing a house, pond, or tree line can lengthen or sever a route. This is what makes the town editor strategic rather than cosmetic.

Path costs are **static for a whole run** — the town cannot be edited mid-simulation (§11) — so all 10×2 agent→shop costs are computed once at load and cached. A path of `None` (unreachable) removes that shop from the agent's option set permanently and MUST be surfaced as a load-time warning, not a silent zero.

### 2.6 Reference town — "Marrow Hollow"

Shipped in `data/town.json` as the default layout and the basis for every worked number in this spec. 40×30 grid; Main Street runs east–west at `y = 14–15`; Mill Lane runs north–south at `x = 18–19`; Hollow Pond occupies `[4,22,6,5]`; 13 trees and 1 rock block scattered tiles; ten houses, two coffee shops, one clock tower.

Verified door-to-door path costs (§2.5):

| Agent | House | → `brewhouse` | → `simffee` |
|---|---|---:|---:|
| A01 | house_maya | 29.40 | 9.30 |
| A02 | house_devon | 29.40 | 11.30 |
| A03 | house_harriet | 8.10 | 24.00 |
| A04 | house_jonas | 22.00 | 12.30 |
| A05 | house_priya | 18.40 | 10.30 |
| A06 | house_tom | 7.20 | 17.10 |
| A07 | house_ingrid | 12.00 | 30.40 |
| A08 | house_marcus | 9.60 | 18.30 |
| A09 | house_lena | 29.80 | 13.10 |
| A10 | house_rafael | 38.60 | 18.50 |

The layout is deliberately lopsided: Brewhouse sits west of centre among the older houses, Simffee sits east on Main Street. Six of ten agents are closer to Simffee. That asymmetry is the experiment — a startup that cannot win on a friendly map has a product problem, not a siting problem.

### 2.7 The two shops

Both are `coffee_shop` structures. Simulation-relevant shop fields live in `data/world.json`; placement lives in `data/town.json`, keyed by the same `id`.

| Field | `brewhouse` | `simffee` |
|---|---|---|
| `name` | Brewhouse Corner | Simffee |
| `role` | incumbent | startup |
| `price` | 3.50 | 4.25 |
| `base_craft` | 0.29 | 0.34 |
| `novelty_base` | 0.00 | 1.00 |
| `novelty_decay` | 0.00 | 0.25 |
| `opens_on_day` | 1 (pre-existing) | 1 |

`quality`, `capacity`, `ambience`, `service_slots`, and `service_time_minutes` are **no longer authored** — they are derived from the interior (§3). `base_craft` is barista skill: the quality floor the shop achieves before any equipment.

### 2.8 Novelty

Novelty is a single shop-level decaying scalar:

```
novelty(s, d) = novelty_base_s * exp(-novelty_decay_s * (d - 1))
```

Simffee: 1.000, 0.779, 0.607, 0.472, 0.368, 0.287, 0.223 across days 1–7. Brewhouse: 0.000 throughout.

`menu` in `world.json` flags each item `novel: true|false` for report readability only. No item-level flag ever enters a calculation. Simffee's novel line (cold-brew flight, oat cortado, seasonal syrup bar) is the *reason* `novelty_base = 1.00`, not an input to it.

### 2.9 Global weights and constants

Declared in `data/world.json` under `weights` and `dynamics`.

| Constant | Value | Meaning |
|---|---|---|
| `w_quality` | 1.00 | scales the quality term |
| `w_novelty` | 0.80 | scales the novelty term |
| `w_habit` | 1.20 | scales the loyalty term |
| `w_perception` | 0.60 | scales the perception term |
| `w_price` | 1.00 | scales the price penalty |
| `w_distance` | 1.00 | scales the travel-time penalty |
| `w_wait` | 0.30 | scales the queue-wait satisfaction penalty |
| `reservation_utility` | 0.35 | utility of buying nothing |
| `habit_gain` | 0.25 | loyalty formed per visit |
| `habit_visit_base` | 0.50 | loyalty credit for a merely-neutral visit |
| `loyalty_decay` | 0.10 | fractional loyalty lost per day not visited |
| `expectation_base` | 0.40 | expectation intercept |
| `expectation_slope` | 0.40 | expectation gain per unit `quality_sensitivity` |
| `ambience_cap` | 0.15 | max satisfaction bonus from decor |
| `wom_threshold` | 0.15 | \|satisfaction\| needed to talk about a shop |
| `wom_transmission` | 0.15 | perception shift per word-of-mouth event |
| `day_start` / `day_end` | 06:00 / 18:00 | 720-minute trading day |
| `tick_minutes` | 1.0 | simulation step |
| `seed` | 20260919 | RNG seed |

## 3. Shop interiors

Clicking a `coffee_shop` on the town map enters its interior (§11.2). The interior is **not decoration** — its contents derive five of the shop's simulation parameters.

### 3.1 Interior grid

Each shop carries an `interior` object: `{ grid: {width, height}, items: [{type, x, y}] }`. Interior grids are independent of the town grid and of the building's exterior footprint; a 5×4 exterior may hold a 12×9 interior. Interior tiles have no movement cost — agents inside are abstract occupants, not pathfinding bodies (§11.2).

### 3.2 Furniture catalog

Declared once in `world.json` as `furniture_catalog`. Every item contributes to at most a few of five channels:

| Item | `capacity` | `quality` | `ambience` | `service_slots` | `prep_minutes` |
|---|---:|---:|---:|---:|---:|
| `seat` | 1 | — | — | — | — |
| `window_seat` | 1 | — | 0.05 | — | — |
| `table` | — | — | 0.02 | — | — |
| `counter` | — | — | — | 1 | — |
| `drip_brewer` | — | 0.05 | — | — | 1.5 |
| `espresso_machine` | — | 0.18 | 0.01 | — | 3.0 |
| `pour_over_bar` | — | 0.06 | — | — | 4.0 |
| `cold_brew_tap` | — | 0.12 | — | — | 1.0 |
| `grinder` | — | 0.10 | — | — | — |
| `plant` | — | — | 0.03 | — | — |
| `art` | — | — | 0.04 | — | — |

An item with `prep_minutes` is a **brew device**. `grinder` is not — it raises quality without being a station an order occupies.

### 3.3 Derived shop parameters

```
capacity_s            = Σ capacity over items                    [max concurrent customers inside]
quality_s             = clamp(0, 1, base_craft_s + Σ quality over items)
ambience_s            = min(ambience_cap, Σ ambience over items)
service_slots_s       = Σ service_slots over items               [concurrent orders in progress]
service_time_minutes_s = mean(prep_minutes) over brew devices
```

`service_time_minutes` is the **mean** of the installed brew devices, not the minimum. Installing a slow prestige device (`pour_over_bar`, 4.0 min) raises quality *and* slows every order, because staff split across the menu. This is the interior's central trade-off and the reason the report can recommend removing equipment.

Shop throughput is `service_slots / service_time_minutes` customers per minute. A shop may be quality-rich and throughput-poor; §9 tracks both so §10 can tell them apart.

### 3.4 Validation

A `coffee_shop` interior MUST contain at least one `counter` and at least one brew device, or the shop cannot trade and load fails with a named error. `capacity_s = 0` is legal but means every arriving agent is turned away and logged as capacity-blocked demand — a real, diagnosable configuration, not an error.

## 4. Agent model

Ten agents. Every agent carries exactly these fields — no more, no fewer.

| Field | Type | Range | Meaning |
|---|---|---|---|
| `id` | string | `A01`–`A10` | stable key |
| `name` | string | — | display name |
| `archetype` | string | — | one-line label for the report |
| `home_building_id` | string | — | must match a `house` structure in `town.json` whose `occupant` is this agent |
| `price_sensitivity` | float | 0.0–1.0 | how much cost hurts |
| `quality_sensitivity` | float | 0.0–1.0 | how much quality is valued *and* how high expectations run (§7.1) |
| `novelty_seeking` | float | 0.0–1.0 | pull of a new product |
| `loyalty_strength` | float | 0.0–1.0 | how strongly accumulated habit steers choice |
| `walk_speed` | float | 1.2–3.0 | tiles (cost units) per minute |
| `distance_tolerance` | float | 3.0–30.0 | travel minutes before the trip feels costly |
| `patience_minutes` | float | 2.0–30.0 | queue wait tolerated before abandoning |
| `daily_budget` | float | 2.50–12.00 | max spend per day; also the denominator for price pain |
| `visit_frequency` | float | 0.0–1.0 | daily probability of wanting coffee at all |
| `social_susceptibility` | float | 0.0–1.0 | how much others' perception moves this agent |
| `need_time` | string | `HH:MM` in 06:00–18:00 | when the agent leaves home wanting coffee |
| `wom_propensity` | float | 0.0–1.0 | how loudly this agent broadcasts an opinion |
| `initial_loyalty` | object | each 0.0–1.0 | `{brewhouse, simffee}` habit at Day-1 start |
| `initial_perception` | object | each −1.0–1.0 | `{brewhouse, simffee}` signed awareness×sentiment at Day-1 start |
| `notes` | string | — | the one market behavior this agent is designed to expose |

**Changed from v1:** `home_location` (float on a 1-D street) → `home_building_id`; `need_window` (morning/afternoon enum) → `need_time` (clock time, because arrival order is now emergent); `distance_tolerance` rebased from street units to **minutes**. **Added:** `walk_speed`, `patience_minutes`.

**On `walk_speed`.** The 1.2–3.0 tiles/minute band is deliberately slow. Faster speeds compress every trip in Marrow Hollow into a 1–7 minute range, and distance stops discriminating between agents at all — the model then cannot distinguish a siting problem from a price problem, which defeats §1.

**On `perception`.** A single signed scalar, not separate awareness and sentiment. `0.0` = never heard of the shop; `+1.0` = knows and loves it; `−1.0` = knows it and has been warned off. This collapse is what lets negative word-of-mouth be modeled without a second field (§7.3).

## 5. Utility function

### 5.1 Form

For agent *i*, shop *s*, day *d*:

```
U(i,s,d) =  w_quality    * quality_sensitivity_i   * quality_s
          + w_novelty    * novelty_seeking_i       * novelty(s,d)
          + w_habit      * loyalty_strength_i      * loyalty_i,s(d)
          + w_perception * social_susceptibility_i * perception_i,s(d)
          - w_price      * price_sensitivity_i     * (price_s / daily_budget_i)
          - w_distance   * (travel_time(i,s) / distance_tolerance_i)
```

Buying nothing has fixed utility `reservation_utility = 0.35`.

Every term is a trait × world-fact product, so zeroing any global weight cleanly removes that lever from the run. That property is what §10's attribution depends on.

**Wait time is deliberately absent from choice.** Agents cannot see the queue from home. A bad queue is punished after the fact through satisfaction (§7.1), and only reaches other agents through loyalty and word-of-mouth. This is what lets the report distinguish "nobody comes" from "they come once and never return."

### 5.2 Choice rule

1. Drop any shop that is unreachable (§2.5) or whose `price_s > daily_budget_i`.
2. Compute `U` for each surviving shop.
3. Rank all options including no-purchase; the agent walks to its top-ranked shop.

### 5.3 Tie-breaking

Ties within `1e-9` resolve in order: **higher `quality_s`** → **lower `price_s`** → **shorter `travel_time`** → **lexicographic `shop_id`**. A tie against `reservation_utility` resolves to no-purchase.

### 5.4 Worked example — A01, Day 1

**A01 Maya Okonkwo**, in `house_maya`: `quality_sensitivity` 0.90, `price_sensitivity` 0.25, `novelty_seeking` 0.60, `loyalty_strength` 0.35, `walk_speed` 2.2, `distance_tolerance` 14.0, `patience_minutes` 12.0, `daily_budget` 8.00, `social_susceptibility` 0.45, `initial_loyalty` {brewhouse 0.50, simffee 0.00}, `initial_perception` {brewhouse 0.85, simffee 0.15}.

Path costs from §2.6: brewhouse 29.40, simffee 9.30. At `walk_speed` 2.2 → travel 13.3636 min and 4.2273 min.

**Brewhouse** (quality 0.62, price 3.50, novelty 0.00):

| Term | Arithmetic | Value |
|---|---|---|
| quality | 1.00 × 0.90 × 0.62 | +0.5580 |
| novelty | 0.80 × 0.60 × 0.00 | +0.0000 |
| habit | 1.20 × 0.35 × 0.50 | +0.2100 |
| perception | 0.60 × 0.45 × 0.85 | +0.2295 |
| price | −1.00 × 0.25 × (3.50 / 8.00) | −0.1094 |
| distance | −1.00 × (13.3636 / 14.0) | −0.9545 |
| **U** | | **−0.0664** |

**Simffee** (quality 0.80, price 4.25, novelty 1.00):

| Term | Arithmetic | Value |
|---|---|---|
| quality | 1.00 × 0.90 × 0.80 | +0.7200 |
| novelty | 0.80 × 0.60 × 1.00 | +0.4800 |
| habit | 1.20 × 0.35 × 0.00 | +0.0000 |
| perception | 0.60 × 0.45 × 0.15 | +0.0405 |
| price | −1.00 × 0.25 × (4.25 / 8.00) | −0.1328 |
| distance | −1.00 × (4.2273 / 14.0) | −0.3019 |
| **U** | | **+0.8057** |

No-purchase: 0.3500. **Choice: Simffee** (0.8057 > 0.3500 > −0.0664).

She leaves home at her `need_time`, walks 4.23 minutes, and queues 4.0 minutes behind earlier arrivals. Post-visit, by §7.1:

```
expected_quality = 0.40 + 0.40 × 0.90              = 0.7600
price_pain       = 0.25 × (4.25 / 8.00)            = 0.1328
ambience         (Simffee interior, §3.3)          = 0.1200
wait_penalty     = 0.30 × (4.0 / 12.0)             = 0.1000
satisfaction     = (0.80 − 0.76) − 0.1328 + 0.1200 − 0.1000 = −0.0728
```

By §7.2: `loyalty(simffee) = clamp01(0.00 + 0.25 × (0.50 − 0.0728)) = 0.1068`; `loyalty(brewhouse) = 0.50 × 0.90 = 0.4500`.

By §7.3: `|−0.0728| < 0.15`, so she says nothing.

Read that last line carefully. The most winnable agent on the map — lives beside Simffee, can afford it, values quality most — buys it decisively and walks out with *net-negative* satisfaction, because a 4-minute queue and a 4.25 price cancel a genuinely better cup against her own high expectations. She forms weak habit and generates no word-of-mouth. Surfacing exactly that cell is why this model exists.

## 6. Real-time day loop

v2 replaces v1's fixed morning/afternoon service ordering. **Arrival order, queueing, and contention are emergent** — they fall out of where agents live, how fast they walk, and when they leave.

Each day runs `day_start` → `day_end` (06:00–18:00) in `tick_minutes` = 1-minute steps. Agent states: `idle` → `deciding` → `walking` → `queued` → `served` → `returning` → `idle`.

### 6.1 Day setup (before the first tick)

1. Recompute `novelty(s, d)` for both shops.
2. For each agent, draw `r = rng(seed, d, id)`; the agent will seek coffee this day iff `r < visit_frequency_i`. Agents that will not are `idle` all day and take no further part.
3. Reset per-shop occupancy and queues to empty.

### 6.2 Per-tick sequence

At each minute `t`, in this order:

1. **Departures.** Every agent whose `need_time == t` and who is seeking coffee enters `deciding`, evaluates §5 against the *current* state of loyalty and perception, and either enters `walking` toward its chosen shop's door or, if no option beats `reservation_utility`, is logged as `below_reservation` unmet demand and returns to `idle`.
2. **Movement.** Every `walking` agent advances `walk_speed_i` cost-units along its cached path. On reaching the door it enters `queued` with `queue_entry_time = t`.
3. **Admission.** For each shop, while `occupants < capacity_s` and the queue is non-empty, admit the longest-waiting agent (ties by `id`). An admitted agent records `wait_minutes = t − queue_entry_time` and begins service.
4. **Service.** Each shop serves at most `service_slots_s` orders concurrently; each order takes `service_time_minutes_s`. On completion the agent is `served`, satisfaction resolves (§7.1), the seat frees, and the agent enters `returning`.
5. **Abandonment.** Any `queued` agent whose `t − queue_entry_time > patience_minutes_i` abandons. It is logged as `capacity_blocked` unmet demand against that shop and returns home. **An abandoning agent does not re-choose**; a wasted trip is a wasted trip. It still updates perception downward (§7.3) exactly as if it had been dissatisfied, with `satisfaction = −wom_threshold` assigned for broadcast purposes only.
6. **Return.** `returning` agents walk home and become `idle`. Arriving home has no effect; it exists so the replay view (§11.1) shows a complete day.

### 6.3 End of day

After the last tick, in order: word-of-mouth propagates (§7.3), loyalty updates apply (§7.2), day metrics (§9) are written, and state freezes as Day `d+1` input. Agents still walking or queued at `day_end` are force-abandoned and logged as `closed_before_served`.

**Determinism.** The only stochastic element is the §6.1 need draw, keyed on `(seed, day, agent_id)`. Every other rule is a total order. Two runs of the same town, same data, same seed are byte-identical.

## 7. Feedback loops

### 7.1 Satisfaction

```
expected_quality_i = expectation_base + expectation_slope * quality_sensitivity_i
price_pain_i,s     = price_sensitivity_i * (price_s / daily_budget_i)
wait_penalty_i     = w_wait * (wait_minutes_i / patience_minutes_i)
satisfaction_i,s   = clamp(-1, 1, (quality_s - expected_quality_i)
                                  - price_pain_i,s + ambience_s - wait_penalty_i)
```

Expectations scale with `quality_sensitivity`, so a discerning agent is harder to delight with the same cup. This is what lets the model conclude "high quality is not sufficient" rather than only "high quality wins."

`ambience_s` and `wait_penalty_i` are new in v2 and are the two channels through which the **interior** reaches the simulation: a well-furnished room raises satisfaction, an under-staffed one destroys it. Both are invisible to choice (§5.1) and act only after the visit.

### 7.2 Loyalty / habit

```
chosen shop:      loyalty ← clamp01(loyalty + habit_gain * (habit_visit_base + satisfaction))
every other shop: loyalty ← clamp01(loyalty * (1 - loyalty_decay))
```

Agents that abandoned a queue (§6.2 step 5) count as having chosen **no** shop: every loyalty decays, including toward the shop they failed to reach. The `habit_visit_base` term means a merely-neutral visit still builds habit; only real dissatisfaction (`satisfaction < −0.50`) erodes it.

### 7.3 Word-of-mouth

After the last tick, each agent *i* that visited (or abandoned) a shop *s* with `|satisfaction_i,s| ≥ wom_threshold` broadcasts. For every other agent *j*:

```
Δperception_j,s = wom_transmission * wom_propensity_i * social_susceptibility_j * sign(satisfaction_i,s)
perception_j,s  ← clamp(-1, 1, perception_j,s + Δperception_j,s)
```

All deltas are computed from the pre-step snapshot and applied simultaneously, so ordering within the step cannot matter. Broadcasts do not reach the broadcaster. Perception of shops not visited that day is untouched.

This is the **only** channel by which a startup reaches agents who have never visited it, and it is signed — a bad first week actively poisons reach rather than merely failing to build it.

## 8. Competitor behavior

**Brewhouse is static for v1 and v2.** Its price, `base_craft`, interior, and siting never change during a run.

*Why:* with 10 agents over 7 days, a reactive competitor makes every delta jointly caused. The run would show that something moved without being able to say which lever moved it, which defeats §1. A static incumbent makes Simffee's parameters and placement the only independent variables.

*What it would take to change:* a `reactions` block in `world.json` (trigger condition → parameter delta → response lag in days), plus a paired-run harness that executes the same seed with reactions off and on and reports only the difference. Do not add reactive behavior without that paired-run comparison, or §10's attribution claims become unsupportable.

## 9. Metrics tracked per day

- `visits` — count per shop.
- `revenue` — `visits × price` per shop, plus cumulative.
- `choices` — per agent: `{agent_id, sought_coffee, chosen, utilities:{brewhouse, simffee, none}, travel_minutes, wait_minutes, outcome}` where `outcome` ∈ `served | abandoned | below_reservation | closed_before_served | stayed_home`.
- `switch_events` — agents whose served shop differs from their previous *served* day: `{agent_id, from, to, day}`.
- `satisfaction` — per served agent, plus mean / min / max per shop.
- `queue_profile` — per shop per hour: arrivals, mean wait, max wait, peak occupancy, and minutes spent at full `capacity_s`.
- `unmet_demand` — count and agent ids by cause: `capacity_blocked`, `below_reservation`, `closed_before_served`, `unreachable`.
- `state_snapshot` — every agent's `loyalty` and `perception` for both shops at end of day.
- `derived_shop_stats` — `quality_s`, `capacity_s`, `ambience_s`, `service_slots_s`, `service_time_minutes_s` and throughput, recorded once per run so the report can cite the interior that produced them.

## 10. Output report format

1. **Headline** — one sentence: did Simffee end Day 7 with more repeat demand than it started, and is the trend rising or decaying.
2. **Seven-day trace** — day × shop table of visits, revenue, mean satisfaction, mean wait.
3. **Trial vs. retention split** — of all Simffee visits, how many were first-time (novelty-driven) vs repeat (loyalty-driven), per day. The core diagnostic: novelty decays on a known curve (§2.8), so a visit count falling at that same rate means nothing converted.
4. **Agent ledger** — one row per agent: archetype, visits to each shop, mean travel and wait, end-state loyalty and perception, and whether the agent was ever won.
5. **Loss analysis** — for every agent that never bought from Simffee, the single term in §5.1 with the largest negative contribution to its Simffee utility, averaged over the run. This names the blocking lever per agent.
6. **Throughput analysis** — for each shop, `service_slots / service_time_minutes` against peak arrival rate, plus minutes at full capacity. Separates "nobody wanted it" from "we could not serve them."
7. **Word-of-mouth map** — which agents broadcast, in which direction, and the net perception shift caused per shop.
8. **Unmet demand** — by cause, by day.
9. **Recommendations** — ranked changes. Each states the lever, the direction, the agents it would flip, and the counter-cost, and MUST cite the section and figure supporting it. A recommendation with no citation into §§2–8 must not be emitted.

**Evidence rules for §10.9:**

| Recommendation | Only valid if |
|---|---|
| Lower price | §10.5 names the price term as top blocker for ≥2 agents |
| Raise quality (add equipment) | §10.5 names quality as top blocker, **or** §10.2 mean satisfaction < 0 while visits hold |
| Extend / refresh novelty | §10.3 shows visits tracking the novelty decay curve with repeat share flat |
| Improve siting or paths | §10.5 names the distance term as top blocker for ≥2 agents |
| Improve reach | §10.5 names the perception term as top blocker for ≥2 agents |
| Add seats | §10.8 shows `capacity_blocked` demand on ≥2 days |
| Add a counter / drop a slow brew device | §10.6 shows mean wait > 0.5 × mean `patience` **or** throughput below peak arrival rate |
| Improve ambience | §10.2 mean satisfaction < 0 while §10.5 names no single dominant blocker |

## 11. Presentation layer

Rendering is specified here because siting and interiors are now player-editable inputs. **No rendering code is in scope for the current task** (§12).

### 11.1 Town view

Top-down 2-D pixel-art tile map, Stardew-Valley-styled: 16×16 tiles, nearest-neighbour upscaling, no smoothing. Renders terrain, props, structures, and agent sprites. Controls: pan, zoom, day scrubber, play/pause, speed multiplier.

Playback is a **replay of an already-resolved day**, not a live authority. The simulation (§6) resolves a full day deterministically; the view animates the recorded state. Pausing, scrubbing, or closing the window cannot alter an outcome.

Hovering an agent shows name, archetype, current state, and destination. Selecting one draws its cached path and pins its utility breakdown for the current day.

### 11.2 Interior view

Clicking a `coffee_shop` enters its interior: a separate tile view of the room, its furniture, the agents currently inside, and the queue outside the door. A live panel shows the five derived parameters (§3.3) with the contributing items itemised, so the player can see that removing the `pour_over_bar` trades −0.06 quality for −0.5 mean prep minutes.

Agents inside are rendered as occupants at seats, **not** as pathfinding bodies — there is no interior navigation, no interior collision, and no walking-to-the-counter simulation. Seats are a counter, rendered as furniture.

### 11.3 Town editor

The player builds the town before a run: place and remove `house`, `tower`, and `coffee_shop` structures, paint terrain, and furnish shop interiors. Editing writes `data/town.json` and the `interior` blocks of `data/world.json`.

Placement is rejected, with a named reason, unless all hold:

1. Footprint is fully in bounds and overlaps no other footprint.
2. The `door` tile is in bounds, outside the footprint, orthogonally adjacent to it, and on walkable terrain.
3. No blocking prop occupies the `door` tile.
4. A `house` has exactly one `occupant`, and every agent in `agents.json` owns exactly one house.
5. Every house door can reach every `coffee_shop` door by some walkable path (§2.5).
6. Every `coffee_shop` interior satisfies §3.4.

Rule 5 is the one that bites: walling off a shop with houses or trees is a legal-looking layout that silently destroys the experiment, so it is rejected at edit time rather than discovered as a run of zeroes.

**The editor is unavailable while a run is in progress.** Path costs are cached at load (§2.5) and a mid-run edit would silently invalidate every cached route and every day already simulated.

## 12. Non-goals and known simplifications

Recorded so v3 knows what it inherited.

1. **No rendering, editor, or engine code exists.** This document and `data/town.json` are the only v2 artifacts. `agents.json` and `world.json` are still v1-shaped.
2. **One purchase per agent per day, max.** No second cup, no group orders. `daily_budget` is therefore a price-pain scale more than a real constraint.
3. **Single price point per shop.** `menu` is report decoration; no item-level choice, no attach rate, no food.
4. **Static homes, single destination.** Agents go home → shop → home. No workplace, no commute that happens to pass a door, no errands.
5. **The town cannot be edited mid-run** (§11.3).
6. **Novelty is shop-level on a global clock**, not per-agent-exposure. An agent who never visits still "uses up" the novelty window. This understates how new a late discoverer finds Simffee.
7. **No price-quality inference.** Agents do not read a high price as a quality signal.
8. **No interior navigation.** Seats are a capacity counter (§11.2).
9. **No staffing model.** `service_slots` comes from counters, not from hired baristas with wages, shifts, or skill.
10. **Wait time is invisible to choice** (§5.1). Agents never learn to avoid a peak hour; they only sour on the shop overall.
11. **No time-of-day supply effects.** Price, quality, and staffing are constant across the 12-hour day.
12. **Static competitor** (§8).
13. **No agent entry or exit, no tourists, no weather, no weekday/weekend effect.** Day 3 is structurally identical to Day 6.
14. **Word-of-mouth is a fully-connected broadcast.** No social graph; every talker reaches all nine others, damped only by their own `wom_propensity` and the listener's `social_susceptibility`.
15. **7 days is short for habit formation.** With `habit_gain = 0.25`, loyalty saturates slowly by design; read the direction of the trend, not its level.
