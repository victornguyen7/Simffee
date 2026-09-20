import type { Shop, Twin } from '../types'

export const GRID = 27
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
  { kind: 'poultry', x: GRID - 5, y: 0, w: 5, h: 4 },
  { kind: 'cow', x: 0, y: GRID - 5, w: 5, h: 5 },
]

export const idx = (x: number, y: number) => y * GRID + x
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID

/** A world cell (0..4) of the simulation grid sits on this town tile. */
export const cellToTile = (cx: number, cy: number): [number, number] => [cx * 4 + 5, cy * 4 + 5]

/** Deterministic pseudo random so the default town is stable across reloads. */
function rand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function walkableForCheck(ground: Ground[], props: Prop[], x: number, y: number) {
  return (
    inBounds(x, y) &&
    (ground[idx(x, y)] === 'path' || ground[idx(x, y)] === 'plaza' || ground[idx(x, y)] === 'sand') &&
    props[idx(x, y)] === 'none'
  )
}

function entranceForCheck(ground: Ground[], props: Prop[], tile: [number, number]): [number, number] {
  const [x, y] = tile
  const prop = props[idx(x, y)]
  if (prop !== 'house' && prop !== 'simffee' && prop !== 'starbucks') return tile
  const candidates: [number, number][] = [
    [x, y + 1],
    [x + 1, y],
    [x - 1, y],
    [x, y - 1],
  ]
  return candidates.find(([cx, cy]) => walkableForCheck(ground, props, cx, cy)) ?? tile
}

function hasWalkableRoute(ground: Ground[], props: Prop[], from: [number, number], to: [number, number]) {
  if (!walkableForCheck(ground, props, from[0], from[1]) || !walkableForCheck(ground, props, to[0], to[1])) {
    return false
  }
  const queue: [number, number][] = [from]
  const seen = new Set([from.join(',')])
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current[0] === to[0] && current[1] === to[1]) return true
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next: [number, number] = [current[0] + dx, current[1] + dy]
      const key = next.join(',')
      if (seen.has(key) || !walkableForCheck(ground, props, next[0], next[1])) continue
      seen.add(key)
      queue.push(next)
    }
  }
  return false
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
  for (let x = GRID - 5; x < GRID - 1; x++) {
    for (let y = GRID - 5; y < GRID - 1; y++) {
      if (ground[idx(x, y)] === 'path') continue
      ground[idx(x, y)] = x === GRID - 5 || y === GRID - 5 ? 'sand' : 'water'
    }
  }

  for (const twin of twins) {
    const [tx, ty] = cellToTile(twin.home[0], twin.home[1])
    props[idx(tx, ty)] = 'house'
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        const nx = tx + dx
        const ny = ty + dy
        if (inBounds(nx, ny) && ground[idx(nx, ny)] === 'grass') ground[idx(nx, ny)] = 'path'
      }
    }
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
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 2; dy++) {
        if (dx === 0 && dy === 0) continue
        const nx = tx + dx
        const ny = ty + dy
        if (inBounds(nx, ny) && ground[idx(nx, ny)] === 'grass') ground[idx(nx, ny)] = 'plaza'
      }
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

  const houses = twins.map((twin) => cellToTile(twin.home[0], twin.home[1]))
  for (const [hx, hy] of houses) {
    const gardenX = hx < GRID / 2 ? 1 : -1
    const gardenY = hy < GRID / 2 ? 1 : -1
    const gardenProps: Prop[] = [
      'flowerbed',
      'vegpatch',
      'hedge',
      'picketfence',
      'haybale',
      'barrel',
      'well',
      'cart',
    ]
    for (let dx = 1; dx <= 3; dx++) {
      for (let dy = 1; dy <= 3; dy++) {
        const x = hx + gardenX * dx
        const y = hy + gardenY * dy
        const tile = idx(x, y)
        if (
          !inBounds(x, y) ||
          penTiles.has(tile) ||
          ground[tile] !== 'grass' ||
          props[tile] !== 'none' ||
          r() > 0.7
        ) {
          continue
        }
        props[tile] = gardenProps[Math.floor(r() * gardenProps.length)]
      }
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
    [13, 7, 'fountain'],
    [6, 9, 'bench'],
    [14, 9, 'bench'],
    [5, 15, 'lamp'],
    [17, 7, 'lamp'],
    [21, 12, 'kiosk'],
  ]
  for (const [x, y, prop] of furniture) {
    const tile = idx(x, y)
    if ((ground[tile] === 'path' || ground[tile] === 'plaza') && props[tile] === 'none') props[tile] = prop
  }

  if (import.meta.env.DEV) {
    const shopEntrances = Object.values(shops).map((shop) =>
      entranceForCheck(ground, props, cellToTile(shop.position[0], shop.position[1])),
    )
    for (const twin of twins) {
      const home = entranceForCheck(ground, props, cellToTile(twin.home[0], twin.home[1]))
      for (const shop of shopEntrances) {
        if (!hasWalkableRoute(ground, props, home, shop)) {
          console.warn(`No default town route from ${home.join(',')} to ${shop.join(',')}`)
        }
      }
    }
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
