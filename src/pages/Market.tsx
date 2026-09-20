import { useMemo } from 'react'
import './market.css'
import { AGENTS, SHOPS, runAll, selfTest, type ShopId } from '../sim/engine'

const SHOP_IDS: ShopId[] = ['brewhouse', 'simffee']

export default function Market() {
  const run = useMemo(() => runAll(), [])
  const check = useMemo(() => selfTest(), [])

  const totals = SHOP_IDS.map((id) => ({
    id,
    name: SHOPS.find((s) => s.id === id)?.name ?? id,
    visits: run.days.reduce((sum, d) => sum + d.visits[id], 0),
    revenue: run.days.reduce((sum, d) => sum + d.revenue[id], 0)
  }))

  return (
    <div className="market">
      <header className="market__head">
        <h1 className="market__title">Seven day run</h1>
        <p className={`check check--${check.pass ? 'ok' : 'bad'}`}>
          {check.pass ? 'engine matches the spec worked example' : 'engine does NOT match the spec'}
        </p>
      </header>

      {!check.pass && (
        <pre className="check__details">{check.details.join('\n')}</pre>
      )}

      <section>
        <h2 className="market__h2">Visits and revenue</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Day</th>
              <th>Novelty</th>
              {SHOP_IDS.map((id) => (
                <th key={id}>{id === 'simffee' ? 'Simffee' : 'Brewhouse'}</th>
              ))}
              <th>Mean satisfaction (Simffee)</th>
              <th>Unmet</th>
            </tr>
          </thead>
          <tbody>
            {run.days.map((d) => {
              const sims = d.satisfaction.filter((s) => s.shop === 'simffee')
              const mean = sims.length === 0 ? null : sims.reduce((a, b) => a + b.value, 0) / sims.length
              return (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td className="dim">{d.novelty.simffee.toFixed(3)}</td>
                  {SHOP_IDS.map((id) => (
                    <td key={id}>
                      {d.visits[id]} <span className="dim">${d.revenue[id].toFixed(2)}</span>
                    </td>
                  ))}
                  <td className={mean !== null && mean < 0 ? 'bad' : ''}>
                    {mean === null ? '—' : mean.toFixed(3)}
                  </td>
                  <td className="dim">{d.unmet_demand.length}</td>
                </tr>
              )
            })}
            <tr className="grid__total">
              <td>All</td>
              <td />
              {totals.map((t) => (
                <td key={t.id}>
                  {t.visits} <span className="dim">${t.revenue.toFixed(2)}</span>
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="market__h2">Agent ledger</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Archetype</th>
              <th>Brewhouse</th>
              <th>Simffee</th>
              <th>End loyalty (Simffee)</th>
              <th>End perception (Simffee)</th>
              <th>Won?</th>
            </tr>
          </thead>
          <tbody>
            {AGENTS.map((a) => {
              const brew = run.days.filter((d) =>
                d.choices.some((c) => c.agent_id === a.id && c.chosen === 'brewhouse')
              ).length
              const sim = run.days.filter((d) =>
                d.choices.some((c) => c.agent_id === a.id && c.chosen === 'simffee')
              ).length
              const end = run.finalState[a.id]
              return (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="dim">{a.archetype}</td>
                  <td>{brew}</td>
                  <td className={sim > 0 ? 'good' : 'dim'}>{sim}</td>
                  <td>{end.loyalty.simffee.toFixed(3)}</td>
                  <td>{end.perception.simffee.toFixed(3)}</td>
                  <td>{sim > 0 ? 'yes' : 'never'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
