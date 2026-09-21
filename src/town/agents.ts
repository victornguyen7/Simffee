import type { Row, Runs, Twin, WhatIfAnswer } from '../types'
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

/** Everyone heading to the same shop stands on their own spot in front of it. */
const QUEUE_SPOTS: [number, number][] = [
  [0, 0],
  [0.7, 0],
  [0, 0.7],
  [0.7, 0.7],
  [-0.7, 0],
  [0, -0.7],
  [-0.7, 0.7],
  [0.7, -0.7],
  [-0.7, -0.7],
  [1.4, 0],
]

/**
 * Where everyone is at `phase` (0..1) of the given day.
 * 0–0.55 walking to the chosen shop, 0.55–0.85 standing there thinking,
 * 0.85–1 heading home while the gossip lands.
 */
export function agentsAt(runs: Runs, rows: Row[], phase: number, selected: string | null): AgentState[] {
  const byTwin = new Map(rows.map((r) => [r.twin, r]))
  const taken = new Map<string, number>()
  return runs.twins.map((twin) => {
    const row = byTwin.get(twin.id)
    const home = cellToTile(twin.home[0], twin.home[1])
    const base = targetTile(runs, row, twin)
    const queued = taken.get(base.join()) ?? 0
    taken.set(base.join(), queued + 1)
    const spot = QUEUE_SPOTS[queued % QUEUE_SPOTS.length]
    const dest: [number, number] = [base[0] + spot[0], base[1] + spot[1]]
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
    const isSelected = selected === twin.id
    // with a twin pinned the town stays readable: only their bubble shows
    if (row && (isSelected || !selected)) {
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

export function salesFor(runs: Runs, scenario: string, seed: number, day: number): Record<string, number> {
  const seedRun = runs.scenarios[scenario]?.seeds[String(seed)]
  const out: Record<string, number> = {}
  for (const id of Object.keys(runs.shops)) out[id] = seedRun?.daily_sales[id]?.[day - 1] ?? 0
  return out
}

export function movementReasons(answer: WhatIfAnswer, twins: Twin[], windowDays: 2 | 3) {
  const seeds = Object.keys(answer.result ?? {}).map(Number).sort((a, b) => a - b)
  const seed = seeds.includes(0) ? 0 : seeds[0] ?? 0
  const runId = answer.run_id ?? answer.scenario?.id
  const rows = (answer.result?.[String(seed)]?.rows ?? []).filter((row) =>
    row.seed === seed && row.scenario === runId)
  const lastDay = answer.days ?? answer.scenario?.days ?? Math.max(0, ...rows.map((row) => row.day))
  const actionDays = (answer.scenario?.overrides ?? []).flatMap((override) => {
    const entering = override.set?.exists_from_day
    const otherChanges = Object.keys(override.set ?? {}).some((key) => key !== 'exists_from_day' && !key.startsWith('prompt.'))
      || (override.unset?.length ?? 0) > 0
    return [
      ...(typeof entering === 'number' ? [entering] : []),
      ...(otherChanges ? [override.from_day] : []),
    ]
  }).filter((day) => Number.isInteger(day) && day >= 1)
  const firstChange = actionDays.length ? Math.min(...actionDays) : 2
  const startDay = Math.max(1, Math.min(firstChange - 1, lastDay - 1))
  const endDay = Math.min(lastDay, startDay + windowDays - 1)
  const byDay = new Map(rows.map((row) => [`${row.twin}:${row.day}`, row]))
  const twinIds = [...new Set([...twins.map((twin) => twin.id), ...rows.map((row) => row.twin)])].sort()
  const missing = new Set<string>()
  const changes: { twin: string; fromDay: number; day: number; from: string; to: string; reason: string; driver: string }[] = []
  for (let day = startDay + 1; day <= endDay; day++) {
    for (const twin of twinIds) {
      const before = byDay.get(`${twin}:${day - 1}`)
      const after = byDay.get(`${twin}:${day}`)
      if (!before || !after || before.llm_failed || after.llm_failed
        || before.decision_source === 'fallback' || after.decision_source === 'fallback') {
        missing.add(twin)
        continue
      }
      if (before.choice !== after.choice) {
        changes.push({ twin, fromDay: day - 1, day, from: before.choice, to: after.choice,
          reason: after.reasoning, driver: after.primary_driver })
      }
    }
  }
  return { seed, startDay, endDay, changes, incomplete: missing.size > 0, available: rows.length > 0 && endDay > startDay }
}
