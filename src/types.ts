export type ShopId = 'simffee' | 'starbucks'
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
  why_excerpt: string[]
  say_do_gap: string | null
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
}

export interface SeedRun {
  rows: Row[]
  daily_sales: Record<string, number[]>
}

export interface Scenario {
  label: string
  parent: string | null
  from_day: number
  seeds: Record<string, SeedRun>
}

export interface WhatIf {
  scenario: string
  label: string
  returns: number
  of: number
  returned: string[]
  confidence: number
  confidence_detail: { stability: number; support: number; unmeasured: boolean; reason: string | null }
}

export interface Analysis {
  break_day: number
  drop: number
  naive: { driver: string; magnitude: number; label: string }
  actual: { driver: string; histogram: Record<string, number>; switchers: string[] }
  surprise: boolean
  impact: {
    lost_total: number
    lost_by_decision: number
    lost_anyway: number
    per_twin: { twin: string; baseline: Choice; cf_null: Choice; attributed: boolean }[]
  }
  evidence: (Row & { kind: string })[]
  confidence: { value: number; stability: number; support: number; unmeasured: boolean; reason: string | null }
  narration: string | null
  whatif: WhatIf[]
}

export interface Runs {
  meta: {
    twins: number
    days: number
    seeds: number[]
    default_seed: number
    generated_at: string
    synthetic_label: string
  }
  shops: Record<ShopId, Shop>
  twins: Twin[]
  scenarios: Record<string, Scenario>
  analysis: Analysis
}
