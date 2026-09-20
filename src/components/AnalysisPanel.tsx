import type { Row, Runs } from '../types'

interface Props {
  runs: Runs
  rows: Row[]
  day: number
  selectedTwin: string | null
  onSelectTwin: (id: string | null) => void
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export default function AnalysisPanel({ runs, rows, day, selectedTwin, onSelectTwin }: Props) {
  const a = runs.analysis
  const selectedRow = rows.find((r) => r.twin === selectedTwin)
  const twin = runs.twins.find((t) => t.id === selectedTwin)
  const histogram = Object.entries(a.actual.histogram).sort((x, y) => y[1] - x[1])
  const maxWeight = Math.max(...histogram.map(([, v]) => v))

  return (
    <aside className="panel">
      <section>
        <h3>day {day}</h3>
        <ul className="rowlist">
          {rows.map((r) => {
            const t = runs.twins.find((tw) => tw.id === r.twin)
            return (
              <li key={r.twin}>
                <button
                  type="button"
                  className={r.twin === selectedTwin ? 'rowbtn active' : 'rowbtn'}
                  onClick={() => onSelectTwin(r.twin === selectedTwin ? null : r.twin)}
                >
                  <b>{t?.name ?? r.twin}</b>
                  <span className={`pill ${r.choice}`}>{r.choice === 'none' ? 'skipped' : r.choice}</span>
                  <span className="muted">{r.mode === 'reappraisal' ? r.disruption.source : 'autopilot'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {selectedRow && twin && (
        <section className="selected">
          <h3>{twin.name}</h3>
          <p className="why">“{selectedRow.reasoning}”</p>
          <p className="muted">
            {twin.profile.occupation}, {twin.profile.age} · usual {twin.profile.usual_order} at{' '}
            {twin.profile.usual_time}
          </p>
          <p className="muted">
            driver {selectedRow.primary_driver}
            {selectedRow.secondary_driver ? ` + ${selectedRow.secondary_driver}` : ''} · habit simffee{' '}
            {selectedRow.state_after.habit.simffee?.toFixed(2)} · starbucks{' '}
            {selectedRow.state_after.habit.starbucks?.toFixed(2)}
          </p>
        </section>
      )}

      <section>
        <h3>what actually happened</h3>
        <p>
          Sales broke on day {a.break_day}, down {pct(a.drop)}. The obvious read is{' '}
          <b>{a.naive.label}</b>, but the simulation attributes it to <b>{a.actual.driver}</b>.
        </p>
        <div className="hist">
          {histogram.map(([driver, weight]) => (
            <div key={driver} className="bar">
              <span>{driver}</span>
              <i style={{ width: `${(weight / maxWeight) * 100}%` }} />
              <em>{weight}</em>
            </div>
          ))}
        </div>
        <p className="muted">
          confidence {pct(a.confidence.value)} (stability {pct(a.confidence.stability)}, support{' '}
          {pct(a.confidence.support)}) · {a.impact.lost_by_decision} of {a.impact.lost_total} lost customers
          are attributable to the change
        </p>
      </section>

      <section>
        <h3>what-if</h3>
        {a.whatif.map((w) => (
          <div key={w.scenario} className="whatif">
            <b>{w.label}</b>
            <span>
              wins back {w.returns} of {w.of}
            </span>
            <em>confidence {pct(w.confidence)}</em>
          </div>
        ))}
      </section>

      <p className="synthetic">{runs.meta.synthetic_label}</p>
    </aside>
  )
}
