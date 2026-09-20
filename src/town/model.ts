import type { Shop, Twin } from '../types'

export const GRID = 19
export const TILE_W = 64
export const TILE_H = 32

export type Ground = 'grass' | 'path' | 'plaza' | 'water' | 'sand' | 'dirt'
export type Prop =
  | 'none'
  | 'tree'
  | 'pine'
  | 'bush'
  | 'flowers'
  | 'house'
  | 'simffee'
  | 'starbucks'
  | 'lamp'
  | 'bench'
  | 'kiosk'
  | 'fountain'
  | 'fence'
  | 'gate'
  | 'trough'
  | 'coop'

export interface Town {
  ground: Ground[]
  props: Prop[]
}

export interface Pen {
  kind: 'sheep' | 'cow' | 'poultry'
  x: number
  y: number
  w: number
  h: number
}

export const PENS: Pen[] = [
  { kind: 'sheep', x: 0, y: 0, w: 5, h: 5 },
  { kind: 'poultry', x: 14, y: 0, w: 5, h: 4 },
  { kind: 'cow', x: 0, y: 14, w: 5, h: 5 },
]

export const idx = (x: number, y: number) => y * GRID + x
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID

/** A world cell (0..4) of the simulation grid sits on this town tile. */
export const cellToTile = (cx: number, cy: number): [number, number] => [cx * 2 + 5, cy * 2 + 5]

/** Deterministic pseudo random so the default town is stable across reloads. */
function rand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function defaultTown(twins: Twin[], shops: Record<string, Shop>, focus: string): Town {
  const ground: Ground[] = new Array(GRID * GRID).fill('grass')
  const props: Prop[] = new Array(GRID * GRID).fill('none')
  const r = rand(7)

  // paths: a lane through every simulation row and column
  for (let c = 0; c < 5; c++) {
    const [tx, ty] = cellToTile(c, 0)
    for (let i = 1; i <= GRID - 2; i++) {
      ground[idx(tx, i)] = 'path'
      ground[idx(i, ty)] = 'path'
    }
  }

  // a pond in the far corner plus a sandy shore
  for (let x = 15; x < 18; x++) {
    for (let y = 15; y < 18; y++) {
      if (ground[idx(x, y)] === 'path') continue
      ground[idx(x, y)] = x === 15 || y === 15 ? 'sand' : 'water'
    }
  }

  for (const twin of twins) {
    const [tx, ty] = cellToTile(twin.home[0], twin.home[1])
    props[idx(tx, ty)] = 'house'
  }

  for (const [id, shop] of Object.entries(shops)) {
    const [tx, ty] = cellToTile(shop.position[0], shop.position[1])
    ground[idx(tx, ty)] = 'plaza'
    props[idx(tx, ty)] = id === focus ? 'simffee' : 'starbucks'
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = tx + dx
      const ny = ty + dy
      if (inBounds(nx, ny) && ground[idx(nx, ny)] === 'grass') ground[idx(nx, ny)] = 'plaza'
    }
  }

  const penTiles = new Set<number>()
  for (const pen of PENS) {
    const gateY = pen.y + Math.floor(pen.h / 2)
    const gateX = pen.kind === 'poultry' ? pen.x : pen.x + pen.w - 1

    for (let x = pen.x; x < pen.x + pen.w; x++) {
      for (let y = pen.y; y < pen.y + pen.h; y++) {
        const tile = idx(x, y)
        penTiles.add(tile)
        ground[tile] = 'dirt'
        const perimeter = x === pen.x || x === pen.x + pen.w - 1 || y === pen.y || y === pen.y + pen.h - 1
        if (perimeter) props[tile] = x === gateX && y === gateY ? 'gate' : 'fence'
      }
    }

    const inner: [number, number][] = []
    for (let x = pen.x + 1; x < pen.x + pen.w - 1; x++) {
      for (let y = pen.y + 1; y < pen.y + pen.h - 1; y++) {
        inner.push([x, y])
      }
    }
    const corner = inner.shift()
    if (corner) props[idx(corner[0], corner[1])] = pen.kind === 'poultry' ? 'coop' : 'trough'

  }

  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      const i = idx(x, y)
      if (penTiles.has(i) || props[i] !== 'none' || ground[i] !== 'grass') continue
      const roll = r()
      if (roll > 0.82) props[i] = 'tree'
      else if (roll > 0.74) props[i] = 'pine'
      else if (roll > 0.68) props[i] = 'bush'
      else if (roll > 0.62) props[i] = 'flowers'
    }
  }

  // street furniture along the central lanes
  const furniture: [number, number, Prop][] = [
    [8, 7, 'fountain'],
    [6, 7, 'bench'],
    [10, 7, 'bench'],
    [4, 11, 'lamp'],
    [12, 7, 'lamp'],
    [8, 11, 'kiosk'],
  ]
  for (const [x, y, prop] of furniture) {
    if (props[idx(x, y)] === 'none' && ground[idx(x, y)] !== 'dirt') props[idx(x, y)] = prop
  }

  return { ground, props }
}

const STORAGE_KEY = 'simffee.town.v2'

export function loadTown(): Town | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Town
    if (parsed.ground?.length !== GRID * GRID || parsed.props?.length !== GRID * GRID) return null
    return parsed
  } catch {
    return null
  }
}

export function saveTown(town: Town) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(town))
  } catch {
    // storage unavailable: the town simply will not persist
  }
}

export function clearTown() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing to do
  }
}

/** Screen position of the centre of a tile, before camera offset. */
export function tileToScreen(x: number, y: number): [number, number] {
  return [((x - y) * TILE_W) / 2, ((x + y) * TILE_H) / 2]
}

/** Inverse projection: which tile does this (already camera-corrected) point hit. */
export function screenToTile(sx: number, sy: number): [number, number] {
  const x = sy / TILE_H + sx / TILE_W
  const y = sy / TILE_H - sx / TILE_W
  return [Math.round(x), Math.round(y)]
}
