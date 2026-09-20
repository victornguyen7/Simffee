import { shopColor, shopIds, shopName } from '../shops'
import type { Runs } from '../types'

interface Props {
  runs: Runs
  scenario: string
  seed: number
  day: number
  days: number
  seeds: number[]
  playing: boolean
  sales: Record<string, number>
  onScenario: (s: string) => void
  onSeed: (s: number) => void
  onDay: (d: number) => void
  onPlaying: (p: boolean) => void
}

const vnd = (n: number) => `${(n / 1000).toFixed(0)}k`

export default function Controls({
  runs,
  scenario,
  seed,
  day,
  days,
  seeds,
  playing,
  sales,
  onScenario,
  onSeed,
  onDay,
  onPlaying,
}: Props) {
  const breakDay = runs.analysis.break_day
  const library = Object.entries(runs.scenarios).filter(([, s]) => s.source?.kind !== 'user')
  const live = Object.entries(runs.scenarios).filter(([, s]) => s.source?.kind === 'user')
  return (
    <div className="controls">
      <div className="control-group">
        {library.map(([id, s]) => (
          <button
            key={id}
            type="button"
            className={id === scenario ? 'chip active' : 'chip'}
            title={s.role ? `${s.role}${s.parent ? ` · forks ${s.parent} on day ${s.from_day}` : ''}` : undefined}
            onClick={() => onScenario(id)}
          >
            {s.label}
          </button>
        ))}
        {live.length > 0 && <span className="muted sep">live</span>}
        {live.map(([id, s]) => (
          <button
            key={id}
            type="button"
            className={id === scenario ? 'chip live active' : 'chip live'}
            title={s.source?.text}
            onClick={() => onScenario(id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="control-group">
        <button type="button" className="chip play" onClick={() => onPlaying(!playing)}>
          {playing ? '❚❚ pause' : '▶ play week'}
        </button>
        <div className="days">
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              type="button"
              className={`day${d === day ? ' active' : ''}${d === breakDay ? ' break' : ''}`}
              onClick={() => onDay(d)}
              title={d === breakDay ? 'the day sales broke' : `day ${d}`}
            >
              {d}
            </button>
          ))}
        </div>
        <label className="seed">
          seed
          <select value={seed} onChange={(e) => onSeed(Number(e.target.value))}>
            {seeds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="control-group sales">
        {shopIds(runs).map((id) => (
          <span key={id} className="sale" style={{ background: shopColor(runs, id) }}>
            {shopName(runs, id)} {vnd(sales[id] ?? 0)}
          </span>
        ))}
      </div>
    </div>
  )
}
