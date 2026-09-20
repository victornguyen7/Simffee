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
import { critterMoving, type Car, type Critter } from './critters'
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

// ------------------------------------------------------------------ scenery
//
// Everything below is plotted on the same art pixel grid the buildings use, so
// a leaf, a roof tile and a car door are all exactly the same size on screen.
// That shared grid is what makes a scene read as pixel art. Mixing smooth
// curves in with it is what made the old trees look pasted on.

/** World pixels per art pixel. Matches drawHome and drawShop on purpose. */
const AU = Math.max(2, Math.round(T / 9))

type Pen = (ax: number, ay: number, aw: number, ah: number, c: string) => void

/**
 * Returns a plotter anchored at a world point, with ay measured upward from the
 * ground line. Snapping the anchor to the grid keeps every sprite aligned.
 */
function plot(ctx: CanvasRenderingContext2D, cx: number, baseY: number): Pen {
  const ox = Math.round(cx / AU) * AU
  const oy = Math.round(baseY / AU) * AU
  return (ax, ay, aw, ah, c) => {
    if (aw <= 0 || ah <= 0) return
    ctx.fillStyle = c
    ctx.fillRect(ox + ax * AU, oy + ay * AU, aw * AU, ah * AU)
  }
}

/** Same, but mirrored when facing left, so one drawing serves both directions. */
function flipPen(P: Pen, facing: number): Pen {
  if (facing >= 0) return P
  return (ax, ay, aw, ah, c) => P(-ax - aw, ay, aw, ah, c)
}

/**
 * Stacks rows of given half widths into a rounded mass with an outline, a lit
 * upper left and a shaded lower right. Foliage, rocks and fleece are all this.
 */
function blob(P: Pen, halves: number[], top: number, fill: string, light: string, dark: string, edge: string): void {
  const n = halves.length
  P(-halves[0], top - 1, halves[0] * 2, 1, edge)
  P(-halves[n - 1], top + n, halves[n - 1] * 2, 1, edge)
  for (let i = 0; i < n; i++) {
    const h = halves[i]
    P(-h - 1, top + i, h * 2 + 2, 1, edge)
    P(-h, top + i, h * 2, 1, fill)
  }
  for (let i = 0; i < n; i++) {
    const h = halves[i]
    if (i < n * 0.45) P(-h + 1, top + i, Math.max(1, Math.round(h * 0.85)), 1, light)
    if (i > n * 0.62) P(0, top + i, Math.max(1, h - 1), 1, dark)
  }
}

const TREE_SHAPE = [3, 5, 7, 8, 9, 9, 9, 8, 6, 4]
const TREE_GREENS = [
  ['#4f7a3f', '#6f9f54', '#3a5c2e'],
  ['#57813f', '#79a95c', '#405f2f'],
  ['#4a7342', '#699a57', '#365733']
]

function drawTree(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const scale = 1 + (d.variant % 3) * 0.16
  const halves = TREE_SHAPE.map((h) => Math.max(1, Math.round(h * scale)))
  const g = TREE_GREENS[d.variant % 3]
  const trunkH = 5

  shadow(ctx, d.x, d.y, AU * halves[halves.length - 1] * 1.1, AU * 1.7)

  P(-2, -trunkH, 4, trunkH, '#3a2718')
  P(-1, -trunkH, 2, trunkH, '#6b4a33')
  P(-1, -trunkH, 1, trunkH, '#8b6546')

  blob(P, halves, -trunkH - halves.length + 1, g[0], g[1], g[2], '#25401e')
}

/** Pines are drawn as stacked tiers, each starting narrow so the steps show. */
const PINE_SHAPE = [1, 2, 3, 2, 3, 4, 5, 3, 4, 5, 6, 7]

function drawPine(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const scale = 1 + (d.variant % 3) * 0.14
  const halves = PINE_SHAPE.map((h) => Math.max(1, Math.round(h * scale)))
  const trunkH = 4
  const fill = '#39663a'
  const light = '#4f8748'
  const dark = '#264a2a'
  const edge = '#1b3520'

  shadow(ctx, d.x, d.y, AU * halves[halves.length - 1] * 1.1, AU * 1.6)

  P(-2, -trunkH, 4, trunkH, '#3a2718')
  P(-1, -trunkH, 2, trunkH, '#6b4a33')

  const top = -trunkH - halves.length + 1
  for (let i = 0; i < halves.length; i++) {
    const h = halves[i]
    const y = top + i
    P(-h - 1, y, h * 2 + 2, 1, edge)
    P(-h, y, h * 2, 1, fill)
    P(-h + 1, y, Math.max(1, Math.round(h * 0.7)), 1, light)
    // a tier restarts wherever the row narrows, so shade the row above it
    if (i > 0 && h < halves[i - 1]) P(-halves[i - 1], y - 1, halves[i - 1] * 2, 1, dark)
  }
  P(-1, top - 1, 2, 1, edge)
}

function drawBush(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const scale = 1 + (d.variant % 3) * 0.2
  const halves = [2, 4, 5, 5, 4].map((h) => Math.max(1, Math.round(h * scale)))
  shadow(ctx, d.x, d.y, AU * halves[2] * 1.1, AU * 1.2)
  blob(P, halves, -halves.length, '#4d7a42', '#699a55', '#375c31', '#22401f')
  if (d.variant % 2 === 0) {
    P(-2, -4, 1, 1, '#e4737f')
    P(2, -3, 1, 1, '#e4737f')
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const bloom = ['#e88fa5', '#f2d06b', '#c98ae0', '#f0f0f0'][d.variant % 4]
  const spots = [
    [-3, 0],
    [0, -1],
    [3, 0],
    [1, 1]
  ]
  for (const [sx, sy] of spots) {
    P(sx, sy - 3, 1, 3, '#4d7a42')
    P(sx - 1, sy - 4, 3, 1, bloom)
    P(sx, sy - 5, 1, 1, bloom)
    P(sx, sy - 4, 1, 1, '#fff3c4')
  }
}

function drawRock(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const scale = 1 + (d.variant % 3) * 0.25
  const halves = [2, 4, 5, 4].map((h) => Math.max(1, Math.round(h * scale)))
  shadow(ctx, d.x, d.y, AU * halves[2] * 1.1, AU * 1.1)
  blob(P, halves, -halves.length, '#9d9a92', '#bcb9b0', '#6f6d67', '#46443f')
}

function drawStump(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 4, AU * 1.1)
  P(-4, -4, 8, 4, '#3f2a1c')
  P(-3, -4, 6, 3, '#6b4a33')
  P(-3, -4, 2, 3, '#835c40')
  P(-4, -5, 8, 1, '#3f2a1c')
  P(-3, -5, 6, 1, '#a07a56')
  P(-1, -5, 2, 1, '#c09a72')
}

function drawLog(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 8, AU * 1.2)
  P(-8, -4, 16, 4, '#3f2a1c')
  P(-7, -4, 14, 3, '#6b4a33')
  P(-7, -4, 14, 1, '#8b6546')
  P(-7, -3, 2, 2, '#a07a56')
  P(5, -3, 2, 2, '#a07a56')
}

function drawHaystack(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const halves = [2, 4, 6, 7, 7]
  shadow(ctx, d.x, d.y, AU * 8, AU * 1.5)
  blob(P, halves, -halves.length, '#d9b45c', '#efd085', '#b08d3e', '#7a5f28')
  for (let i = -5; i < 6; i += 3) P(i, -3, 1, 3, '#b08d3e')
}

function drawLamp(ctx: CanvasRenderingContext2D, d: Decor, tick: number): void {
  const P = plot(ctx, d.x, d.y)
  const glow = 0.72 + Math.sin(tick / 34 + d.x) * 0.1

  shadow(ctx, d.x, d.y, AU * 2.4, AU * 0.9)
  P(-2, -1, 4, 1, '#3b3129')
  P(-1, -14, 2, 14, '#3b3129')
  P(-1, -14, 1, 14, '#57493c')

  P(-3, -19, 6, 5, '#3b3129')
  P(-2, -18, 4, 3, `rgba(255,226,150,${glow.toFixed(2)})`)
  P(-2, -18, 2, 1, 'rgba(255,245,210,0.95)')
  P(-2, -20, 4, 1, '#3b3129')
  P(-1, -21, 2, 1, '#3b3129')

  ctx.fillStyle = `rgba(255,222,140,${(glow * 0.16).toFixed(2)})`
  ctx.fillRect(Math.round(d.x - AU * 7), Math.round(d.y - AU * 23), AU * 14, AU * 12)
}

function drawLantern(ctx: CanvasRenderingContext2D, d: Decor, tick: number): void {
  const P = plot(ctx, d.x, d.y)
  const glow = 0.6 + Math.sin(tick / 26 + d.x * 0.4) * 0.16
  P(-1, -8, 2, 8, '#4a3a2c')
  P(-2, -12, 4, 4, '#3b3129')
  P(-1, -11, 2, 2, `rgba(255,214,130,${glow.toFixed(2)})`)
  P(-2, -13, 4, 1, '#3b3129')
}

function drawBench(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 6, AU * 1.1)
  P(-6, -3, 2, 3, '#4a3527')
  P(4, -3, 2, 3, '#4a3527')
  P(-7, -5, 14, 2, '#5e4230')
  P(-7, -5, 14, 1, '#8a6a47')
  P(-7, -8, 14, 2, '#5e4230')
  P(-7, -8, 14, 1, '#8a6a47')
  P(-7, -9, 1, 4, '#4a3527')
  P(6, -9, 1, 4, '#4a3527')
}

function drawPlanter(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 4, AU * 1)
  P(-4, -5, 8, 5, '#5e4230')
  P(-3, -5, 6, 4, '#8a6a47')
  P(-3, -5, 6, 1, '#a58558')
  P(-3, -7, 6, 2, '#4d7a42')
  P(-3, -7, 3, 1, '#699a55')
  const bloom = ['#e88fa5', '#f2d06b', '#c98ae0', '#f6f2e6'][d.variant % 4]
  P(-3, -8, 1, 1, bloom)
  P(0, -8, 1, 1, bloom)
  P(2, -8, 1, 1, bloom)
}

function drawCrate(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 4, AU * 1)
  P(-4, -8, 8, 8, '#4a3527')
  P(-3, -8, 6, 7, '#a5794c')
  P(-3, -8, 6, 1, '#c29767')
  P(-3, -8, 1, 7, '#c29767')
  P(-3, -5, 6, 1, '#7d5a38')
  P(-1, -8, 1, 7, '#7d5a38')
}

function drawBarrel(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 3.4, AU * 1)
  P(-4, -9, 8, 9, '#4a3527')
  P(-3, -9, 6, 8, '#9a6b42')
  P(-3, -9, 2, 8, '#bb8a5c')
  P(2, -9, 1, 8, '#7a5233')
  P(-3, -7, 6, 1, '#5d4a33')
  P(-3, -3, 6, 1, '#5d4a33')
  P(-3, -10, 6, 1, '#7a5233')
}

function drawFence(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const span = 10 + d.variant * 3
  P(-span, -5, span * 2, 1, '#c9b492')
  P(-span, -8, span * 2, 1, '#c9b492')
  P(-span, -5, span * 2, 1, '#8a7355')
  for (let i = -span; i <= span; i += 4) {
    P(i, -11, 2, 11, '#8a7355')
    P(i, -11, 1, 11, '#ddcaa6')
    P(i, -12, 2, 1, '#ddcaa6')
  }
}

function drawMailbox(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 2, AU * 0.8)
  P(-1, -8, 2, 8, '#5e4230')
  P(-4, -13, 8, 5, '#3f4f5e')
  P(-3, -12, 6, 3, '#7a94a8')
  P(-3, -12, 6, 1, '#9db4c4')
  P(4, -12, 1, 3, '#c85a4a')
}

function drawBistro(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 6, AU * 1.2)
  // two chairs
  for (const cx of [-7, 5]) {
    P(cx, -6, 3, 6, '#5e4230')
    P(cx, -9, 3, 3, '#7a5a3d')
    P(cx, -9, 1, 3, '#9a7a53')
  }
  // pedestal table
  P(-1, -7, 2, 7, '#8a7355')
  P(-5, -9, 10, 2, '#4a3527')
  P(-5, -10, 10, 1, '#f2e8d5')
  P(-5, -10, 5, 1, '#fffaf0')
  if (d.variant % 2 === 0) {
    P(1, -12, 2, 2, '#f6f2e6')
    P(1, -11, 2, 1, '#8a5a34')
  }
}

function drawWell(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 8, AU * 2)
  // stone ring
  P(-8, -8, 16, 8, '#5c5850')
  P(-7, -8, 14, 7, '#9d9a92')
  P(-7, -8, 14, 1, '#bcb9b0')
  for (let i = -7; i < 7; i += 3) P(i, -6, 1, 6, '#7d7a73')
  P(-6, -9, 12, 1, '#6f6d67')
  P(-5, -10, 10, 1, '#2b3640')
  // posts and roof
  P(-6, -22, 2, 13, '#5e4230')
  P(4, -22, 2, 13, '#5e4230')
  for (let r = 0; r < 5; r++) {
    const half = 3 + r * 2
    P(-half, -27 + r, half * 2, 1, '#6d4232')
    P(-half, -27 + r, Math.max(1, half), 1, '#8a5a40')
  }
  P(-1, -28, 2, 1, '#4a2f22')
  // bucket
  P(-2, -14, 4, 4, '#4a3527')
  P(-1, -14, 2, 3, '#9a6b42')
}

function drawSignpost(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 3, AU * 1)
  P(-1, -16, 2, 16, '#5e4230')
  P(-1, -16, 1, 16, '#8a6a47')
  const dir = d.variant % 2 === 0 ? 1 : -1
  for (const [ay, col] of [
    [-15, '#b5653a'],
    [-11, '#4f6b52']
  ] as [number, string][]) {
    const x = dir === 1 ? 0 : -9
    P(x, ay, 9, 3, '#4a3527')
    P(x + (dir === 1 ? 0 : 1), ay, 8, 2, col)
    P(x + (dir === 1 ? 0 : 1), ay, 8, 1, tint(col, 0.22))
  }
}

function drawCart(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  shadow(ctx, d.x, d.y, AU * 8, AU * 1.4)
  // wheels
  for (const wx of [-6, 3]) {
    P(wx, -5, 4, 4, '#3a2718')
    P(wx + 1, -4, 2, 2, '#8a6a47')
  }
  // bed
  P(-9, -9, 18, 4, '#4a3527')
  P(-8, -9, 16, 3, '#9a6b42')
  P(-8, -9, 16, 1, '#bb8a5c')
  // produce
  P(-6, -12, 4, 3, '#c85a4a')
  P(-1, -11, 3, 2, '#e0a83e')
  P(3, -12, 3, 3, '#5f8c46')
  // handle
  P(8, -13, 2, 5, '#5e4230')
}

/** A market stall, the thing that most makes the street feel like a village. */
function drawStall(ctx: CanvasRenderingContext2D, d: Decor): void {
  const P = plot(ctx, d.x, d.y)
  const stripe = ['#c2694a', '#4f6b52', '#3f6a8c', '#a5643f'][d.variant % 4]

  shadow(ctx, d.x, d.y, AU * 10, AU * 1.6)

  // posts
  P(-10, -20, 2, 20, '#5e4230')
  P(8, -20, 2, 20, '#5e4230')
  P(-10, -20, 1, 20, '#8a6a47')
  P(8, -20, 1, 20, '#8a6a47')

  // counter
  P(-11, -10, 22, 4, '#4a3527')
  P(-10, -10, 20, 3, '#a5794c')
  P(-10, -10, 20, 1, '#c29767')

  // goods on the counter
  P(-8, -13, 3, 3, '#c85a4a')
  P(-4, -12, 3, 2, '#e0a83e')
  P(0, -13, 3, 3, '#5f8c46')
  P(4, -12, 4, 2, '#8a5a34')

  // striped canopy, scalloped along the bottom like the cafe awnings
  P(-12, -24, 24, 4, '#4a3527')
  for (let i = -12; i < 12; i += 2) {
    P(i, -24, 1, 3, stripe)
    P(i + 1, -24, 1, 3, '#f4e6d2')
  }
  P(-12, -24, 24, 1, 'rgba(255,255,255,0.28)')
  for (let i = -12; i < 12; i += 2) P(i, -21, 1, 1, stripe)
  P(-12, -25, 24, 1, '#4a3527')
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
    case 'well':
      return drawWell(ctx, d)
    case 'signpost':
      return drawSignpost(ctx, d)
    case 'haystack':
      return drawHaystack(ctx, d)
    case 'stall':
      return drawStall(ctx, d)
    case 'stump':
      return drawStump(ctx, d)
    case 'log':
      return drawLog(ctx, d)
    case 'cart':
      return drawCart(ctx, d)
    case 'lantern':
      return drawLantern(ctx, d, tick)
  }
}

// ------------------------------------------------------------------- animals

function drawCritter(ctx: CanvasRenderingContext2D, c: Critter): void {
  const moving = critterMoving(c)
  // a one pixel bob while walking, which is all a small sprite needs
  const bob = moving && Math.floor(c.anim / 9) % 2 === 0 ? -1 : 0
  const P = flipPen(plot(ctx, c.x, c.y + bob * AU), c.facing)
  const legDown = moving && Math.floor(c.anim / 9) % 2 === 0

  switch (c.kind) {
    case 'chicken': {
      shadow(ctx, c.x, c.y, AU * 2.6, AU * 0.8)
      P(-1, -1, 1, 1, '#d8992f')
      P(1, -1, 1, 1, legDown ? '#d8992f' : '#b87f26')
      P(-3, -6, 6, 5, '#d8d2c6')
      P(-2, -6, 5, 4, '#f6f2e6')
      P(-2, -6, 3, 2, '#fffdf7')
      P(1, -4, 2, 3, '#d8d2c6')
      P(2, -9, 3, 3, '#f6f2e6')
      P(3, -9, 2, 2, '#fffdf7')
      P(3, -10, 2, 1, '#c85a4a')
      P(5, -8, 1, 1, '#d8992f')
      P(3, -8, 1, 1, '#3a2718')
      P(-4, -8, 2, 3, '#d8d2c6')
      break
    }
    case 'duck': {
      shadow(ctx, c.x, c.y, AU * 2.6, AU * 0.8)
      P(-1, -1, 1, 1, '#e0a83e')
      P(1, -1, 1, 1, legDown ? '#e0a83e' : '#c08f2c')
      P(-3, -6, 6, 5, '#efe6cf')
      P(-2, -6, 5, 4, '#fbf6e8')
      P(-4, -7, 2, 3, '#e6dcc2')
      P(2, -9, 3, 3, '#5f8c46')
      P(3, -9, 2, 2, '#77a659')
      P(5, -8, 2, 1, '#e0a83e')
      P(3, -8, 1, 1, '#3a2718')
      break
    }
    case 'cat': {
      const coat = ['#d98b48', '#4a4540', '#e8e2d6'][c.variant % 3]
      shadow(ctx, c.x, c.y, AU * 3, AU * 0.8)
      P(-3, -1, 1, 1, tint(coat, -0.4))
      P(0, -1, 1, 1, legDown ? tint(coat, -0.4) : tint(coat, -0.2))
      P(-4, -5, 8, 4, coat)
      P(-4, -5, 8, 1, tint(coat, 0.22))
      P(-4, -2, 8, 1, tint(coat, -0.25))
      P(3, -9, 4, 4, coat)
      P(3, -9, 3, 2, tint(coat, 0.22))
      P(3, -10, 1, 1, tint(coat, -0.3))
      P(5, -10, 1, 1, tint(coat, -0.3))
      P(5, -8, 1, 1, '#2f3a2c')
      P(-6, -9, 2, 5, coat)
      P(-6, -10, 2, 1, tint(coat, 0.2))
      break
    }
    case 'dog': {
      const coat = ['#a5794c', '#6b4a33', '#d8c8a8'][c.variant % 3]
      shadow(ctx, c.x, c.y, AU * 3.4, AU * 0.9)
      P(-4, -2, 2, 2, tint(coat, -0.35))
      P(1, -2, 2, 2, legDown ? tint(coat, -0.35) : tint(coat, -0.15))
      P(-5, -7, 10, 5, coat)
      P(-5, -7, 10, 1, tint(coat, 0.22))
      P(-5, -3, 10, 1, tint(coat, -0.28))
      P(4, -11, 4, 4, coat)
      P(4, -11, 3, 2, tint(coat, 0.2))
      P(8, -9, 1, 1, '#2f2620')
      P(6, -10, 1, 1, '#2f2620')
      P(3, -12, 2, 2, tint(coat, -0.3))
      P(-7, -10, 2, 4, coat)
      break
    }
    case 'sheep': {
      shadow(ctx, c.x, c.y, AU * 4, AU * 1)
      P(-4, -2, 2, 2, '#4a4540')
      P(1, -2, 2, 2, legDown ? '#4a4540' : '#5f5a53')
      blob(P, [3, 5, 6, 5], -8, '#f2ece0', '#fffdf7', '#cfc7b6', '#9a9184')
      P(4, -10, 4, 4, '#4a4540')
      P(4, -10, 3, 2, '#5f5a53')
      P(7, -9, 1, 1, '#f2ece0')
      break
    }
    case 'cow': {
      shadow(ctx, c.x, c.y, AU * 5.5, AU * 1.2)
      P(-6, -3, 2, 3, '#4a4540')
      P(2, -3, 2, 3, legDown ? '#4a4540' : '#5f5a53')
      P(-8, -11, 16, 8, '#efe9dd')
      P(-8, -11, 16, 1, '#fffdf7')
      P(-8, -4, 16, 1, '#c9c2b4')
      P(-6, -10, 4, 3, '#3f3a35')
      P(0, -8, 5, 3, '#3f3a35')
      P(7, -14, 5, 5, '#efe9dd')
      P(7, -14, 4, 2, '#fffdf7')
      P(10, -12, 2, 2, '#d8a0a8')
      P(9, -11, 1, 1, '#3a2718')
      P(7, -15, 1, 1, '#c9c2b4')
      P(11, -15, 1, 1, '#c9c2b4')
      P(-10, -13, 2, 6, '#efe9dd')
      break
    }
  }
}

// ------------------------------------------------------------------- traffic

function drawCar(ctx: CanvasRenderingContext2D, c: Car, tick: number): void {
  const P = flipPen(plot(ctx, c.x, c.y), c.dir)
  const body = ['#c4584a', '#4a7fb0', '#e0b24e', '#6b8f5a', '#b6bac2', '#8a6ab0'][c.variant % 6]
  const light = tint(body, 0.26)
  const dark = tint(body, -0.26)
  const edge = tint(body, -0.6)
  const glass = '#bcd8e4'
  const rolling = c.wait <= 0
  const spin = rolling && Math.floor(tick / 5) % 2 === 0

  const wheel = (wx: number, size = 3): void => {
    P(wx, -size, size, size, '#22201f')
    P(wx + (spin ? 1 : 0), -size + 1, 1, 1, '#7a746c')
  }

  switch (c.kind) {
    case 'car': {
      shadow(ctx, c.x, c.y, AU * 9, AU * 1.4)
      wheel(-6)
      wheel(3)
      P(-9, -7, 18, 4, edge)
      P(-8, -7, 16, 3, body)
      P(-8, -7, 16, 1, light)
      P(-8, -5, 16, 1, dark)
      P(-5, -11, 10, 4, edge)
      P(-4, -11, 8, 3, body)
      P(-4, -10, 3, 2, glass)
      P(1, -10, 3, 2, glass)
      P(8, -6, 1, 1, '#ffe9a8')
      P(-9, -6, 1, 1, '#d8604a')
      break
    }
    case 'van': {
      shadow(ctx, c.x, c.y, AU * 10, AU * 1.5)
      wheel(-7)
      wheel(4)
      P(-10, -13, 20, 10, edge)
      P(-9, -13, 18, 9, body)
      P(-9, -13, 18, 1, light)
      P(-9, -5, 18, 1, dark)
      P(2, -12, 6, 4, glass)
      P(-8, -12, 9, 5, '#f6f2e6')
      P(-7, -11, 7, 3, tint(body, -0.1))
      P(9, -7, 1, 1, '#ffe9a8')
      P(-10, -7, 1, 1, '#d8604a')
      break
    }
    case 'truck': {
      shadow(ctx, c.x, c.y, AU * 12, AU * 1.6)
      wheel(-10, 4)
      wheel(-3, 4)
      wheel(6, 4)
      P(-13, -14, 12, 10, '#4a3527')
      P(-12, -14, 10, 9, '#a5794c')
      P(-12, -14, 10, 1, '#c29767')
      for (let i = -12; i < -2; i += 3) P(i, -12, 1, 7, '#7d5a38')
      P(-1, -12, 13, 8, edge)
      P(0, -12, 11, 7, body)
      P(0, -12, 11, 1, light)
      P(5, -11, 6, 3, glass)
      P(11, -6, 1, 1, '#ffe9a8')
      break
    }
    case 'bike': {
      shadow(ctx, c.x, c.y, AU * 5, AU * 1)
      wheel(-5)
      wheel(2)
      P(-4, -6, 7, 2, edge)
      P(-4, -6, 7, 1, body)
      P(3, -9, 2, 4, edge)
      P(-2, -12, 4, 6, '#4a5f7a')
      P(-2, -12, 4, 1, '#66809e')
      P(-1, -16, 3, 4, '#e8c49a')
      P(-1, -17, 3, 2, '#3a2f28')
      break
    }
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
  | { sort: number; kind: 'critter'; c: Critter }
  | { sort: number; kind: 'car'; car: Car }

export function render(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewW: number,
  viewH: number,
  hoveredDoorId: string | null,
  tick: number,
  dpr: number,
  villagers: Villager[],
  critters: Critter[] = [],
  cars: Car[] = []
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
  for (const c of critters) items.push({ sort: c.y, kind: 'critter', c })
  for (const car of cars) items.push({ sort: car.y, kind: 'car', car })

  items.sort((a, b) => a.sort - b.sort)

  const px = T / 14

  for (const item of items) {
    if (item.kind === 'building') {
      const hovered = item.b.id === hoveredDoorId
      if (item.b.kind === 'shop') drawShop(ctx, item.b, hovered, tick)
      else drawHome(ctx, item.b, hovered, tick)
    } else if (item.kind === 'decor') {
      drawDecor(ctx, item.d, tick)
    } else if (item.kind === 'critter') {
      drawCritter(ctx, item.c)
    } else if (item.kind === 'car') {
      drawCar(ctx, item.car, tick)
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