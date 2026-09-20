import { useEffect, useRef } from 'react'
import type { Row, Runs } from '../types'
import { agentsAt } from '../town/agents'
import { drawAnimal, drawBubble, drawGround, drawPerson, drawPet, drawProp } from '../town/draw'
import {
  GRID,
  PENS,
  TILE_H,
  TILE_W,
  idx,
  tileToScreen,
  type Pen,
  type Town,
} from '../town/model'

const PIXEL = 2

interface Pet {
  kind: 'cat' | 'dog'
  pos: [number, number]
  target: [number, number]
}

interface Livestock {
  kind: 'sheep' | 'cow' | 'chicken' | 'duck'
  pen: Pen
  pos: [number, number]
  target: [number, number]
  idleUntil: number
}

interface Props {
  runs: Runs
  town: Town
  rows: Row[]
  phase: number
  selectedTwin: string | null
  onSelectTwin: (id: string | null) => void
  onEnterShop: (sprite: 'simffee' | 'starbucks') => void
}

function penTile(x: number, y: number): boolean {
  return PENS.some((pen) => x >= pen.x && x < pen.x + pen.w && y >= pen.y && y < pen.y + pen.h)
}

function petTarget(town: Town): [number, number] {
  const candidates: [number, number][] = []
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const ground = town.ground[idx(x, y)]
      if (penTile(x, y) || town.props[idx(x, y)] !== 'none') continue
      if (ground === 'path' || ground === 'plaza' || ground === 'grass') candidates.push([x, y])
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)] ?? [8, 8]
}

function unit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function livestockPoint(pen: Pen, seed: number): [number, number] {
  const minX = pen.x + 1.2
  const maxX = pen.x + pen.w - 1.2
  const minY = pen.y + 1.2
  const maxY = pen.y + pen.h - 1.2
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = minX + (maxX - minX) * unit(seed + attempt * 2)
    const y = minY + (maxY - minY) * unit(seed + attempt * 2 + 1)
    if (Math.hypot(x - (pen.x + 1), y - (pen.y + 1)) >= 0.7) return [x, y]
  }
  return [maxX, maxY]
}

function createLivestock(): Livestock[] {
  const counts: Record<Pen['kind'], number> = { sheep: 7, cow: 4, poultry: 8 }
  const animals: Livestock[] = []
  let seed = 41
  for (const pen of PENS) {
    for (let i = 0; i < counts[pen.kind]; i++) {
      const kind =
        pen.kind === 'sheep'
          ? 'sheep'
          : pen.kind === 'cow'
            ? 'cow'
            : i % 3 === 0
              ? 'duck'
              : 'chicken'
      animals.push({
        kind,
        pen,
        pos: livestockPoint(pen, seed),
        target: livestockPoint(pen, seed + 100),
        idleUntil: 0,
      })
      seed += 7
    }
  }
  return animals
}

export default function IsoTown({
  runs,
  town,
  rows,
  phase,
  selectedTwin,
  onSelectTwin,
  onEnterShop,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ runs, town, rows, phase, selectedTwin })
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1.5 })
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const petsRef = useRef<Pet[]>([])
  const livestockRef = useRef<Livestock[]>([])

  useEffect(() => {
    stateRef.current = { runs, town, rows, phase, selectedTwin }
  }, [runs, town, rows, phase, selectedTwin])

  useEffect(() => {
    petsRef.current = [
      { kind: 'cat', pos: petTarget(town), target: petTarget(town) },
      { kind: 'dog', pos: petTarget(town), target: petTarget(town) },
    ]
    livestockRef.current = createLivestock()
  }, [town])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let previous = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr / PIXEL))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr / PIXEL))
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr / PIXEL, 0, 0, dpr / PIXEL, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = (t: number) => {
      const ctx = canvas.getContext('2d')
      const { runs: r, town: tn, rows: rws, phase: ph, selectedTwin: sel } = stateRef.current
      if (!ctx) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr / PIXEL, 0, 0, dpr / PIXEL, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const elapsed = previous === 0 ? 0 : Math.min(100, t - previous) / 1000
      previous = t
      for (const pet of petsRef.current) {
        const dx = pet.target[0] - pet.pos[0]
        const dy = pet.target[1] - pet.pos[1]
        const distance = Math.hypot(dx, dy)
        if (distance < 0.04) {
          pet.pos = pet.target
          pet.target = petTarget(tn)
          continue
        }
        const step = Math.min(distance, elapsed * 0.35)
        pet.pos = [pet.pos[0] + (dx / distance) * step, pet.pos[1] + (dy / distance) * step]
      }

      for (const livestock of livestockRef.current) {
        if (livestock.idleUntil > t) continue
        const dx = livestock.target[0] - livestock.pos[0]
        const dy = livestock.target[1] - livestock.pos[1]
        const distance = Math.hypot(dx, dy)
        if (distance < 0.04) {
          livestock.pos = livestock.target
          if (Math.random() < 0.7) {
            livestock.idleUntil = t + 900 + Math.random() * 2200
          } else {
            livestock.target = livestockPoint(livestock.pen, Math.random() * 10000)
          }
          continue
        }
        const step = Math.min(distance, elapsed * 0.15)
        livestock.pos = [
          livestock.pos[0] + (dx / distance) * step,
          livestock.pos[1] + (dy / distance) * step,
        ]
      }

      const cam = cameraRef.current
      const originX = rect.width / 2 + cam.x
      const originY = rect.height / 2 - (GRID * TILE_H / 2) * cam.zoom + cam.y
      ctx.save()
      ctx.translate(originX, originY)
      ctx.scale(cam.zoom, cam.zoom)

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const [sx, sy] = tileToScreen(x, y)
          ctx.save()
          ctx.translate(sx, sy)
          drawGround(ctx, x, y, tn.ground[idx(x, y)], t)
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

      for (const pet of petsRef.current) {
        const [sx, sy] = tileToScreen(pet.pos[0], pet.pos[1])
        items.push({
          depth: pet.pos[0] + pet.pos[1] + 0.35,
          draw: () => {
            ctx.save()
            ctx.translate(sx, sy)
            drawPet(ctx, pet.kind, t)
            ctx.restore()
          },
        })
      }

      for (const livestock of livestockRef.current) {
        const [sx, sy] = tileToScreen(livestock.pos[0], livestock.pos[1])
        items.push({
          depth: livestock.pos[0] + livestock.pos[1] + 0.4,
          draw: () => {
            ctx.save()
            ctx.translate(sx, sy)
            drawAnimal(ctx, livestock.kind, t, livestock.pos[0] * 31 + livestock.pos[1])
            ctx.restore()
          },
        })
      }

      agents.forEach((a, i) => {
        const [sx, sy] = tileToScreen(a.pos[0], a.pos[1])
        items.push({
          depth: a.pos[0] + a.pos[1] + 0.5,
          draw: () => {
            ctx.save()
            ctx.translate(sx, sy)
            drawPerson(ctx, i, a.walking, t, sel === a.twin.id)
            ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
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

  const pickTwin = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cam = cameraRef.current
    const originX = rect.width / 2 + cam.x
    const originY = rect.height / 2 - (GRID * TILE_H / 2) * cam.zoom + cam.y
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
    const originY = rect.height / 2 - (GRID * TILE_H / 2) * cam.zoom + cam.y
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
      style={{ cursor: 'grab' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
        cameraRef.current.x += dx
        cameraRef.current.y += dy
        drag.x = e.clientX
        drag.y = e.clientY
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current
        dragRef.current = null
        if (!drag || drag.moved) return
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
        cam.zoom = Math.min(2.2, Math.max(0.45, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)))
      }}
      onDoubleClick={() => {
        cameraRef.current = { x: 0, y: 0, zoom: 1.5 }
      }}
      aria-label={`Isometric town, ${GRID} by ${GRID} tiles, tile size ${TILE_W} by ${TILE_H}`}
    />
  )
}
