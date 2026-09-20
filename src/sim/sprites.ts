/**
 * Pixel art drawn in code. Every character is a small grid of letters, each
 * letter mapping to a colour, so nothing has to be loaded and you can recolour
 * anyone by swapping their palette.
 *
 * Legend:
 *   ' ' transparent   'o' outline    's' skin
 *   'h' hair          'c' clothes    'p' trousers
 *   'a' apron         'u' cup
 */

export interface BodyPalette {
  outline: string
  skin: string
  hair: string
  clothes: string
  trousers: string
  apron: string
  cup: string
}

const SPRITE_W = 12
const SPRITE_H = 16

function pad(rows: string[]): string[] {
  return rows.map((r) => r.padEnd(SPRITE_W, ' ').slice(0, SPRITE_W))
}

/** Facing the camera, two walk frames with the legs swapped. */
const DOWN_A = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohssssho  ',
  '  oso soso  ',
  '  ossssso   ',
  '   osnso    ',
  '   oooo     ',
  '  occccco   ',
  ' occccccco  ',
  ' oscccccso  ',
  ' oscccccso  ',
  '  occccco   ',
  '  oppppo    ',
  '  op  po    ',
  '  oo  oo    '
])

const DOWN_B = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohssssho  ',
  '  oso soso  ',
  '  ossssso   ',
  '   osnso    ',
  '   oooo     ',
  '  occccco   ',
  ' occccccco  ',
  ' oscccccso  ',
  ' oscccccso  ',
  '  occccco   ',
  '  oppppo    ',
  '   oppo     ',
  '   oooo     '
])

/** Facing away, no face. */
const UP_A = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '   ohhho    ',
  '   oooo     ',
  '  occccco   ',
  ' occccccco  ',
  ' oscccccso  ',
  ' oscccccso  ',
  '  occccco   ',
  '  oppppo    ',
  '  op  po    ',
  '  oo  oo    '
])

const UP_B = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '  ohhhhhho  ',
  '   ohhho    ',
  '   oooo     ',
  '  occccco   ',
  ' occccccco  ',
  ' oscccccso  ',
  ' oscccccso  ',
  '  occccco   ',
  '  oppppo    ',
  '   oppo     ',
  '   oooo     '
])

/** Side view, drawn facing right. Left is the same sprite mirrored. */
const SIDE_A = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohhssso   ',
  '  ohsoss    ',
  '  ohsssso   ',
  '   osnso    ',
  '   oooo     ',
  '   occcco   ',
  '  occcccco  ',
  '  occccccso ',
  '  occcccco  ',
  '   occcco   ',
  '   oppppo   ',
  '   op  po   ',
  '   oo  oo   '
])

const SIDE_B = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohhssso   ',
  '  ohsoss    ',
  '  ohsssso   ',
  '   osnso    ',
  '   oooo     ',
  '   occcco   ',
  '  occcccco  ',
  '  occccccso ',
  '  occcccco  ',
  '   occcco   ',
  '   oppppo   ',
  '    oppo    ',
  '    oooo    '
])

/** Barista: same body, apron over the clothes, standing still. */
const BARISTA = pad([
  '    oooo    ',
  '   ohhhho   ',
  '  ohhhhhho  ',
  '  ohssssho  ',
  '  oso soso  ',
  '  ossssso   ',
  '   osnso    ',
  '   oooo     ',
  '  occccco   ',
  ' occaaacco  ',
  ' oscaaacso  ',
  ' oscaaacso  ',
  '  ocaaaco   ',
  '  oppppo    ',
  '  op  po    ',
  '  oo  oo    '
])

export type Facing = 'up' | 'down' | 'left' | 'right'

function frameFor(facing: Facing, walking: boolean, anim: number): { rows: string[]; mirror: boolean } {
  const b = walking && Math.floor(anim / 6) % 2 === 1
  if (facing === 'up') return { rows: b ? UP_B : UP_A, mirror: false }
  if (facing === 'down') return { rows: b ? DOWN_B : DOWN_A, mirror: false }
  return { rows: b ? SIDE_B : SIDE_A, mirror: facing === 'left' }
}

function colorFor(ch: string, p: BodyPalette): string | null {
  switch (ch) {
    case 'o':
      return p.outline
    case 's':
      return p.skin
    case 'n':
      return p.skin
    case 'h':
      return p.hair
    case 'c':
      return p.clothes
    case 'p':
      return p.trousers
    case 'a':
      return p.apron
    case 'u':
      return p.cup
    default:
      return null
  }
}

/** Draws a sprite with its feet at (cx, cy), scaled to the given pixel size. */
function drawRows(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  mirror: boolean,
  cx: number,
  cy: number,
  px: number,
  palette: BodyPalette
): void {
  const w = SPRITE_W * px
  const h = SPRITE_H * px
  const left = cx - w / 2
  const top = cy - h

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const ch = rows[y][mirror ? SPRITE_W - 1 - x : x]
      const color = colorFor(ch, palette)
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(Math.round(left + x * px), Math.round(top + y * px), Math.ceil(px), Math.ceil(px))
    }
  }
}

export function drawCustomer(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  px: number,
  facing: Facing,
  walking: boolean,
  anim: number,
  palette: BodyPalette,
  carrying: boolean
): void {
  const { rows, mirror } = frameFor(facing, walking, anim)
  drawRows(ctx, rows, mirror, cx, cy, px, palette)

  if (carrying) {
    // a takeaway cup held out to one side
    const x = cx + (facing === 'left' ? -5 * px : 4 * px)
    const y = cy - 6 * px
    ctx.fillStyle = palette.outline
    ctx.fillRect(Math.round(x - px), Math.round(y - px), Math.ceil(px * 4), Math.ceil(px * 5))
    ctx.fillStyle = palette.cup
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(px * 2), Math.ceil(px * 3))
  }
}

export function drawBarista(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  px: number,
  palette: BodyPalette
): void {
  drawRows(ctx, BARISTA, false, cx, cy, px, palette)
}

const HAIR = ['#3b2418', '#6b4226', '#241c1a', '#8a5a2b', '#4a2f52', '#2b3a4a', '#7a3b2e']
const CLOTHES = ['#7a9e7e', '#c4756a', '#6f86a8', '#c3a06b', '#8a7aa8', '#a8705f', '#5f8a86']
const TROUSERS = ['#4a4a55', '#3f4a5c', '#5a4a3e', '#44504a']
const SKIN = ['#f0c8a0', '#d9a878', '#b57f56', '#8d5a3b', '#f7d9bc']

/** Same customer id always gets the same look, so nobody flickers. */
export function paletteForCustomer(id: number, outline: string, cup: string, apron: string): BodyPalette {
  return {
    outline,
    skin: SKIN[id % SKIN.length],
    hair: HAIR[(id * 3) % HAIR.length],
    clothes: CLOTHES[(id * 5) % CLOTHES.length],
    trousers: TROUSERS[(id * 7) % TROUSERS.length],
    apron,
    cup
  }
}
