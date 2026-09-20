import { useEffect, useMemo, useState } from 'react'
import './market.css'
import { loadRuns, rowsFor, scenarioIds, type Runs } from '../sim/runs'

/**
 * The model page. This reads what the Python engine produced and shows it
 * straight. Nothing here recomputes a decision, so what you see is exactly
 * what the run contains.
 */
export default function Market() {
  const [runs, setRuns] = useState<Runs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState('baseline')

  useEffect(() => {
    let alive = true
    loadRuns()
      .then((r) => alive && setRuns(r))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const days = useMemo(() => {
    if (!runs) return []
    const seed = runs.meta.default_seed
    return Array.from({ length: runs.meta.days }, (_, i) => ({
      day: i + 1,
      rows: rowsFor(runs, scenario, seed, i + 1)
    }))
  }, [runs, scenario])

  if (error) {
    return (
      <div className="market">
        <div className="check check--bad">runs.json did not load: {error}</div>
      </div>
    )
  }

  if (!runs) return <div className="market"><p className="dim">Loading the run.</p></div>

  const shopIds = Object.keys(runs.shops)

  return (
    <div className="market">
      <header className="market__head">
        <h2 className="market__title">The model</h2>
        <p className="dim">
          Generated {new Date(runs.meta.generated_at).toLocaleString()} · seed{' '}
          {runs.meta.default_seed} of {runs.meta.seeds.length}
        </p>
      </header>

      <div className="check">{runs.meta.synthetic_label}</div>

      <div className="market__scenarios">
        {scenarioIds(runs).map((id) => (
          <button
            key={id}
            className={id === scenario ? 'is-on' : ''}
            onClick={() => setScenario(id)}
          >
            {runs.scenarios[id].label}
          </button>
        ))}
      </div>

      <h3 className="market__h">Purchases by day</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Day</th>
            {shopIds.map((id) => (
              <th key={id}>{runs.shops[id].name}</th>
            ))}
            <th>Went without</th>
            <th>Takings</th>
          </tr>
        </thead>
        <tbody>
          {days.map(({ day, rows }) => {
            const count = (id: string) => rows.filter((r) => !r.abandoned && r.choice === id).length
            const without = rows.filter((r) => r.abandoned).length
            const takings = rows.reduce((sum, r) => sum + (r.spent || 0), 0)
            return (
              <tr key={day}>
                <td>{day}</td>
                {shopIds.map((id) => (
                  <td key={id}>{count(id)}</td>
                ))}
                <td className={without ? 'bad' : 'dim'}>{without}</td>
                <td className="grid__total">{Math.round(takings / 1000)}k</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3 className="market__h">Every twin, day by day</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Twin</th>
            {days.map((d) => (
              <th key={d.day}>D{d.day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.twins.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              {days.map((d) => {
                const row = d.rows.find((r) => r.twin === t.id)
                if (!row) return <td key={d.day} className="dim">·</td>
                if (row.abandoned) return <td key={d.day} className="bad">none</td>
                return (
                  <td
                    key={d.day}
                    className={row.choice === 'simffee' ? 'good' : 'dim'}
                    title={row.reasoning}
                  >
                    {row.choice === 'simffee' ? 'S' : 'X'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim">S is Simffee, X is Starbucks. Hover a cell for the twin's own reason.</p>
    </div>
  )
}