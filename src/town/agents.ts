import type { Row, Runs, Twin } from '../types'
import { cellToTile, GRID, idx, type Town } from './model'

export interface AgentState {
  twin: Twin
  row: Row | undefined
  /** tile-space position, fractional */
  pos: [number, number]
  walking: boolean
  bubble: { text: string; tone: 'think' | 'talk' } | null
}

const routeCache = new Map<string, [number, number][]>()

function routeKey(from: [number, number], to: [number, number]) {
  return `${from[0]},${from[1]}>${to[0]},${to[1]}`
}

function isWalkable(town: Town, x: number, y: number, start: [number, number], goal: [number, number]) {
  if ((x === start[0] && y === start[1]) || (x === goal[0] && y === goal[1])) return true
  return (
    town.ground[idx(x, y)] === 'path' ||
    town.ground[idx(x, y)] === 'plaza' ||
    town.ground[idx(x, y)] === 'sand'
  ) && town.props[idx(x, y)] === 'none'
}

export function routeBetween(town: Town, from: [number, number], to: [number, number]): [number, number][] {
  const start: [number, number] = [Math.round(from[0]), Math.round(from[1])]
  const goal: [number, number] = [Math.round(to[0]), Math.round(to[1])]
  const key = routeKey(start, goal)
  const cached = routeCache.get(key)
  if (cached) return cached
  if (start[0] === goal[0] && start[1] === goal[1]) {
    const same = [start]
    routeCache.set(key, same)
    return same
  }

  const queue: [number, number][] = [start]
  const previous = new Map<string, [number, number] | null>([[start.join(','), null]])
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current[0] === goal[0] && current[1] === goal[1]) break
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next: [number, number] = [current[0] + dx, current[1] + dy]
      const nextKey = next.join(',')
      if (
        next[0] < 0 ||
        next[1] < 0 ||
        next[0] >= GRID ||
        next[1] >= GRID ||
        previous.has(nextKey) ||
        !isWalkable(town, next[0], next[1], start, goal)
      ) {
        continue
      }
      previous.set(nextKey, current)
      queue.push(next)
    }
  }

  const route: [number, number][] = []
  let current: [number, number] | undefined = goal
  while (current) {
    route.push(current)
    current = previous.get(current.join(',')) ?? undefined
  }
  if (!previous.has(goal.join(','))) {
    const fallback = [from, to]
    routeCache.set(key, fallback)
    return fallback
  }
  route.reverse()
  routeCache.set(key, route)
  return route
}

function pointOnRoute(route: [number, number][], progress: number): [number, number] {
  if (route.length === 1) return route[0]
  const lengths = route.slice(1).map((point, i) => Math.hypot(point[0] - route[i][0], point[1] - route[i][1]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let distance = Math.max(0, Math.min(1, progress)) * total
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i]) {
      const ratio = lengths[i] === 0 ? 1 : distance / lengths[i]
      return [
        route[i][0] + (route[i + 1][0] - route[i][0]) * ratio,
        route[i][1] + (route[i + 1][1] - route[i][1]) * ratio,
      ]
    }
    distance -= lengths[i]
  }
  return route[route.length - 1]
}

function routedPoint(town: Town, from: [number, number], to: [number, number], progress: number) {
  return pointOnRoute(routeBetween(town, from, to), progress)
}

function wanderTarget(town: Town, home: [number, number]): [number, number] {
  const queue: { point: [number, number]; distance: number }[] = [{ point: home, distance: 0 }]
  const seen = new Set([home.join(',')])
  for (let head = 0; head < queue.length; head++) {
    const { point, distance } = queue[head]
    if (distance >= 2 && isWalkable(town, point[0], point[1], home, home)) return point
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next: [number, number] = [point[0] + dx, point[1] + dy]
      const key = next.join(',')
      if (
        next[0] < 0 ||
        next[1] < 0 ||
        next[0] >= GRID ||
        next[1] >= GRID ||
        seen.has(key) ||
        !isWalkable(town, next[0], next[1], home, home)
      ) {
        continue
      }
      seen.add(key)
      queue.push({ point: next, distance: distance + 1 })
    }
  }
  return home
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
export function agentsAt(
  runs: Runs,
  town: Town,
  rows: Row[],
  phase: number,
  selected: string | null,
): AgentState[] {
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
      // a skipped coffee: a short loop along the nearest lane and back home
      const wander = wanderTarget(town, home)
      pos = phase < 0.5
        ? routedPoint(town, home, wander, phase / 0.5)
        : routedPoint(town, wander, home, (phase - 0.5) / 0.5)
    } else if (phase < 0.55) {
      const routeProgress = phase / 0.55
      pos = routedPoint(town, home, base, routeProgress)
      if (routeProgress > 0.9) {
        const blend = (routeProgress - 0.9) / 0.1
        pos = [pos[0] + spot[0] * blend, pos[1] + spot[1] * blend]
      }
    } else if (phase < 0.85) {
      pos = dest
      walking = false
    } else {
      const routeProgress = (phase - 0.85) / 0.15
      pos = routedPoint(town, base, home, routeProgress)
      if (routeProgress < 0.1) {
        const blend = 1 - routeProgress / 0.1
        pos = [pos[0] + spot[0] * blend, pos[1] + spot[1] * blend]
      }
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
