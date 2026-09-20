import { TILE_H, TILE_W, type Ground, type Prop } from './model'

const GROUND_COLORS: Record<Ground, [string, string, string]> = {
  grass: ['#7cc36a', '#5da94f', '#4a8c3f'],
  path: ['#d8bd8d', '#c2a473', '#a3885c'],
  plaza: ['#cfc6ba', '#b4a99c', '#968b7e'],
  water: ['#5fb7e6', '#3f9ed4', '#2f7fae'],
  sand: ['#e8d8a8', '#d4c28d', '#b3a273'],
  dirt: ['#c9a373', '#a88657', '#8b6e47'],
}

export function drawGround(ctx: CanvasRenderingContext2D, x: number, y: number, kind: Ground, t: number) {
  const [top, side, dark] = GROUND_COLORS[kind]
  const h = kind === 'water' ? 3 + Math.sin(t / 420 + x + y) * 1.5 : 0

  ctx.beginPath()
  ctx.moveTo(0, -TILE_H / 2 + h)
  ctx.lineTo(TILE_W / 2, h)
  ctx.lineTo(0, TILE_H / 2 + h)
  ctx.lineTo(-TILE_W / 2, h)
  ctx.closePath()
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'
  ctx.stroke()

  // soil skirt so the town reads as a floating block
  const depth = 10
  ctx.beginPath()
  ctx.moveTo(-TILE_W / 2, h)
  ctx.lineTo(0, TILE_H / 2 + h)
  ctx.lineTo(0, TILE_H / 2 + depth)
  ctx.lineTo(-TILE_W / 2, depth)
  ctx.closePath()
  ctx.fillStyle = side
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(TILE_W / 2, h)
  ctx.lineTo(0, TILE_H / 2 + h)
  ctx.lineTo(0, TILE_H / 2 + depth)
  ctx.lineTo(TILE_W / 2, depth)
  ctx.closePath()
  ctx.fillStyle = dark
  ctx.fill()
}

function box(
  ctx: CanvasRenderingContext2D,
  w: number,
  d: number,
  h: number,
  top: string,
  left: string,
  right: string,
) {
  const hw = (w * TILE_W) / 2
  const hd = (d * TILE_H) / 2

  ctx.beginPath()
  ctx.moveTo(0, -h - hd * 2)
  ctx.lineTo(hw, -h - hd)
  ctx.lineTo(0, -h)
  ctx.lineTo(-hw, -h - hd)
  ctx.closePath()
  ctx.fillStyle = top
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(-hw, -h - hd)
  ctx.lineTo(0, -h)
  ctx.lineTo(0, 0)
  ctx.lineTo(-hw, -hd)
  ctx.closePath()
  ctx.fillStyle = left
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(hw, -h - hd)
  ctx.lineTo(0, -h)
  ctx.lineTo(0, 0)
  ctx.lineTo(hw, -hd)
  ctx.closePath()
  ctx.fillStyle = right
  ctx.fill()
}

function shadow(ctx: CanvasRenderingContext2D, rx = 22, ry = 11) {
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.13)'
  ctx.fill()
}

function tree(ctx: CanvasRenderingContext2D, crown: string, crownDark: string) {
  shadow(ctx, 16, 8)
  ctx.fillStyle = '#8a6240'
  ctx.fillRect(-3, -26, 6, 26)
  ctx.beginPath()
  ctx.ellipse(0, -36, 18, 20, 0, 0, Math.PI * 2)
  ctx.fillStyle = crown
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(6, -30, 11, 12, 0, 0, Math.PI * 2)
  ctx.fillStyle = crownDark
  ctx.fill()
}

function house(ctx: CanvasRenderingContext2D, wall: string, roof: string, roofDark: string) {
  shadow(ctx)
  box(ctx, 0.78, 0.78, 26, wall, shade(wall, -0.18), shade(wall, -0.34))
  ctx.save()
  ctx.translate(0, -26)
  box(ctx, 0.86, 0.86, 16, roof, shade(roof, -0.16), roofDark)
  ctx.restore()
  ctx.fillStyle = '#f3e4c8'
  ctx.fillRect(-15, -24, 8, 9)
  ctx.fillStyle = '#7a5334'
  ctx.fillRect(4, -22, 9, 17)
}

function shopBuilding(
  ctx: CanvasRenderingContext2D,
  wall: string,
  roof: string,
  sign: string,
  label: string,
) {
  shadow(ctx, 26, 13)
  box(ctx, 0.92, 0.92, 34, wall, shade(wall, -0.18), shade(wall, -0.34))
  ctx.save()
  ctx.translate(0, -34)
  box(ctx, 1.0, 1.0, 12, roof, shade(roof, -0.16), shade(roof, -0.3))
  ctx.restore()
  // awning + windows
  ctx.fillStyle = '#f6efe2'
  ctx.fillRect(-24, -30, 15, 13)
  ctx.fillStyle = shade(wall, -0.45)
  ctx.fillRect(8, -28, 13, 22)
  ctx.fillStyle = sign
  ctx.fillRect(-20, -52, 40, 12)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(label, 0, -43)
}

export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = clamp(((n >> 16) & 255) * (1 + amount))
  const g = clamp(((n >> 8) & 255) * (1 + amount))
  const b = clamp((n & 255) * (1 + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function fence(ctx: CanvasRenderingContext2D, gate: boolean) {
  shadow(ctx, 15, 6)
  ctx.fillStyle = gate ? '#c89858' : '#8a5b32'
  ctx.fillRect(-20, -17, 4, 17)
  ctx.fillRect(16, -17, 4, 17)
  ctx.fillRect(-19, -14, 38, 4)
  if (gate) {
    ctx.strokeStyle = '#f0d08d'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-17, -13)
    ctx.lineTo(17, -1)
    ctx.stroke()
  }
}

function animal(ctx: CanvasRenderingContext2D, kind: 'sheep' | 'cow' | 'chicken' | 'duck', t: number, seed: number) {
  const bob = Math.sin(t / 600 + seed) * 1
  shadow(ctx, kind === 'cow' ? 12 : 9, 5)
  ctx.save()
  ctx.translate(0, -bob)
  if (kind === 'sheep') {
    ctx.fillStyle = '#f6f0dc'
    ctx.beginPath()
    ctx.ellipse(-1, -10, 14, 9, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#51565a'
    ctx.beginPath()
    ctx.ellipse(12, -11, 5, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#5b4635'
    for (const x of [-8, -1, 7, 12]) ctx.fillRect(x, -5, 2, 6)
  } else if (kind === 'cow') {
    ctx.fillStyle = '#f4f0df'
    ctx.beginPath()
    ctx.ellipse(0, -11, 18, 11, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#453b39'
    for (const [x, y, rx, ry] of [[-9, -13, 4, 3], [2, -17, 5, 3], [8, -7, 3, 3]] as const) {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#f1a3a0'
    ctx.beginPath()
    ctx.ellipse(18, -10, 5, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#5b4635'
    for (const x of [-12, -4, 5, 13]) ctx.fillRect(x, -4, 2, 6)
  } else {
    const duck = kind === 'duck'
    ctx.fillStyle = duck ? '#b4c94e' : '#f5f1df'
    ctx.beginPath()
    ctx.ellipse(0, -8, duck ? 9 : 8, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    if (!duck) {
      ctx.fillStyle = '#d84d45'
      ctx.beginPath()
      ctx.arc(-2, -16, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#f18e32'
    ctx.beginPath()
    ctx.moveTo(7, -10)
    ctx.lineTo(14, -8)
    ctx.lineTo(7, -6)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#d8752c'
    ctx.fillRect(-4, -3, 2, 4)
    ctx.fillRect(4, -3, 2, 4)
  }
  ctx.restore()
}

function trough(ctx: CanvasRenderingContext2D) {
  shadow(ctx, 12, 6)
  box(ctx, 0.5, 0.4, 5, '#9b6a3c', '#754b2b', '#5f3c23')
  ctx.fillStyle = '#5fb7e6'
  ctx.beginPath()
  ctx.ellipse(0, -9, 13, 5, 0, 0, Math.PI * 2)
  ctx.fill()
}

function coop(ctx: CanvasRenderingContext2D) {
  shadow(ctx, 13, 7)
  box(ctx, 0.6, 0.55, 10, '#d7b886', '#a3774b', '#825b37')
  ctx.save()
  ctx.translate(0, -10)
  box(ctx, 0.72, 0.65, 8, '#c74f43', '#9d3935', '#7d2f30')
  ctx.restore()
  ctx.fillStyle = '#efd4a0'
  ctx.fillRect(-5, -10, 10, 6)
}

export function drawPet(ctx: CanvasRenderingContext2D, kind: 'cat' | 'dog', t: number) {
  const wobble = Math.sin(t / 150) * 1.5
  shadow(ctx, 6, 3)
  ctx.save()
  ctx.translate(0, -Math.abs(wobble))
  ctx.fillStyle = kind === 'cat' ? '#df8c43' : '#8a5b3e'
  ctx.beginPath()
  ctx.ellipse(0, -7, 7, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(-5 + wobble, -5, 2, 5)
  ctx.fillRect(3 - wobble, -5, 2, 5)
  ctx.beginPath()
  ctx.arc(7, -10, 4, 0, Math.PI * 2)
  ctx.fill()
  if (kind === 'cat') {
    ctx.beginPath()
    ctx.moveTo(4, -13)
    ctx.lineTo(5, -18)
    ctx.lineTo(8, -14)
    ctx.moveTo(9, -14)
    ctx.lineTo(12, -18)
    ctx.lineTo(12, -11)
    ctx.fill()
  } else {
    ctx.fillStyle = '#513a2b'
    ctx.fillRect(9, -12, 3, 5)
  }
  ctx.restore()
}

export function drawProp(ctx: CanvasRenderingContext2D, prop: Prop, t: number, seed = 0) {
  switch (prop) {
    case 'tree':
      tree(ctx, '#63b05a', '#4a8f46')
      break
    case 'pine':
      shadow(ctx, 14, 7)
      ctx.fillStyle = '#8a6240'
      ctx.fillRect(-3, -18, 6, 18)
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(0, -46 + i * 12)
        ctx.lineTo(13 - i * 2, -22 + i * 9)
        ctx.lineTo(-13 + i * 2, -22 + i * 9)
        ctx.closePath()
        ctx.fillStyle = i % 2 ? '#2f6b46' : '#3a7d52'
        ctx.fill()
      }
      break
    case 'bush':
      shadow(ctx, 12, 6)
      ctx.beginPath()
      ctx.ellipse(0, -8, 14, 10, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#4f9b4a'
      ctx.fill()
      break
    case 'flowers':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        ctx.beginPath()
        ctx.arc(Math.cos(a) * 10, Math.sin(a) * 5 - 4, 3, 0, Math.PI * 2)
        ctx.fillStyle = ['#e8618c', '#f2c94c', '#f27b4c', '#c77bf2'][i]
        ctx.fill()
      }
      break
    case 'house':
      house(ctx, '#f0e0c4', '#c05b4a', '#9c4438')
      break
    case 'simffee':
      shopBuilding(ctx, '#f3e3c7', '#7b4a2d', '#2f7d6d', 'SIMFFEE')
      break
    case 'starbucks':
      shopBuilding(ctx, '#e9ecef', '#2a6b4f', '#1d6b4a', 'STARBUCKS')
      break
    case 'lamp':
      ctx.fillStyle = '#3d4a55'
      ctx.fillRect(-2, -34, 4, 34)
      ctx.beginPath()
      ctx.arc(0, -38, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#ffe9a8'
      ctx.fill()
      break
    case 'bench':
      ctx.fillStyle = '#9c6b40'
      ctx.fillRect(-16, -12, 32, 5)
      ctx.fillRect(-16, -20, 32, 5)
      ctx.fillStyle = '#6d4a2c'
      ctx.fillRect(-14, -8, 4, 8)
      ctx.fillRect(10, -8, 4, 8)
      break
    case 'kiosk':
      shadow(ctx, 18, 9)
      box(ctx, 0.6, 0.6, 20, '#d9e6ef', '#b9c9d4', '#9cadb9')
      ctx.fillStyle = '#e2584f'
      ctx.fillRect(-18, -26, 36, 6)
      break
    case 'fountain':
      shadow(ctx, 22, 11)
      box(ctx, 0.7, 0.7, 8, '#b9c3cc', '#9aa5ae', '#828d96')
      ctx.beginPath()
      ctx.ellipse(0, -12, 16, 8, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#5fb7e6'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(0, -14 - Math.sin(t / 300) * 2, 4, 3, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#e8f6ff'
      ctx.fill()
      break
    case 'fence':
      fence(ctx, false)
      break
    case 'gate':
      fence(ctx, true)
      break
    case 'sheep':
    case 'cow':
    case 'chicken':
    case 'duck':
      animal(ctx, prop, t, seed)
      break
    case 'trough':
      trough(ctx)
      break
    case 'coop':
      coop(ctx)
      break
    default:
      break
  }
}

const SKIN = ['#f0c8a0', '#e0ab86', '#c98d68', '#a9704f']
const SHIRTS = ['#e2584f', '#3f7fc4', '#f2b544', '#6b4ec4', '#2f9e7a', '#e2699c', '#4aa3d4', '#d4763a', '#7a9c3a', '#c44f7a']

export function drawPerson(
  ctx: CanvasRenderingContext2D,
  colorSeed: number,
  walking: boolean,
  t: number,
  highlight: boolean,
) {
  const bob = walking ? Math.abs(Math.sin(t / 110)) * 2.5 : 0
  const legSwing = walking ? Math.sin(t / 110) * 3 : 0
  shadow(ctx, 8, 4)
  ctx.save()
  ctx.translate(0, -bob)
  if (highlight) {
    ctx.beginPath()
    ctx.ellipse(0, -2, 13, 7, 0, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffd166'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.fillStyle = '#3a4250'
  ctx.fillRect(-4 + legSwing, -9, 3, 9)
  ctx.fillRect(1 - legSwing, -9, 3, 9)
  ctx.fillStyle = SHIRTS[colorSeed % SHIRTS.length]
  ctx.fillRect(-5, -20, 10, 12)
  ctx.fillStyle = SKIN[colorSeed % SKIN.length]
  ctx.beginPath()
  ctx.arc(0, -25, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2f2a28'
  ctx.beginPath()
  ctx.arc(0, -27.5, 5.5, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawBubble(ctx: CanvasRenderingContext2D, text: string, tone: 'think' | 'talk') {
  const maxWidth = 168
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  const clipped = lines.slice(0, 4)
  const w = Math.max(...clipped.map((l) => ctx.measureText(l).width)) + 16
  const h = clipped.length * 14 + 12
  const x = -w / 2
  const y = -46 - h

  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 8)
  ctx.fillStyle = tone === 'think' ? 'rgba(255,255,255,0.97)' : 'rgba(255,246,214,0.97)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,40,40,0.25)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(-5, y + h)
  ctx.lineTo(5, y + h)
  ctx.lineTo(0, y + h + 8)
  ctx.closePath()
  ctx.fillStyle = tone === 'think' ? 'rgba(255,255,255,0.97)' : 'rgba(255,246,214,0.97)'
  ctx.fill()

  ctx.fillStyle = '#2b2b2b'
  ctx.textAlign = 'center'
  clipped.forEach((l, i) => ctx.fillText(l, 0, y + 18 + i * 14))
}

export function drawTileHighlight(ctx: CanvasRenderingContext2D, color: string) {
  ctx.beginPath()
  ctx.moveTo(0, -TILE_H / 2)
  ctx.lineTo(TILE_W / 2, 0)
  ctx.lineTo(0, TILE_H / 2)
  ctx.lineTo(-TILE_W / 2, 0)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}
