import { memo, useEffect, useId, useMemo, useRef } from 'react'
import { shopName } from '../shops'
import type { Runs } from '../types'
import { customerSeries, customerSources, decisionRoutes, historyShares, layerValue, strongestShop } from '../town/customerLayers'

interface Props {
  runs: Runs
  scenarioId: string
  seed: number
  day: number
  selectedTwin: string | null
  onSelectTwin: (id: string) => void
  onSelectDay: (day: number) => void
  onClose: () => void
}

const EMPTY_ROWS: [] = []
const score = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
const WIDTH = 840
const HEIGHT = 230
const LEFT = 42
const RIGHT = 818
const TOP = 18
const BOTTOM = 192

export default memo(function CustomerLayersGraph({ runs, scenarioId, seed, day, selectedTwin, onSelectTwin, onSelectDay, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const chartId = useId()
  const twin = runs.twins.find((person) => person.id === selectedTwin) ?? runs.twins[0]
  const scenario = runs.scenarios[scenarioId]
  const days = scenario?.days ?? runs.meta.days
  const rows = scenario?.seeds[String(seed)]?.rows ?? EMPTY_ROWS
  const series = useMemo(() => customerSeries(rows, twin?.id ?? '', days), [rows, twin?.id, days])
  const authored = twin ? customerSources[twin.id] : undefined
  const source = authored?.name === twin?.name ? authored : undefined
  const shares = useMemo(() => historyShares(source), [source])
  const selected = series.points.find((point) => point.day === day)
  const route = selected?.route ?? 'unknown'
  const regularToday = strongestShop(selected?.row?.state_before?.habit)
  const alternativeToday = strongestShop(selected?.row?.state_before?.latent_interest, regularToday)
  const firstFallback = series.points.find((point) => point.route === 'fallback')?.day
  const x = (d: number) => days > 1 ? LEFT + (d - 1) * (RIGHT - LEFT) / (days - 1) : (LEFT + RIGHT) / 2
  const y = (value: number) => BOTTOM - value * (BOTTOM - TOP)
  const label = (id?: string) => id ? shopName(runs, id) : 'not available'
  const path = (key: 'habit' | 'interest') => {
    let connected = false
    return series.points.map((point) => {
      const value = point[key]
      if (value === null) {
        connected = false
        return ''
      }
      const command = `${connected ? 'L' : 'M'}${x(point.day)},${y(value)}`
      connected = true
      return command
    }).join(' ')
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  if (!twin) return null

  return (
    <dialog ref={dialogRef} className="customer-graph-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header className="customer-graph-header">
        <div>
          <h2 id={titleId}>How a customer is built</h2>
          <p className="muted">Two input layers → customer state → selective LLM use</p>
        </div>
        <button type="button" className="chip" onClick={onClose}>Back to town</button>
      </header>

      <div className="customer-graph-controls">
        <label className="seed">Customer
          <select value={twin.id} onChange={(event) => onSelectTwin(event.target.value)}>
            {runs.twins.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <span className="muted">{scenario?.label ?? scenarioId} · seed {seed} · day {day}</span>
      </div>
      <p className="customer-graph-note">Synthetic persona and saved simulation rows—not the random mock examples in the what-if panel. Opening this graph makes no AI calls.</p>

      <div className="customer-input-layers">
        <article className="customer-input-card behavior-layer">
          <h3>Layer 1 · What they did</h3>
          <p>Behavior history: where, when, and how much.</p>
          {source ? (
            <>
              <p className="muted">{source.what_log.length} authored daily records</p>
              <ul className="customer-history-bars">
                {shares.map((share) => (
                  <li key={share.shop}>
                    <span>{share.shop === 'none' ? 'No coffee stop' : label(share.shop)}</span>
                    <span className="customer-history-track"><i style={{ width: `${share.share * 100}%` }} /></span>
                    <span>{share.count}/{source.what_log.length}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="muted">Original behavior log is not available for this customer.</p>}
          <p>{twin.profile.usual_time} · usual order: {twin.profile.usual_order.replaceAll('_', ' ')}</p>
          <div className="customer-derived">Visit share → starting habit strength</div>
        </article>
        <article className="customer-input-card motivation-layer">
          <h3>Layer 2 · Why they did it</h3>
          <p>Interview: motivations, curiosity, and tolerance.</p>
          <dl className="customer-traits">
            <div><dt>Disruption threshold</dt><dd>{score(source?.mechanism.disruption_threshold)}</dd></div>
            <div><dt>Ad sensitivity</dt><dd>{score(source?.mechanism.ad_sensitivity)}</dd></div>
          </dl>
          <details>
            <summary>Read the interview evidence</summary>
            {(source?.why_transcript ?? twin.why_excerpt).map((line, index) => (
              <blockquote key={index}><b>{line.q}</b><br />“{line.a}”</blockquote>
            ))}
          </details>
          <div className="customer-derived">Motivation → latent interest + personal thresholds</div>
        </article>
      </div>
      <p className="customer-graph-note">These are authored inputs, not fitted regression coefficients. Scenario setup can mask shops that do not exist; the chart below uses the resulting run state.</p>

      <section className="customer-state-chart">
        <h3>How the two state variables evolve</h3>
        <div className="customer-chart-legend">
          <span><i className="habit-key" />Habit at initial regular: {label(series.regular)}</span>
          <span><i className="interest-key" />Interest in alternative: {label(series.alternative)}</span>
          <span>Dashed gray line: habit gate 0.60</span>
        </div>
        {series.recordedDays > 0 ? (
          <div className="customer-chart-scroll">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={chartId}>
              <title id={chartId}>{`Habit and latent interest before each daily decision for ${twin.name}. Scores range from zero to one, not predicted probabilities.`}</title>
              {firstFallback !== undefined && (
                <rect x={x(firstFallback)} y={TOP} width={Math.max(2, RIGHT - x(firstFallback))} height={BOTTOM - TOP} fill="#fbe9e7" />
              )}
              <rect x={x(day) - 4} y={TOP} width="8" height={BOTTOM - TOP} fill="#d8e3ec" />
              {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                <g key={value}>
                  <line x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)} stroke="#e2dcd2" />
                  <text x={LEFT - 8} y={y(value) + 4} textAnchor="end">{value}</text>
                </g>
              ))}
              <line x1={LEFT} x2={RIGHT} y1={y(0.6)} y2={y(0.6)} stroke="#888078" strokeDasharray="4 5" />
              <path d={path('habit')} fill="none" stroke="#2f7d6d" strokeWidth="3" />
              <path d={path('interest')} fill="none" stroke="#7851a9" strokeWidth="3" strokeDasharray="7 4" />
              {series.points.map((point) => (
                <g key={point.day}>
                  {point.habit !== null && <circle cx={x(point.day)} cy={y(point.habit)} r="4" fill="#2f7d6d"><title>{`Day ${point.day}: habit ${score(point.habit)}`}</title></circle>}
                  {point.interest !== null && <circle cx={x(point.day)} cy={y(point.interest)} r="4" fill="#7851a9"><title>{`Day ${point.day}: interest ${score(point.interest)}`}</title></circle>}
                  {(days <= 14 || point.day === 1 || point.day === days || point.day === day) &&
                    <text x={x(point.day)} y={BOTTOM + 22} textAnchor="middle">Day {point.day}</text>}
                </g>
              ))}
            </svg>
          </div>
        ) : <p className="muted">No recorded trajectory is available for this customer and seed.</p>}
        <p className="customer-graph-note">Values are recorded before each day's decision. Missing values are gaps, not zeros. These scores are mechanism state, not a trained prediction.</p>
        {firstFallback !== undefined && <p className="customer-diagnostic">Fallback on day {firstFallback}: later state can be influenced by that fallback. The shaded region is diagnostic, not reliable behavioral evidence.</p>}
        <div className="customer-day-routes" aria-label="Daily decision routes">
          {series.points.map((point) => (
            <button key={point.day} type="button" className={`customer-day-route ${point.day === day ? 'selected' : ''}`}
              aria-pressed={point.day === day} onClick={() => onSelectDay(point.day)}
              title={`Day ${point.day}: ${decisionRoutes[point.route].label}`}>
              <i style={{ background: decisionRoutes[point.route].color }} />
              Day {point.day}<small>{point.route === 'model' ? 'model / cache' : point.route}</small>
            </button>
          ))}
        </div>
        <p><b>Day {day}: {decisionRoutes[route].label}.</b> {selected?.row
          ? `${selected.row.choice === 'none' ? 'No coffee stop' : label(selected.row.choice)} — ${selected.row.reasoning}`
          : 'No recorded decision.'}</p>
        <p className="customer-graph-note">Regular today: {label(regularToday)} · habit {score(layerValue(selected?.row, 'habit', regularToday))} · disruption {score(selected?.row?.disruption.score)} · strongest alternative interest {score(layerValue(selected?.row, 'latent_interest', alternativeToday))}</p>
      </section>

      <section className="customer-call-routing">
        <h3>How we avoid asking the LLM every day</h3>
        <ol className="customer-pipeline">
          <li><b>Update state with arithmetic</b><span>Visits reinforce habit; absence decays it. Marketing and neighbor reports update interest.</span></li>
          <li><b>Apply the habit gate</b><span>Habit ≥ 0.60, disruption ≤ personal threshold, and no alternative interest above habit + 0.30 → autopilot, no LLM.</span></li>
          <li><b>Reappraise only when the gate breaks</b><span>Try the deterministic skip rule, then an exact decision-cache lookup. Only an uncached, unresolved decision needs the LLM.</span></li>
          <li><b>Feed the choice back into state</b><span>Update habit and tomorrow's word of mouth using local arithmetic, not another model call.</span></li>
        </ol>
        <div className="customer-route-counts">
          <div><strong>{series.localDecisions}</strong><span>days resolved by autopilot / rules</span></div>
          <div><strong>{series.counts.model}</strong><span>model-informed days (live or cached)</span></div>
          <div><strong>{series.counts.fallback + series.counts.unknown}</strong><span>fallback / unverified / missing days</span></div>
        </div>
        <p className="customer-graph-note">Counts describe the selected customer's {days}-day route, not billed API requests. Cached replies, retries and inherited days prevent inferring actual calls from rows. Translation and AI advice are separate calls. Fallbacks are not counted as successful savings.</p>
        <details>
          <summary>The cheap update is arithmetic—not linear regression</summary>
          <p><code>visited: h′ = h + 0.15 × (1 − h)</code><br /><code>not visited: h′ = 0.95 × h</code></p>
          <p>No regression weights are fitted by these rules.</p>
        </details>
      </section>

      <section className="customer-planned">
        <span className="customer-planned-badge">Planned · not implemented</span>
        <h3>Optional next step: learned choice classifier</h3>
        <p>LLM decision examples → train and validate a small logistic-regression model → use it for confident, familiar cases → retain LLM review for uncertain cases.</p>
        <p className="customer-graph-note">Café choice is categorical, so logistic regression fits this purpose better than ordinary linear regression. No classifier is trained or running here, and no regression-based savings are claimed.</p>
      </section>
    </dialog>
  )
})
