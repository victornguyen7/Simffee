/**
 * Reader for public/runs.json.
 *
 * The model lives in Python now. This file only reads what it produced, which
 * is deliberate: a second implementation in TypeScript is a second thing that
 * can quietly disagree with the real one.
 */

import type { Confidence, Row, Runs } from '../types'

// One description of runs.json, in src/types.ts (AUDIT_FIX_PLAN #26); re-exported here for the
// pages that read the bundle through this module.
export type { Analysis, Confidence, Row, Runs, Scenario, Twin, WhatIf } from '../types'

/** The shops that have a drawn interior and a town sprite. Not the same as a data shop id,
 *  which is any key of `runs.shops` (src/types.ts `ShopId`). */
export type ShopId = 'simffee' | 'starbucks'

let runsJson: Promise<unknown> | null = null

/** runs.json, fetched once per page load and shared by every page (it is read-only data).
 *  It sits in public/, so it is served next to the app at BASE_URL. A failed load is not
 *  cached, so opening another page retries it. */
export function loadRuns(): Promise<Runs> {
  runsJson ??= fetch(`${import.meta.env.BASE_URL}runs.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`runs.json failed to load (${res.status})`)
      return res.json() as Promise<unknown>
    })
    .catch((reason: unknown) => {
      runsJson = null
      throw reason
    })
  return runsJson as Promise<Runs>
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
