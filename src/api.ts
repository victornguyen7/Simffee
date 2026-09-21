import type { AIReview, Health, MockAssessment, UserScenario, WhatIfAnswer } from './types'
import type { MockMovement } from './town/mockMovements'

/** Where api/server.py listens. Override with VITE_API_URL for another port. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8765'

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const data = (await r.json()) as T
    return data
  } finally {
    clearTimeout(timer)
  }
}

export async function health(): Promise<Health | null> {
  try {
    const r = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    return (await r.json()) as Health
  } catch {
    return null
  }
}

/** Free text -> translated -> run -> analysed. The server's own timeout (--timeout, default 240s)
 *  falls back to the library; this must outlive it plus translation so the fallback answer arrives. */
export async function whatIf(text: string, seeds: number[], parent = 'baseline'): Promise<WhatIfAnswer> {
  const answer = await post<WhatIfAnswer>('/whatif', { text, seeds, parent, fresh: true }, 300_000)
  if (!answer.error && answer.fresh !== true) {
    throw new Error('The backend is still running the previous version. Restart it to enable fresh what-if runs.')
  }
  return answer
}

/** Re-run an already translated scenario (e.g. with more seeds). No model call for translation. */
export function runScenario(scenario: UserScenario, seeds: number[]): Promise<WhatIfAnswer> {
  return post<WhatIfAnswer>('/run', { scenario, seeds }, 300_000)
}

export async function assessMockMovements(payload: {
  text: string
  days: 2 | 3
  focus_shop: string
  competitor_shop: string
  movements: (MockMovement & { person: string })[]
  refresh?: boolean
}): Promise<MockAssessment> {
  const result = await post<MockAssessment & { error?: string }>('/assess-mock', payload, 240_000)
  if (result.error || result.data_source !== 'mock' || !['ready', 'unavailable'].includes(result.status)
    || typeof result.assessment !== 'string' || typeof result.limitations !== 'string'
    || !Array.isArray(result.recommendations)) {
    throw new Error('AI assessment is unavailable. Restart the backend to load /assess-mock.')
  }
  const ids = new Set(payload.movements.map((movement) => movement.id))
  if (result.recommendations.some((item) => !item || typeof item.action !== 'string'
    || typeof item.why !== 'string' || typeof item.tradeoff !== 'string'
    || !Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0
    || item.evidence_ids.some((id) => !ids.has(id)))) {
    throw new Error('The AI advice referenced examples that are not in this sample.')
  }
  return result
}

export async function reviewRun(runId: string, refresh = false): Promise<AIReview> {
  const result = await post<AIReview & { error?: string }>('/review', { run_id: runId, refresh }, 240_000)
  if (result.error || !result.status || typeof result.summary !== 'string' || !Array.isArray(result.issues)) {
    throw new Error('AI review is unavailable. Restart the backend to load the review endpoint.')
  }
  return result
}
