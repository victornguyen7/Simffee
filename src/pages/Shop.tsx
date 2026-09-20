import { useCallback, useEffect, useRef, useState } from 'react'
import './shop.css'
import { paletteFrom, render } from '../sim/render'
import {
  DEFAULT_CONFIG,
  GRID_H,
  GRID_W,
  TILE,
  applyConfig,
  createWorld,
  dayIsOver,
  endDay,
  step,
  type DayStats,
  type World
} from '../sim/world'

type Speed = 0 | 1 | 3

const BASE_TICKS_PER_SECOND = 20

export default function Shop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World>(createWorld())
  const frameRef = useRef<number>(0)

  const [speed, setSpeed] = useState<Speed>(1)
  const [baristas, setBaristas] = useState(DEFAULT_CONFIG.baristas)
  const [price, setPrice] = useState(DEFAULT_CONFIG.price)

  // Mirrors of sim state, refreshed each frame so React can display them.
  const [view, setView] = useState({
    day: 1,
    tick: 0,
    inShop: 0,
    queueLength: 0,
    stats: worldRef.current.stats,
    reputation: 1
  })
  const [history, setHistory] = useState<DayStats[]>([])

  useEffect(() => {
    applyConfig(worldRef.current, { baristas, price })
  }, [baristas, price])

  const finishDay = useCallback(() => {
    endDay(worldRef.current)
    setHistory([...worldRef.current.history])
  }, [])

  // The render loop. It never decides anything, it only draws and drives ticks.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let last = performance.now()
    let carry = 0
    let palette = paletteFrom(canvas)
    let paletteAge = 0

    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now

      const world = worldRef.current

      if (speed > 0) {
        carry += dt * BASE_TICKS_PER_SECOND * speed
        const ticks = Math.floor(carry)
        carry -= ticks
        for (let i = 0; i < ticks; i++) {
          if (dayIsOver(world)) break
          step(world)
        }
      }

      // Theme can change under us, so refresh the palette occasionally.
      paletteAge += dt
      if (paletteAge > 1) {
        palette = paletteFrom(canvas)
        paletteAge = 0
      }

      render(ctx, world, palette)

      setView({
        day: world.day,
        tick: world.tick,
        inShop: world.customers.length,
        queueLength: world.queue.length,
        stats: { ...world.stats },
        reputation: world.reputation
      })

      frameRef.current = requestAnimationFrame(loop)
    }

    frameRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frameRef.current)
  }, [speed])

  function runRestOfDay() {
    const world = worldRef.current
    let guard = 0
    while (!dayIsOver(world) && guard < 5000) {
      step(world)
      guard++
    }
  }

  function resetAll() {
    worldRef.current = createWorld({ ...DEFAULT_CONFIG, baristas, price })
    setHistory([])
  }

  const world = worldRef.current
  const dayDone = view.tick >= world.config.dayLength && view.inShop === 0
  const progress = Math.min(1, view.tick / world.config.dayLength)
  const avgWait = view.stats.served === 0 ? 0 : view.stats.totalWait / view.stats.served

  return (
    <div className="shop">
      <header className="shop__head">
        <div>
          <h1 className="shop__title">Day {view.day}</h1>
          <p className="shop__meta">
            {dayDone ? 'closed' : `${Math.round(progress * 100)}% through the day`} · {view.inShop} in the shop ·{' '}
            {view.queueLength} in line
          </p>
        </div>

        <div className="shop__speeds">
          {([0, 1, 3] as Speed[]).map((s) => (
            <button key={s} className={`chip ${speed === s ? 'chip--on' : ''}`} onClick={() => setSpeed(s)}>
              {s === 0 ? 'pause' : `${s}x`}
            </button>
          ))}
          <button className="chip" onClick={runRestOfDay}>
            skip to close
          </button>
        </div>
      </header>

      <div className="shop__body">
        <div className="shop__stage">
          <canvas ref={canvasRef} width={GRID_W * TILE} height={GRID_H * TILE} className="shop__canvas" />
          <div className="shop__progress">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>

        <aside className="shop__panel">
          <section className="lever">
            <label className="lever__label">
              Baristas <b>{baristas}</b>
            </label>
            <input
              type="range"
              min={1}
              max={4}
              value={baristas}
              onChange={(e) => setBaristas(Number(e.target.value))}
            />
          </section>

          <section className="lever">
            <label className="lever__label">
              Price <b>${price.toFixed(2)}</b>
            </label>
            <input
              type="range"
              min={2.5}
              max={8}
              step={0.5}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </section>

          <dl className="readout">
            <div>
              <dt>Served</dt>
              <dd>{view.stats.served}</dd>
            </div>
            <div>
              <dt>Walked out</dt>
              <dd className={view.stats.walkouts > 0 ? 'bad' : ''}>{view.stats.walkouts}</dd>
            </div>
            <div>
              <dt>Revenue</dt>
              <dd>${view.stats.revenue.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Avg wait</dt>
              <dd>{avgWait.toFixed(0)} min</dd>
            </div>
            <div>
              <dt>Reputation</dt>
              <dd>{Math.round(view.reputation * 100)}%</dd>
            </div>
          </dl>

          {dayDone && (
            <button className="chip chip--go" onClick={finishDay}>
              Close up and start day {view.day + 1}
            </button>
          )}

          <button className="chip" onClick={resetAll}>
            reset to day 1
          </button>
        </aside>
      </div>

      {history.length > 0 && (
        <section className="days">
          <h2 className="days__title">Across days</h2>
          <div className="days__rows">
            {history.map((d) => (
              <div className="days__row" key={d.day}>
                <span className="days__day">Day {d.day}</span>
                <span className="days__bar">
                  <span className="days__fill" style={{ width: `${Math.min(100, (d.served / 60) * 100)}%` }} />
                </span>
                <span className="days__num">{d.served} served</span>
                <span className="days__num bad">{d.walkouts} lost</span>
                <span className="days__num">${d.revenue.toFixed(0)}</span>
                <span className="days__num">{Math.round(d.satisfaction * 100)}% happy</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
