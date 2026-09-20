import type { Health, UserScenario, WhatIfAnswer } from './types'

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

/** Free text -> translated -> run -> analysed. The server's own timeout falls back to the library. */
export function whatIf(text: string, seeds: number[], parent = 'baseline'): Promise<WhatIfAnswer> {
  return post<WhatIfAnswer>('/whatif', { text, seeds, parent }, 120_000)
}

/** Re-run an already translated scenario (e.g. with more seeds). No model call for translation. */
export function runScenario(scenario: UserScenario, seeds: number[]): Promise<WhatIfAnswer> {
  return post<WhatIfAnswer>('/run', { scenario, seeds }, 300_000)
}
