import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AnalysisPanel from './components/AnalysisPanel'
import Controls from './components/Controls'
import IsoTown, { type Brush } from './components/IsoTown'
import Palette from './components/Palette'
import ShopInterior from './components/ShopInterior'
import { rowsFor, salesFor } from './town/agents'
import { clearTown, defaultTown, loadTown, saveTown, type Town } from './town/model'
import type { Runs, ShopId } from './types'

const DAY_MS = 7000

export default function App() {
  const [runs, setRuns] = useState<Runs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [town, setTown] = useState<Town | null>(null)
  const [scenario, setScenario] = useState('baseline')
  const [seed, setSeed] = useState(0)
  const [day, setDay] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [phase, setPhase] = useState(0)
  const [brush, setBrush] = useState<Brush>(null)
  const [selectedTwin, setSelectedTwin] = useState<string | null>(null)
  const [interior, setInterior] = useState<ShopId | null>(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}runs.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`runs.json: ${r.status}`)
        return r.json() as Promise<Runs>
      })
      .then((data) => {
        setRuns(data)
        setSeed(data.meta.default_seed)
        setTown(loadTown() ?? defaultTown(data.twins, data.shops))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    if (!playing || !runs) return
    const started = performance.now() - phaseRef.current * DAY_MS
    let raf = 0
    const tick = (now: number) => {
      const elapsed = now - started
      const next = elapsed / DAY_MS
      if (next >= 1) {
        setDay((d) => (d % runs.meta.days) + 1)
        setPhase(0)
        return
      }
      setPhase(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, runs, day])

  const rows = useMemo(() => (runs ? rowsFor(runs, scenario, seed, day) : []), [runs, scenario, seed, day])
  const sales = useMemo(
    () => (runs ? salesFor(runs, scenario, seed, day) : { simffee: 0, starbucks: 0 }),
    [runs, scenario, seed, day],
  )

  const paint = useCallback((tile: number, b: Brush) => {
    if (!b) return
    setTown((prev) => {
      if (!prev) return prev
      const next: Town = { ground: [...prev.ground], props: [...prev.props] }
      if (b.kind === 'ground') next.ground[tile] = b.value
      else if (b.kind === 'prop') next.props[tile] = b.value
      else {
        if (next.props[tile] !== 'none') next.props[tile] = 'none'
        else next.ground[tile] = 'grass'
      }
      saveTown(next)
      return next
    })
  }, [])

  const resetTown = useCallback(() => {
    if (!runs) return
    clearTown()
    setTown(defaultTown(runs.twins, runs.shops))
  }, [runs])

  if (error) {
    return (
      <div className="loading">
        <p>Could not load runs.json — {error}</p>
        <p className="muted">Build it first: ./tools/build_demo.sh --offline</p>
      </div>
    )
  }
  if (!runs || !town) return <div className="loading">loading the island…</div>

  const scenarioLabel = runs.scenarios[scenario]?.label ?? scenario

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Simffee <span>what-if island</span>
        </h1>
        <span className="muted">
          {scenarioLabel} · day {day} of {runs.meta.days} · seed {seed}
        </span>
      </header>

      <div className="stage">
        <div className="town-col">
          <Controls
            runs={runs}
            scenario={scenario}
            seed={seed}
            day={day}
            playing={playing}
            sales={sales}
            onScenario={setScenario}
            onSeed={setSeed}
            onDay={(d) => {
              setDay(d)
              setPhase(0)
            }}
            onPlaying={setPlaying}
          />
          <IsoTown
            runs={runs}
            town={town}
            rows={rows}
            phase={playing ? phase : 0.7}
            brush={brush}
            selectedTwin={selectedTwin}
            onPaint={paint}
            onSelectTwin={setSelectedTwin}
            onEnterShop={setInterior}
          />
          <Palette brush={brush} onBrush={setBrush} onReset={resetTown} />
        </div>
        <AnalysisPanel
          runs={runs}
          rows={rows}
          day={day}
          selectedTwin={selectedTwin}
          onSelectTwin={setSelectedTwin}
        />
      </div>

      {interior && (
        <ShopInterior
          runs={runs}
          shopId={interior}
          rows={rows}
          day={day}
          sales={sales}
          onClose={() => setInterior(null)}
        />
      )}
    </div>
  )
}
