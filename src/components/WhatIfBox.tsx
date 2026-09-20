import { useEffect, useState } from 'react'
import { health, runScenario, whatIf } from '../api'
import type { Health, Runs, WhatIfAnswer } from '../types'

interface Props {
  runs: Runs
  /** Called with a finished live answer so the town can play it. */
  onAnswer: (answer: WhatIfAnswer) => void
  /** The answer currently shown in the town, if any. */
  current: WhatIfAnswer | null
}

const EXAMPLES = [
  'open at 6 and add croissants at 30k',
  'cut the latte to 40k but keep the 7am opening',
  'put everything back the way it was',
  'Starbucks raises their latte to 70k',
  'add a loyalty card',
]

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`)

export default function WhatIfBox({ runs, onAnswer, current }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [answer, setAnswer] = useState<WhatIfAnswer | null>(null)
  const [api, setApi] = useState<Health | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      const h = await health()
      if (alive) setApi(h)
    }
    void poll()
    const id = setInterval(poll, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const ask = async (q: string, seeds: number[] = [0]) => {
    const query = q.trim()
    if (!query || busy) return
    setBusy(seeds.length > 1 ? `running ${seeds.length} seeds…` : 'translating and running…')
    try {
      const a = await whatIf(query, seeds)
      setAnswer(a)
      if (a.result && !a.fallback_used) onAnswer(a)
    } catch (e) {
      setAnswer({ scenario: null, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const moreSeeds = async () => {
    if (!answer?.scenario || busy) return
    const seeds = runs.meta.seeds.slice(0, 3)
    setBusy(`running ${seeds.length} seeds for confidence…`)
    try {
      const a = await runScenario(answer.scenario, seeds)
      const merged = { ...answer, ...a, translation: answer.translation, unsupported: answer.unsupported }
      setAnswer(merged)
      if (a.result && !a.fallback_used) onAnswer(merged)
    } catch (e) {
      setAnswer({ ...answer, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const offline = api === null
  const a = answer
  const w = a?.analysis?.whatif?.[0]
  const isShown = !!current && !!a?.run_id && current.run_id === a.run_id

  return (
    <section className="whatif-box">
      <div className="whatif-head">
        <h3>what if we…</h3>
        <span className={`dot ${api === undefined ? 'unknown' : offline ? 'off' : api.llm ? 'on' : 'cached'}`}>
          {api === undefined
            ? 'checking the local API'
            : offline
              ? 'local API not running — cached scenarios only'
              : api.llm
                ? `live · ${api.model}`
                : 'API up, model offline — cached decisions only'}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <input
          type="text"
          value={text}
          placeholder="describe your plan in a sentence"
          disabled={offline || !!busy}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="chip play" disabled={offline || !!busy || !text.trim()}>
          {busy ? '…' : 'simulate'}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip small"
            disabled={offline || !!busy}
            onClick={() => {
              setText(ex)
              void ask(ex)
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {busy && <p className="muted">{busy} — every reappraisal is one model call, paced ~2 s.</p>}

      {a && !busy && (
        <div className="answer">
          {a.error && <p className="warn">{a.error}</p>}

          {a.scenario === null && !a.error && (
            <div className="unsupported">
              <b>Can't simulate that yet.</b>
              {(a.unsupported ?? []).map((u, i) => (
                <p key={i}>
                  “{u.text}” — {u.reason}
                  {u.nearest ? ` (nearest: ${u.nearest})` : ''}
                </p>
              ))}
              {(a.problems ?? []).length > 0 && !a.unsupported?.length && (
                <p className="muted">{a.problems?.join('; ')}</p>
              )}
            </div>
          )}

          {a.chip && <p className="sim-chip">{a.chip}</p>}

          {a.fallback_used && (
            <p className="warn">
              Live run unavailable ({a.reason}). Showing the closest cached scenario instead:{' '}
              <b>{a.served?.label}</b>
              {a.served?.whatif && a.served.whatif.returns != null
                ? ` — wins back ${a.served.whatif.returns} of ${a.served.whatif.of}.`
                : '.'}
            </p>
          )}

          {a.warning && <p className="warn">{a.warning}</p>}

          {(a.unsupported ?? []).length > 0 && a.scenario && (
            <p className="muted">
              Not simulated: {(a.unsupported ?? []).map((u) => `“${u.text}” (${u.reason})`).join('; ')}
            </p>
          )}

          {a.analysis && a.analysis.complete && w && (
            <div className="whatif">
              <b>{w.label}</b>
              <span>
                wins back {w.returns} of {w.of}
                {w.returned.length ? ` (${w.returned.join(', ')})` : ''}
              </span>
              {w.revenue && (
                <span className="money">
                  {w.revenue.delta >= 0 ? '+' : '−'}
                  {(Math.abs(w.revenue.delta_per_day) / 1000).toFixed(0)}k/day vs doing nothing
                </span>
              )}
              <em>
                {w.confidence_detail?.unmeasured
                  ? `confidence unmeasured — ${w.confidence_detail.reason ?? '1 seed'}`
                  : `confidence ${pct(w.confidence)}`}
              </em>
            </div>
          )}
          {a.analysis && !a.analysis.complete && !a.fallback_used && (
            <p className="muted">Analysis withheld: {a.analysis.reason}</p>
          )}

          {a.cost && (
            <p className="cost">
              {a.cost.reasoned} decisions reasoned · {a.cost.on_habit} on habit · {a.cost.responses} model calls
              {a.cost.cache_hits ? ` · ${a.cost.cache_hits} cached` : ''}
              {a.took_ms != null ? ` · ${(a.took_ms / 1000).toFixed(1)} s` : ''}
              {a.cost.cost.usd != null
                ? ` · $${a.cost.cost.usd.toFixed(4)}${a.cost.cost.verified ? '' : ' (price unverified)'}`
                : ''}
            </p>
          )}

          {a.run_id && a.result && !a.fallback_used && (
            <div className="answer-actions">
              {isShown ? (
                <span className="muted">playing in the town →</span>
              ) : (
                <button type="button" className="chip" onClick={() => onAnswer(a)}>
                  show in the town
                </button>
              )}
              {(a.seeds?.length ?? 1) < 3 && a.analysis?.complete && (
                <button type="button" className="chip" onClick={() => void moreSeeds()}>
                  run 3 seeds for confidence
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
