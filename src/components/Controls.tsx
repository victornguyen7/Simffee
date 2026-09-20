import type { Runs } from '../types'

interface Props {
  runs: Runs
  scenario: string
  seed: number
  day: number
  playing: boolean
  sales: { simffee: number; starbucks: number }
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
  playing,
  sales,
  onScenario,
  onSeed,
  onDay,
  onPlaying,
}: Props) {
  const breakDay = runs.analysis.break_day
  return (
    <div className="controls">
      <div className="control-group">
        {Object.entries(runs.scenarios).map(([id, s]) => (
          <button
            key={id}
            type="button"
            className={id === scenario ? 'chip active' : 'chip'}
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
          {Array.from({ length: runs.meta.days }, (_, i) => i + 1).map((d) => (
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
            {runs.meta.seeds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="control-group sales">
        <span className="sale simffee">Simffee {vnd(sales.simffee)}</span>
        <span className="sale starbucks">Starbucks {vnd(sales.starbucks)}</span>
      </div>
    </div>
  )
}
