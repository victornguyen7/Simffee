import { useEffect, useRef, useState } from 'react'
import type { Runs } from '../types'
import { agentsAt } from '../town/agents'
import type { Row } from '../types'
import { drawBubble, drawGround, drawPerson, drawProp, drawTileHighlight } from '../town/draw'
import {
  GRID,
  TILE_H,
  TILE_W,
  idx,
  inBounds,
  screenToTile,
  tileToScreen,
  type Ground,
  type Prop,
  type Town,
} from '../town/model'

export type Brush =
  | { kind: 'ground'; value: Ground }
  | { kind: 'prop'; value: Prop }
  | { kind: 'erase' }
  | null

interface Props {
  runs: Runs
  town: Town
  rows: Row[]
  phase: number
  brush: Brush
  selectedTwin: string | null
  onPaint: (tile: number, brush: Brush) => void
  onSelectTwin: (id: string | null) => void
  onEnterShop: (sprite: 'simffee' | 'starbucks') => void
}

export default function IsoTown({
  runs,
  town,
  rows,
  phase,
  brush,
  selectedTwin,
  onPaint,
  onSelectTwin,
  onEnterShop,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ runs, town, rows, phase, brush, selectedTwin })
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 })
  const hoverRef = useRef<[number, number] | null>(null)
  const dragRef = useRef<{ x: number; y: number; moved: boolean; painting: boolean } | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    stateRef.current = { runs, town, rows, phase, brush, selectedTwin }
  }, [runs, town, rows, phase, brush, selectedTwin])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = (t: number) => {
      const ctx = canvas.getContext('2d')
      const { runs: r, town: tn, rows: rws, phase: ph, selectedTwin: sel } = stateRef.current
      if (!ctx) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const cam = cameraRef.current
      const originX = rect.width / 2 + cam.x
      const originY = rect.height / 2 - (GRID * TILE_H) / 2 + cam.y
      ctx.save()
      ctx.translate(originX, originY)
      ctx.scale(cam.zoom, cam.zoom)

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const [sx, sy] = tileToScreen(x, y)
          ctx.save()
          ctx.translate(sx, sy)
          drawGround(ctx, x, y, tn.ground[idx(x, y)], t)
          const hover = hoverRef.current
          if (hover && hover[0] === x && hover[1] === y) {
            drawTileHighlight(ctx, 'rgba(255,255,255,0.35)')
          }
          ctx.restore()
        }
      }

      const agents = agentsAt(r, rws, ph, sel)

      type Item = { depth: number; draw: () => void; overlay?: () => void }
      const items: Item[] = []

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const prop = tn.props[idx(x, y)]
          if (prop === 'none') continue
          const [sx, sy] = tileToScreen(x, y)
          items.push({
            depth: x + y,
            draw: () => {
              ctx.save()
              ctx.translate(sx, sy)
              drawProp(ctx, prop, t)
              ctx.restore()
            },
          })
        }
      }

      agents.forEach((a, i) => {
        const [sx, sy] = tileToScreen(a.pos[0], a.pos[1])
        items.push({
          depth: a.pos[0] + a.pos[1] + 0.5,
          draw: () => {
            ctx.save()
            ctx.translate(sx, sy)
            drawPerson(ctx, i, a.walking, t, sel === a.twin.id)
            ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.fillStyle = 'rgba(30,30,30,0.7)'
            ctx.fillText(a.twin.name, 0, 8)
            ctx.restore()
          },
          overlay: a.bubble
            ? () => {
                ctx.save()
                ctx.translate(sx, sy)
                drawBubble(ctx, a.bubble!.text, a.bubble!.tone)
                ctx.restore()
              }
            : undefined,
        })
      })

      items.sort((a, b) => a.depth - b.depth)
      for (const item of items) item.draw()
      for (const item of items) item.overlay?.()

      ctx.restore()
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const toTile = (clientX: number, clientY: number): [number, number] | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cam = cameraRef.current
    const originX = rect.width / 2 + cam.x
    const originY = rect.height / 2 - (GRID * TILE_H) / 2 + cam.y
    const sx = (clientX - rect.left - originX) / cam.zoom
    const sy = (clientY - rect.top - originY) / cam.zoom
    const [tx, ty] = screenToTile(sx, sy)
    return inBounds(tx, ty) ? [tx, ty] : null
  }

  const pickTwin = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cam = cameraRef.current
    const originX = rect.width / 2 + cam.x
    const originY = rect.height / 2 - (GRID * TILE_H) / 2 + cam.y
    const px = (clientX - rect.left - originX) / cam.zoom
    const py = (clientY - rect.top - originY) / cam.zoom
    const agents = agentsAt(runs, rows, phase, selectedTwin)
    for (const a of agents) {
      const [sx, sy] = tileToScreen(a.pos[0], a.pos[1])
      if (Math.abs(px - sx) < 11 && py - sy < 6 && py - sy > -32) return a.twin.id
    }
    return null
  }

  /** Buildings are drawn above their tile, so hit-test their sprite box rather than the ground. */
  const pickShop = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cam = cameraRef.current
    const originX = rect.width / 2 + cam.x
    const originY = rect.height / 2 - (GRID * TILE_H) / 2 + cam.y
    const px = (clientX - rect.left - originX) / cam.zoom
    const py = (clientY - rect.top - originY) / cam.zoom
    let hit: { id: 'simffee' | 'starbucks'; depth: number } | null = null
    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        const prop = town.props[idx(tx, ty)]
        if (prop !== 'simffee' && prop !== 'starbucks') continue
        const [sx, sy] = tileToScreen(tx, ty)
        if (Math.abs(px - sx) > TILE_W / 2 || py - sy > TILE_H / 2 || py - sy < -62) continue
        const depth = tx + ty
        if (!hit || depth > hit.depth) hit = { id: prop, depth }
      }
    }
    return hit?.id ?? null
  }

  return (
    <canvas
      ref={canvasRef}
      className="iso-canvas"
      style={{ cursor: brush ? 'crosshair' : 'grab' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const painting = Boolean(brush) && e.button === 0
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false, painting }
        if (painting) {
          const tile = toTile(e.clientX, e.clientY)
          if (tile) onPaint(idx(tile[0], tile[1]), brush)
        }
      }}
      onPointerMove={(e) => {
        const tile = toTile(e.clientX, e.clientY)
        hoverRef.current = tile
        const drag = dragRef.current
        if (!drag) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
        if (drag.painting) {
          if (tile) onPaint(idx(tile[0], tile[1]), brush)
          return
        }
        cameraRef.current.x += dx
        cameraRef.current.y += dy
        drag.x = e.clientX
        drag.y = e.clientY
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current
        dragRef.current = null
        if (!drag || drag.moved || drag.painting) return
        const twin = pickTwin(e.clientX, e.clientY)
        if (twin) {
          onSelectTwin(twin === selectedTwin ? null : twin)
          return
        }
        const shop = pickShop(e.clientX, e.clientY)
        if (shop) {
          onEnterShop(shop)
          return
        }
        onSelectTwin(null)
      }}
      onWheel={(e) => {
        const cam = cameraRef.current
        const next = Math.min(2.2, Math.max(0.45, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)))
        cam.zoom = next
        force((n) => n + 1)
      }}
      onDoubleClick={() => {
        cameraRef.current = { x: 0, y: 0, zoom: 1 }
        force((n) => n + 1)
      }}
      aria-label={`Isometric town, ${GRID} by ${GRID} tiles, tile size ${TILE_W} by ${TILE_H}`}
    />
  )
}
