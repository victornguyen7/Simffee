/**
 * Reader for public/runs.json.
 *
 * The model lives in Python now. This file only reads what it produced, which
 * is deliberate: a second implementation in TypeScript is a second thing that
 * can quietly disagree with the real one.
 */

export type ShopId = 'simffee' | 'starbucks'

/** What a twin did on one day, under one scenario, on one seed. */
export interface Row {
  scenario: string
  seed: number
  day: number
  twin: string
  mode: string
  disruption: { score: number; source: string }
  /** The shop they bought from, or something else entirely if they went without. */
  choice: string
  spent: number
  abandoned: boolean
  primary_driver: string | null
  secondary_driver: string | null
  valence: number
  /** One sentence in the twin's own voice. Goes straight into a speech bubble. */
  reasoning: string
  told: string[]
  llm_failed: boolean
}

export type Driver =
  | 'habit'
  | 'hours'
  | 'price'
  | 'distance'
  | 'wait'
  | 'product'
  | 'curiosity'
  | 'social'
  | 'quality'

export interface Confidence {
  value: number | null
  stability?: number
  support?: number
  unmeasured: boolean
  reason: string | null
  low_confidence?: boolean
}

export interface WhatIf {
  scenario: string
  label: string
  returns: number
  of: number
  returned: string[]
  confidence: number | null
  confidence_detail: Confidence
}

interface State {
  habit: Record<string, number>
  latent_interest: Record<string, number>
}

export interface EvidenceRow extends Row {
  state_before: State
  state_after: State
  kind: string
}

export interface Analysis {
  complete: boolean
  break_day: number | null
  drop?: number | null
  reason?: string
  naive?: { driver: Driver; magnitude: number; label: string } | null
  actual?: { driver: Driver; histogram: Record<Driver, number>; switchers: string[] } | null
  surprise?: boolean | null
  impact?: {
    lost_total: number
    lost_by_decision: number
    lost_anyway: number
    per_twin: { twin: string; baseline: string; cf_null: string; attributed: boolean }[]
  } | null
  evidence?: EvidenceRow[]
  confidence?: Confidence
  narration?: string | null
  whatif?: WhatIf[]
}

export interface Scenario {
  label: string
  parent: string | null
  from_day: number
  seeds: Record<string, { rows: Row[] }>
}

export interface Twin {
  id: string
  name: string
  home: [number, number]
  profile: Record<string, unknown>
  why_excerpt: { q: string; a: string }[]
  say_do_gap?: unknown
}

export interface ShopInfo {
  name: string
  price: Record<string, number>
  open: string
  close: string
  quality: number
  avg_wait_min: number
}

export interface Runs {
  meta: {
    twins: number
    days: number
    seeds: number[]
    default_seed: number
    generated_at: string
    /** The disclaimer the protocol requires on every screen. */
    synthetic_label: string
  }
  shops: Record<string, ShopInfo>
  twins: Twin[]
  scenarios: Record<string, Scenario>
  analysis: Analysis
}

/** runs.json sits in public/, so Vite serves it straight from the site root. */
export async function loadRuns(): Promise<Runs> {
  const res = await fetch('/runs.json')
  if (!res.ok) throw new Error(`runs.json failed to load (${res.status})`)
  return (await res.json()) as Runs
}

export function scenarioIds(runs: Runs): string[] {
  // baseline first, counterfactuals after, so the switcher reads in story order
  const ids = Object.keys(runs.scenarios)
  return ids.sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b)))
}

/** Every row for one scenario, seed and day. */
export function rowsFor(runs: Runs, scenario: string, seed: number, day: number): Row[] {
  const s = runs.scenarios[scenario]
  if (!s) return []
  const bucket = s.seeds[String(seed)] ?? s.seeds[String(runs.meta.default_seed)]
  if (!bucket) return []
  return bucket.rows.filter((r) => r.day === day)
}

/** Maps a row's choice onto a shop in the village, or null if they went without. */
export function shopOfChoice(choice: string, abandoned: boolean): ShopId | null {
  if (abandoned) return null
  if (choice === 'simffee' || choice === 'starbucks') return choice
  return null
}

export function twinName(runs: Runs, id: string): string {
  return runs.twins.find((twin) => twin.id === id)?.name ?? id
}

export function lowConfidence(c: Confidence | null | undefined, value: number | null = c?.value ?? null): boolean {
  return !!c && !c.unmeasured && value != null && (c.low_confidence ?? value < 0.5)
}
