import { useEffect, useMemo, useRef, useState } from 'react'
import type { Runs } from '../types'
import IsoTown from '../components/IsoTown'
import { rowsFor } from '../town/agents'
import { defaultTown, loadTown } from '../town/model'
import type { ShopId } from '../sim/runs'
import './town.css'

interface Props {
  onEnterShop: (shop: ShopId) => void
}

const DAY_MS = 16000

export default function Town({ onEnterShop }: Props) {
  const [runs, setRuns] = useState<Runs | null>(null)
  const [scenario, setScenario] = useState('baseline')
  const [seed, setSeed] = useState(0)
  const [day, setDay] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [phase, setPhase] = useState(0)
  const [selectedTwin, setSelectedTwin] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}runs.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`runs.json failed to load (${response.status})`)
        return response.json() as Promise<Runs>
      })
      .then((loaded) => {
        if (!alive) return
        setRuns(loaded)
        setSeed(loaded.meta.default_seed)
        setScenario(Object.keys(loaded.scenarios).includes('baseline') ? 'baseline' : Object.keys(loaded.scenarios)[0])
      })
      .catch((reason: unknown) => {
        if (alive) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    if (!runs) return
    let frame = 0
    let previous = performance.now()
    const loop = (now: number) => {
      const elapsed = now - previous
      previous = now
      if (!playing) {
        if (phaseRef.current !== 0.7) {
          phaseRef.current = 0.7
          setPhase(0.7)
        }
      } else {
        let next = phaseRef.current + elapsed / DAY_MS
        if (next >= 1) {
          next %= 1
          setDay((current) => current >= runs.meta.days ? 1 : current + 1)
        }
        phaseRef.current = next
        setPhase(next)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [runs, playing])

  const town = useMemo(
    () => (runs ? loadTown() ?? defaultTown(runs.twins, runs.shops, runs.meta.focus_shop ?? 'simffee') : null),
    [runs],
  )
  const rows = useMemo(
    () => (runs ? rowsFor(runs, scenario, seed, day) : []),
    [runs, scenario, seed, day],
  )
  const scenarioIds = useMemo(() => {
    if (!runs) return []
    return Object.keys(runs.scenarios).sort((a, b) => (
      a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b)
    ))
  }, [runs])
  const selected = runs?.twins.find((twin) => twin.id === selectedTwin) ?? null
  const selectedRow = selected ? rows.find((row) => row.twin === selected.id) : undefined

  return (
    <div className="town">
      <div className="town__stage">
        {runs && town && (
          <IsoTown
            runs={runs}
            town={town}
            rows={rows}
            phase={phase}
            selectedTwin={selectedTwin}
            onSelectTwin={setSelectedTwin}
            onEnterShop={onEnterShop}
          />
        )}
      </div>

      {selected && (
        <aside className="resident">
          <button className="resident__close" onClick={() => setSelectedTwin(null)} aria-label="Close">
            ×
          </button>
          <h3 className="resident__name">{selected.name}</h3>
          <p className="resident__role">{selected.profile.occupation} · {selected.profile.age}</p>

          <dl className="resident__stats">
            <div>
              <dt>Usual order</dt>
              <dd>{selected.profile.usual_order}</dd>
            </div>
            <div>
              <dt>Usual time</dt>
              <dd>{selected.profile.usual_time}</dd>
            </div>
            <div>
              <dt>Daily budget</dt>
              <dd>{Math.round(selected.profile.daily_budget_vnd / 1000)}k</dd>
            </div>
            <div>
              <dt>Will wait</dt>
              <dd>{selected.profile.wait_tolerance_min} min</dd>
            </div>
            {selectedRow && (
              <div>
                <dt>Day {day}</dt>
                <dd>
                  {selectedRow.abandoned ? 'went without' : selectedRow.choice}
                  {selectedRow.primary_driver ? ` · ${selectedRow.primary_driver}` : ''}
                </dd>
              </div>
            )}
          </dl>

          {selectedRow && <p className="resident__notes">{selectedRow.reasoning}</p>}

          {selected.why_excerpt.slice(0, 2).map((excerpt, i) => (
            <p className="resident__notes" key={i}>
              <strong>{excerpt.q}</strong>
              <br />
              {excerpt.a}
            </p>
          ))}
        </aside>
      )}

      {runs && (
        <div className="town__sim">
          <div className="town__days">
            <button onClick={() => setPlaying((current) => !current)}>{playing ? 'pause' : 'play'}</button>
            <span className="town__day">
              day {day} of {runs.meta.days}
            </span>
            <button onClick={() => setDay((current) => current >= runs.meta.days ? 1 : current + 1)}>next</button>
          </div>

          <div className="town__scenarios">
            {scenarioIds.map((id) => (
              <button
                key={id}
                className={id === scenario ? 'is-on' : ''}
                onClick={() => {
                  setScenario(id)
                  setDay(1)
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
