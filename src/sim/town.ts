/**
 * The village. X positions still come from the spec's 1-D main street, so
 * distances in the model match what you see, but depth is used freely to make
 * it read as a town rather than a row of houses.
 */

/**
 * The village no longer imports the old TypeScript engine. The model is Python
 * and its output arrives as runs.json, so the town only needs to know the shape
 * of the place. Names and prices are filled in from the run at startup.
 */
export type { ShopId } from './runs'
import type { ShopId } from './runs'

/** Ten house plots along the street, spread so the rows stagger nicely. */
const HOME_SLOTS = [0.7, 1.9, 3.1, 4.3, 5.5, 6.7, 7.9, 9.1, 10.0, 2.5]

/** Starbucks is the incumbent on the left, Simffee the newcomer opposite. */
const SHOP_DEFS: { id: ShopId; name: string; location: number }[] = [
  { id: 'starbucks', name: 'Starbucks', location: 3.0 },
  { id: 'simffee', name: 'Simffee Coffee', location: 6.6 }
]

export const T = 28
export const TILES_PER_UNIT = 8

export const WORLD_W = Math.round(11.4 * TILES_PER_UNIT * T)
export const WORLD_H = 56 * T

/** The main road runs across the middle of the map. */
export const ROAD_TOP = 30 * T
export const ROAD_BOTTOM = 34 * T

export type BuildingKind = 'home' | 'shop'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Building {
  id: string
  kind: BuildingKind
  shopId?: ShopId
  label: string
  sublabel?: string
  box: Rect
  door: Rect
  roof: string
  wall: string
}

export function unitToX(unit: number): number {
  return Math.round(unit * TILES_PER_UNIT * T) + T * 3
}

const HOME_ROOFS = ['#9c5f4e', '#7d6a9c', '#5f7f8c', '#a5784a', '#6f8a5f', '#8c5f74']
const HOME_WALLS = ['#f0e2cb', '#e6dcef', '#dcebef', '#f5e7cf', '#e2eddc', '#f3e0e4']

function doorOf(box: Rect): Rect {
  const w = Math.round(T * 1.1)
  return { x: Math.round(box.x + box.w / 2 - w / 2), y: box.y + box.h - T, w, h: T }
}

export const BUILDINGS: Building[] = []

/** Three depth rows north of the road, so the neighbourhood has layers. */
const HOME_ROWS = [6.5, 14, 21.5]

HOME_SLOTS.forEach((slot, i) => {
  const w = Math.round(T * 3.4)
  const h = Math.round(T * 3.6)
  const row = HOME_ROWS[i % HOME_ROWS.length]
  const box: Rect = { x: unitToX(slot) - w / 2, y: Math.round(row * T), w, h }

  BUILDINGS.push({
    id: `T${String(i + 1).padStart(2, '0')}`,
    kind: 'home',
    label: `T${String(i + 1).padStart(2, '0')}`,
    sublabel: '',
    box,
    door: doorOf(box),
    roof: HOME_ROOFS[i % HOME_ROOFS.length],
    wall: HOME_WALLS[i % HOME_WALLS.length]
  })
})

for (const shop of SHOP_DEFS) {
  const w = Math.round(T * 6)
  const h = Math.round(T * 4.6)
  const box: Rect = { x: unitToX(shop.location) - w / 2, y: ROAD_BOTTOM + T * 2.2, w, h }

  BUILDINGS.push({
    id: shop.id,
    kind: 'shop',
    shopId: shop.id,
    label: shop.name,
    sublabel: '',
    box,
    door: doorOf(box),
    roof: shop.id === 'simffee' ? '#c07a3e' : '#6b5040',
    wall: shop.id === 'simffee' ? '#f6ead7' : '#ddd0bd'
  })
}

/** Cobbled squares in front of each cafe, plus one in the middle of town. */
export const PLAZAS: Rect[] = [
  ...BUILDINGS.filter((b) => b.kind === 'shop').map((b) => ({
    x: b.box.x - T * 2,
    y: b.box.y + b.box.h,
    w: b.box.w + T * 4,
    h: T * 3
  })),
  { x: WORLD_W / 2 - T * 5, y: ROAD_BOTTOM + T * 8.5, w: T * 10, h: T * 6 }
]

const DOOR_PAD = 6

export function hitDoor(worldX: number, worldY: number): Building | null {
  for (const b of BUILDINGS) {
    const d = b.door
    if (
      worldX >= d.x - DOOR_PAD &&
      worldX <= d.x + d.w + DOOR_PAD &&
      worldY >= d.y - DOOR_PAD &&
      worldY <= d.y + d.h + DOOR_PAD
    ) {
      return b
    }
  }
  return null
}

// --------------------------------------------------------------- pathfinding

export interface Waypoint {
  x: number
  y: number
}

/**
 * Points villagers walk between. Just the pavements, the plazas and the spot
 * outside each door, which is plenty for wandering.
 */
export const WAYPOINTS: Waypoint[] = []

const PAVE_N = ROAD_TOP - T * 0.9
const PAVE_S = ROAD_BOTTOM + T * 0.9

for (let x = T * 3; x < WORLD_W - T * 2; x += T * 3) {
  WAYPOINTS.push({ x, y: PAVE_N })
  WAYPOINTS.push({ x, y: PAVE_S })
}

for (const b of BUILDINGS) {
  WAYPOINTS.push({ x: b.door.x + b.door.w / 2, y: b.box.y + b.box.h + T * 0.9 })
}

for (const p of PLAZAS) {
  WAYPOINTS.push({ x: p.x + p.w * 0.3, y: p.y + p.h * 0.5 })
  WAYPOINTS.push({ x: p.x + p.w * 0.7, y: p.y + p.h * 0.5 })
}

// ---------------------------------------------------------------- decoration

export type DecorKind =
  | 'tree'
  | 'pine'
  | 'bush'
  | 'flowers'
  | 'rock'
  | 'lamp'
  | 'bench'
  | 'planter'
  | 'crate'
  | 'barrel'
  | 'fence'
  | 'mailbox'
  | 'bistro'
  | 'well'
  | 'signpost'
  | 'haystack'
  | 'stall'
  | 'stump'
  | 'log'
  | 'cart'
  | 'lantern'

export interface Decor {
  kind: DecorKind
  x: number
  y: number
  variant: number
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function inRect(x: number, y: number, r: Rect, pad: number): boolean {
  return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad
}

function blocked(x: number, y: number, pad: number): boolean {
  if (y > ROAD_TOP - T && y < ROAD_BOTTOM + T) return true
  for (const p of PLAZAS) if (inRect(x, y, p, T * 0.4)) return true
  for (const b of BUILDINGS) if (inRect(x, y, b.box, pad + T * 0.4)) return true
  // keep the walking routes clear
  for (const w of WAYPOINTS) {
    if (Math.abs(x - w.x) < T * 0.9 && Math.abs(y - w.y) < T * 0.9) return true
  }
  return false
}

function buildDecor(): Decor[] {
  const rand = mulberry(20260919)
  const out: Decor[] = []

  const place = (kind: DecorKind, count: number, pad: number, band?: [number, number]) => {
    let tries = 0
    let made = 0
    while (made < count && tries < count * 70) {
      tries++
      const x = rand() * (WORLD_W - T * 2) + T
      const y = band ? band[0] + rand() * (band[1] - band[0]) : rand() * (WORLD_H - T * 2) + T
      if (blocked(x, y, pad)) continue
      out.push({ kind, x, y, variant: Math.floor(rand() * 4) })
      made++
    }
  }

  // dense woods at the very top and bottom, framing the town
  place('pine', 90, T * 0.4, [T * 0.5, T * 6])
  place('pine', 62, T * 0.4, [WORLD_H - T * 9, WORLD_H - T])
  place('tree', 70, T * 0.5, [WORLD_H - T * 17, WORLD_H - T * 2])
  place('tree', 52, T * 0.6, [T * 2, ROAD_TOP - T * 3])
  place('bush', 150, T * 0.3)
  place('flowers', 210, T * 0.22)
  place('rock', 52, T * 0.3)
  place('stump', 22, T * 0.35)
  place('log', 18, T * 0.4)
  place('crate', 22, T * 0.4)
  place('barrel', 20, T * 0.4)
  place('haystack', 20, T * 0.5, [WORLD_H - T * 14, WORLD_H - T * 2])
  place('lantern', 26, T * 0.3)

  const lampY = ROAD_TOP - T * 1.4
  for (let x = T * 4; x < WORLD_W - T * 2; x += T * 9) {
    out.push({ kind: 'lamp', x, y: lampY, variant: 0 })
    out.push({ kind: 'lamp', x: x + T * 4.5, y: ROAD_BOTTOM + T * 1.4, variant: 0 })
  }

  for (const b of BUILDINGS) {
    if (b.kind === 'home') {
      out.push({ kind: 'mailbox', x: b.box.x - T * 0.7, y: b.box.y + b.box.h + T * 0.35, variant: 0 })
      out.push({ kind: 'planter', x: b.box.x + b.box.w + T * 0.55, y: b.box.y + b.box.h + T * 0.15, variant: 0 })
      out.push({ kind: 'fence', x: b.box.x - T * 2.4, y: b.box.y + b.box.h + T * 0.6, variant: 1 })
      out.push({ kind: 'fence', x: b.box.x + b.box.w + T * 2.4, y: b.box.y + b.box.h + T * 0.6, variant: 1 })
    } else {
      out.push({ kind: 'bistro', x: b.box.x - T * 1.8, y: b.box.y + b.box.h + T * 1.1, variant: 0 })
      out.push({ kind: 'bistro', x: b.box.x + b.box.w + T * 1.8, y: b.box.y + b.box.h + T * 1.1, variant: 1 })
      out.push({ kind: 'planter', x: b.box.x - T * 0.6, y: b.box.y + b.box.h + T * 0.1, variant: 1 })
      out.push({ kind: 'planter', x: b.box.x + b.box.w + T * 0.6, y: b.box.y + b.box.h + T * 0.1, variant: 1 })
    }
  }

  // a market row along the north pavement, between the two cafes
  const stallY = ROAD_TOP - T * 3.1
  for (let i = 0; i < 6; i++) {
    out.push({ kind: 'stall', x: WORLD_W * 0.26 + i * T * 7.2, y: stallY, variant: i % 4 })
    out.push({ kind: 'crate', x: WORLD_W * 0.26 + i * T * 7.2 + T * 2.1, y: stallY + T * 0.7, variant: i % 4 })
  }

  // landmarks, so the eye has somewhere to land while panning
  out.push({ kind: 'well', x: WORLD_W * 0.5, y: ROAD_TOP - T * 6.4, variant: 0 })
  out.push({ kind: 'cart', x: WORLD_W * 0.5 - T * 4.4, y: ROAD_TOP - T * 5.6, variant: 0 })
  out.push({ kind: 'signpost', x: WORLD_W * 0.5 + T * 3.6, y: ROAD_BOTTOM + T * 2.2, variant: 0 })
  out.push({ kind: 'signpost', x: WORLD_W * 0.16, y: ROAD_BOTTOM + T * 2.2, variant: 1 })
  out.push({ kind: 'well', x: WORLD_W * 0.82, y: WORLD_H - T * 10, variant: 1 })

  // benches around the middle plaza
  const plaza = PLAZAS[PLAZAS.length - 1]
  out.push({ kind: 'bench', x: plaza.x + T * 1.5, y: plaza.y + plaza.h - T * 0.4, variant: 0 })
  out.push({ kind: 'bench', x: plaza.x + plaza.w - T * 1.5, y: plaza.y + plaza.h - T * 0.4, variant: 0 })
  out.push({ kind: 'planter', x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h * 0.45, variant: 1 })

  return out
}

export const DECOR: Decor[] = buildDecor()


/**
 * Names and prices come from the run, so the village always shows whatever the
 * Python side actually simulated rather than a copy that can drift out of date.
 */
export function applyRunsToTown(
  twins: { id: string; name: string }[],
  shops: Record<string, { name: string; price: Record<string, number> }>
): void {
  for (const b of BUILDINGS) {
    if (b.kind === 'home') {
      const twin = twins.find((t) => t.id === b.id)
      if (twin) {
        b.label = twin.name
        b.sublabel = twin.id
      }
      continue
    }
    const info = shops[b.shopId as string]
    if (!info) continue
    b.label = info.name
    const latte = info.price?.latte
    b.sublabel = typeof latte === 'number' ? `latte ${Math.round(latte / 1000)}k` : ''
  }
}

/** Where a villager stands when they go for coffee. */
export function shopDoorSpot(shopId: ShopId): Waypoint {
  const b = BUILDINGS.find((x) => x.shopId === shopId)
  if (!b) return WAYPOINTS[0]
  return { x: b.door.x + b.door.w / 2, y: b.box.y + b.box.h + T * 1.1 }
}

/** Where a villager stands outside their own front door. */
export function homeDoorSpot(twinId: string): Waypoint {
  const b = BUILDINGS.find((x) => x.id === twinId && x.kind === 'home')
  if (!b) return WAYPOINTS[0]
  return { x: b.door.x + b.door.w / 2, y: b.box.y + b.box.h + T * 0.9 }
}