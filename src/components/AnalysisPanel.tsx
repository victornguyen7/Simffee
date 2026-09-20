import { shopColor, shopIds, shopName } from '../shops'
import { focusShopOf, type Analysis, type Row, type Runs, type Scenario } from '../types'

interface Props {
  runs: Runs
  /** The analysis to show: the bundle's, or a live answer's when a live scenario is selected. */
  analysis: Analysis
  scenario: Scenario | undefined
  rows: Row[]
  day: number
  selectedTwin: string | null
  onSelectTwin: (id: string | null) => void
}

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const vnd = (n: number) => `${(n / 1000).toFixed(0)}k`

export default function AnalysisPanel({ runs, analysis: a, scenario, rows, day, selectedTwin, onSelectTwin }: Props) {
  const focus = focusShopOf(runs)
  const selectedRow = rows.find((r) => r.twin === selectedTwin)
  const twin = runs.twins.find((t) => t.id === selectedTwin)
  const histogram = Object.entries(a.actual?.histogram ?? {}).sort((x, y) => y[1] - x[1])
  const maxWeight = Math.max(1, ...histogram.map(([, v]) => v))
  const live = scenario?.source?.kind === 'user'

  return (
    <aside className="panel">
      <section>
        <h3>day {day}</h3>
        <ul className="rowlist">
          {rows.map((r) => {
            const t = runs.twins.find((tw) => tw.id === r.twin)
            const color = r.choice === 'none' ? undefined : shopColor(runs, r.choice)
            return (
              <li key={r.twin}>
                <button
                  type="button"
                  className={r.twin === selectedTwin ? 'rowbtn active' : 'rowbtn'}
                  onClick={() => onSelectTwin(r.twin === selectedTwin ? null : r.twin)}
                >
                  <b>{t?.name ?? r.twin}</b>
                  <span className={`pill${r.choice === 'none' ? ' none' : ''}`} style={color ? { background: color } : undefined}>
                    {r.choice === 'none' ? 'skipped' : shopName(runs, r.choice)}
                  </span>
                  <span className="muted">
                    {r.llm_failed ? 'fallback' : r.mode === 'reappraisal' ? r.disruption.source : 'autopilot'}
                  </span>
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
            {selectedRow.secondary_driver ? ` + ${selectedRow.secondary_driver}` : ''}
            {shopIds(runs).map((id) => (
              <span key={id}>
                {' '}
                · habit {shopName(runs, id)} {selectedRow.state_after.habit[id]?.toFixed(2) ?? '—'}
              </span>
            ))}
          </p>
        </section>
      )}

      {live && scenario && (
        <section>
          <h3>your plan</h3>
          {scenario.source?.text && <p className="why">“{scenario.source.text}”</p>}
          <ul className="overrides">
            {(scenario.overrides ?? []).map((o, i) => (
              <li key={i}>
                <b>{shopName(runs, o.shop)}</b> from day {o.from_day}:{' '}
                {Object.entries(o.set ?? {})
                  .map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : String(v)}`)
                  .concat((o.unset ?? []).map((k) => `${k} → back to normal`))
                  .join('; ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>what actually happened</h3>
        {!a.complete && (
          <p className="warn">
            Analysis withheld — {a.reason ?? 'incomplete evidence'}. Fallback decisions are not customer behaviour.
          </p>
        )}
        {a.complete && a.break_day == null && (
          <p className="muted">{a.reason ?? 'No day moved far enough from its trailing average.'}</p>
        )}
        {a.complete && a.break_day != null && a.naive && a.actual && (
          <>
            <p className="muted">
              Analyzer output for {shopName(runs, focus)} on the {live ? 'baseline this plan forks' : 'baseline week'}, across{' '}
              {runs.meta.seeds.length} seed{runs.meta.seeds.length === 1 ? '' : 's'}.
            </p>
            <p>
              Sales {a.direction === 'rise' ? 'jumped' : 'broke'} on day {a.break_day},{' '}
              {a.direction === 'rise' ? 'up' : 'down'} {pct(a.magnitude ?? (a.drop == null ? null : Math.abs(a.drop)))}. The
              obvious read is <b>{a.naive.label}</b>
              {a.surprise ? (
                <>
                  , but the simulation attributes it to <b>{a.actual.driver}</b>.
                </>
              ) : (
                <>
                  , and the simulation agrees: <b>{a.actual.driver}</b>.
                </>
              )}
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
              {a.confidence.unmeasured
                ? `confidence unmeasured — ${a.confidence.reason ?? 'not enough seeds'}`
                : `confidence ${pct(a.confidence.value)} (stability ${pct(a.confidence.stability)}, support ${pct(a.confidence.support)})`}
              {a.impact && a.impact.lost_total != null && (
                <>
                  {' '}
                  · {a.impact.lost_by_decision} of {a.impact.lost_total} lost customers are attributable to the change
                  {a.impact.lost_anyway ? `; ${a.impact.lost_anyway} left in the control too` : ''}
                </>
              )}
            </p>
            {a.narration && <p className="narration">{a.narration}</p>}
          </>
        )}
      </section>

      {a.whatif.length > 0 && (
        <section>
          <h3>{live ? 'this plan' : 'what-if'}</h3>
          {a.whatif.map((w) => (
            <div key={w.scenario} className="whatif">
              <b>{w.label}</b>
              <span>
                {w.returns == null ? 'withheld' : `wins back ${w.returns} of ${w.of}`}
                {w.returned.length ? ` (${w.returned.join(', ')})` : ''}
              </span>
              {w.revenue && (
                <span className="money">
                  {w.revenue.delta >= 0 ? '+' : '−'}
                  {vnd(Math.abs(w.revenue.delta_per_day))}/day vs doing nothing
                </span>
              )}
              <em>
                {w.confidence_detail?.unmeasured
                  ? `confidence unmeasured${w.confidence_detail.reason ? ` — ${w.confidence_detail.reason}` : ''}`
                  : `confidence ${pct(w.confidence)}`}
              </em>
            </div>
          ))}
        </section>
      )}

      <p className="synthetic">{runs.meta.synthetic_label}</p>
    </aside>
  )
}
