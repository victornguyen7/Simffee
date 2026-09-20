import type { Brush } from './IsoTown'
import type { Ground, Prop } from '../town/model'

interface Props {
  brush: Brush
  onBrush: (brush: Brush) => void
  onReset: () => void
}

const GROUNDS: { value: Ground; label: string; swatch: string }[] = [
  { value: 'grass', label: 'grass', swatch: '#7cc36a' },
  { value: 'path', label: 'path', swatch: '#d8bd8d' },
  { value: 'plaza', label: 'plaza', swatch: '#cfc6ba' },
  { value: 'sand', label: 'sand', swatch: '#e8d8a8' },
  { value: 'water', label: 'water', swatch: '#5fb7e6' },
]

const PROPS: { value: Prop; label: string }[] = [
  { value: 'house', label: 'house' },
  { value: 'simffee', label: 'Simffee' },
  { value: 'starbucks', label: 'Starbucks' },
  { value: 'kiosk', label: 'kiosk' },
  { value: 'tree', label: 'tree' },
  { value: 'pine', label: 'pine' },
  { value: 'bush', label: 'bush' },
  { value: 'flowers', label: 'flowers' },
  { value: 'bench', label: 'bench' },
  { value: 'lamp', label: 'lamp' },
  { value: 'fountain', label: 'fountain' },
]

export default function Palette({ brush, onBrush, onReset }: Props) {
  const isActive = (b: Brush) => {
    if (!brush || !b || brush.kind !== b.kind) return false
    if (brush.kind === 'erase' || b.kind === 'erase') return true
    return brush.value === b.value
  }

  return (
    <div className="palette">
      <div className="palette-row">
        <span className="palette-label">ground</span>
        {GROUNDS.map((g) => {
          const b: Brush = { kind: 'ground', value: g.value }
          return (
            <button
              key={g.value}
              type="button"
              className={isActive(b) ? 'chip active' : 'chip'}
              onClick={() => onBrush(isActive(b) ? null : b)}
            >
              <i style={{ background: g.swatch }} />
              {g.label}
            </button>
          )
        })}
      </div>
      <div className="palette-row">
        <span className="palette-label">build</span>
        {PROPS.map((p) => {
          const b: Brush = { kind: 'prop', value: p.value }
          return (
            <button
              key={p.value}
              type="button"
              className={isActive(b) ? 'chip active' : 'chip'}
              onClick={() => onBrush(isActive(b) ? null : b)}
            >
              {p.label}
            </button>
          )
        })}
        <button
          type="button"
          className={brush?.kind === 'erase' ? 'chip active' : 'chip'}
          onClick={() => onBrush(brush?.kind === 'erase' ? null : { kind: 'erase' })}
        >
          erase
        </button>
        <button type="button" className="chip ghost" onClick={onReset}>
          reset town
        </button>
      </div>
      <p className="hint">
        {brush
          ? 'click or drag on the island to build — pick the same tool again to stop'
          : 'drag to pan · scroll to zoom · double-click to recentre · click a twin to follow them · click a shop to step inside'}
      </p>
    </div>
  )
}
