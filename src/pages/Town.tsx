import { useCallback, useEffect, useRef, useState } from 'react'
import './town.css'
import { clampCamera, render, renderOverlay, type Camera } from '../sim/townRender'
import { BUILDINGS, hitDoor, type Building } from '../sim/town'
import { createCars, createCritters, stepCars, stepCritters } from '../sim/critters'
import { createVillagers, stepVillagers } from '../sim/villagers'
import { applyRunsToTown, type ShopId } from '../sim/town'
import { setDay, setVillagerNames } from '../sim/villagers'
import { loadRuns, rowsFor, scenarioIds, type Runs } from '../sim/runs'

interface Props {
  onEnterShop: (shop: ShopId) => void
}

/** Zoom is fixed. Drag in any direction to explore the village. */
const ZOOM = 1

/**
 * How chunky the world looks. The scene is drawn into a canvas this many times
 * smaller, then blown back up with smoothing off.
 *
 * 1 = crisp, no pixelation. 2 = chunky. 3 = very chunky, but canvas draws curves
 * with anti-aliasing, so soft edges get magnified along with everything else.
 * Hand drawn pixel art avoids that by being drawn on the grid in the first place.
 */
const PIXEL = 2

/** How long one simulated day plays on screen before rolling to the next. */
const DAY_MS = 16000

export default function Town({ onEnterShop }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const hoverRef = useRef<string | null>(null)
  const dragRef = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null)
  const villagersRef = useRef(createVillagers())
  const crittersRef = useRef(createCritters())
  const carsRef = useRef(createCars())
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const movedRef = useRef(false)
  const [hovered, setHovered] = useState<Building | null>(null)
  const [selected, setSelected] = useState<Building | null>(null)
  const [runs, setRuns] = useState<Runs | null>(null)
  const [scenario, setScenario] = useState('baseline')
  const [day, setDayNum] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // pull the model output once
  useEffect(() => {
    let alive = true
    loadRuns()
      .then((r) => {
        if (!alive) return
        applyRunsToTown(r.twins, r.shops)
        setVillagerNames(villagersRef.current, r.twins)
        setRuns(r)
      })
      .catch((e: Error) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [])

  // hand the village the current day, whenever day or scenario changes
  useEffect(() => {
    if (!runs) return
    setDay(villagersRef.current, rowsFor(runs, scenario, runs.meta.default_seed, day))
  }, [runs, scenario, day])

  // auto play the week, looping back to day one
  useEffect(() => {
    if (!runs || !playing) return
    const id = window.setInterval(() => {
      setDayNum((d) => (d >= runs.meta.days ? 1 : d + 1))
    }, DAY_MS)
    return () => window.clearInterval(id)
  }, [runs, playing])

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const cam = camRef.current
    return {
      x: cam.x + (clientX - rect.left) / cam.zoom,
      y: cam.y + (clientY - rect.top) / cam.zoom
    }
  }, [])

  // draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let tick = 0

    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas')
    const off = offscreenRef.current
    const offCtx = off.getContext('2d')
    if (!offCtx) return

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      // Sized off the real backing store, so blowing it back up is always an
      // exact whole number and pixels never land on half positions.
      off.width = Math.max(1, Math.ceil((w * dpr) / PIXEL))
      off.height = Math.max(1, Math.ceil((h * dpr) / PIXEL))

      camRef.current = clampCamera({ ...camRef.current, zoom: ZOOM }, w, h)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const loop = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight

      stepVillagers(villagersRef.current)
      stepCritters(crittersRef.current)
      stepCars(carsRef.current)

      // world, at a third of the resolution
      render(
        offCtx,
        camRef.current,
        w,
        h,
        hoverRef.current,
        tick,
        dpr / PIXEL,
        villagersRef.current,
        crittersRef.current,
        carsRef.current
      )

      // blow it up with hard pixel edges
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, canvas.width, canvas.height)

      // labels and speech bubbles, crisp
      renderOverlay(ctx, camRef.current, w, h, dpr, villagersRef.current)

      tick++
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // start centred on Simffee
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const simffee = BUILDINGS.find((b) => b.shopId === 'simffee')
    if (!simffee) return
    camRef.current = clampCamera(
      {
        zoom: ZOOM,
        x: simffee.box.x + simffee.box.w / 2 - wrap.clientWidth / 2 / ZOOM,
        y: simffee.box.y + simffee.box.h / 2 - wrap.clientHeight / 2 / ZOOM
      },
      wrap.clientWidth,
      wrap.clientHeight
    )
  }, [])

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, camX: camRef.current.x, camY: camRef.current.y }
    movedRef.current = false
  }

  function onPointerMove(e: React.PointerEvent) {
    const wrap = wrapRef.current
    if (!wrap) return

    const drag = dragRef.current
    if (drag) {
      const dx = (e.clientX - drag.x) / camRef.current.zoom
      const dy = (e.clientY - drag.y) / camRef.current.zoom
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true
      camRef.current = clampCamera(
        { ...camRef.current, x: drag.camX - dx, y: drag.camY - dy },
        wrap.clientWidth,
        wrap.clientHeight
      )
      return
    }

    const world = toWorld(e.clientX, e.clientY)
    const door = hitDoor(world.x, world.y)
    hoverRef.current = door?.id ?? null
    setHovered(door)
  }

  function onPointerUp(e: React.PointerEvent) {
    const wasDragging = dragRef.current !== null
    dragRef.current = null
    if (!wasDragging || movedRef.current) return

    const world = toWorld(e.clientX, e.clientY)
    const door = hitDoor(world.x, world.y)
    if (!door) {
      setSelected(null)
      return
    }
    if (door.shopId) {
      onEnterShop(door.shopId)
    } else {
      setSelected(door)
    }
  }

  return (
    <div className="town">
      <div
        className={`town__stage ${hovered ? 'town__stage--door' : ''}`}
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          dragRef.current = null
          hoverRef.current = null
          setHovered(null)
        }}
      >
        <canvas ref={canvasRef} />

        {hovered && (
          <div className="town__tip">
            <strong>{hovered.label}</strong>
            {hovered.sublabel && <span>{hovered.sublabel}</span>}
            <em>{hovered.kind === 'shop' ? 'open the door to go inside' : 'home'}</em>
          </div>
        )}
      </div>

        {selected && selected.kind === 'home' && runs && (() => {
          const twin = runs.twins.find((t) => t.id === selected.id)
          if (!twin) return null
          const p = twin.profile as Record<string, string | number>
          const row = rowsFor(runs, scenario, runs.meta.default_seed, day).find(
            (r) => r.twin === twin.id
          )
          return (
            <aside className="resident">
              <button className="resident__close" onClick={() => setSelected(null)} aria-label="Close">
                ×
              </button>
              <h3 className="resident__name">{twin.name}</h3>
              <p className="resident__role">
                {String(p.occupation ?? '')} · {String(p.age ?? '')}
              </p>

              <dl className="resident__stats">
                <div>
                  <dt>Usual order</dt>
                  <dd>{String(p.usual_order ?? '')}</dd>
                </div>
                <div>
                  <dt>Usual time</dt>
                  <dd>{String(p.usual_time ?? '')}</dd>
                </div>
                <div>
                  <dt>Daily budget</dt>
                  <dd>{Math.round(Number(p.daily_budget_vnd ?? 0) / 1000)}k</dd>
                </div>
                <div>
                  <dt>Will wait</dt>
                  <dd>{String(p.wait_tolerance_min ?? '')} min</dd>
                </div>
                {row && (
                  <div>
                    <dt>Day {day}</dt>
                    <dd>
                      {row.abandoned ? 'went without' : row.choice}
                      {row.primary_driver ? ` · ${row.primary_driver}` : ''}
                    </dd>
                  </div>
                )}
              </dl>

              {row && <p className="resident__notes">{row.reasoning}</p>}

              {twin.why_excerpt?.slice(0, 2).map((w, i) => (
                <p className="resident__notes" key={i}>
                  <strong>{w.q}</strong>
                  <br />
                  {w.a}
                </p>
              ))}
            </aside>
          )
        })()}

      {runs && (
        <div className="town__sim">
          <div className="town__days">
            <button onClick={() => setPlaying((p) => !p)}>{playing ? 'pause' : 'play'}</button>
            <span className="town__day">
              day {day} of {runs.meta.days}
            </span>
            <button onClick={() => setDayNum((d) => (d >= runs.meta.days ? 1 : d + 1))}>next</button>
          </div>

          <div className="town__scenarios">
            {scenarioIds(runs).map((id) => (
              <button
                key={id}
                className={id === scenario ? 'is-on' : ''}
                onClick={() => {
                  setScenario(id)
                  setDayNum(1)
                }}
                title={runs.scenarios[id].label}
              >
                {runs.scenarios[id].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadError && <p className="town__help">runs.json did not load: {loadError}</p>}

      <p className="town__help">
        {runs ? runs.meta.synthetic_label : 'Loading the run.'}
      </p>
    </div>
  )
}