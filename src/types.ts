/** Shop ids are data, not a type union: the bundle can carry any shops (SPEC_FUNCTIONAL 6). */
export type ShopId = string
export type Choice = ShopId | 'none'

export interface Shop {
  name: string
  position: [number, number]
  price: Record<string, number>
  open: string
  close: string
  products: string[]
  quality: number
  avg_wait_min: number
  marketing: { reach: number; message: string }
  permanently_closed?: boolean
  prompt?: { shop_label?: string }
}

export interface TwinProfile {
  age: number
  occupation: string
  usual_time: string
  usual_order: string
  daily_budget_vnd: number
  walk_tolerance: number
  wait_tolerance_min: number
}

export interface Twin {
  id: string
  name: string
  home: [number, number]
  profile: TwinProfile
  why_excerpt: { q: string; a: string }[]
  say_do_gap: unknown | null
}

export interface Row {
  scenario: string
  seed: number
  day: number
  twin: string
  mode: 'autopilot' | 'reappraisal'
  disruption: { score: number; source: string }
  state_before: { habit: Record<string, number>; latent_interest: Record<string, number> }
  choice: Choice
  spent: number
  abandoned: boolean
  primary_driver: string
  secondary_driver: string | null
  valence: number
  reasoning: string
  state_after: { habit: Record<string, number>; latent_interest: Record<string, number> }
  told: string[]
  llm_failed: boolean
  decision_source?: 'autopilot' | 'rule' | 'llm' | 'fallback'
  llm_model?: string | null
}

export interface Coverage {
  complete: boolean
  fallbacks: number
  reappraisals: number
  rows: number
}

export interface SeedRun {
  rows: Row[]
  daily_sales: Record<string, number[]>
  coverage?: Coverage
}

/** One override block, SPEC_FUNCTIONAL 2. */
export interface Override {
  from_day: number
  shop: ShopId
  set?: Record<string, unknown>
  unset?: string[]
}

export interface ScenarioSource {
  kind: 'authored' | 'user'
  text?: string
  translator_model?: string
}

export interface Scenario {
  label: string
  role?: 'baseline' | 'control' | 'whatif' | null
  parent: string | null
  from_day: number
  days?: number
  overrides?: Override[]
  source?: ScenarioSource
  seeds: Record<string, SeedRun>
}

export interface Confidence {
  value: number | null
  stability?: number | null
  support?: number | null
  unmeasured: boolean
  reason?: string | null
  partial?: boolean
}

export interface Revenue {
  from_day: number
  days: number
  baseline: number
  branch: number
  delta: number
  delta_per_day: number
}

export interface WhatIf {
  scenario: string
  label: string
  returns: number | null
  of: number | null
  returned: string[]
  /** Focus-shop takings from the fork day on, branch vs baseline. Present since bundle v3. */
  revenue?: Revenue
  confidence: number | null
  confidence_detail: Confidence
  flows?: Flows
}

/** `complete: false` means fallbacks or no measured break; every causal field is then null. */
export interface Analysis {
  complete: boolean
  reason?: string | null
  focus_shop?: string
  control?: string | null
  break_day: number | null
  drop: number | null
  direction?: 'drop' | 'rise' | null
  magnitude?: number | null
  naive: { driver: string | null; magnitude: number; label: string } | null
  actual: { driver: string | null; histogram: Record<string, number>; switchers: string[] } | null
  surprise: boolean | null
  impact: {
    lost_total: number | null
    lost_by_decision: number | null
    lost_anyway: number | null
    per_twin: { twin: string; baseline: Choice; cf_null: Choice; attributed: boolean }[]
  } | null
  evidence: (Row & { kind: string })[]
  confidence: Confidence
  narration: string | null
  whatif: WhatIf[]
  // ROADMAP B3 / B5 — generic, present even when the causal analysis is withheld
  question?: Question | null
  flows?: Flows | null
  hero_agreement?: Record<string, HeroAgreement> | null
}

export interface Question {
  situation: 'incumbent_change' | 'competitor_enters'
  question: string
  leads_with: string[]
  entrant: { shop: string; day: number } | null
}

export interface FlowGroup {
  twins: string[]
  count: number
  drivers: Record<string, number>
}

export interface FlowDay {
  day: number
  lost_to: Record<string, FlowGroup>
  gained_from: Record<string, FlowGroup>
  returned: string[]
  lost: number
  gained: number
  net: number
}

export interface Flows {
  focus_shop: string
  days: number
  by_day: FlowDay[]
  totals: {
    lost_to: Record<string, string[]>
    gained_from: Record<string, string[]>
    returned: string[]
    moves: number
    fallback_moves: number
  }
  end: {
    start_customers: string[]
    end_customers: string[]
    kept: string[]
    lost: Record<string, string[]>
    gained: Record<string, string[]>
    net: number
  }
}

export interface HeroAgreement {
  compare_to: string
  label: string
  value: number | null
  reappraisal_value: number | null
  seeds: Record<string, { value: number | null; reappraisal_value: number | null; twin_days: number }>
}

export interface Runs {
  meta: {
    version?: number
    twins: number
    days: number
    seeds: number[]
    default_seed: number
    focus_shop?: string
    roles?: { baseline: string; control: string | null; whatifs: string[] }
    generated_at: string
    synthetic_label: string
    publishable?: boolean
    synthetic_run?: boolean
  }
  shops: Record<ShopId, Shop>
  twins: Twin[]
  scenarios: Record<string, Scenario>
  analysis: Analysis
}

/** The focus shop: what the bundle says, else the first shop listed. */
export function focusShopOf(runs: Runs): ShopId {
  return runs.meta.focus_shop ?? runs.analysis.focus_shop ?? Object.keys(runs.shops)[0]
}

/** The other shops, in bundle order. */
export function otherShopsOf(runs: Runs): ShopId[] {
  const focus = focusShopOf(runs)
  return Object.keys(runs.shops).filter((s) => s !== focus)
}

// --- local what-if API (api/server.py) -------------------------------------------------------

export interface Unsupported {
  text: string
  reason: string
  nearest: string | null
}

export interface CostRow {
  reasoned: number
  on_habit: number
  responses: number
  cache_hits: number
  fallbacks: number
  tokens_in: number
  tokens_out: number
  took_ms: number | null
  cost: { usd: number | null; verified: boolean; note?: string | null }
}

export interface UserScenario {
  id: string
  parent: string | null
  label: string
  role?: string
  days: number
  focus_shop: string
  situation?: string
  source?: ScenarioSource
  overrides: Override[]
  unsupported?: Unsupported[]
}

export interface WhatIfAnswer {
  error?: string
  scenario: UserScenario | null
  unsupported?: Unsupported[]
  problems?: string[]
  translation?: { cached: boolean; attempts: number }
  fresh?: boolean
  request_text?: string
  took_ms?: number
  // present when a run happened
  run_id?: string
  days?: number
  seeds?: number[]
  chip?: string
  result?: Record<string, SeedRun>
  analysis?: Analysis
  flows?: Flows | null
  flows_seed?: number
  flows_reason?: string | null
  review?: AIReview
  cost?: CostRow
  warning?: string | null
  fallback_reasons?: Record<string, number> | null
  fallback_used?: boolean
  reason?: string
  served?: { scenario: string; label: string; overlap: number; whatif: WhatIf | null } | null
  pending_run_id?: string
}

export interface AIReview {
  status: 'reviewing' | 'consistent' | 'needs_attention' | 'unavailable'
  summary: string
  issues: string[]
  model?: string
  cached?: boolean
  usage?: { input_tokens: number; output_tokens: number }
}

export interface Health {
  ok: boolean
  offline: boolean
  llm: boolean
  model: string
  translator_model?: string
  reasoning_effort?: string | null
  fresh_runs?: boolean
  library_seeds: number[]
  cache_files: number
  live_runs: number
}
