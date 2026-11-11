import { useEffect, useRef, useState } from 'react'
import { health, reviewRun, runScenario, runStatus, tailorSketch, whatIf } from '../api'
import { focusShopOf, type AIReview, type Flows, type Health, type Runs, type WhatIfAnswer } from '../types'
import { pickMock, SHORTLIST, type MockAnswer, type Picked } from '../mockAnswers'

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

/** How often a timed-out run is checked, and how many failed checks in a row end the wait. */
const POLL_MS = 5_000
const POLL_MISSES = 3

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
  picked: Picked
}

function MockPanel({ mock, tailored, picked }: Sketch) {
  const note = tailored === 'yes' ? 'Illustrative movement sketch, reworded by the model to fit this plan and shop set-up — not a simulated result.'
    : tailored === 'pending' ? 'Illustrative movement sketch — fitting it to your plan…'
    : 'Illustrative movement sketch — the simulation is unavailable, so this is not a simulated result.'
  const how = picked.shortlisted
    ? `best of ${picked.shortlisted} sketches (of ${picked.poolSize}) at ≥70% match to this plan and set-up · ${Math.round(picked.relevance * 100)}% match`
    : `nothing in the ${picked.poolSize}-sketch pool matched this plan at 70%; showing one of the ${SHORTLIST} closest`
  return (
    <div className="flows">
      <b>{mock.headline}</b>
      <em>{note}</em>
      <em>{how}</em>
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
  const [poll, setPoll] = useState<{ runId: string; checks: number } | null>(null)
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

  /** Pick the most relevant unseen sketch right away, then swap in the model's reworded one if the backend can. */
  const showMock = (query: string, version: number, live: Health | null | undefined = api) => {
    void pickMock(query, { focus: focusShopOf(runs), shops: runs.shops })
      .then((picked) => {
        if (version !== requestVersion.current) return
        const raw = picked.mock
        if (!live) {
          setMock({ mock: raw, tailored: 'no', picked })
          return
        }
        setMock({ mock: raw, tailored: 'pending', picked })
        void tailorSketch(query, raw).then((fitted) => {
          if (version !== requestVersion.current) return
          setMock(fitted ? { mock: fitted, tailored: 'yes', picked } : { mock: raw, tailored: 'no', picked })
        })
      })
      .catch(() => {
        // The sketch pool failed to load: the answer area falls back to "Can't simulate that yet."
        if (version === requestVersion.current) setMock(null)
      })
  }

  // AUDIT_FIX_PLAN #5: a request that outlives the server's --timeout answers with
  // pending_run_id while the run carries on. Keep asking for it and swap the answer in.
  const pendingId = answer?.fallback_used && answer.reason === 'timeout' ? answer.pending_run_id : undefined
  useEffect(() => {
    if (!pendingId || !answer) return
    const base = answer
    const version = requestVersion.current
    const context = { request_text: base.request_text, translation: base.translation, fresh: base.fresh }
    let alive = true
    const current = () => alive && version === requestVersion.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let checks = 0
    let misses = 0
    const finish = (next: WhatIfAnswer) => {
      setPoll(null)
      setAnswer(next)
    }
    const tick = async () => {
      const s = await runStatus(pendingId)
      if (!current()) return
      checks += 1
      misses = s.status === 'unreachable' ? misses + 1 : 0
      if (s.status === 'running' || (s.status === 'unreachable' && misses < POLL_MISSES)) {
        setPoll({ runId: pendingId, checks })
        timer = setTimeout(() => void tick(), POLL_MS)
        return
      }
      if (s.status === 'done') {
        const next: WhatIfAnswer = { ...s, ...context, unsupported: s.unsupported ?? base.unsupported }
        finish(next)
        if (next.result) onAnswer(next)
        return
      }
      if (s.status === 'failed') {
        finish({ ...base, ...s, ...context, fallback_used: false })
        showMock(base.request_text ?? '', version)
        return
      }
      finish({
        ...base,
        fallback_used: false,
        error: s.status === 'recorded'
          ? 'This run finished, but the API has restarted since, so its result is no longer available. Ask again to re-run it.'
          : s.status === 'unknown'
            ? 'The API restarted before this run finished. Ask again to re-run it.'
            : 'The local API stopped responding while this run was in progress.',
      })
    }
    timer = setTimeout(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // Restart only when a different run starts pending; `answer` is captured as its base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId])

  const ask = async (q: string, seeds: number[] = [0], fresh = false) => {
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
    setBusy(seeds.length > 1 ? `running ${seeds.length} seeds…`
      : fresh ? 'translating and running fresh…' : 'running (reusing cached answers where they exist)…')
    try {
      const a = await whatIf(query, seeds, 'baseline', fresh)
      if (version !== requestVersion.current) return
      setAnswer(a)
      if (a.error) showMock(query, version)
      if (a.result && !a.fallback_used && !a.error) onAnswer(a)
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
    // Forks need a library run per seed: use the seeds the server has, not the static bundle's.
    const seeds = (api?.library_seeds?.length ? api.library_seeds : runs.meta.seeds).slice(0, 3)
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
          title={api?.translator_model ? `Decisions: ${api.model}; translation: ${api.translator_model}; reasoning: ${api.reasoning_effort ?? 'model default'}${api.fallback_model ? `; fallback when Groq is out of tokens: ${api.fallback_model}` : ''}` : undefined}
        >
          {api === undefined
            ? 'checking the local API'
            : offline
              ? 'local API not running — illustrative sketches only'
              : api.llm
                ? api.fallback_active && api.fallback_model
                  ? `live · ${api.fallback_model} (Groq out of tokens)`
                  : `live · ${api.model}`
                : api.offline
                  ? 'API in offline mode — illustrative sketches only'
                  : 'API up, no model key — illustrative sketches only (set GROQ_API_KEY to simulate)'}
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
          {busy ? '…' : 'simulate'}
        </button>
        <button
          type="button"
          className="chip"
          disabled={!!busy || !text.trim()}
          title="Ignore cached answers: new translation and new model calls"
          onClick={() => void ask(text, [0], true)}
        >
          simulate fresh
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

      <p className="muted">Simulate reuses cached answers, so a question you have asked before comes back in seconds; a new question still needs model calls (a few minutes). Simulate fresh ignores the cache for a new sample.</p>
      {busy && <p className="muted">{busy} — previous output has been cleared.</p>}

      {a && !busy && (
        <div className="answer">
          <p className="muted">Result for: “{a.request_text ?? submittedText}”{a.error ? '' : a.fresh ? ' · fresh run' : a.translation?.cached ? ' · reused cache' : ''}</p>
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
                ? `Still simulating in the background; the result will appear here when it finishes${
                    poll && poll.runId === a.pending_run_id ? ` (checked ${poll.checks}×)` : ''
                  }. A new question will start after this run.`
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
              {(a.models?.length ?? 0) > 1 ? ` · answered by ${a.models?.join(' + ')}` : ''}
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
              {!a.review && !a.error && api?.llm && (
                <button type="button" className="chip" disabled={!!busy} onClick={() => void checkAnswer(a)}>
                  check this run with AI
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
