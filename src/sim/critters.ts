/**
 * Animals and road traffic.
 *
 * These are pure decoration, deliberately. The model decides who buys coffee
 * where. Chickens and delivery vans exist so the village feels lived in while
 * that happens, which is the whole reason a simulation is worth looking at
 * instead of reading as a table.
 */

import { BUILDINGS, PENS, ROAD_BOTTOM, ROAD_TOP, T, WORLD_H, WORLD_W, type Rect } from './town'

export type CritterKind = 'chicken' | 'duck' | 'cat' | 'dog' | 'sheep' | 'cow'

export interface Critter {
  kind: CritterKind
  x: number
  y: number
  /** Animals stay roughly near the spot they were born, like real village pets. */
  homeX: number
  homeY: number
  roam: number
  tx: number
  ty: number
  facing: -1 | 1
  speed: number
  anim: number
  pause: number
  variant: number
  /** Livestock never leave their paddock. Pets have no pen. */
  pen?: Rect
}

export type CarKind = 'van' | 'car' | 'truck' | 'bike'

export interface Car {
  kind: CarKind
  x: number
  y: number
  dir: 1 | -1
  speed: number
  variant: number
  /** Ticks left of a stop, so traffic is not a perfectly even conveyor belt. */
  wait: number
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

/** Animals should not stand inside a wall. */
function insideBuilding(x: number, y: number): boolean {
  for (const b of BUILDINGS) {
    if (
      x > b.box.x - T * 0.3 &&
      x < b.box.x + b.box.w + T * 0.3 &&
      y > b.box.y + b.box.h * 0.45 &&
      y < b.box.y + b.box.h + T * 0.3
    ) {
      return true
    }
  }
  return false
}

function onRoad(y: number): boolean {
  return y > ROAD_TOP - T * 0.6 && y < ROAD_BOTTOM + T * 0.6
}

export function createCritters(): Critter[] {
  const rand = mulberry(77021)
  const out: Critter[] = []

  const add = (kind: CritterKind, x: number, y: number, roam: number, speed: number, pen?: Rect): void => {
    if (insideBuilding(x, y) || onRoad(y)) return
    if (x < T || x > WORLD_W - T || y < T || y > WORLD_H - T) return
    out.push({
      pen,
      kind,
      x,
      y,
      homeX: x,
      homeY: y,
      roam,
      tx: x,
      ty: y,
      facing: rand() < 0.5 ? -1 : 1,
      speed,
      anim: rand() * 100,
      pause: Math.floor(rand() * 120),
      variant: Math.floor(rand() * 3)
    })
  }

  // pets: a cat or dog in most front yards, free to wander the whole village
  for (const b of BUILDINGS) {
    if (b.kind !== 'home') continue
    const yardY = b.box.y + b.box.h + T * 1.5
    if (rand() < 0.6) {
      add(rand() < 0.5 ? 'cat' : 'dog', b.box.x + rand() * b.box.w, yardY + rand() * T, T * 3.2, 0.22)
    }
  }
  for (let i = 0; i < 6; i++) {
    add('cat', T * 3 + rand() * (WORLD_W - T * 6), T * 2 + rand() * (ROAD_TOP - T * 5), T * 3, 0.2)
  }

  // livestock, penned on the farm south of town
  for (const pen of PENS) {
    const inner = { x: pen.box.x + T, y: pen.box.y + T, w: pen.box.w - T * 2, h: pen.box.h - T * 1.6 }
    const spot = (): [number, number] => [inner.x + rand() * inner.w, inner.y + rand() * inner.h]
    if (pen.kind === 'sheep') {
      for (let i = 0; i < 9; i++) add('sheep', ...spot(), T * 3, 0.1, inner)
    } else if (pen.kind === 'cow') {
      for (let i = 0; i < 5; i++) add('cow', ...spot(), T * 3, 0.07, inner)
    } else {
      for (let i = 0; i < 9; i++) add(rand() < 0.3 ? 'duck' : 'chicken', ...spot(), T * 2.5, 0.16, inner)
    }
  }

  return out
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function stepCritters(list: Critter[]): void {
  for (const c of list) {
    c.anim += 1

    if (c.pause > 0) {
      c.pause -= 1
      continue
    }

    const dx = c.tx - c.x
    const dy = c.ty - c.y
    const dist = Math.hypot(dx, dy)

    if (dist < 2) {
      // stand still and peck for a moment, then choose somewhere new nearby
      c.pause = 40 + Math.floor(Math.random() * 160)
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * c.roam
      let nx = c.homeX + Math.cos(a) * r
      let ny = c.homeY + Math.sin(a) * r * 0.7
      if (c.pen) {
        nx = clampTo(nx, c.pen.x, c.pen.x + c.pen.w)
        ny = clampTo(ny, c.pen.y, c.pen.y + c.pen.h)
      }
      if (!insideBuilding(nx, ny) && !onRoad(ny)) {
        c.tx = nx
        c.ty = ny
      }
      continue
    }

    const step = c.speed
    c.x += (dx / dist) * step
    c.y += (dy / dist) * step
    if (Math.abs(dx) > 0.4) c.facing = dx < 0 ? -1 : 1
  }
}

export function critterMoving(c: Critter): boolean {
  return c.pause <= 0 && Math.hypot(c.tx - c.x, c.ty - c.y) > 2
}

// ------------------------------------------------------------------ traffic

/** Two lanes, so traffic reads as a real road rather than a single file queue. */
const LANE_RIGHT = ROAD_TOP + T * 1.45
const LANE_LEFT = ROAD_BOTTOM - T * 1.15

export function createCars(): Car[] {
  const rand = mulberry(31337)
  const out: Car[] = []
  const kinds: CarKind[] = ['van', 'car', 'truck', 'bike', 'car', 'van']

  for (let i = 0; i < 7; i++) {
    out.push({
      kind: kinds[Math.floor(rand() * kinds.length)],
      x: rand() * WORLD_W,
      y: LANE_RIGHT,
      dir: 1,
      speed: 0.7 + rand() * 0.8,
      variant: Math.floor(rand() * 4),
      wait: 0
    })
  }
  for (let i = 0; i < 7; i++) {
    out.push({
      kind: kinds[Math.floor(rand() * kinds.length)],
      x: rand() * WORLD_W,
      y: LANE_LEFT,
      dir: -1,
      speed: 0.7 + rand() * 0.8,
      variant: Math.floor(rand() * 4),
      wait: 0
    })
  }
  return out
}

export function stepCars(list: Car[]): void {
  for (const c of list) {
    if (c.wait > 0) {
      c.wait -= 1
      continue
    }

    // do not drive through the car in front, which is what makes it look like
    // traffic instead of sprites passing through each other
    let blockedAhead = false
    for (const o of list) {
      if (o === c || o.y !== c.y) continue
      const gap = (o.x - c.x) * c.dir
      if (gap > 0 && gap < T * 3.4) blockedAhead = true
    }
    if (blockedAhead) continue

    c.x += c.speed * c.dir

    // occasionally pull up, as if at a crossing
    if (Math.random() < 0.0012) c.wait = 60 + Math.floor(Math.random() * 120)

    // wrap around off screen so the road never empties
    if (c.dir === 1 && c.x > WORLD_W + T * 5) c.x = -T * 5
    if (c.dir === -1 && c.x < -T * 5) c.x = WORLD_W + T * 5
  }
}
