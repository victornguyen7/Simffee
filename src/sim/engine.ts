/**
 * Simffee market engine. Implements SPEC.md sections 4 to 6 exactly.
 * Pure functions, no rendering, no React. Deterministic for a given seed.
 */

import agentsFile from '../../data/agents.json'
import worldFile from '../../data/world.json'

export type ShopId = 'brewhouse' | 'simffee'
export type Choice = ShopId | 'none'
export type NeedWindow = 'morning' | 'afternoon'

export interface Agent {
  id: string
  name: string
  archetype: string
  home_location: number
  price_sensitivity: number
  quality_sensitivity: number
  novelty_seeking: number
  loyalty_strength: number
  distance_tolerance: number
  daily_budget: number
  visit_frequency: number
  social_susceptibility: number
  need_window: NeedWindow
  wom_propensity: number
  initial_loyalty: Record<ShopId, number>
  initial_perception: Record<ShopId, number>
  notes: string
}

export interface Shop {
  id: ShopId
  name: string
  location: number
  price: number
  quality: number
  novelty_base: number
  novelty_decay: number
  capacity: number
}

export interface Weights {
  w_price: number
  w_quality: number
  w_novelty: number
  w_habit: number
  w_distance: number
  w_perception: number
  reservation_utility: number
}

export interface Dynamics {
  habit_gain: number
  loyalty_decay: number
  wom_threshold: number
  wom_transmission: number
  seed: number
}

/** Spec section 2.4. Used only where world.json leaves a field out. */
const SPEC_WEIGHTS: Weights = {
  w_price: 1.0,
  w_quality: 1.0,
  w_novelty: 0.8,
  w_habit: 1.2,
  w_distance: 1.0,
  w_perception: 0.6,
  reservation_utility: 0.35
}

const SPEC_DYNAMICS: Dynamics = {
  habit_gain: 0.25,
  loyalty_decay: 0.1,
  wom_threshold: 0.15,
  wom_transmission: 0.15,
  seed: 20260919
}

const SPEC_SHOPS: Shop[] = [
  {
    id: 'brewhouse',
    name: 'Brewhouse Corner',
    location: 3.0,
    price: 3.5,
    quality: 0.62,
    novelty_base: 0.0,
    novelty_decay: 0.0,
    capacity: 6
  },
  {
    id: 'simffee',
    name: 'Simffee',
    location: 6.0,
    price: 4.25,
    quality: 0.8,
    novelty_base: 1.0,
    novelty_decay: 0.25,
    capacity: 5
  }
]

interface WorldFile {
  shops?: Partial<Shop>[]
  weights?: Partial<Weights>
  dynamics?: Partial<Dynamics>
}

const raw = worldFile as WorldFile

export const AGENTS: Agent[] = (agentsFile as { agents: Agent[] }).agents

export const WEIGHTS: Weights = { ...SPEC_WEIGHTS, ...(raw.weights ?? {}) }
export const DYNAMICS: Dynamics = { ...SPEC_DYNAMICS, ...(raw.dynamics ?? {}) }

export const SHOPS: Shop[] = SPEC_SHOPS.map((fallback) => {
  const found = raw.shops?.find((s) => s.id === fallback.id)
  return { ...fallback, ...(found ?? {}) } as Shop
})

export const DAYS = 7

// ---------------------------------------------------------------- randomness

function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Spec 5.2: one draw per agent per day, stable across runs. */
export function rng(seed: number, day: number, agentId: string): number {
  let t = (fnv1a(`${seed}:${day}:${agentId}`) + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ------------------------------------------------------------------- helpers

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const clamp11 = (v: number): number => Math.max(-1, Math.min(1, v))

/** Spec 4.3. Shop level, global clock, same for everyone. */
export function noveltyOn(shop: Shop, day: number): number {
  return shop.novelty_base * Math.exp(-shop.novelty_decay * (day - 1))
}

export interface AgentState {
  loyalty: Record<ShopId, number>
  perception: Record<ShopId, number>
}

export type StateMap = Record<string, AgentState>

export function initialState(): StateMap {
  const state: StateMap = {}
  for (const a of AGENTS) {
    state[a.id] = {
      loyalty: { ...a.initial_loyalty },
      perception: { ...a.initial_perception }
    }
  }
  return state
}

export interface TermBreakdown {
  quality: number
  novelty: number
  habit: number
  perception: number
  price: number
  distance: number
  total: number
}

/** Spec 4.1. Returns every term so the loss analysis in 9.5 can name a blocker. */
export function utility(agent: Agent, shop: Shop, day: number, state: AgentState): TermBreakdown {
  const quality = WEIGHTS.w_quality * agent.quality_sensitivity * shop.quality
  const novelty = WEIGHTS.w_novelty * agent.novelty_seeking * noveltyOn(shop, day)
  const habit = WEIGHTS.w_habit * agent.loyalty_strength * state.loyalty[shop.id]
  const perception = WEIGHTS.w_perception * agent.social_susceptibility * state.perception[shop.id]
  const price = -WEIGHTS.w_price * agent.price_sensitivity * (shop.price / agent.daily_budget)
  const distance =
    -WEIGHTS.w_distance * (Math.abs(agent.home_location - shop.location) / agent.distance_tolerance)

  return {
    quality,
    novelty,
    habit,
    perception,
    price,
    distance,
    total: quality + novelty + habit + perception + price + distance
  }
}

/** Spec 4.4. Higher quality, then lower price, then id. */
function better(a: Shop, b: Shop): Shop {
  if (a.quality !== b.quality) return a.quality > b.quality ? a : b
  if (a.price !== b.price) return a.price < b.price ? a : b
  return a.id < b.id ? a : b
}

export interface AgentChoice {
  agent_id: string
  wanted_coffee: boolean
  chosen: Choice
  utilities: Record<ShopId, number> & { none: number }
  terms: Record<ShopId, TermBreakdown>
  affordable: Record<ShopId, boolean>
  blocked_by_capacity: boolean
}

/** Spec 4.2, without capacity. Capacity is applied later in the tick order. */
function rank(agent: Agent, day: number, state: AgentState): { shop: Shop; u: number }[] {
  return SHOPS.filter((s) => s.price <= agent.daily_budget)
    .map((shop) => ({ shop, u: utility(agent, shop, day, state).total }))
    .sort((a, b) => {
      if (Math.abs(a.u - b.u) < 1e-9) return better(a.shop, b.shop).id === a.shop.id ? -1 : 1
      return b.u - a.u
    })
}

export interface DayRecord {
  day: number
  novelty: Record<ShopId, number>
  visits: Record<ShopId, number>
  revenue: Record<ShopId, number>
  choices: AgentChoice[]
  satisfaction: { agent_id: string; shop: ShopId; value: number }[]
  switch_events: { agent_id: string; from: Choice; to: Choice; day: number }[]
  unmet_demand: { agent_id: string; cause: 'capacity' | 'below_reservation' }[]
  wom: { from: string; shop: ShopId; sign: number }[]
  state_snapshot: StateMap
}

export interface RunResult {
  days: DayRecord[]
  finalState: StateMap
}

/** Spec 5. One full day, strictly in the documented order. */
export function runDay(
  day: number,
  state: StateMap,
  lastPurchase: Record<string, Choice>
): { record: DayRecord; state: StateMap; lastPurchase: Record<string, Choice> } {
  const nextState: StateMap = {}
  for (const id of Object.keys(state)) {
    nextState[id] = {
      loyalty: { ...state[id].loyalty },
      perception: { ...state[id].perception }
    }
  }

  // 1. novelty
  const novelty: Record<ShopId, number> = {
    brewhouse: noveltyOn(SHOPS.find((s) => s.id === 'brewhouse') as Shop, day),
    simffee: noveltyOn(SHOPS.find((s) => s.id === 'simffee') as Shop, day)
  }

  // 2. need check, and 3. scoring (simultaneous, from the start-of-day state)
  const choices: AgentChoice[] = AGENTS.map((agent) => {
    const wants = rng(DYNAMICS.seed, day, agent.id) < agent.visit_frequency
    const terms = {} as Record<ShopId, TermBreakdown>
    const utilities = { none: WEIGHTS.reservation_utility } as AgentChoice['utilities']
    const affordable = {} as Record<ShopId, boolean>

    for (const shop of SHOPS) {
      terms[shop.id] = utility(agent, shop, day, state[agent.id])
      utilities[shop.id] = terms[shop.id].total
      affordable[shop.id] = shop.price <= agent.daily_budget
    }

    return {
      agent_id: agent.id,
      wanted_coffee: wants,
      chosen: 'none' as Choice,
      utilities,
      terms,
      affordable,
      blocked_by_capacity: false
    }
  })

  // 4. service, in a fixed order: morning then afternoon, each ascending by id
  const order = [...AGENTS].sort((a, b) => {
    if (a.need_window !== b.need_window) return a.need_window === 'morning' ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  const remaining: Record<ShopId, number> = {
    brewhouse: (SHOPS.find((s) => s.id === 'brewhouse') as Shop).capacity,
    simffee: (SHOPS.find((s) => s.id === 'simffee') as Shop).capacity
  }

  const unmet: DayRecord['unmet_demand'] = []

  for (const agent of order) {
    const choice = choices.find((c) => c.agent_id === agent.id) as AgentChoice
    if (!choice.wanted_coffee) continue

    const ranked = rank(agent, day, state[agent.id]).filter((r) => r.u > WEIGHTS.reservation_utility)

    if (ranked.length === 0) {
      unmet.push({ agent_id: agent.id, cause: 'below_reservation' })
      continue
    }

    let served = false
    for (const option of ranked) {
      if (remaining[option.shop.id] > 0) {
        remaining[option.shop.id] -= 1
        choice.chosen = option.shop.id
        served = true
        break
      }
      // top choice was full, so fall through to the next option
      choice.blocked_by_capacity = true
    }

    if (!served) unmet.push({ agent_id: agent.id, cause: 'capacity' })
  }

  // 5. satisfaction
  const satisfaction: DayRecord['satisfaction'] = []
  for (const choice of choices) {
    if (choice.chosen === 'none') continue
    const agent = AGENTS.find((a) => a.id === choice.agent_id) as Agent
    const shop = SHOPS.find((s) => s.id === choice.chosen) as Shop

    const expected = 0.4 + 0.4 * agent.quality_sensitivity
    const pricePain = agent.price_sensitivity * (shop.price / agent.daily_budget)
    const value = clamp11(shop.quality - expected - pricePain)

    satisfaction.push({ agent_id: agent.id, shop: shop.id, value })
  }

  // 6. word of mouth, all deltas computed from the same snapshot then applied
  const wom: DayRecord['wom'] = []
  const deltas: Record<string, Record<ShopId, number>> = {}
  for (const a of AGENTS) deltas[a.id] = { brewhouse: 0, simffee: 0 }

  for (const s of satisfaction) {
    if (Math.abs(s.value) < DYNAMICS.wom_threshold) continue
    const talker = AGENTS.find((a) => a.id === s.agent_id) as Agent
    wom.push({ from: talker.id, shop: s.shop, sign: Math.sign(s.value) })

    for (const listener of AGENTS) {
      if (listener.id === talker.id) continue
      deltas[listener.id][s.shop] +=
        DYNAMICS.wom_transmission * talker.wom_propensity * listener.social_susceptibility * Math.sign(s.value)
    }
  }

  for (const a of AGENTS) {
    for (const shop of SHOPS) {
      nextState[a.id].perception[shop.id] = clamp11(
        nextState[a.id].perception[shop.id] + deltas[a.id][shop.id]
      )
    }
  }

  // 7. loyalty carryover
  for (const choice of choices) {
    const st = nextState[choice.agent_id]
    if (choice.chosen === 'none') {
      for (const shop of SHOPS) st.loyalty[shop.id] = clamp01(st.loyalty[shop.id] * (1 - DYNAMICS.loyalty_decay))
      continue
    }

    const sat = satisfaction.find((s) => s.agent_id === choice.agent_id)?.value ?? 0
    for (const shop of SHOPS) {
      if (shop.id === choice.chosen) {
        st.loyalty[shop.id] = clamp01(st.loyalty[shop.id] + DYNAMICS.habit_gain * (0.5 + sat))
      } else {
        st.loyalty[shop.id] = clamp01(st.loyalty[shop.id] * (1 - DYNAMICS.loyalty_decay))
      }
    }
  }

  // switches, measured against the previous purchasing day only
  const switch_events: DayRecord['switch_events'] = []
  const nextPurchase = { ...lastPurchase }
  for (const choice of choices) {
    if (choice.chosen === 'none') continue
    const previous = lastPurchase[choice.agent_id]
    if (previous && previous !== choice.chosen) {
      switch_events.push({ agent_id: choice.agent_id, from: previous, to: choice.chosen, day })
    }
    nextPurchase[choice.agent_id] = choice.chosen
  }

  const visits: Record<ShopId, number> = { brewhouse: 0, simffee: 0 }
  for (const c of choices) if (c.chosen !== 'none') visits[c.chosen] += 1

  const revenue: Record<ShopId, number> = {
    brewhouse: visits.brewhouse * (SHOPS.find((s) => s.id === 'brewhouse') as Shop).price,
    simffee: visits.simffee * (SHOPS.find((s) => s.id === 'simffee') as Shop).price
  }

  return {
    record: {
      day,
      novelty,
      visits,
      revenue,
      choices,
      satisfaction,
      switch_events,
      unmet_demand: unmet,
      wom,
      state_snapshot: nextState
    },
    state: nextState,
    lastPurchase: nextPurchase
  }
}

export function runAll(days = DAYS): RunResult {
  let state = initialState()
  let lastPurchase: Record<string, Choice> = {}
  const records: DayRecord[] = []

  for (let day = 1; day <= days; day++) {
    const stepped = runDay(day, state, lastPurchase)
    records.push(stepped.record)
    state = stepped.state
    lastPurchase = stepped.lastPurchase
  }

  return { days: records, finalState: state }
}

// ------------------------------------------------------------------ self test

/**
 * Checks the engine against the worked example in SPEC.md 4.5.
 * If this fails, the numbers in any report are not trustworthy.
 */
export function selfTest(): { pass: boolean; details: string[] } {
  const details: string[] = []
  const a01 = AGENTS.find((a) => a.id === 'A01')
  if (!a01) return { pass: false, details: ['A01 missing from agents.json'] }

  const state: AgentState = {
    loyalty: { ...a01.initial_loyalty },
    perception: { ...a01.initial_perception }
  }

  const brew = utility(a01, SHOPS.find((s) => s.id === 'brewhouse') as Shop, 1, state).total
  const sim = utility(a01, SHOPS.find((s) => s.id === 'simffee') as Shop, 1, state).total

  const near = (got: number, want: number, label: string): boolean => {
    const ok = Math.abs(got - want) < 0.0005
    details.push(`${label}: got ${got.toFixed(4)}, spec says ${want.toFixed(4)} ${ok ? 'ok' : 'MISMATCH'}`)
    return ok
  }

  const pass = [near(brew, 0.0881, 'A01 day 1 brewhouse'), near(sim, 1.0577, 'A01 day 1 simffee')].every(Boolean)

  return { pass, details }
}
