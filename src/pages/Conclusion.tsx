import { useEffect, useState } from 'react'
import './conclusion.css'
import { loadRuns, lowConfidence, twinName, type Analysis, type Runs } from '../sim/runs'

function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function choiceLabel(choice: string): string {
  return choice === 'none' ? 'went without' : choice
}

export default function Conclusion() {
  const [runs, setRuns] = useState<Runs | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadRuns()
      .then((loaded) => alive && setRuns(loaded))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="conclusion">
        <h2>What actually happened</h2>
        <div className="check">{error}</div>
      </div>
    )
  }

  if (!runs) return <div className="conclusion"><p className="dim">Loading the conclusion.</p></div>

  const analysis: Analysis = runs.analysis
  const evidence = analysis.evidence ?? []
  const whatif = analysis.whatif ?? []
  const actual = analysis.actual
  const impact = analysis.impact
  const confidence = analysis.confidence
  const footerLow = lowConfidence(confidence)
  const complete = analysis.complete ?? analysis.break_day != null

  return (
    <div className="conclusion">
      <header className="conclusion__head">
        <h2>What actually happened</h2>
        <div className="check">{runs.meta.synthetic_label}</div>
      </header>

      {!complete || analysis.break_day == null ? (
        <div className="check check--bad">
          {analysis.reason ?? 'This run is not complete yet.'}
        </div>
      ) : (
        <>
          <section className="conclusion__headline">
            <h1>
              Sales broke on day {analysis.break_day}
              {analysis.drop != null && <span> — −{Math.round(analysis.drop * 100)}% vs trailing average</span>}
            </h1>
            {analysis.narration != null && <p className="conclusion__narration">{analysis.narration}</p>}
          </section>

          <section className="conclusion__reading">
            <article className="conclusion__card">
              <h3>The obvious reading</h3>
              {analysis.naive ? (
                <>
                  <strong className="conclusion__driver">{analysis.naive.label}</strong>
                  <p className="dim">{analysis.naive.driver} · {percent(analysis.naive.magnitude)}</p>
                </>
              ) : <p className="dim">No naive reading was recorded.</p>}
            </article>

            <article className="conclusion__card">
              <div className="conclusion__card-head">
                <h3>What the simulation found</h3>
                {analysis.surprise && <span className="conclusion__pill">the obvious reading is wrong</span>}
              </div>
              {actual ? (
                <>
                  <strong className="conclusion__driver">{actual.driver}</strong>
                  <div className="conclusion__bars">
                    {Object.entries(actual.histogram)
                      .sort(([, a], [, b]) => b - a)
                      .map(([driver, value]) => {
                        const max = Math.max(...Object.values(actual.histogram), 1)
                        return (
                          <div className="conclusion__bar-row" key={driver}>
                            <span>{driver}</span>
                            <span className="conclusion__bar-track">
                              <span className="conclusion__bar" style={{ width: `${(value / max) * 100}%` }} />
                            </span>
                            <span>{value}</span>
                          </div>
                        )
                      })}
                  </div>
                </>
              ) : <p className="dim">No actual reading was recorded.</p>}
            </article>
          </section>

          {impact && (
            <section className="conclusion__section">
              <h3>Impact</h3>
              <p className="conclusion__impact">
                {impact.lost_total} customers lost: {impact.lost_by_decision} because of the change, {impact.lost_anyway} would have left anyway
              </p>
              <table className="grid">
                <thead>
                  <tr><th>Twin</th><th>Baseline choice</th><th>Counterfactual</th><th>Attributed</th></tr>
                </thead>
                <tbody>
                  {impact.per_twin.map((row) => (
                    <tr key={row.twin}>
                      <td>{twinName(runs, row.twin)}</td>
                      <td>{choiceLabel(row.baseline)}</td>
                      <td>{choiceLabel(row.cf_null)}</td>
                      <td className={row.attributed ? 'good' : 'bad'}>{row.attributed ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {evidence.length > 0 && (
            <section className="conclusion__section">
              <h3>Evidence</h3>
              <div className="conclusion__evidence">
                {evidence.map((row) => (
                  <article className="conclusion__quote" key={`${row.twin}-${row.day}`}>
                    <div className="conclusion__quote-meta">
                      <strong>{twinName(runs, row.twin)}</strong>
                      <span className="dim">day {row.day}</span>
                    </div>
                    <blockquote>“{row.reasoning}”</blockquote>
                    <p className="dim">
                      {row.primary_driver ?? 'no primary driver'}
                      {row.secondary_driver && ` / ${row.secondary_driver}`} · {row.disruption.source}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {whatif.length > 0 && (
            <section className="conclusion__section">
              <h3>Which fix targets the mechanism</h3>
              <div className="conclusion__whatif">
                {whatif.map((fix, index) => {
                  const low = lowConfidence(fix.confidence_detail)
                  const bestReturns = Math.max(
                    ...whatif
                      .filter((candidate) => !lowConfidence(candidate.confidence_detail))
                      .map((candidate) => candidate.returns),
                    -Infinity,
                  )
                  const best = !low && fix.returns === bestReturns
                  const measured = fix.confidence != null && !fix.confidence_detail.unmeasured
                  return (
                    <article className={`conclusion__card conclusion__whatif-card ${best ? 'is-best' : ''} ${low ? 'is-low' : ''}`} key={fix.scenario || index}>
                      <h4>{fix.label}</h4>
                      <strong className="conclusion__returns">{fix.returns} <span>of {fix.of} come back</span></strong>
                      <ul>
                        {fix.returned.map((id) => <li key={id}>{twinName(runs, id)}</li>)}
                      </ul>
                      {low ? (
                        <p className="dim conclusion__low"><em>low confidence — not actionable</em> · {percent(fix.confidence)}</p>
                      ) : (
                        <p className="dim">Confidence {measured ? percent(fix.confidence) : 'unmeasured'}</p>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <footer className={`conclusion__footer ${footerLow ? 'is-low' : ''}`}>
            <p>
              {footerLow && <><em>low confidence — not actionable</em> · </>}
              {confidence?.unmeasured || confidence?.value == null ? (
                <>Confidence unmeasured{confidence?.reason ? `: ${confidence.reason}` : '.'}</>
              ) : (
                <>
                  Confidence {percent(confidence.value)} across {runs.meta.seeds.length} seeds
                  {confidence.stability != null && ` (stability ${percent(confidence.stability)}`}
                  {confidence.support != null && `, support ${percent(confidence.support)}`}
                  {(confidence.stability != null || confidence.support != null) && ')'}
                </>
              )}
            </p>
            <a
              href="https://github.com/victornguyen7/Simffee/blob/main/PROTOCOL.md"
              target="_blank"
              rel="noreferrer"
            >
              Protocol for replacing twins with real people
            </a>
          </footer>
        </>
      )}
    </div>
  )
}
