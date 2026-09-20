import type { Twin } from '../types'

export const GRID = 13
export const TILE_W = 64
export const TILE_H = 32

export type Ground = 'grass' | 'path' | 'plaza' | 'water' | 'sand'
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

export interface Town {
  ground: Ground[]
  props: Prop[]
}

export const idx = (x: number, y: number) => y * GRID + x
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID

/** A world cell (0..4) of the simulation grid sits on this town tile. */
export const cellToTile = (cx: number, cy: number): [number, number] => [cx * 2 + 2, cy * 2 + 2]

/** Deterministic pseudo random so the default town is stable across reloads. */
function rand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function defaultTown(twins: Twin[], shops: Record<string, { position: [number, number] }>): Town {
  const ground: Ground[] = new Array(GRID * GRID).fill('grass')
  const props: Prop[] = new Array(GRID * GRID).fill('none')
  const r = rand(7)

  // paths: a lane through every simulation row and column
  for (let c = 0; c < 5; c++) {
    const [tx, ty] = cellToTile(c, 0)
    for (let i = 1; i < GRID - 1; i++) {
      ground[idx(tx, i)] = 'path'
      ground[idx(i, ty)] = 'path'
    }
  }

  // a pond in the far corner plus a sandy shore
  for (let x = 9; x < 12; x++) {
    for (let y = 9; y < 12; y++) {
      if (ground[idx(x, y)] === 'path') continue
      ground[idx(x, y)] = x === 9 || y === 9 ? 'sand' : 'water'
    }
  }

  for (const twin of twins) {
    const [tx, ty] = cellToTile(twin.home[0], twin.home[1])
    props[idx(tx, ty)] = 'house'
  }

  for (const [id, shop] of Object.entries(shops)) {
    const [tx, ty] = cellToTile(shop.position[0], shop.position[1])
    ground[idx(tx, ty)] = 'plaza'
    props[idx(tx, ty)] = id === 'simffee' ? 'simffee' : 'starbucks'
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

  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      const i = idx(x, y)
      if (props[i] !== 'none' || ground[i] !== 'grass') continue
      const roll = r()
      if (roll > 0.82) props[i] = 'tree'
      else if (roll > 0.74) props[i] = 'pine'
      else if (roll > 0.68) props[i] = 'bush'
      else if (roll > 0.62) props[i] = 'flowers'
    }
  }

  // street furniture along the central lanes
  props[idx(6, 5)] = 'fountain'
  props[idx(4, 7)] = 'bench'
  props[idx(8, 3)] = 'bench'
  props[idx(5, 2)] = 'lamp'
  props[idx(7, 8)] = 'lamp'
  props[idx(9, 6)] = 'kiosk'

  return { ground, props }
}

const STORAGE_KEY = 'simffee.town.v1'

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
