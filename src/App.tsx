import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AnalysisPanel from './components/AnalysisPanel'
import Controls from './components/Controls'
import IsoTown, { type Brush } from './components/IsoTown'
import Palette from './components/Palette'
import ShopInterior from './components/ShopInterior'
import WhatIfBox from './components/WhatIfBox'
import { shopForSprite, type ShopSprite } from './shops'
import { rowsFor, salesFor } from './town/agents'
import { clearTown, defaultTown, loadTown, saveTown, type Town } from './town/model'
import { focusShopOf, type Analysis, type Runs, type Scenario, type ShopId, type WhatIfAnswer } from './types'

const DAY_MS = 7000
/** Agents stand at their shop with their reasoning showing. */
const PAUSED_PHASE = 0.7

/** A live answer from the API becomes one more scenario in the bundle we render from. */
function withLive(base: Runs, live: Record<string, WhatIfAnswer>): Runs {
  const scenarios: Record<string, Scenario> = { ...base.scenarios }
  for (const [id, a] of Object.entries(live)) {
    if (!a.scenario || !a.result) continue
    scenarios[id] = {
      label: a.scenario.label,
      role: 'whatif',
      parent: a.scenario.parent,
      from_day: Math.min(...a.scenario.overrides.map((o) => o.from_day)),
      days: a.days,
      overrides: a.scenario.overrides,
      source: a.scenario.source ?? { kind: 'user' },
      seeds: a.result,
    }
  }
  return { ...base, scenarios }
}

export default function App() {
  const [bundle, setBundle] = useState<Runs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [town, setTown] = useState<Town | null>(null)
  const [scenario, setScenario] = useState('baseline')
  const [seedChoice, setSeed] = useState(0)
  const [day, setDay] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [phase, setPhase] = useState(0)
  const pause = useCallback((next: boolean) => {
    setPlaying(next)
    if (!next) setPhase(PAUSED_PHASE)
  }, [])
  const [brush, setBrush] = useState<Brush>(null)
  const [selectedTwin, setSelectedTwin] = useState<string | null>(null)
  const [interior, setInterior] = useState<ShopId | null>(null)
  const [live, setLive] = useState<Record<string, WhatIfAnswer>>({})
  const phaseRef = useRef(0)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}runs.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`runs.json: ${r.status}`)
        return r.json() as Promise<Runs>
      })
      .then((data) => {
        setBundle(data)
        setScenario(data.meta.roles?.baseline ?? Object.keys(data.scenarios)[0])
        setSeed(data.meta.default_seed)
        setTown(loadTown() ?? defaultTown(data.twins, data.shops, focusShopOf(data)))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const runs = useMemo(() => (bundle ? withLive(bundle, live) : null), [bundle, live])

  // The selected scenario decides the run length, the seeds on offer, and the analysis shown.
  const current: Scenario | undefined = runs?.scenarios[scenario]
  const days = current?.days ?? runs?.meta.days ?? 7
  const seeds = useMemo(
    () => (current ? Object.keys(current.seeds).map(Number).sort((a, b) => a - b) : runs?.meta.seeds ?? [0]),
    [current, runs],
  )
  const analysis: Analysis | null = runs ? (live[scenario]?.analysis ?? runs.analysis) : null
  // A live run may have fewer seeds than the library; show the first one it has.
  const seed = seeds.includes(seedChoice) ? seedChoice : (seeds[0] ?? 0)

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
        setDay((d) => (d % days) + 1)
        setPhase(0)
        return
      }
      setPhase(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, runs, day, days])

  const rows = useMemo(() => (runs ? rowsFor(runs, scenario, seed, day) : []), [runs, scenario, seed, day])
  const sales = useMemo(() => (runs ? salesFor(runs, scenario, seed, day) : {}), [runs, scenario, seed, day])

  const showAnswer = useCallback((a: WhatIfAnswer) => {
    if (!a.run_id || !a.result) return
    setLive((prev) => ({ ...prev, [a.run_id as string]: a }))
    setScenario(a.run_id)
    const first = Math.min(...(a.scenario?.overrides.map((o) => o.from_day) ?? [1]))
    setDay(Math.max(1, first - 1))
    setPhase(0)
    setPlaying(true)
  }, [])

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
    setTown(defaultTown(runs.twins, runs.shops, focusShopOf(runs)))
  }, [runs])

  if (error) {
    return (
      <div className="loading">
        <p>Could not load runs.json — {error}</p>
        <p className="muted">Build it first: ./tools/build_demo.sh --offline</p>
      </div>
    )
  }
  if (!runs || !town || !analysis) return <div className="loading">loading the island…</div>

  const scenarioLabel = current?.label ?? scenario

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Simffee <span>what-if island</span>
        </h1>
        <span className="muted">
          {scenarioLabel} · day {day} of {days} · seed {seed}
          {runs.meta.publishable === false ? ' · unverified bundle' : ''}
        </span>
      </header>

      <div className="stage">
        <div className="town-col">
          <Controls
            runs={runs}
            scenario={scenario}
            seed={seed}
            day={day}
            days={days}
            seeds={seeds}
            playing={playing}
            sales={sales}
            onScenario={(s) => {
              setScenario(s)
              setDay(1)
              setPhase(0)
            }}
            onSeed={setSeed}
            onDay={(d) => {
              setDay(d)
              setPhase(playing ? 0 : PAUSED_PHASE)
            }}
            onPlaying={pause}
          />
          <IsoTown
            runs={runs}
            town={town}
            rows={rows}
            phase={phase}
            brush={brush}
            selectedTwin={selectedTwin}
            onPaint={paint}
            onSelectTwin={setSelectedTwin}
            onEnterShop={(sprite: ShopSprite) => setInterior(shopForSprite(runs, sprite))}
          />
          <WhatIfBox runs={runs} onAnswer={showAnswer} current={live[scenario] ?? null} />
          <Palette brush={brush} onBrush={setBrush} onReset={resetTown} />
        </div>
        <AnalysisPanel
          runs={runs}
          analysis={analysis}
          scenario={current}
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
