export type MockDestination = 'focus' | 'competitor' | 'none'

export interface MockMovement {
  id: string
  twinIndex: number
  from: MockDestination
  to: MockDestination
  reason: string
}

export const MOCK_MOVEMENTS: readonly MockMovement[] = [
  { id: 'mock-1', twinIndex: 0, from: 'focus', to: 'competitor',
    reason: 'The usual shop opened too late for my commute, so I tried the other café.' },
  { id: 'mock-2', twinIndex: 1, from: 'competitor', to: 'focus',
    reason: 'The earlier opening let me return to my preferred morning stop.' },
  { id: 'mock-3', twinIndex: 2, from: 'focus', to: 'none',
    reason: 'The drink no longer fitted my daily budget, so I skipped buying coffee.' },
  { id: 'mock-4', twinIndex: 3, from: 'none', to: 'focus',
    reason: 'A lower price made a morning coffee affordable again.' },
  { id: 'mock-5', twinIndex: 4, from: 'focus', to: 'competitor',
    reason: 'The queue was too long, and I needed somewhere that could serve me sooner.' },
  { id: 'mock-6', twinIndex: 5, from: 'competitor', to: 'focus',
    reason: 'The shorter wait made the usual shop convenient again.' },
  { id: 'mock-7', twinIndex: 6, from: 'focus', to: 'competitor',
    reason: 'I was curious about the newly opened café and decided to try it.' },
  { id: 'mock-8', twinIndex: 7, from: 'competitor', to: 'focus',
    reason: 'After trying the alternative, I preferred my familiar routine and returned.' },
  { id: 'mock-9', twinIndex: 8, from: 'none', to: 'competitor',
    reason: 'A nearby café was open when I passed, so I stopped rather than skipping coffee.' },
  { id: 'mock-10', twinIndex: 9, from: 'competitor', to: 'none',
    reason: 'My usual drink was unavailable and I did not want a substitute.' },
]

export function sampleMockMovements(count = 5): MockMovement[] {
  const pool = [...MOCK_MOVEMENTS]
  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[pool[index], pool[other]] = [pool[other], pool[index]]
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)))
}
