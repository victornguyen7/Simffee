import type { Row, Runs, Twin } from '../types'
import { cellToTile } from './model'

export interface AgentState {
  twin: Twin
  row: Row | undefined
  /** tile-space position, fractional */
  pos: [number, number]
  walking: boolean
  bubble: { text: string; tone: 'think' | 'talk' } | null
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Walk along the lanes: first on the x axis, then on the y axis. */
function pathPoint(from: [number, number], to: [number, number], t: number): [number, number] {
  const legX = Math.abs(to[0] - from[0])
  const legY = Math.abs(to[1] - from[1])
  const total = legX + legY
  if (total === 0) return from
  const travelled = t * total
  if (travelled <= legX) return [lerp(from[0], to[0], legX === 0 ? 1 : travelled / legX), from[1]]
  return [to[0], lerp(from[1], to[1], legY === 0 ? 1 : (travelled - legX) / legY)]
}

export function targetTile(runs: Runs, row: Row | undefined, twin: Twin): [number, number] {
  if (!row || row.choice === 'none') return cellToTile(twin.home[0], twin.home[1])
  const shop = runs.shops[row.choice]
  return cellToTile(shop.position[0], shop.position[1])
}

/**
 * Where everyone is at `phase` (0..1) of the given day.
 * 0–0.55 walking to the chosen shop, 0.55–0.85 standing there thinking,
 * 0.85–1 heading home while the gossip lands.
 */
export function agentsAt(runs: Runs, rows: Row[], phase: number, selected: string | null): AgentState[] {
  const byTwin = new Map(rows.map((r) => [r.twin, r]))
  return runs.twins.map((twin) => {
    const row = byTwin.get(twin.id)
    const home = cellToTile(twin.home[0], twin.home[1])
    const dest = targetTile(runs, row, twin)
    const skipped = !row || row.choice === 'none'

    let pos: [number, number]
    let walking = true
    if (skipped) {
      // a skipped coffee: a short loop around the block and back home
      const wander: [number, number] = [home[0] + 1, home[1] + 1]
      pos = phase < 0.5 ? pathPoint(home, wander, phase / 0.5) : pathPoint(wander, home, (phase - 0.5) / 0.5)
    } else if (phase < 0.55) {
      pos = pathPoint(home, dest, phase / 0.55)
    } else if (phase < 0.85) {
      pos = dest
      walking = false
    } else {
      pos = pathPoint(dest, home, (phase - 0.85) / 0.15)
    }

    let bubble: AgentState['bubble'] = null
    if (row) {
      const isSelected = selected === twin.id
      if (phase >= 0.55 && phase < 0.85 && (row.mode === 'reappraisal' || isSelected)) {
        bubble = { text: row.reasoning, tone: 'think' }
      } else if (phase >= 0.85 && row.told.length > 0) {
        const names = row.told
          .map((id) => runs.twins.find((t) => t.id === id)?.name ?? id)
          .join(', ')
        bubble = { text: `tells ${names} about it`, tone: 'talk' }
      } else if (isSelected) {
        bubble = { text: row.reasoning, tone: 'think' }
      }
    }

    return { twin, row, pos, walking, bubble }
  })
}

export function rowsFor(runs: Runs, scenario: string, seed: number, day: number): Row[] {
  const seedRun = runs.scenarios[scenario]?.seeds[String(seed)]
  if (!seedRun) return []
  return seedRun.rows.filter((r) => r.day === day)
}

export function salesFor(runs: Runs, scenario: string, seed: number, day: number) {
  const seedRun = runs.scenarios[scenario]?.seeds[String(seed)]
  if (!seedRun) return { simffee: 0, starbucks: 0 }
  return {
    simffee: seedRun.daily_sales.simffee?.[day - 1] ?? 0,
    starbucks: seedRun.daily_sales.starbucks?.[day - 1] ?? 0,
  }
}
