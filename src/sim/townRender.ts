import { drawCustomer, paletteForCustomer } from './sprites'
import {
  BUILDINGS,
  DECOR,
  PLAZAS,
  ROAD_BOTTOM,
  ROAD_TOP,
  T,
  WORLD_H,
  WORLD_W,
  type Building,
  type Decor
} from './town'
import { isWalking, type Villager } from './villagers'

export interface Camera {
  x: number
  y: number
  zoom: number
}

const OUTLINE = '#3a2a20'
const SHADOW = 'rgba(40,30,20,0.16)'

const GRASS = ['#8fb873', '#88b16c', '#95bd7a', '#83ab68']
const ROAD_FILL = '#cdbfa6'
const PAVEMENT = '#ded3bd'

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = SHADOW
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

function outlined(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  lw = 2
): void {
  rect(ctx, x - lw, y - lw, w + lw * 2, h + lw * 2, OUTLINE)
  rect(ctx, x, y, w, h, fill)
}

// ------------------------------------------------------------------ scenery

function drawTree(ctx: CanvasRenderingContext2D, d: Decor): void {
  const s = T * (0.9 + d.variant * 0.12)
  shadow(ctx, d.x, d.y, s * 0.5, s * 0.16)
  outlined(ctx, d.x - s * 0.1, d.y - s * 0.9, s * 0.2, s * 0.9, '#6b4a33', 1)

  const greens = ['#4f7f47', '#5d8d4f', '#456f3e', '#67985a']
  const g = greens[d.variant % greens.length]
  const puffs: [number, number, number][] = [
    [0, -1.55, 0.72],
    [-0.5, -1.2, 0.55],
    [0.5, -1.2, 0.55],
    [0, -1.05, 0.6]
  ]
  ctx.fillStyle = OUTLINE
  for (const [ox, oy, r] of puffs) {
    ctx.beginPath()
    ctx.arc(d.x + ox * s, d.y + oy * s, r * s + 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = g
  for (const [ox, oy, r] of puffs) {
    ctx.beginPath()
    ctx.arc(d.x + ox * s, d.y + oy * s, r * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.beginPath()
  ctx.arc(d.x - s * 0.25, d.y - s * 1.75, s * 0.3, 0, Math.PI * 2)
  ctx.fill()
}

function drawPine(ctx: CanvasRenderingContext2D, d: Decor): void {
  const s = T * (0.85 + d.variant * 0.1)
  shadow(ctx, d.x, d.y, s * 0.42, s * 0.14)
  outlined(ctx, d.x - s * 0.09, d.y - s * 0.6, s * 0.18, s * 0.6, '#63442f', 1)

  const layers = [
    [1.9, 0.78],
    [1.45, 0.62],
    [1.0, 0.46]
  ]
  const g = ['#3f6b40', '#48784a', '#37603a'][d.variant % 3]
  for (const [top, half] of layers) {
    ctx.fillStyle = OUTLINE
    ctx.beginPath()
    ctx.moveTo(d.x, d.y - top * s - 3)
    ctx.lineTo(d.x - half * s - 3, d.y - (top - 0.62) * s)
    ctx.lineTo(d.x + half * s + 3, d.y - (top - 0.62) * s)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(d.x, d.y - top * s)
    ctx.lineTo(d.x - half * s, d.y - (top - 0.62) * s)
    ctx.lineTo(d.x + half * s, d.y - (top - 0.62) * s)
    ctx.closePath()
    ctx.fill()
  }
}

function drawBush(ctx: CanvasRenderingContext2D, d: Decor): void {
  const s = T * (0.4 + d.variant * 0.08)
  shadow(ctx, d.x, d.y, s * 1.1, s * 0.3)
  const g = ['#567f4c', '#618c56', '#4c7344'][d.variant % 3]
  ctx.fillStyle = OUTLINE
  for (const ox of [-0.6, 0, 0.6]) {
    ctx.beginPath()
    ctx.arc(d.x + ox * s, d.y - s * 0.5, s * 0.72 + 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = g
  for (const ox of [-0.6, 0, 0.6]) {
    ctx.beginPath()
    ctx.arc(d.x + ox * s, d.y - s * 0.5, s * 0.72, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D, d: Decor): void {
  const colors = ['#e88fa5', '#f2d06b', '#c98ae0', '#f0997a']
  const c = colors[d.variant % colors.length]
  for (let i = 0; i < 3; i++) {
    const x = d.x + (i - 1) * T * 0.26
    const y = d.y - (i % 2) * T * 0.12
    rect(ctx, x - 1, y - T * 0.24, 2, T * 0.24, '#4f7a45')
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(x, y - T * 0.28, T * 0.12, 0, Math.PI * 2)
    ctx.fill()
    rect(ctx, x - 1, y - T * 0.29, 2, 2, '#fff3c4')
  }
}

function drawRock(ctx: CanvasRenderingContext2D, d: Decor): void {
  const s = T * (0.24 + d.variant * 0.06)
  shadow(ctx, d.x, d.y, s * 1.3, s * 0.4)
  ctx.fillStyle = OUTLINE
  ctx.beginPath()
  ctx.ellipse(d.x, d.y - s * 0.4, s * 1.1 + 2, s * 0.8 + 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#9c9488'
  ctx.beginPath()
  ctx.ellipse(d.x, d.y - s * 0.4, s * 1.1, s * 0.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#b5ada0'
  ctx.beginPath()
  ctx.ellipse(d.x - s * 0.3, d.y - s * 0.65, s * 0.4, s * 0.25, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawLamp(ctx: CanvasRenderingContext2D, d: Decor, tick: number): void {
  shadow(ctx, d.x, d.y, T * 0.3, T * 0.1)
  outlined(ctx, d.x - T * 0.1, d.y - T * 2.4, T * 0.2, T * 2.4, '#4c4038', 1)
  outlined(ctx, d.x - T * 0.32, d.y - T * 2.95, T * 0.64, T * 0.55, '#5c4e42', 1)

  const glow = 0.72 + Math.sin(tick / 40) * 0.08
  ctx.fillStyle = `rgba(255, 224, 150, ${glow})`
  ctx.beginPath()
  ctx.arc(d.x, d.y - T * 2.68, T * 0.5, 0, Math.PI * 2)
  ctx.fill()
  rect(ctx, d.x - T * 0.18, d.y - T * 2.85, T * 0.36, T * 0.36, '#ffe9a8')
}

function drawBench(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.85, T * 0.18)
  outlined(ctx, d.x - T * 0.75, d.y - T * 0.5, T * 1.5, T * 0.22, '#8a6a47', 1)
  outlined(ctx, d.x - T * 0.75, d.y - T * 0.95, T * 1.5, T * 0.2, '#9a7a55', 1)
  rect(ctx, d.x - T * 0.62, d.y - T * 0.3, T * 0.14, T * 0.32, '#5c4a35')
  rect(ctx, d.x + T * 0.48, d.y - T * 0.3, T * 0.14, T * 0.32, '#5c4a35')
}

function drawPlanter(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.45, T * 0.14)
  outlined(ctx, d.x - T * 0.34, d.y - T * 0.5, T * 0.68, T * 0.5, d.variant === 1 ? '#b5744d' : '#9a7a55', 1)
  const g = '#4f7f47'
  ctx.fillStyle = g
  for (const ox of [-0.22, 0, 0.22]) {
    ctx.beginPath()
    ctx.arc(d.x + ox * T, d.y - T * 0.62, T * 0.22, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#f2d06b'
  ctx.beginPath()
  ctx.arc(d.x + T * 0.1, d.y - T * 0.75, T * 0.09, 0, Math.PI * 2)
  ctx.fill()
}

function drawCrate(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.42, T * 0.13)
  outlined(ctx, d.x - T * 0.34, d.y - T * 0.68, T * 0.68, T * 0.68, '#a97f58', 1)
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(d.x - T * 0.34, d.y - T * 0.68)
  ctx.lineTo(d.x + T * 0.34, d.y)
  ctx.moveTo(d.x + T * 0.34, d.y - T * 0.68)
  ctx.lineTo(d.x - T * 0.34, d.y)
  ctx.stroke()
}

function drawBarrel(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.4, T * 0.13)
  outlined(ctx, d.x - T * 0.3, d.y - T * 0.78, T * 0.6, T * 0.78, '#8e6239', 1)
  rect(ctx, d.x - T * 0.3, d.y - T * 0.58, T * 0.6, T * 0.08, '#6b4726')
  rect(ctx, d.x - T * 0.3, d.y - T * 0.26, T * 0.6, T * 0.08, '#6b4726')
}

function drawFence(ctx: CanvasRenderingContext2D, d: Decor): void {
  const w = T * 2.6
  const x0 = d.x - w / 2
  rect(ctx, x0, d.y - T * 0.42, w, T * 0.1, '#c9b48f')
  rect(ctx, x0, d.y - T * 0.22, w, T * 0.1, '#c9b48f')
  for (let i = 0; i <= 5; i++) {
    const px = x0 + (w / 5) * i
    rect(ctx, px - 2, d.y - T * 0.58, 4, T * 0.6, '#d8c5a2')
    rect(ctx, px - 2, d.y - T * 0.62, 4, 4, '#c0ab86')
  }
}

function drawMailbox(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.22, T * 0.08)
  rect(ctx, d.x - 2, d.y - T * 0.8, 4, T * 0.8, '#6b5540')
  outlined(ctx, d.x - T * 0.24, d.y - T * 1.12, T * 0.48, T * 0.34, '#7a94a8', 1)
  rect(ctx, d.x + T * 0.18, d.y - T * 1.16, 3, T * 0.2, '#c2564f')
}

function drawBistro(ctx: CanvasRenderingContext2D, d: Decor): void {
  shadow(ctx, d.x, d.y, T * 0.7, T * 0.18)
  // table
  rect(ctx, d.x - 2, d.y - T * 0.6, 4, T * 0.6, '#6b5540')
  ctx.fillStyle = OUTLINE
  ctx.beginPath()
  ctx.ellipse(d.x, d.y - T * 0.62, T * 0.42 + 2, T * 0.2 + 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = d.variant === 1 ? '#e6d3b3' : '#d9c4a0'
  ctx.beginPath()
  ctx.ellipse(d.x, d.y - T * 0.62, T * 0.42, T * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()
  // two chairs
  for (const ox of [-T * 0.72, T * 0.72]) {
    outlined(ctx, d.x + ox - T * 0.2, d.y - T * 0.52, T * 0.4, T * 0.14, '#8a6a47', 1)
    outlined(ctx, d.x + ox - T * 0.2, d.y - T * 0.9, T * 0.4, T * 0.12, '#8a6a47', 1)
  }
  // a cup on the table
  rect(ctx, d.x - 3, d.y - T * 0.78, 6, T * 0.16, '#fdfaf3')
}

function drawDecor(ctx: CanvasRenderingContext2D, d: Decor, tick: number): void {
  switch (d.kind) {
    case 'tree':
      return drawTree(ctx, d)
    case 'pine':
      return drawPine(ctx, d)
    case 'bush':
      return drawBush(ctx, d)
    case 'flowers':
      return drawFlowers(ctx, d)
    case 'rock':
      return drawRock(ctx, d)
    case 'lamp':
      return drawLamp(ctx, d, tick)
    case 'bench':
      return drawBench(ctx, d)
    case 'planter':
      return drawPlanter(ctx, d)
    case 'crate':
      return drawCrate(ctx, d)
    case 'barrel':
      return drawBarrel(ctx, d)
    case 'fence':
      return drawFence(ctx, d)
    case 'mailbox':
      return drawMailbox(ctx, d)
    case 'bistro':
      return drawBistro(ctx, d)
  }
}

// ----------------------------------------------------------------- buildings

function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const f = (v: number): number =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount))))
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`
}

/**
 * Houses are plotted on an art pixel grid, one art pixel being several world
 * pixels. Slopes are stair stepped and every edge lands on a whole pixel, which
 * is what makes it read as pixel art instead of smooth vector shapes.
 */
function drawHome(ctx: CanvasRenderingContext2D, b: Building, hovered: boolean, tick: number): void {
  const { x, y, w, h } = b.box

  const U = Math.max(2, Math.round(T / 9)) // world pixels per art pixel
  const AW = Math.max(18, Math.round(w / U))
  const AH = Math.max(18, Math.round(h / U))
  const x0 = Math.round(x)
  const y0 = Math.round(y)

  const P = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    if (aw <= 0 || ah <= 0) return
    ctx.fillStyle = c
    ctx.fillRect(x0 + ax * U, y0 + ay * U, aw * U, ah * U)
  }

  const roof = b.roof
  const roofLight = tint(roof, 0.22)
  const roofDark = tint(roof, -0.28)
  const roofEdge = tint(roof, -0.55)

  const wall = b.wall
  const wallLight = tint(wall, 0.3)
  const wallDark = tint(wall, -0.16)
  const wallEdge = tint(wall, -0.55)

  const ROOF_ROWS = Math.round(AH * 0.5)
  const EAVE = ROOF_ROWS
  const WALL_TOP = EAVE + 2
  const mid = Math.floor(AW / 2)

  shadow(ctx, x + w / 2, y + h + 2, w * 0.48, T * 0.2)

  // chimney, drawn first so the roof overlaps its base
  const chX = Math.round(AW * 0.66)
  P(chX - 1, 0, 5, ROOF_ROWS, roofEdge)
  P(chX, 1, 3, ROOF_ROWS - 1, '#9c6b52')
  P(chX, 1, 1, ROOF_ROWS - 1, tint('#9c6b52', 0.25))
  P(chX - 1, 0, 5, 1, '#5e4030')

  // smoke
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  for (let i = 0; i < 3; i++) {
    const t = (tick / 30 + i * 0.9) % 3
    const sx = x0 + (chX + 1) * U + Math.sin(t * 2.4) * 5
    const sy = y0 - t * 13
    const r = Math.round((2.4 + t * 2) / 2) * 2
    ctx.fillRect(Math.round(sx / U) * U, Math.round(sy / U) * U, r, r)
  }

  // roof: a stepped trapezoid, wider every row down to the eaves
  for (let r = 0; r < ROOF_ROWS; r++) {
    const t = ROOF_ROWS === 1 ? 1 : r / (ROOF_ROWS - 1)
    const half = Math.round(AW * 0.17 + t * (AW * 0.44))
    const left = mid - half
    const span = half * 2

    P(left - 1, r, span + 2, 1, roofEdge)
    P(left, r, span, 1, roof)
    P(left, r, Math.max(1, Math.round(span * 0.34)), 1, roofLight)
    P(left + span - Math.max(1, Math.round(span * 0.2)), r, Math.max(1, Math.round(span * 0.2)), 1, roofDark)
    if (r % 3 === 2) P(left, r, span, 1, roofDark)
  }

  // ridge cap and the fascia board, which give the roof real thickness
  P(mid - Math.round(AW * 0.18), 0, Math.round(AW * 0.36), 1, roofEdge)
  P(-1, EAVE, AW + 2, 2, roofEdge)
  P(-1, EAVE, AW + 2, 1, tint(roof, -0.4))

  // walls
  P(0, WALL_TOP, AW, AH - WALL_TOP, wallEdge)
  P(1, WALL_TOP, AW - 2, AH - WALL_TOP - 1, wall)
  P(1, WALL_TOP, 2, AH - WALL_TOP - 1, wallLight)
  P(AW - 4, WALL_TOP, 3, AH - WALL_TOP - 1, wallDark)
  for (let r = WALL_TOP + 2; r < AH - 1; r += 3) P(1, r, AW - 2, 1, tint(wall, -0.07))

  // windows
  const winY = WALL_TOP + 2
  const winW = Math.max(4, Math.round(AW * 0.22))
  const winH = Math.max(4, Math.round((AH - WALL_TOP) * 0.42))
  for (const wx of [Math.round(AW * 0.12), AW - Math.round(AW * 0.12) - winW]) {
    P(wx - 1, winY - 1, winW + 2, winH + 2, '#5e4030')
    P(wx, winY, winW, winH, '#9fc6d4')
    P(wx, winY, Math.ceil(winW / 2), Math.ceil(winH / 2), '#cfe6ee')
    P(wx + Math.floor(winW / 2), winY, 1, winH, '#5e4030')
    P(wx, winY + Math.floor(winH / 2), winW, 1, '#5e4030')
    // sill and flower box
    P(wx - 2, winY + winH + 1, winW + 4, 1, '#7a5738')
    P(wx - 1, winY + winH + 2, winW + 2, 2, '#a9764f')
    const bloom = ['#e88fa5', '#f2d06b', '#c98ae0'][b.id.charCodeAt(2) % 3]
    for (let i = 0; i < winW; i += 2) P(wx - 1 + i, winY + winH + 1, 1, 1, bloom)
  }

  // door
  const dW = Math.max(4, Math.round(AW * 0.2))
  const dX = mid - Math.floor(dW / 2)
  const dY = AH - Math.max(6, Math.round((AH - WALL_TOP) * 0.62))
  P(dX - 1, dY - 1, dW + 2, AH - dY + 1, '#4a3122')
  P(dX, dY, dW, AH - dY - 1, hovered ? '#f0c987' : '#8a5c3a')
  P(dX, dY, 1, AH - dY - 1, hovered ? '#f7dcaa' : '#a3714a')
  P(dX + 1, dY + 1, dW - 2, 2, hovered ? '#d9ab6d' : '#6f4830')
  P(dX + dW - 2, dY + Math.round((AH - dY) / 2), 1, 1, hovered ? '#4a3122' : '#f0c987')
  P(dX - 2, AH - 1, dW + 4, 1, '#b9a98c')

  // lamp over the door
  P(mid, WALL_TOP + 1, 1, 1, '#5e4030')
  P(mid - 1, WALL_TOP + 2, 3, 2, 'rgba(255,224,150,0.9)')
}

/**
 * Shop geometry, worked out once and used by both the pixel pass and the text
 * overlay. When these were computed separately the name drifted onto the roof
 * and the hanging sign text floated off the side of the building.
 */
function shopMetrics(b: Building) {
  const U = Math.max(2, Math.round(T / 9))
  const AW = Math.max(24, Math.round(b.box.w / U))
  const AH = Math.max(20, Math.round(b.box.h / U))
  const ROOF_ROWS = Math.max(4, Math.round(AH * 0.28))
  const CORNICE = ROOF_ROWS
  const x0 = Math.round(b.box.x)
  const y0 = Math.round(b.box.y)

  return {
    U,
    AW,
    AH,
    ROOF_ROWS,
    CORNICE,
    WALL_TOP: CORNICE + 4,
    x0,
    y0,
    /** Centre of the three row cornice board, where the painted name sits. */
    nameX: x0 + (AW / 2) * U,
    nameY: y0 + (CORNICE + 1.5) * U,
    /** Centre of the little hanging sign. */
    signX: x0 + (AW + 2.5) * U,
    signY: y0 + (CORNICE + 7.5) * U
  }
}

function drawShop(ctx: CanvasRenderingContext2D, b: Building, hovered: boolean, tick: number): void {
  const { x, y, w, h } = b.box
  const isSimffee = b.shopId === 'simffee'

  const m = shopMetrics(b)
  const { U, AW, AH, x0, y0 } = m

  const P = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    if (aw <= 0 || ah <= 0) return
    ctx.fillStyle = c
    ctx.fillRect(x0 + ax * U, y0 + ay * U, aw * U, ah * U)
  }

  const wall = isSimffee ? '#f2e3cd' : '#c9a98d'
  const wallLight = tint(wall, 0.28)
  const wallDark = tint(wall, -0.14)
  const wallEdge = tint(wall, -0.55)

  const roof = isSimffee ? '#c3773f' : '#5c4738'
  const roofLight = tint(roof, 0.22)
  const roofDark = tint(roof, -0.28)
  const roofEdge = tint(roof, -0.55)

  const trim = isSimffee ? '#b5653a' : '#4f6b52'
  const awnA = isSimffee ? '#c2694a' : '#4f6b52'
  const awnB = isSimffee ? '#f4e6d2' : '#dfd6c2'

  const { ROOF_ROWS, CORNICE, WALL_TOP } = m
  const mid = Math.floor(AW / 2)

  shadow(ctx, x + w / 2, y + h + 3, w * 0.5, T * 0.24)

  // shallow stepped roof plane
  for (let r = 0; r < ROOF_ROWS; r++) {
    const t = ROOF_ROWS === 1 ? 1 : r / (ROOF_ROWS - 1)
    const half = Math.round(AW * 0.34 + t * (AW * 0.18))
    const left = mid - half
    const span = half * 2
    P(left - 1, r, span + 2, 1, roofEdge)
    P(left, r, span, 1, roof)
    P(left, r, Math.max(1, Math.round(span * 0.35)), 1, roofLight)
    P(left + span - Math.max(1, Math.round(span * 0.18)), r, Math.max(1, Math.round(span * 0.18)), 1, roofDark)
    if (r % 3 === 2) P(left, r, span, 1, roofDark)
  }

  // bottom course of the roof, squared off to the width of the cornice below
  P(-2, ROOF_ROWS - 1, AW + 4, 1, roofEdge)
  P(-1, ROOF_ROWS - 1, AW + 2, 1, roofDark)

  // cornice board, where the painted name goes
  P(-1, CORNICE, AW + 2, 4, tint(trim, -0.5))
  P(0, CORNICE, AW, 3, trim)
  P(0, CORNICE, AW, 1, tint(trim, 0.22))

  // shopfront
  P(0, WALL_TOP, AW, AH - WALL_TOP, wallEdge)
  P(1, WALL_TOP, AW - 2, AH - WALL_TOP - 1, wall)
  P(1, WALL_TOP, 2, AH - WALL_TOP - 1, wallLight)
  P(AW - 4, WALL_TOP, 3, AH - WALL_TOP - 1, wallDark)

  if (!isSimffee) {
    // brick courses for the older shop
    for (let r = WALL_TOP + 1; r < AH - 1; r += 3) {
      P(1, r, AW - 2, 1, tint(wall, -0.1))
      for (let c = (r % 6 === 1 ? 2 : 4); c < AW - 2; c += 5) P(c, r - 1, 1, 1, tint(wall, -0.1))
    }
  }

  // striped awning across the whole front
  const AW_Y = WALL_TOP + 1
  const AW_H = 3
  P(-2, AW_Y - 1, AW + 4, AW_H + 2, tint(awnA, -0.55))
  for (let c = -1; c < AW + 1; c += 2) {
    P(c, AW_Y, 2, AW_H, Math.floor((c + 1) / 2) % 2 === 0 ? awnA : awnB)
  }
  // scalloped lower edge
  for (let c = -1; c < AW + 1; c += 2) {
    P(c, AW_Y + AW_H, 1, 1, Math.floor((c + 1) / 2) % 2 === 0 ? awnA : awnB)
  }
  P(-2, AW_Y - 1, AW + 4, 1, tint(awnA, 0.2))

  // big glass windows with warm light inside
  const gY = AW_Y + AW_H + 2
  const gW = Math.max(5, Math.round(AW * 0.26))
  const gH = Math.max(5, AH - gY - 3)
  for (const gx of [Math.round(AW * 0.07), AW - Math.round(AW * 0.07) - gW]) {
    P(gx - 1, gY - 1, gW + 2, gH + 2, tint(trim, -0.5))
    P(gx, gY, gW, gH, '#9fc6d4')
    P(gx, gY, Math.ceil(gW / 2), Math.ceil(gH * 0.45), '#d6ecf2')
    P(gx, gY + Math.round(gH * 0.55), gW, Math.round(gH * 0.45), '#f0d9a8')
    P(gx + Math.floor(gW / 2), gY, 1, gH, trim)
    P(gx - 1, gY + gH, gW + 2, 1, trim)
  }

  // door with a glazed top panel
  const dW = Math.max(5, Math.round(AW * 0.16))
  const dX = mid - Math.floor(dW / 2)
  const dY = gY
  P(dX - 2, dY - 1, dW + 4, AH - dY + 1, tint(trim, -0.5))
  P(dX - 1, dY, dW + 2, AH - dY - 1, trim)
  P(dX, dY + 1, dW, AH - dY - 3, hovered ? '#f7d99b' : '#8a5c3a')
  P(dX + 1, dY + 2, dW - 2, 3, '#bfe0ea')
  P(dX + dW - 2, dY + Math.round((AH - dY) / 2), 1, 1, hovered ? '#4a3122' : '#f0c987')
  P(dX - 3, AH - 1, dW + 6, 1, '#b9a98c')

  // open sign in the left window, gently pulsing
  const on = Math.sin(tick / 30) > -0.3
  P(Math.round(AW * 0.1), gY + 2, 3, 2, on ? '#ffd76b' : '#b99a52')

  // hanging sign on a bracket
  P(AW, CORNICE + 2, 3, 1, tint(trim, -0.3))
  P(AW + 2, CORNICE + 3, 1, 2, tint(trim, -0.3))
  P(AW - 1, CORNICE + 5, 7, 5, tint(trim, -0.5))
  P(AW, CORNICE + 6, 5, 3, '#f6efe2')
}

function drawGround(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < WORLD_H; y += T) {
    for (let x = 0; x < WORLD_W; x += T) {
      const i = (x / T + y / T * 3) % GRASS.length
      ctx.fillStyle = GRASS[Math.floor(i)]
      ctx.fillRect(x, y, T, T)
    }
  }

  // tufts of grass for texture
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  for (let y = 0; y < WORLD_H; y += T * 1.5) {
    for (let x = ((y / T) % 2) * T; x < WORLD_W; x += T * 3) {
      ctx.fillRect(x + 4, y + 6, 5, 2)
      ctx.fillRect(x + 11, y + 12, 4, 2)
    }
  }

  // pavement then road
  rect(ctx, 0, ROAD_TOP - T * 0.55, WORLD_W, T * 0.55, PAVEMENT)
  rect(ctx, 0, ROAD_BOTTOM, WORLD_W, T * 0.55, PAVEMENT)
  ctx.fillStyle = 'rgba(0,0,0,0.07)'
  for (let x = 0; x < WORLD_W; x += T) {
    ctx.fillRect(x, ROAD_TOP - T * 0.55, 1, T * 0.55)
    ctx.fillRect(x, ROAD_BOTTOM, 1, T * 0.55)
  }

  rect(ctx, 0, ROAD_TOP, WORLD_W, ROAD_BOTTOM - ROAD_TOP, ROAD_FILL)
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  for (let i = 0; i < 300; i++) {
    const x = (i * 97.3) % WORLD_W
    const y = ROAD_TOP + ((i * 53.7) % (ROAD_BOTTOM - ROAD_TOP))
    ctx.fillRect(x, y, 2, 2)
  }

  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  for (let x = T; x < WORLD_W; x += T * 2.4) {
    ctx.fillRect(x, (ROAD_TOP + ROAD_BOTTOM) / 2 - 2, T, 3)
  }

  // cobbled squares outside the cafes and in the middle of town
  for (const p of PLAZAS) {
    rect(ctx, p.x, p.y, p.w, p.h, '#d3c6ac')
    ctx.fillStyle = 'rgba(0,0,0,0.07)'
    for (let cy = p.y; cy < p.y + p.h; cy += T * 0.52) {
      const offset = ((cy - p.y) / (T * 0.52)) % 2 === 0 ? 0 : T * 0.26
      for (let cx = p.x + offset; cx < p.x + p.w; cx += T * 0.52) {
        ctx.fillRect(Math.round(cx), Math.round(cy), Math.round(T * 0.46), Math.round(T * 0.42))
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.w), 2)
  }

  // a stone path from every door to the pavement
  for (const b of BUILDINGS) {
    const px = b.door.x + b.door.w / 2
    const from = b.kind === 'home' ? b.box.y + b.box.h : b.box.y + b.box.h
    const to = b.kind === 'home' ? ROAD_TOP - T * 0.55 : ROAD_BOTTOM + T * 0.55
    const step = T * 0.5
    const dir = Math.sign(to - from)
    for (let y = from; dir > 0 ? y < to : y > to; y += step * dir) {
      ctx.fillStyle = 'rgba(70,55,40,0.14)'
      ctx.beginPath()
      ctx.ellipse(px, y + 2, T * 0.26, T * 0.13, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d7cbb2'
      ctx.beginPath()
      ctx.ellipse(px, y, T * 0.26, T * 0.13, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// -------------------------------------------------------------------- render

type Drawable =
  | { sort: number; kind: 'building'; b: Building }
  | { sort: number; kind: 'decor'; d: Decor }
  | { sort: number; kind: 'villager'; v: Villager }

export function render(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewW: number,
  viewH: number,
  hoveredDoorId: string | null,
  tick: number,
  dpr: number,
  villagers: Villager[]
): void {
  // One transform for everything. Device pixel ratio is folded in here so the
  // screen-to-world maths in Town.tsx stays a plain cam + offset / zoom.
  const k = cam.zoom * dpr

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, viewW * dpr, viewH * dpr)
  ctx.imageSmoothingEnabled = false

  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)

  drawGround(ctx)

  // Everything that stands up is sorted by its base line, so things in front
  // correctly overlap things behind.
  const items: Drawable[] = []

  for (const b of BUILDINGS) items.push({ sort: b.box.y + b.box.h, kind: 'building', b })
  for (const d of DECOR) items.push({ sort: d.y, kind: 'decor', d })

  for (const v of villagers) items.push({ sort: v.y, kind: 'villager', v })

  items.sort((a, b) => a.sort - b.sort)

  const px = T / 14

  for (const item of items) {
    if (item.kind === 'building') {
      const hovered = item.b.id === hoveredDoorId
      if (item.b.kind === 'shop') drawShop(ctx, item.b, hovered, tick)
      else drawHome(ctx, item.b, hovered, tick)
    } else if (item.kind === 'decor') {
      drawDecor(ctx, item.d, tick)
    } else {
      const v = item.v
      shadow(ctx, v.x, v.y, T * 0.28, T * 0.1)
      drawCustomer(
        ctx,
        v.x,
        v.y,
        px,
        v.facing,
        isWalking(v),
        v.anim,
        paletteForCustomer(v.index + 1, OUTLINE, '#f4efe6', '#d9cbb4'),
        false
      )

    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

export function clampCamera(cam: Camera, viewW: number, viewH: number): Camera {
  const visibleW = viewW / cam.zoom
  const visibleH = viewH / cam.zoom
  return {
    zoom: cam.zoom,
    x: Math.max(0, Math.min(Math.max(0, WORLD_W - visibleW), cam.x)),
    y: Math.max(0, Math.min(Math.max(0, WORLD_H - visibleH), cam.y))
  }
}

/**
 * UI drawn on the main canvas at full resolution, after the pixelated world has
 * been scaled up. Text stays crisp instead of turning to mush.
 */
export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  _viewW: number,
  _viewH: number,
  dpr: number,
  villagers: Villager[]
): void {
  const k = cam.zoom * dpr
  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const plate = (text: string, x: number, y: number, size: number, bg: string, fg: string): void => {
    ctx.font = `600 ${size}px 'Segoe UI', sans-serif`
    const tw = ctx.measureText(text).width + size * 0.8
    const th = size * 1.5
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.roundRect(x - tw / 2, y - th / 2, tw, th, th / 3)
    ctx.fill()
    ctx.fillStyle = fg
    ctx.fillText(text, x, y + 0.5)
  }

  for (const b of BUILDINGS) {
    if (b.kind === 'home') {
      plate(b.label, b.box.x + b.box.w / 2, b.box.y - T * 0.7, T * 0.42, 'rgba(58,42,32,0.86)', '#f6efe2')
    } else {
      const isSimffee = b.shopId === 'simffee'
      const trim = isSimffee ? '#b5653a' : '#4f6b52'
      const m = shopMetrics(b)

      // painted name, centred on the cornice board
      let size = Math.round(T * 0.46)
      ctx.font = `700 ${size}px 'Segoe UI', sans-serif`
      // shrink to fit rather than overflow the board
      while (size > 8 && ctx.measureText(b.label).width > b.box.w - T * 0.6) {
        size -= 1
        ctx.font = `700 ${size}px 'Segoe UI', sans-serif`
      }
      ctx.fillStyle = '#f6efe2'
      ctx.fillText(b.label, m.nameX, m.nameY)

      // hanging sign
      ctx.font = `600 ${Math.round(T * 0.3)}px 'Segoe UI', sans-serif`
      ctx.fillStyle = trim
      ctx.fillText(isSimffee ? 'coffee' : 'brew', m.signX, m.signY)
    }
  }

  for (const v of villagers) {
    if (v.chat) {
      ctx.font = `${Math.round(T * 0.36)}px 'Segoe UI', sans-serif`
      const bw = Math.min(T * 9, ctx.measureText(v.chat.text).width + T * 0.8)
      const bh = T * 0.84
      const bx = v.x - bw / 2
      const by = v.y - T * 3.6

      ctx.fillStyle = '#3a2a20'
      ctx.beginPath()
      ctx.roundRect(bx - 2, by - 2, bw + 4, bh + 4, 9)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(v.x - 8, by + bh)
      ctx.lineTo(v.x + 8, by + bh)
      ctx.lineTo(v.x, by + bh + 11)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#fdfaf3'
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, bh, 8)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(v.x - 6, by + bh - 1)
      ctx.lineTo(v.x + 6, by + bh - 1)
      ctx.lineTo(v.x, by + bh + 8)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#3a2a20'
      ctx.fillText(v.chat.text, v.x, by + bh / 2)
    }

    plate(v.name, v.x, v.y - T * 2.3, T * 0.34, 'rgba(58,42,32,0.75)', '#f6efe2')
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}