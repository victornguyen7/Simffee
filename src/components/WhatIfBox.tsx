import { useEffect, useRef, useState } from 'react'
import { health, reviewRun, runScenario, tailorSketch, whatIf } from '../api'
import type { AIReview, Flows, Health, Runs, WhatIfAnswer } from '../types'
import { randomMock, type MockAnswer } from '../mockAnswers'

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
  'Starbucks opens across the street on day 4. I open at 6 and add pastries',
  'add a loyalty card',
]

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`)

const names = (twins: string[]) => (twins.length ? ` (${twins.join(', ')})` : '')
const topDriver = (drivers: Record<string, number>) =>
  Object.entries(drivers).sort((x, y) => y[1] - x[1])[0]?.[0]

/** ROADMAP B3 — who left for whom, who came back, who never moved. */
function FlowsPanel({ flows, shops, entrant, seed }: { flows: Flows; shops: Runs['shops']; entrant: string | null; seed: number }) {
  const name = (id: string) => (id === 'none' ? 'skipping coffee' : shops[id]?.name ?? id)
  const lostTo = Object.entries(flows.totals.lost_to)
  const drivers: Record<string, Record<string, number>> = {}
  for (const d of flows.by_day)
    for (const [o, g] of Object.entries(d.lost_to))
      for (const [k, n] of Object.entries(g.drivers)) (drivers[o] ??= {})[k] = (drivers[o][k] ?? 0) + n
  return (
    <div className="flows">
      <b>Who moved in this what-if</b>
      <em>Days 1–{flows.days} · seed {seed}</em>
      {lostTo.length === 0 && <span>nobody left the shop.</span>}
      {lostTo.map(([o, twins]) => (
        <span key={o} className={o === entrant ? 'flow-entrant' : undefined}>
          {twins.length} {o === 'none' ? 'skipped coffee' : `left for ${name(o)}`} at least once
          {names(twins)}
          {topDriver(drivers[o] ?? {}) ? ` — mostly ${topDriver(drivers[o])}` : ''}
        </span>
      ))}
      {Object.entries(flows.end.gained).map(([origin, twins]) => (
        <span key={origin}>{twins.length} new customers from {name(origin)}{names(twins)}</span>
      ))}
      <span>
        {flows.totals.returned.length} came back{names(flows.totals.returned)} · {flows.end.kept.length} never left
        {names(flows.end.kept)}
      </span>
      <span>Net customers on the final day: {flows.end.net > 0 ? '+' : ''}{flows.end.net} vs day 1</span>
    </div>
  )
}

interface Sketch {
  mock: MockAnswer
  /** 'pending' while the model is rewording it, 'yes' once it has, 'no' if it could not. */
  tailored: 'pending' | 'yes' | 'no'
}

function MockPanel({ mock, tailored }: Sketch) {
  const note = tailored === 'yes' ? 'Illustrative movement sketch, reworded by the model to fit this plan and shop set-up — not a simulated result.'
    : tailored === 'pending' ? 'Illustrative movement sketch — fitting it to your plan…'
    : 'Illustrative movement sketch — the simulation is unavailable, so this is not a simulated result.'
  return (
    <div className="flows">
      <b>{mock.headline}</b>
      <em>{note}</em>
      {mock.movements.map((line) => <span key={line}>{line}</span>)}
      <span>Mostly driven by {mock.drivers.join(' and ')}</span>
      <span>{mock.net}</span>
    </div>
  )
}

export default function WhatIfBox({ runs, onAnswer, current }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [answer, setAnswer] = useState<WhatIfAnswer | null>(null)
  const [mock, setMock] = useState<Sketch | null>(null)
  const [api, setApi] = useState<Health | null | undefined>(undefined)
  const [submittedText, setSubmittedText] = useState('')
  const requestVersion = useRef(0)
  const reviewVersion = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let alive = true
    inFlight.current = false
    const poll = async () => {
      const h = await health()
      if (alive) {
        setApi(h)
        if (!inFlight.current) setBusy(null)
      }
    }
    void poll()
    const id = setInterval(poll, 15_000)
    return () => {
      alive = false
      requestVersion.current += 1
      reviewVersion.current += 1
      clearInterval(id)
    }
  }, [])

  const checkAnswer = async (target: WhatIfAnswer, refresh = false, version = requestVersion.current) => {
    if (!target.run_id || !target.result || target.fallback_used || target.error) return
    const reviewId = ++reviewVersion.current
    const update = (review: AIReview) => setAnswer((prev) =>
      version === requestVersion.current && reviewId === reviewVersion.current
        && prev && prev.run_id === target.run_id && prev.result === target.result ? { ...prev, review } : prev)
    update({ status: 'reviewing', summary: 'Checking the request, plan, and recorded customer movements…', issues: [] })
    try {
      update(await reviewRun(target.run_id, refresh))
    } catch {
      update({ status: 'unavailable', summary: 'AI review unavailable. Restart the backend if it has not loaded the latest code.', issues: [] })
    }
  }

  /** Show a random canned sketch right away, then swap in the model's reworded one if the backend can. */
  const showMock = (query: string, version: number, live: Health | null | undefined = api) => {
    const raw = randomMock()
    if (!live) {
      setMock({ mock: raw, tailored: 'no' })
      return
    }
    setMock({ mock: raw, tailored: 'pending' })
    void tailorSketch(query, raw).then((fitted) => {
      if (version !== requestVersion.current) return
      setMock(fitted ? { mock: fitted, tailored: 'yes' } : { mock: raw, tailored: 'no' })
    })
  }

  const ask = async (q: string, seeds: number[] = [0]) => {
    const query = q.trim()
    if (!query || inFlight.current) return
    let live = api
    if (live === undefined) {
      inFlight.current = true
      setBusy('checking API…')
      live = await health()
      setApi(live)
      inFlight.current = false
    }
    if (!live || !live.llm || live.fresh_runs !== true) {
      setBusy(null)
      const version = ++requestVersion.current
      setSubmittedText(query)
      setAnswer({ scenario: null, request_text: query })
      showMock(query, version, live)
      return
    }
    inFlight.current = true
    const version = ++requestVersion.current
    setSubmittedText(query)
    setAnswer(null)
    setMock(null)
    setBusy(seeds.length > 1 ? `running ${seeds.length} seeds…` : 'translating and running fresh…')
    try {
      const a = await whatIf(query, seeds)
      if (version !== requestVersion.current) return
      setAnswer(a)
      if (a.error) showMock(query, version)
      if (a.result && !a.fallback_used && !a.error) onAnswer(a)
      void checkAnswer(a, true, version)
    } catch {
      if (version === requestVersion.current) {
        setAnswer({ scenario: null, request_text: query })
        showMock(query, version)
      }
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const moreSeeds = async () => {
    const previous = answer
    if (!previous?.scenario || inFlight.current) return
    inFlight.current = true
    const version = ++requestVersion.current
    const seeds = runs.meta.seeds.slice(0, 3)
    setAnswer(null)
    setMock(null)
    setBusy(`running ${seeds.length} seeds for confidence…`)
    try {
      const a = await runScenario(previous.scenario, seeds)
      if (version !== requestVersion.current) return
      const next = { ...a, scenario: a.scenario ?? null, request_text: previous.request_text,
        translation: previous.translation, unsupported: a.unsupported ?? previous.unsupported }
      setAnswer(next)
      if (a.result && !a.fallback_used && !a.error) onAnswer(next)
      void checkAnswer(next, true, version)
      if (a.error) showMock(previous.request_text ?? submittedText, version)
    } catch {
      if (version === requestVersion.current) {
        setAnswer({ scenario: null, request_text: previous.request_text })
        showMock(previous.request_text ?? submittedText, version)
      }
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const offline = api === null
  const a = answer
  const w = a?.analysis?.whatif?.find((item) => item.scenario === (a.run_id ?? a.scenario?.id))
  const flowSeed = a?.flows_seed ?? (a?.seeds?.includes(0) ? 0 : a?.seeds?.[0] ?? 0)
  const flowRun = a?.result?.[String(flowSeed)]
  const flowComplete = flowRun?.coverage?.complete && flowRun.rows.every((row) => !row.llm_failed)
  const answerFlows = a?.flows !== undefined ? a.flows
    : w?.flows ?? (a?.scenario?.parent === null ? a.analysis?.flows : undefined)
  const onlyOfflineCacheMisses = Object.keys(a?.fallback_reasons ?? {}).length === 1
    && (a?.fallback_reasons?.['offline, not cached'] ?? 0) > 0
  const isShown = !!current && !!a?.run_id && current.run_id === a.run_id

  return (
    <section className="whatif-box">
      <div className="whatif-head">
        <h3>what if we…</h3>
        <span
          className={`dot ${api === undefined ? 'unknown' : offline ? 'off' : api.llm ? 'on' : 'cached'}`}
          title={api?.translator_model ? `Decisions: ${api.model}; translation: ${api.translator_model}; reasoning: ${api.reasoning_effort ?? 'model default'}` : undefined}
        >
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
          disabled={!!busy}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="chip play" disabled={!!busy || !text.trim()}>
          {busy ? '…' : 'simulate fresh'}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip small"
            disabled={!!busy}
            onClick={() => {
              setText(ex)
              void ask(ex)
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <p className="muted">New submissions run fresh and may use additional model calls. Identical plans can still produce the same behavior.</p>
      {busy && <p className="muted">{busy} — previous output has been cleared.</p>}

      {a && !busy && (
        <div className="answer">
          <p className="muted">Result for: “{a.request_text ?? submittedText}”{a.fresh && !a.error ? ' · fresh run' : ''}</p>
          {a.error && !mock && <p className="warn">{a.error}</p>}
          {mock && <MockPanel {...mock} />}

          {a.scenario === null && !a.error && !mock && (
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
              {a.reason === 'timeout'
                ? 'This simulation is still running in the background. No completed result is available for this request yet.'
                : `No new result is available (${a.reason ?? 'run unavailable'}).`}
              {' '}A previous or cached scenario has not been substituted.
            </p>
          )}

          {a.warning && !onlyOfflineCacheMisses && <p className="warn">{a.warning}</p>}

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
          {a.result && !a.fallback_used && (
            flowComplete && answerFlows && answerFlows.totals.fallback_moves === 0 ? (
              <FlowsPanel
                flows={answerFlows}
                shops={runs.shops}
                entrant={a.analysis?.question?.entrant?.shop ?? null}
                seed={flowSeed}
              />
            ) : (
              <p className="muted">{a.flows_reason ?? 'Movement summary unavailable: a complete what-if trajectory is required; fallback choices are not customer behavior.'}</p>
            )
          )}

          {a.review && (
            <section className="flows">
              <b>Independent AI review{a.review.cached ? ' · cached' : ''}</b>
              <span className={a.review.status === 'needs_attention' ? 'warn' : undefined}>{a.review.summary}</span>
              {a.review.issues.length > 0 && <ul>{a.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
              <em>{a.review.model ? `${a.review.model} · ` : ''}Sanity check only; recorded decisions and computed counts are unchanged.</em>
              <button
                type="button"
                className="chip small"
                disabled={!!busy || a.review.status === 'reviewing'}
                onClick={() => void checkAnswer(a, true)}
              >
                {a.review.status === 'reviewing' ? 'reviewing…' : 'recheck with AI (fresh call)'}
              </button>
            </section>
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
