import { useEffect, useRef, useState } from 'react'
import { assessMockMovements, health, runScenario, whatIf } from '../api'
import { movementReasons } from '../town/agents'
import { sampleMockMovements, type MockDestination, type MockMovement } from '../town/mockMovements'
import { focusShopOf, otherShopsOf, type Health, type MockAssessment, type Runs, type WhatIfAnswer } from '../types'

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

/** ROADMAP B3 — who left for whom, who came back, who never moved. */
function MovementReasonList({ answer, runs, windowDays, onWindowDays }: {
  answer: WhatIfAnswer
  runs: Runs
  windowDays: 2 | 3
  onWindowDays: (value: 2 | 3) => void
}) {
  const comparison = movementReasons(answer, runs.twins, windowDays)
  const destination = (id: string) => id === 'none' ? 'no coffee stop' : runs.shops[id]?.name ?? id
  return (
    <section className="flows">
      <b>Movement reasons</b>
      <label className="seed">
        Compare
        <select value={windowDays} onChange={(event) => onWindowDays(event.target.value === '2' ? 2 : 3)}>
          <option value={2}>2 days</option>
          <option value={3}>3 days</option>
        </select>
      </label>
      {comparison.available && <em>Days {comparison.startDay}–{comparison.endDay} around your change · seed {comparison.seed}</em>}
      <ul className="movement-reasons">
        {comparison.changes.map((change) => (
          <li key={`${change.twin}-${change.day}`}>
            <b>{runs.twins.find((twin) => twin.id === change.twin)?.name ?? change.twin}</b>
            {' '}— {destination(change.from)} → {destination(change.to)}
            <span className="muted"> (day {change.fromDay} → {change.day})</span>
            <div>{change.driver}: “{change.reason}”</div>
          </li>
        ))}
        {comparison.changes.length === 0 && (
          <li>{!comparison.available || comparison.incomplete
            ? 'No verified movement changes are available for this window.'
            : 'No one changed their coffee destination during these days.'}</li>
        )}
      </ul>
      {comparison.incomplete && <em>Missing or fallback decisions were excluded; this list may be incomplete.</em>}
    </section>
  )
}

function MockMovementList({ movements, runs, windowDays, onWindowDays, disabled }: {
  movements: MockMovement[]
  runs: Runs
  windowDays: 2 | 3
  onWindowDays: (value: 2 | 3) => void
  disabled: boolean
}) {
  const focus = runs.shops[focusShopOf(runs)]?.name ?? 'Your café'
  const competitor = runs.shops[otherShopsOf(runs)[0]]?.name ?? 'Another café'
  const destination = (value: MockDestination) => value === 'none' ? 'no coffee stop' : value === 'focus' ? focus : competitor
  return (
    <section className="flows">
      <b>Demo movement reasons — mock data</b>
      <label className="seed">
        Illustrate
        <select disabled={disabled} value={windowDays} onChange={(event) => onWindowDays(event.target.value === '2' ? 2 : 3)}>
          <option value={2}>2 days</option>
          <option value={3}>3 days</option>
        </select>
      </label>
      <em>Random examples from a pool of 10, not predictions for this request. The town has not been resimulated.</em>
      <ul className="movement-reasons">
        {movements.map((movement) => (
          <li key={movement.id} id={`mock-evidence-${movement.id}`}>
            <span className="muted">[{movement.id}] </span>
            <b>{runs.twins[movement.twinIndex]?.name ?? `Person ${movement.twinIndex + 1}`}</b>
            {' '}— {destination(movement.from)} → {destination(movement.to)}
            <span className="muted"> (illustrative day 1 → day {windowDays})</span>
            <div>“{movement.reason}”</div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function WhatIfBox({ runs, onAnswer, current }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [answer, setAnswer] = useState<WhatIfAnswer | null>(null)
  const [api, setApi] = useState<Health | null | undefined>(undefined)
  const [submittedText, setSubmittedText] = useState('')
  const [windowDays, setWindowDays] = useState<2 | 3>(3)
  const [demoMode, setDemoMode] = useState(true)
  const [mockOutput, setMockOutput] = useState<MockMovement[] | null>(null)
  const [mockAdvice, setMockAdvice] = useState<MockAssessment | null>(null)
  const [mockAdviceError, setMockAdviceError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    if (demoMode) return
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
      clearInterval(id)
    }
  }, [demoMode])

  const assessSample = async (query: string, sample: MockMovement[], days: 2 | 3, refresh = false) => {
    if (inFlight.current) return
    inFlight.current = true
    const version = ++requestVersion.current
    setMockAdvice(null)
    setMockAdviceError(null)
    setBusy('AI is assessing the displayed mock movements…')
    try {
      const assessment = await assessMockMovements({
        text: query,
        days,
        focus_shop: runs.shops[focusShopOf(runs)]?.name ?? 'Your café',
        competitor_shop: runs.shops[otherShopsOf(runs)[0]]?.name ?? 'Another café',
        movements: sample.map((movement) => ({ ...movement,
          person: runs.twins[movement.twinIndex]?.name ?? `Person ${movement.twinIndex + 1}` })),
        refresh,
      })
      if (version === requestVersion.current) setMockAdvice(assessment)
    } catch (error) {
      if (version === requestVersion.current) {
        setMockAdviceError(error instanceof Error && error.name !== 'TypeError'
          ? error.message : 'Cannot reach the AI backend. Start it on port 8765 and retry; the mock examples remain available.')
      }
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const shuffleAndAssess = () => {
    if (inFlight.current) return
    const sample = sampleMockMovements()
    setMockOutput(sample)
    void assessSample(submittedText, sample, windowDays)
  }

  const changeMockWindow = (days: 2 | 3) => {
    requestVersion.current += 1
    setWindowDays(days)
    setMockAdvice(null)
    setMockAdviceError(null)
  }

  const ask = async (q: string, seeds: number[] = [0]) => {
    const query = q.trim()
    if (!query || inFlight.current) return
    if (demoMode) {
      const sample = sampleMockMovements()
      setSubmittedText(query)
      setAnswer(null)
      setMockOutput(sample)
      void assessSample(query, sample, windowDays)
      return
    }
    if (api && api.fresh_runs !== true) {
      requestVersion.current += 1
      setSubmittedText(query)
      setAnswer({ scenario: null, request_text: query,
        error: 'Restart the backend to load fresh-run support; the running server still has the previous code.' })
      return
    }
    inFlight.current = true
    const version = ++requestVersion.current
    setSubmittedText(query)
    setAnswer(null)
    setBusy(seeds.length > 1 ? `running ${seeds.length} seeds…` : 'translating and running fresh…')
    try {
      const a = await whatIf(query, seeds)
      if (version !== requestVersion.current) return
      setAnswer(a)
      if (a.result && !a.fallback_used && !a.error) onAnswer(a)
    } catch (e) {
      if (version === requestVersion.current) {
        setAnswer({ scenario: null, request_text: query, error: e instanceof Error ? e.message : String(e) })
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
    setBusy(`running ${seeds.length} seeds for confidence…`)
    try {
      const a = await runScenario(previous.scenario, seeds)
      if (version !== requestVersion.current) return
      const next = { ...a, scenario: a.scenario ?? null, request_text: previous.request_text,
        translation: previous.translation, unsupported: a.unsupported ?? previous.unsupported }
      setAnswer(next)
      if (a.result && !a.fallback_used && !a.error) onAnswer(next)
    } catch (e) {
      if (version === requestVersion.current) {
        setAnswer({ scenario: null, request_text: previous.request_text, error: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const offline = api === null
  const formDisabled = (!demoMode && !api) || !!busy
  const a = answer
  const onlyOfflineCacheMisses = Object.keys(a?.fallback_reasons ?? {}).length === 1
    && (a?.fallback_reasons?.['offline, not cached'] ?? 0) > 0
  const isShown = !!current && !!a?.run_id && current.run_id === a.run_id

  return (
    <section className="whatif-box">
      <div className="whatif-head">
        <h3>what if we…</h3>
        <span
          className={`dot ${demoMode ? 'cached' : api === undefined ? 'unknown' : offline ? 'off' : api.llm ? 'on' : 'cached'}`}
          title={demoMode ? 'Mock movements appear instantly; AI advice is requested from the backend for the displayed sample.' : api?.translator_model ? `Decisions: ${api.model}; translation: ${api.translator_model}; reasoning: ${api.reasoning_effort ?? 'model default'}` : undefined}
        >
          {demoMode
            ? 'mock data + AI advice'
            : api === undefined
            ? 'checking the local API'
            : offline
              ? 'local API not running — cached scenarios only'
              : api.llm
                ? `live · ${api.model}`
                : 'API up, model offline — cached decisions only'}
        </span>
      </div>

      <label className="seed">
        Output mode
        <select
          value={demoMode ? 'mock' : 'live'}
          disabled={!!busy}
          onChange={(event) => {
            requestVersion.current += 1
            setDemoMode(event.target.value === 'mock')
            setAnswer(null)
            setMockOutput(null)
            setMockAdvice(null)
            setMockAdviceError(null)
            setApi(undefined)
          }}
        >
          <option value="mock">Mock movements + AI advice</option>
          <option value="live">Real simulation</option>
        </select>
      </label>

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
          maxLength={4000}
          disabled={formDisabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="chip play" disabled={formDisabled || !text.trim()}>
          {busy ? '…' : demoMode ? 'show movements + AI advice' : 'simulate fresh'}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip small"
            disabled={formDisabled}
            onClick={() => {
              setText(ex)
              void ask(ex)
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <p className="muted">{demoMode
        ? 'Demo: 5 random mock movements appear immediately, followed by one AI assessment with suggested actions. Advice needs the backend; no simulation is run.'
        : 'New submissions run fresh and may use additional model calls. Identical plans can still produce the same behavior.'}</p>
      {busy && <p className="muted" role="status">{busy}{demoMode ? ' The examples remain visible below.' : ' Previous output has been cleared.'}</p>}

      {demoMode && mockOutput && (
        <div className="answer">
          <p className="muted">Request: “{submittedText}” · random mock examples, not a computed outcome</p>
          <MockMovementList movements={mockOutput} runs={runs} windowDays={windowDays} onWindowDays={changeMockWindow} disabled={!!busy} />
          {mockAdviceError && <p className="warn" role="alert">{mockAdviceError}</p>}
          {mockAdvice && (
            <section className="flows" aria-live="polite">
              <b>AI advice based on mock data{mockAdvice.cached ? ' · cached for this exact sample' : ''}</b>
              <p>{mockAdvice.assessment}</p>
              {mockAdvice.recommendations.length > 0 && (
                <ol className="movement-reasons">
                  {mockAdvice.recommendations.map((recommendation, index) => (
                    <li key={`${mockAdvice.sample_id}-${index}`}>
                      <b>{recommendation.action}</b>
                      <div>{recommendation.why}</div>
                      <div className="muted">Tradeoff / validation: {recommendation.tradeoff}</div>
                      <div>
                        Supporting mock examples:{' '}
                        {recommendation.evidence_ids.map((id) => (
                          <a key={id} href={`#mock-evidence-${id}`}>[{id}] </a>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <em>{mockAdvice.limitations}</em>
              <em>Illustrative suggestions, not a validated prediction. {mockAdvice.model}</em>
            </section>
          )}
          <div className="answer-actions">
            <button type="button" className="chip small" disabled={!!busy} onClick={shuffleAndAssess}>
              shuffle + get AI advice
            </button>
            <button type="button" className="chip small" disabled={!!busy}
              onClick={() => void assessSample(submittedText, mockOutput, windowDays, true)}>
              {mockAdvice ? 'reassess this sample (fresh AI call)' : 'get AI advice for this sample'}
            </button>
          </div>
        </div>
      )}

      {!demoMode && a && !busy && (
        <div className="answer">
          <p className="muted">Result for: “{a.request_text ?? submittedText}”{a.fresh ? ' · fresh run' : ''}</p>
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

          {a.result && !a.fallback_used && !a.error && (
            <MovementReasonList answer={a} runs={runs} windowDays={windowDays} onWindowDays={setWindowDays} />
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
