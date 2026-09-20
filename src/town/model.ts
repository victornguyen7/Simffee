import type { Shop, Twin } from '../types'

export const GRID = 23
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
  | 'hedge'
  | 'flowerbed'
  | 'vegpatch'
  | 'well'
  | 'haybale'
  | 'barrel'
  | 'cart'
  | 'picketfence'

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
  { kind: 'poultry', x: 18, y: 0, w: 5, h: 4 },
  { kind: 'cow', x: 0, y: 14, w: 5, h: 5 },
]

export const idx = (x: number, y: number) => y * GRID + x
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID

/** A world cell (0..4) of the simulation grid sits on this town tile. */
export const cellToTile = (cx: number, cy: number): [number, number] => [cx * 3 + 5, cy * 3 + 5]

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
    const [tx] = cellToTile(c, 0)
    const [, ty] = cellToTile(0, c)
    for (let i = 1; i <= GRID - 2; i++) {
      ground[idx(tx, i)] = 'path'
      ground[idx(i, ty)] = 'path'
    }
  }

  // a pond in the far corner plus a sandy shore
  for (let x = 18; x < 22; x++) {
    for (let y = 18; y < 22; y++) {
      if (ground[idx(x, y)] === 'path') continue
      ground[idx(x, y)] = x === 18 || y === 18 ? 'sand' : 'water'
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

  const gardenSlots = new Set<number>()
  const houses = twins.map((twin) => cellToTile(twin.home[0], twin.home[1]))
  for (const [hx, hy] of houses) {
    const behindX = hx < GRID / 2 ? -1 : 1
    const behindY = hy < GRID / 2 ? -1 : 1
    const around: [number, number][] = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        const x = hx + dx
        const y = hy + dy
        if (!inBounds(x, y) || ground[idx(x, y)] !== 'grass' || props[idx(x, y)] !== 'none') continue
        around.push([x, y])
      }
    }
    const behind: [number, number][] = [
      [hx + behindX, hy + behindY],
      [hx + behindX, hy],
      [hx, hy + behindY],
    ]
    const ordered = [...behind, ...around].filter(
      ([x, y], index, all) =>
        inBounds(x, y) &&
        ground[idx(x, y)] === 'grass' &&
        props[idx(x, y)] === 'none' &&
        all.findIndex(([ax, ay]) => ax === x && ay === y) === index,
    )
    const gardenA = ordered[0]
    const gardenB = ordered.find(([x, y]) => !gardenA || x !== gardenA[0] || y !== gardenA[1])
    if (gardenA) {
      props[idx(gardenA[0], gardenA[1])] = r() < 0.5 ? 'flowerbed' : 'vegpatch'
      gardenSlots.add(idx(gardenA[0], gardenA[1]))
    }
    if (gardenB) {
      props[idx(gardenB[0], gardenB[1])] =
        gardenA && props[idx(gardenA[0], gardenA[1])] === 'flowerbed' ? 'vegpatch' : 'flowerbed'
      gardenSlots.add(idx(gardenB[0], gardenB[1]))
    }
    const side = ordered.find(([x, y]) => !gardenSlots.has(idx(x, y)))
    if (side) {
      props[idx(side[0], side[1])] = r() < 0.5 ? 'hedge' : 'picketfence'
      gardenSlots.add(idx(side[0], side[1]))
    }
    const small = ordered.find(([x, y]) => !gardenSlots.has(idx(x, y)))
    if (small && r() < 0.4) {
      const smallProps: Prop[] = ['barrel', 'haybale', 'well', 'cart']
      props[idx(small[0], small[1])] = smallProps[Math.floor(r() * smallProps.length)]
      gardenSlots.add(idx(small[0], small[1]))
    }
  }

  // village scatter leaves open grass between the gardens
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      const tile = idx(x, y)
      if (props[tile] !== 'none' || ground[tile] !== 'grass' || penTiles.has(tile)) continue
      if (r() > 0.55) continue
      const roll = r()
      if (roll < 0.25) props[tile] = 'tree'
      else if (roll < 0.37) props[tile] = 'pine'
      else if (roll < 0.47) props[tile] = 'bush'
      else props[tile] = 'flowers'
    }
  }

  // street furniture along the central lanes
  const furniture: [number, number, Prop][] = [
    [11, 7, 'fountain'],
    [6, 8, 'bench'],
    [10, 8, 'bench'],
    [5, 13, 'lamp'],
    [14, 7, 'lamp'],
    [17, 12, 'kiosk'],
  ]
  for (const [x, y, prop] of furniture) {
    const tile = idx(x, y)
    if ((ground[tile] === 'path' || ground[tile] === 'plaza') && props[tile] === 'none') props[tile] = prop
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
