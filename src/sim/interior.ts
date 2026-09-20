/**
 * The inside of each cafe. Both shops share one floor plan (world.ts owns the
 * walkable tiles) but dress it completely differently: Simffee is a warm,
 * cluttered vintage roastery, Starbucks is a dark green, walnut and brass
 * chain store. Nothing here affects the simulation, it is all set dressing.
 */

import { GRID_H, GRID_W, TILE, TILES } from './world'
import type { ShopId } from './runs'
import type { Palette } from './render'

/** Art pixels per tile. Matches the character sprites so the scale agrees. */
const PX = TILE / 14

export type FurnitureKind =
  | 'shelf'
  | 'backbar'
  | 'menuboard'
  | 'painting'
  | 'clock'
  | 'espresso'
  | 'grinder'
  | 'register'
  | 'pastry'
  | 'plant'
  | 'tallplant'
  | 'bookshelf'
  | 'fireplace'
  | 'armchair'
  | 'sofa'
  | 'floorlamp'
  | 'sidetable'
  | 'gramophone'
  | 'sacks'
  | 'barrel'
  | 'crates'
  | 'stanchion'
  | 'easel'
  | 'newsrack'
  | 'umbrellas'
  | 'windowseat'
  | 'merch'
  | 'lowtable'
  | 'doormat'
  | 'bench'
  | 'chalkboard'

export interface Furniture {
  kind: FurnitureKind
  x: number
  y: number
}

export interface Rug {
  x: number
  y: number
  w: number
  h: number
}

export interface InteriorTheme {
  palette: Palette
  /** 'planks' is straight boards, 'herringbone' zigzags, 'checker' is tile. */
  floor: 'planks' | 'herringbone' | 'checker'
  wallpaper: string
  wallpaperStripe: string
  wainscot: string
  wainscotLine: string
  rugA: string
  rugB: string
  rugEdge: string
  windowFrame: string
  shelfWood: string
  jarA: string
  jarB: string
  upholstery: string
  upholsteryDark: string
  metal: string
  rugs: Rug[]
  /** Top wall windows, in tile columns. */
  windows: number[]
  furniture: Furniture[]
}

/**
 * Tiles customers walk through and must stay empty. Row 3 is the walk from the
 * counter to the tables, column 4 is the queue, columns 8 and 9 are the way out.
 */
const SIMFFEE: InteriorTheme = {
  palette: {
    floorA: '#d9b077',
    floorB: '#c99a5f',
    wall: '#e9d7b8',
    wallTop: '#b5663d',
    counter: '#8d5a34',
    counterTop: '#5e3a20',
    table: '#c9884a',
    tableTaken: '#a9683a',
    chair: '#6f4526',
    door: '#cbb896',
    outline: '#3a2a20',
    cup: '#f4efe6',
    apron: '#c2694a',
    annoyed: '#c2564f',
    accent: '#c07a3e'
  },
  floor: 'herringbone',
  wallpaper: '#efdcc0',
  wallpaperStripe: '#e4c9a6',
  wainscot: '#b5663d',
  wainscotLine: '#8f4b2b',
  rugA: '#a94b3d',
  rugB: '#c2694a',
  rugEdge: '#e8c98c',
  windowFrame: '#f6efe2',
  shelfWood: '#7a4a2a',
  jarA: '#d9a441',
  jarB: '#8f4b2b',
  upholstery: '#a94b3d',
  upholsteryDark: '#7c3128',
  metal: '#c9a06f',
  rugs: [
    { x: 9, y: 3, w: 10, h: 7 },
    { x: 3, y: 3, w: 3, h: 10 }
  ],
  windows: [12, 15],
  furniture: [
    // back wall
    { kind: 'shelf', x: 1, y: 1 },
    { kind: 'backbar', x: 3, y: 1 },
    { kind: 'menuboard', x: 10, y: 1 },
    { kind: 'painting', x: 13, y: 1 },
    { kind: 'clock', x: 14, y: 1 },
    { kind: 'shelf', x: 16, y: 1 },
    { kind: 'plant', x: 18, y: 1 },
    // counter
    { kind: 'espresso', x: 3, y: 2 },
    { kind: 'grinder', x: 8, y: 2 },
    { kind: 'pastry', x: 9, y: 2 },
    { kind: 'sacks', x: 1, y: 2 },
    { kind: 'gramophone', x: 12, y: 2 },
    { kind: 'bookshelf', x: 15, y: 2 },
    { kind: 'tallplant', x: 18, y: 2 },
    // left wall
    { kind: 'bookshelf', x: 1, y: 4 },
    { kind: 'fireplace', x: 1, y: 7 },
    { kind: 'armchair', x: 1, y: 10 },
    { kind: 'plant', x: 2, y: 10 },
    { kind: 'barrel', x: 1, y: 11 },
    // between the queue and the way out
    { kind: 'plant', x: 6, y: 5 },
    { kind: 'newsrack', x: 6, y: 6 },
    { kind: 'sidetable', x: 6, y: 8 },
    { kind: 'plant', x: 6, y: 10 },
    { kind: 'stanchion', x: 7, y: 5 },
    { kind: 'stanchion', x: 7, y: 8 },
    { kind: 'stanchion', x: 7, y: 11 },
    // lounge under the tables
    { kind: 'sofa', x: 11, y: 10 },
    { kind: 'floorlamp', x: 14, y: 10 },
    { kind: 'sidetable', x: 15, y: 10 },
    { kind: 'sofa', x: 17, y: 10 },
    { kind: 'plant', x: 11, y: 11 },
    { kind: 'plant', x: 18, y: 11 },
    // by the door
    { kind: 'crates', x: 1, y: 12 },
    { kind: 'barrel', x: 3, y: 12 },
    { kind: 'doormat', x: 8, y: 12 },
    { kind: 'umbrellas', x: 10, y: 12 },
    { kind: 'bench', x: 12, y: 12 },
    { kind: 'sacks', x: 15, y: 12 },
    { kind: 'tallplant', x: 18, y: 12 }
  ]
}

const STARBUCKS: InteriorTheme = {
  palette: {
    floorA: '#4a3a30',
    floorB: '#5a4638',
    wall: '#2f5a46',
    wallTop: '#3f4a3a',
    counter: '#3b2a22',
    counterTop: '#c9a06f',
    table: '#3f6b52',
    tableTaken: '#2f5540',
    chair: '#2b2622',
    door: '#a3805c',
    outline: '#1e1a16',
    cup: '#f4efe6',
    apron: '#1f6b4a',
    annoyed: '#c2564f',
    accent: '#00704a'
  },
  floor: 'checker',
  wallpaper: '#2f5a46',
  wallpaperStripe: '#295040',
  wainscot: '#6b4a3a',
  wainscotLine: '#4a3327',
  rugA: '#1f4a38',
  rugB: '#27563f',
  rugEdge: '#c9a06f',
  windowFrame: '#1e1a16',
  shelfWood: '#2b2622',
  jarA: '#f4efe6',
  jarB: '#00704a',
  upholstery: '#4f6b52',
  upholsteryDark: '#334a38',
  metal: '#d6b25a',
  rugs: [
    { x: 9, y: 3, w: 10, h: 7 },
    { x: 3, y: 3, w: 3, h: 10 }
  ],
  windows: [13, 14, 16, 17],
  furniture: [
    // back wall
    { kind: 'merch', x: 1, y: 1 },
    { kind: 'backbar', x: 3, y: 1 },
    { kind: 'chalkboard', x: 10, y: 1 },
    { kind: 'clock', x: 13, y: 1 },
    { kind: 'shelf', x: 16, y: 1 },
    { kind: 'tallplant', x: 18, y: 1 },
    // counter
    { kind: 'espresso', x: 3, y: 2 },
    { kind: 'register', x: 8, y: 2 },
    { kind: 'pastry', x: 9, y: 2 },
    { kind: 'crates', x: 1, y: 2 },
    { kind: 'merch', x: 12, y: 2 },
    { kind: 'merch', x: 15, y: 2 },
    { kind: 'plant', x: 18, y: 2 },
    // left wall
    { kind: 'windowseat', x: 1, y: 4 },
    { kind: 'tallplant', x: 1, y: 7 },
    { kind: 'bookshelf', x: 1, y: 8 },
    { kind: 'armchair', x: 1, y: 11 },
    { kind: 'umbrellas', x: 2, y: 11 },
    // between the queue and the way out
    { kind: 'stanchion', x: 6, y: 5 },
    { kind: 'easel', x: 6, y: 6 },
    { kind: 'stanchion', x: 6, y: 8 },
    { kind: 'plant', x: 6, y: 9 },
    { kind: 'stanchion', x: 6, y: 11 },
    { kind: 'crates', x: 7, y: 10 },
    // lounge under the tables
    { kind: 'armchair', x: 11, y: 10 },
    { kind: 'lowtable', x: 12, y: 10 },
    { kind: 'armchair', x: 13, y: 10 },
    { kind: 'floorlamp', x: 15, y: 10 },
    { kind: 'bookshelf', x: 17, y: 10 },
    { kind: 'plant', x: 11, y: 11 },
    { kind: 'plant', x: 18, y: 11 },
    // by the door
    { kind: 'newsrack', x: 1, y: 12 },
    { kind: 'plant', x: 3, y: 12 },
    { kind: 'doormat', x: 8, y: 12 },
    { kind: 'bench', x: 10, y: 12 },
    { kind: 'merch', x: 13, y: 12 },
    { kind: 'sacks', x: 16, y: 12 },
    { kind: 'tallplant', x: 18, y: 12 }
  ]
}

export const INTERIORS: Record<ShopId, InteriorTheme> = {
  simffee: SIMFFEE,
  starbucks: STARBUCKS
}

// ------------------------------------------------------------------ plotting

type Pen = (ax: number, ay: number, aw: number, ah: number, c: string) => void

/** Plotter anchored at the top left of a tile, in 14ths of a tile. */
function plot(ctx: CanvasRenderingContext2D, tx: number, ty: number): Pen {
  const ox = Math.round(tx * TILE)
  const oy = Math.round(ty * TILE)
  return (ax, ay, aw, ah, c) => {
    if (aw <= 0 || ah <= 0) return
    ctx.fillStyle = c
    ctx.fillRect(Math.round(ox + ax * PX), Math.round(oy + ay * PX), Math.round(aw * PX), Math.round(ah * PX))
  }
}

function light(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ----------------------------------------------------------------- surfaces

export function drawFloor(ctx: CanvasRenderingContext2D, t: InteriorTheme): void {
  const p = t.palette
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const kind = TILES[y][x]
      const px0 = x * TILE
      const py0 = y * TILE

      if (kind === 'wall') {
        drawWallTile(ctx, t, x, y)
        continue
      }

      if (kind === 'door') {
        ctx.fillStyle = p.door
        ctx.fillRect(px0, py0, TILE, TILE)
        ctx.fillStyle = p.outline
        ctx.fillRect(px0, py0, TILE, Math.max(2, TILE * 0.12))
        ctx.fillRect(px0 + TILE / 2 - 1, py0, 2, TILE)
        ctx.fillStyle = t.metal
        ctx.fillRect(px0 + TILE / 2 - 5, py0 + TILE * 0.45, 3, 3)
        ctx.fillRect(px0 + TILE / 2 + 3, py0 + TILE * 0.45, 3, 3)
        continue
      }

      if (t.floor === 'checker') {
        ctx.fillStyle = (x + y) % 2 === 0 ? p.floorA : p.floorB
        ctx.fillRect(px0, py0, TILE, TILE)
        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(px0, py0, TILE, 1)
        ctx.fillRect(px0, py0, 1, TILE)
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(px0, py0 + TILE - 1, TILE, 1)
        ctx.fillRect(px0 + TILE - 1, py0, 1, TILE)
      } else if (t.floor === 'herringbone') {
        const P = plot(ctx, x, y)
        P(0, 0, 14, 14, p.floorB)
        const flip = (x + y) % 2 === 0
        for (let i = 0; i < 14; i += 2) {
          const off = flip ? i : 12 - i
          P(off, i, 2, 2, p.floorA)
          P(i, off, 2, 2, p.floorA)
        }
        P(0, 13, 14, 1, 'rgba(0,0,0,0.08)')
      } else {
        ctx.fillStyle = (x + (y % 2 === 0 ? 0 : 1)) % 2 === 0 ? p.floorA : p.floorB
        ctx.fillRect(px0, py0, TILE, TILE)
        ctx.fillStyle = 'rgba(0,0,0,0.06)'
        ctx.fillRect(px0, py0 + TILE - 1, TILE, 1)
      }
    }
  }

  for (const r of t.rugs) drawRug(ctx, t, r)
}

function drawWallTile(ctx: CanvasRenderingContext2D, t: InteriorTheme, x: number, y: number): void {
  const P = plot(ctx, x, y)
  const top = y === 0
  const side = x === 0 || x === GRID_W - 1
  const bottom = y === GRID_H - 1

  if (top) {
    // wallpaper above, wainscot panelling below
    P(0, 0, 14, 8, t.wallpaper)
    for (let i = 1; i < 14; i += 4) P(i, 0, 1, 8, t.wallpaperStripe)
    P(0, 8, 14, 1, light(t.wainscot, 0.15))
    P(0, 9, 14, 5, t.wainscot)
    P(0, 13, 14, 1, t.wainscotLine)
    P(6, 9, 1, 4, t.wainscotLine)
    if (t.windows.includes(x)) drawWindow(P, t)
    else if (x % 5 === 2) drawSconce(P, t)
    return
  }

  if (bottom) {
    P(0, 0, 14, 14, t.wainscot)
    P(0, 0, 14, 1, light(t.wainscot, 0.15))
    for (let i = 3; i < 14; i += 5) P(i, 1, 1, 12, t.wainscotLine)
    P(0, 13, 14, 1, t.wainscotLine)
    return
  }

  if (side) {
    P(0, 0, 14, 14, t.wainscot)
    P(x === 0 ? 13 : 0, 0, 1, 14, t.wainscotLine)
    P(0, 6, 14, 1, t.wainscotLine)
    if (y >= 5 && y <= 6) {
      // side windows, letting a bit of the day in
      P(3, 1, 8, 12, t.windowFrame)
      P(4, 2, 6, 10, '#a9d3e6')
      P(4, 2, 2, 10, '#c9e6f2')
      P(6, 2, 1, 10, t.windowFrame)
      P(4, 6, 6, 1, t.windowFrame)
    }
    return
  }

  P(0, 0, 14, 14, t.wainscot)
}

function drawWindow(P: Pen, t: InteriorTheme): void {
  P(1, 0, 12, 8, t.windowFrame)
  P(2, 0, 10, 7, '#a9d3e6')
  P(2, 0, 4, 7, '#c9e6f2')
  P(6, 0, 1, 7, t.windowFrame)
  P(2, 3, 10, 1, t.windowFrame)
  // curtain on the left
  P(0, 0, 3, 8, t.upholstery)
  P(0, 0, 1, 8, t.upholsteryDark)
  P(11, 0, 3, 8, t.upholstery)
  P(13, 0, 1, 8, t.upholsteryDark)
  // sill with a small pot
  P(1, 8, 12, 1, light(t.wainscot, 0.25))
  P(6, 5, 3, 3, '#a94b3d')
  P(6, 3, 3, 2, '#5a8a3c')
}

function drawSconce(P: Pen, t: InteriorTheme): void {
  P(6, 2, 2, 3, t.metal)
  P(4, 0, 6, 3, '#f6e7b8')
  P(5, 0, 4, 1, '#fff7d6')
}

function drawRug(ctx: CanvasRenderingContext2D, t: InteriorTheme, r: Rug): void {
  const x = r.x * TILE + 3
  const y = r.y * TILE + 3
  const w = r.w * TILE - 6
  const h = r.h * TILE - 6
  ctx.fillStyle = t.rugEdge
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = t.rugA
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6)
  ctx.fillStyle = t.rugB
  ctx.fillRect(x + 9, y + 9, w - 18, h - 18)
  ctx.fillStyle = t.rugA
  const step = 14
  for (let i = x + 12; i < x + w - 12; i += step) {
    for (let j = y + 12; j < y + h - 12; j += step) {
      ctx.fillRect(i, j, 4, 4)
    }
  }
  // fringe
  ctx.fillStyle = t.rugEdge
  for (let i = x; i < x + w; i += 6) {
    ctx.fillRect(i, y - 2, 3, 2)
    ctx.fillRect(i, y + h, 3, 2)
  }
}

// ---------------------------------------------------------------- furniture

function shade(ctx: CanvasRenderingContext2D, tx: number, ty: number, w: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath()
  ctx.ellipse((tx + w / 2) * TILE, (ty + 1) * TILE - 3, w * TILE * 0.42, TILE * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawFurniture(ctx: CanvasRenderingContext2D, t: InteriorTheme, f: Furniture, tick: number): void {
  const P = plot(ctx, f.x, f.y)
  const wood = t.shelfWood
  const woodLight = light(wood, 0.15)
  const out = t.palette.outline
  const leaf = '#5a8a3c'
  const leafLight = '#7fb257'
  const leafDark = '#3d6a2a'
  const pot = '#b5663d'

  switch (f.kind) {
    case 'shelf': {
      // two tiles wide, jars and cups on two boards
      for (let s = 0; s < 2; s++) {
        const Q = plot(ctx, f.x + s, f.y)
        Q(0, 2, 14, 1, wood)
        Q(0, 8, 14, 1, wood)
        Q(1, -2, 3, 4, s === 0 ? t.jarA : t.jarB)
        Q(1, -3, 3, 1, out)
        Q(6, -1, 4, 3, t.jarB)
        Q(6, -2, 4, 1, out)
        Q(11, -2, 2, 4, t.jarA)
        Q(2, 5, 3, 3, t.palette.cup)
        Q(2, 5, 3, 1, out)
        Q(7, 4, 4, 4, t.jarA)
        Q(7, 4, 4, 1, out)
        Q(8, 5, 2, 2, t.jarB)
      }
      return
    }
    case 'backbar': {
      // six tiles of back bar behind the counter: boards, grinders, tins, cups
      for (let s = 0; s < 6; s++) {
        const Q = plot(ctx, f.x + s, f.y)
        Q(0, 1, 14, 1, wood)
        Q(0, 7, 14, 1, wood)
        Q(0, 12, 14, 2, wood)
        const tin = s % 2 === 0 ? t.jarA : t.jarB
        Q(1, -3, 4, 4, tin)
        Q(1, -3, 4, 1, out)
        Q(2, -2, 2, 1, t.palette.cup)
        Q(7, -2, 3, 3, t.palette.cup)
        Q(7, -2, 3, 1, out)
        Q(11, -3, 2, 4, t.metal)
        for (let c = 0; c < 4; c++) Q(1 + c * 3, 4, 2, 3, t.palette.cup)
        for (let c = 0; c < 4; c++) Q(1 + c * 3, 4, 2, 1, out)
        Q(1, 9, 5, 3, s % 2 === 0 ? t.jarB : tin)
        Q(1, 9, 5, 1, out)
        Q(8, 9, 4, 3, t.metal)
        Q(8, 9, 4, 1, out)
      }
      return
    }
    case 'menuboard': {
      // three tile chalkboard with a wooden frame and scribbles
      const Q = plot(ctx, f.x, f.y)
      Q(0, -4, 42, 14, wood)
      Q(1, -3, 40, 12, '#2f2a26')
      for (let r = 0; r < 4; r++) {
        Q(3, -1 + r * 3, 12 + (r % 2) * 6, 1, '#efe7d2')
        Q(30, -1 + r * 3, 8, 1, '#efe7d2')
      }
      Q(3, -3, 6, 1, '#f2c96a')
      return
    }
    case 'chalkboard': {
      const Q = plot(ctx, f.x, f.y)
      Q(0, -4, 42, 14, out)
      Q(1, -3, 40, 12, '#1f2e26')
      for (let r = 0; r < 4; r++) {
        Q(3, -1 + r * 3, 14 + (r % 2) * 4, 1, '#dfe8d8')
        Q(30, -1 + r * 3, 8, 1, t.metal)
      }
      Q(20, -2, 4, 4, t.palette.cup)
      Q(21, -1, 2, 2, t.palette.accent)
      return
    }
    case 'painting': {
      P(1, -3, 12, 11, t.metal)
      P(2, -2, 10, 9, '#6a9dc2')
      P(2, 3, 10, 4, '#7fa85a')
      P(4, 0, 3, 3, '#f6e7b8')
      P(7, 2, 4, 3, '#4f6b52')
      return
    }
    case 'clock': {
      P(3, -3, 8, 9, wood)
      P(4, -2, 6, 6, t.palette.cup)
      P(6, -2, 2, 1, out)
      P(6, 0, 1, 2, out)
      P(7, 1, 2, 1, out)
      P(5, 5, 4, 3, wood)
      P(6, 6, 2, 1, t.metal)
      return
    }
    case 'espresso': {
      shade(ctx, f.x, f.y, 1)
      P(1, -4, 12, 11, t.metal)
      P(1, -4, 12, 1, light(t.metal, 0.2))
      P(2, -3, 10, 3, out)
      P(3, -2, 3, 1, '#c2564f')
      P(8, -2, 3, 1, '#5a8a3c')
      P(3, 3, 2, 4, out)
      P(9, 3, 2, 4, out)
      P(3, 7, 3, 2, t.palette.cup)
      P(8, 7, 3, 2, t.palette.cup)
      P(0, 9, 14, 2, out)
      // steam
      if (Math.floor(tick / 20) % 2 === 0) P(5, -6, 1, 2, 'rgba(255,255,255,0.7)')
      else P(8, -7, 1, 2, 'rgba(255,255,255,0.7)')
      return
    }
    case 'grinder': {
      P(4, -3, 6, 4, t.metal)
      P(5, -5, 4, 2, t.jarB)
      P(5, 1, 4, 6, out)
      P(3, 7, 8, 2, out)
      P(6, 3, 2, 2, t.metal)
      return
    }
    case 'register': {
      P(2, -2, 10, 8, out)
      P(3, -1, 8, 3, '#8fd0c2')
      P(3, 3, 8, 2, t.metal)
      P(4, 6, 6, 2, out)
      P(3, -3, 8, 1, t.metal)
      return
    }
    case 'pastry': {
      // glass case on a wooden base, two tiles wide
      const Q = plot(ctx, f.x, f.y)
      Q(0, 5, 28, 9, wood)
      Q(0, 5, 28, 1, woodLight)
      Q(0, -4, 28, 9, 'rgba(200,230,240,0.55)')
      Q(0, -4, 28, 1, t.metal)
      Q(0, -4, 1, 9, t.metal)
      Q(27, -4, 1, 9, t.metal)
      Q(0, 0, 28, 1, t.metal)
      const cakes = ['#d9a441', '#a94b3d', '#f6e7b8', '#7c3128', '#e8c98c', '#c98f56']
      for (let i = 0; i < 6; i++) {
        Q(2 + i * 4.3, -3, 3, 3, cakes[i])
        Q(2 + i * 4.3, 1, 3, 3, cakes[(i + 3) % 6])
      }
      return
    }
    case 'plant': {
      shade(ctx, f.x, f.y, 1)
      P(4, 8, 6, 5, pot)
      P(4, 8, 6, 1, light(pot, 0.15))
      P(3, 7, 8, 1, out)
      P(2, 2, 10, 6, leaf)
      P(3, 1, 4, 3, leafLight)
      P(7, 5, 4, 3, leafDark)
      P(5, 0, 4, 2, leaf)
      return
    }
    case 'tallplant': {
      shade(ctx, f.x, f.y, 1)
      P(3, 9, 8, 5, pot)
      P(3, 9, 8, 1, light(pot, 0.15))
      P(6, 0, 2, 9, leafDark)
      P(0, -3, 6, 4, leaf)
      P(8, -5, 6, 4, leaf)
      P(1, 2, 5, 3, leafLight)
      P(8, 1, 6, 3, leafLight)
      P(4, -8, 6, 5, leaf)
      P(5, -7, 3, 2, leafLight)
      return
    }
    case 'bookshelf': {
      // two tiles wide, three shelves of spines
      const Q = plot(ctx, f.x, f.y)
      const books = ['#a94b3d', '#4f6b52', '#d9a441', '#3b4f7a', '#8f4b2b', '#f6e7b8']
      Q(0, -8, 28, 22, wood)
      Q(1, -7, 26, 20, light(wood, -0.1))
      for (let s = 0; s < 3; s++) {
        const y = -6 + s * 7
        Q(1, y + 5, 26, 1, woodLight)
        let x = 2
        let i = s
        while (x < 25) {
          const w = 2 + (i % 2)
          Q(x, y + (i % 3 === 0 ? 0 : 1), w, 5 - (i % 3 === 0 ? 0 : 1), books[i % books.length])
          x += w + 1
          i++
        }
      }
      return
    }
    case 'fireplace': {
      // two tiles wide brick hearth with a mantel
      const Q = plot(ctx, f.x, f.y)
      Q(0, -10, 28, 24, '#8a5a40')
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 7; c++) Q(c * 4 + (r % 2) * 2, -10 + r * 2, 3, 1, r % 3 === 0 ? '#a26a4a' : '#7a4c34')
      }
      Q(0, -11, 28, 2, wood)
      Q(0, -11, 28, 1, woodLight)
      Q(6, -3, 16, 15, out)
      Q(8, -1, 12, 13, '#3a2718')
      const flick = Math.floor(tick / 8) % 3
      Q(10, 6 + flick, 8, 6 - flick, '#e0682f')
      Q(12, 3 + flick, 4, 6, '#f2a23a')
      Q(13, 1 + flick, 2, 4, '#fbe27a')
      Q(9, 11, 10, 2, '#4a3527')
      Q(3, -10, 4, 5, t.jarA)
      Q(20, -9, 5, 4, t.palette.cup)
      return
    }
    case 'armchair': {
      shade(ctx, f.x, f.y, 1)
      P(1, -2, 12, 6, t.upholstery)
      P(1, -3, 12, 1, out)
      P(0, 3, 14, 8, t.upholstery)
      P(0, 3, 3, 8, t.upholsteryDark)
      P(11, 3, 3, 8, t.upholsteryDark)
      P(3, 4, 8, 5, light(t.upholstery, 0.12))
      P(1, 11, 2, 2, wood)
      P(11, 11, 2, 2, wood)
      return
    }
    case 'sofa': {
      // two tiles wide
      shade(ctx, f.x, f.y, 2)
      const Q = plot(ctx, f.x, f.y)
      Q(1, -2, 26, 6, t.upholstery)
      Q(1, -3, 26, 1, out)
      Q(0, 3, 28, 8, t.upholstery)
      Q(0, 3, 3, 8, t.upholsteryDark)
      Q(25, 3, 3, 8, t.upholsteryDark)
      Q(3, 4, 10, 5, light(t.upholstery, 0.12))
      Q(15, 4, 10, 5, light(t.upholstery, 0.12))
      Q(5, -1, 5, 4, t.rugEdge)
      Q(18, -1, 5, 4, t.jarB)
      Q(1, 11, 2, 2, wood)
      Q(25, 11, 2, 2, wood)
      return
    }
    case 'floorlamp': {
      P(6, -1, 2, 12, t.metal)
      P(3, 11, 8, 2, out)
      P(2, -8, 10, 7, '#f6e7b8')
      P(2, -8, 10, 1, out)
      P(3, -7, 3, 5, '#fff7d6')
      ctx.fillStyle = 'rgba(255,230,160,0.14)'
      ctx.beginPath()
      ctx.ellipse((f.x + 0.5) * TILE, (f.y + 0.4) * TILE, TILE * 1.4, TILE * 1.0, 0, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'sidetable': {
      shade(ctx, f.x, f.y, 1)
      P(2, 3, 10, 3, wood)
      P(2, 3, 10, 1, woodLight)
      P(4, 6, 2, 6, out)
      P(8, 6, 2, 6, out)
      P(5, -2, 4, 5, '#8fbfd9')
      P(4, -4, 6, 3, '#c2564f')
      P(5, -5, 4, 1, '#f2c96a')
      return
    }
    case 'lowtable': {
      shade(ctx, f.x, f.y, 1)
      P(1, 4, 12, 3, wood)
      P(1, 4, 12, 1, woodLight)
      P(2, 7, 2, 5, out)
      P(10, 7, 2, 5, out)
      P(4, 1, 3, 3, t.palette.cup)
      P(8, 2, 4, 2, '#a94b3d')
      return
    }
    case 'gramophone': {
      shade(ctx, f.x, f.y, 1)
      P(2, 6, 10, 6, wood)
      P(2, 6, 10, 1, woodLight)
      P(3, 12, 2, 2, out)
      P(9, 12, 2, 2, out)
      P(7, 2, 2, 4, t.metal)
      P(4, -4, 8, 6, t.metal)
      P(3, -5, 10, 1, light(t.metal, 0.2))
      P(5, -3, 3, 3, light(t.metal, -0.2))
      P(3, 7, 4, 4, out)
      return
    }
    case 'sacks': {
      shade(ctx, f.x, f.y, 1)
      P(1, 3, 8, 10, '#c9a06f')
      P(1, 3, 8, 1, '#e0bf8c')
      P(2, 6, 6, 3, '#8f4b2b')
      P(1, 2, 8, 1, out)
      P(7, 6, 6, 7, '#d6b485')
      P(7, 5, 6, 1, out)
      P(8, 8, 4, 2, '#4f6b52')
      return
    }
    case 'barrel': {
      shade(ctx, f.x, f.y, 1)
      P(2, -1, 10, 14, '#8a5a40')
      P(3, -1, 2, 14, '#a26a4a')
      P(1, 1, 12, 1, t.metal)
      P(1, 9, 12, 1, t.metal)
      P(2, -2, 10, 1, out)
      return
    }
    case 'crates': {
      shade(ctx, f.x, f.y, 1)
      P(0, 4, 10, 9, '#a58558')
      P(0, 4, 10, 1, '#c9a06f')
      P(1, 5, 8, 7, '#8a6a47')
      P(4, 5, 2, 7, '#a58558')
      P(4, -1, 9, 6, '#b8865a')
      P(4, -1, 9, 1, '#d4a677')
      P(5, 0, 7, 4, '#946a44')
      P(8, 0, 1, 4, '#b8865a')
      return
    }
    case 'stanchion': {
      P(6, 0, 2, 12, t.metal)
      P(4, 12, 6, 2, out)
      P(5, -1, 4, 2, t.metal)
      // velvet rope trailing down to the next post
      for (let i = 0; i < 14; i++) P(7, 2 + i, 1, 1, t.upholstery)
      return
    }
    case 'easel': {
      P(3, -6, 8, 12, '#2f2a26')
      P(3, -7, 8, 1, wood)
      P(4, -5, 6, 1, '#efe7d2')
      P(4, -3, 4, 1, '#efe7d2')
      P(4, -1, 5, 1, t.metal)
      P(2, 6, 2, 7, wood)
      P(10, 6, 2, 7, wood)
      return
    }
    case 'newsrack': {
      P(2, 0, 10, 12, wood)
      P(3, 1, 8, 3, '#efe7d2')
      P(3, 5, 8, 3, '#dfe8d8')
      P(3, 9, 8, 2, '#f6e7b8')
      P(4, 2, 5, 1, out)
      P(4, 6, 5, 1, out)
      return
    }
    case 'umbrellas': {
      P(4, 6, 6, 8, t.metal)
      P(4, 6, 6, 1, out)
      P(5, -2, 1, 9, '#a94b3d')
      P(7, -3, 1, 10, '#3b4f7a')
      P(9, -1, 1, 8, '#d9a441')
      return
    }
    case 'windowseat': {
      // bench under the side windows, three tiles tall
      for (let s = 0; s < 3; s++) {
        const Q = plot(ctx, f.x, f.y + s)
        Q(0, 0, 14, 14, wood)
        Q(1, 1, 12, 12, t.upholstery)
        Q(2, 2, 10, 4, light(t.upholstery, 0.12))
        Q(3, 8, 8, 4, s === 1 ? t.rugEdge : t.upholsteryDark)
      }
      return
    }
    case 'merch': {
      // a shelf of mugs and bags to sell
      P(0, 0, 14, 1, wood)
      P(0, 7, 14, 1, wood)
      P(0, 13, 14, 1, wood)
      for (let c = 0; c < 3; c++) {
        P(1 + c * 4, -3, 3, 3, c % 2 === 0 ? t.palette.cup : t.jarB)
        P(1 + c * 4, -3, 3, 1, out)
        P(1 + c * 4, 3, 3, 4, c % 2 === 0 ? t.jarB : t.palette.cup)
        P(1 + c * 4, 3, 3, 1, out)
        P(1 + c * 4, 9, 3, 4, t.jarA)
        P(1 + c * 4, 9, 3, 1, out)
      }
      return
    }
    case 'doormat': {
      const Q = plot(ctx, f.x, f.y)
      Q(2, 3, 24, 9, '#8a6a47')
      Q(3, 4, 22, 7, '#a58558')
      Q(5, 6, 18, 3, '#8a6a47')
      return
    }
    case 'bench': {
      shade(ctx, f.x, f.y, 2)
      const Q = plot(ctx, f.x, f.y)
      Q(1, 2, 26, 4, wood)
      Q(1, 2, 26, 1, woodLight)
      Q(1, -2, 26, 3, wood)
      Q(1, -3, 26, 1, woodLight)
      Q(2, 6, 2, 6, out)
      Q(24, 6, 2, 6, out)
      Q(6, 1, 6, 3, t.upholstery)
      Q(16, 1, 6, 3, t.jarB)
      return
    }
  }
}

/**
 * Furniture that stands on the floor, drawn in row order so lower pieces sit
 * in front of higher ones. Wall pieces sit in row 1 and paint first anyway.
 */
export function drawFurnishings(ctx: CanvasRenderingContext2D, t: InteriorTheme, tick: number): void {
  const ordered = [...t.furniture].sort((a, b) => a.y - b.y)
  for (const f of ordered) drawFurniture(ctx, t, f, tick)
}
