import { GRID_H, GRID_W, SERVE_SPOT, TILE, TILES, type World } from './world'
import { drawBarista, drawCustomer, paletteForCustomer } from './sprites'
import { drawFloor, drawFurnishings, type InteriorTheme } from './interior'

export interface Palette {
  floorA: string
  floorB: string
  wall: string
  wallTop: string
  counter: string
  counterTop: string
  table: string
  tableTaken: string
  chair: string
  door: string
  outline: string
  cup: string
  apron: string
  annoyed: string
  accent: string
}

/** Feet sit slightly below the tile centre so characters look grounded. */
const FOOT_OFFSET = 0.32

export function render(ctx: CanvasRenderingContext2D, world: World, theme: InteriorTheme, tick: number): void {
  const p = theme.palette
  const px = TILE / 14 // sprite pixel size, tuned so a person is a bit taller than a tile

  ctx.clearRect(0, 0, GRID_W * TILE, GRID_H * TILE)
  ctx.imageSmoothingEnabled = false

  // ---- floor, walls, rugs ----
  drawFloor(ctx, theme)

  // counter drawn on top so it reads as furniture, not floor
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (TILES[y][x] !== 'counter') continue
      const px0 = x * TILE
      const py0 = y * TILE
      ctx.fillStyle = p.counter
      ctx.fillRect(px0, py0, TILE, TILE)
      ctx.fillStyle = p.counterTop
      ctx.fillRect(px0, py0 + TILE - Math.max(4, TILE * 0.3), TILE, Math.max(4, TILE * 0.3))
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.fillRect(px0, py0, 1, TILE)
    }
  }

  // ---- tables with chairs ----
  for (const table of world.tables) {
    const cx = table.x * TILE + TILE / 2
    const cy = table.y * TILE + TILE / 2

    ctx.fillStyle = p.chair
    ctx.fillRect(cx - TILE * 0.52, cy - TILE * 0.16, TILE * 0.22, TILE * 0.32)
    ctx.fillRect(cx + TILE * 0.3, cy - TILE * 0.16, TILE * 0.22, TILE * 0.32)

    ctx.fillStyle = p.outline
    ctx.beginPath()
    ctx.arc(cx, cy, TILE * 0.4, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = table.takenBy === null ? p.table : p.tableTaken
    ctx.beginPath()
    ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- set dressing, none of it walkable ----
  drawFurnishings(ctx, theme, tick)

  // ---- baristas behind the counter ----
  world.baristaBusy.forEach((busy, i) => {
    const bx = (SERVE_SPOT.x + i * 1.4) * TILE + TILE / 2
    const by = (SERVE_SPOT.y - 1) * TILE + TILE * FOOT_OFFSET + TILE
    drawBarista(ctx, bx, by, px, {
      outline: p.outline,
      skin: '#e8bd94',
      hair: '#3b2418',
      clothes: '#f3ece0',
      trousers: '#4a4a55',
      apron: p.apron,
      cup: p.cup
    })

    if (busy > 0) {
      ctx.fillStyle = p.accent
      ctx.fillRect(bx - TILE * 0.3, by - TILE * 1.9, TILE * 0.6 * (busy / 14), 3)
    }
  })

  // ---- customers, sorted so lower ones overlap higher ones ----
  const ordered = [...world.customers].sort((a, b) => a.y - b.y)

  for (const c of ordered) {
    const cx = c.x * TILE + TILE / 2
    const cy = c.y * TILE + TILE / 2 + TILE * FOOT_OFFSET

    // soft shadow grounds the sprite
    ctx.fillStyle = 'rgba(0,0,0,0.13)'
    ctx.beginPath()
    ctx.ellipse(cx, cy, TILE * 0.28, TILE * 0.1, 0, 0, Math.PI * 2)
    ctx.fill()

    const walking = c.state === 'entering' || c.state === 'leaving' || c.state === 'toTable' || c.state === 'queueing'

    drawCustomer(
      ctx,
      cx,
      cy,
      px,
      c.facing,
      walking && (Math.abs(c.x - c.tx) > 0.05 || Math.abs(c.y - c.ty) > 0.05),
      c.anim,
      paletteForCustomer(c.id, p.outline, p.cup, p.apron),
      c.carrying
    )

    // patience draining, drawn above the head
    if (c.state === 'queueing') {
      const frac = Math.min(1, c.waited / c.patience)
      const w = TILE * 0.66
      const x = cx - w / 2
      const y = cy - TILE * 1.95

      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(x - 1, y - 1, w + 2, 5)
      ctx.fillStyle = frac > 0.7 ? p.annoyed : p.accent
      ctx.fillRect(x, y, w * (1 - frac), 3)
    }

    if (c.mood === 'annoyed' && c.state === 'leaving') {
      ctx.fillStyle = p.annoyed
      ctx.font = `bold ${Math.round(TILE * 0.6)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('!', cx, cy - TILE * 2.1)
    }
  }
}

