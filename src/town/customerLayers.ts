import type { Row, TwinProfile } from '../types'

export interface CustomerSource {
  id: string
  name: string
  profile: TwinProfile
  what_log: { day: number; shop: string | null; time: string | null; spent: number; abandoned: boolean }[]
  why_transcript: { q: string; a: string }[]
  mechanism: {
    habit: Record<string, number>
    latent_interest: Record<string, number>
    disruption_threshold: number
    ad_sensitivity: number
    social_links: string[]
  }
}

const records = import.meta.glob<CustomerSource>('/data/twins/T*.json', { eager: true, import: 'default' })
export const customerSources = Object.fromEntries(Object.values(records).map((record) => [record.id, record]))

export type DecisionRoute = 'autopilot' | 'rule' | 'model' | 'fallback' | 'unknown'

export const decisionRoutes: Record<DecisionRoute, { label: string; color: string }> = {
  autopilot: { label: 'Autopilot · no LLM', color: '#2f7d6d' },
  rule: { label: 'Local rule · no LLM', color: '#946b13' },
  model: { label: 'Model-informed · live or cached', color: '#6655a4' },
  fallback: { label: 'Fallback · not valid evidence', color: '#c34f46' },
  unknown: { label: 'Unverified / missing', color: '#888078' },
}

export function decisionRoute(row: Row | undefined): DecisionRoute {
  if (!row) return 'unknown'
  if (row.llm_failed || row.decision_source === 'fallback') return 'fallback'
  if (row.decision_source === 'rule') return 'rule'
  if (row.decision_source === 'llm') return 'model'
  if (row.mode === 'autopilot') return 'autopilot'
  return 'unknown'
}

export function strongestShop(values: Record<string, number> | undefined, exclude?: string): string | undefined {
  return Object.keys(values ?? {}).filter((shop) => shop !== exclude && Number.isFinite(values?.[shop]))
    .sort((a, b) => (values?.[b] ?? 0) - (values?.[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0))[0]
}

export function layerValue(row: Row | undefined, layer: 'habit' | 'latent_interest', shop?: string): number | null {
  const value = shop ? row?.state_before?.[layer]?.[shop] : undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

export function customerSeries(rows: Row[], twinId: string, days: number) {
  const selected = rows.filter((row) => row.twin === twinId).sort((a, b) => a.day - b.day)
  const byDay = new Map(selected.map((row) => [row.day, row]))
  const initial = selected[0]
  const regular = strongestShop(initial?.state_before?.habit)
  const alternative = strongestShop(initial?.state_before?.latent_interest, regular)
  const points = Array.from({ length: days }, (_, index) => {
    const day = index + 1
    const row = byDay.get(day)
    return { day, row, habit: layerValue(row, 'habit', regular),
      interest: layerValue(row, 'latent_interest', alternative), route: decisionRoute(row) }
  })
  const counts: Record<DecisionRoute, number> = { autopilot: 0, rule: 0, model: 0, fallback: 0, unknown: 0 }
  for (const point of points) counts[point.route] += 1
  return { regular, alternative, points, counts, localDecisions: counts.autopilot + counts.rule,
    recordedDays: points.filter((point) => point.row).length }
}

export function historyShares(source: CustomerSource | undefined) {
  const counts = new Map<string, number>()
  for (const entry of source?.what_log ?? []) {
    const shop = entry.shop ?? 'none'
    counts.set(shop, (counts.get(shop) ?? 0) + 1)
  }
  const total = source?.what_log.length ?? 0
  return [...counts].sort((a, b) => b[1] - a[1]).map(([shop, count]) => ({ shop, count, share: total ? count / total : 0 }))
}
