import { focusShopOf, type Runs, type ShopId } from './types'

/** Two building sprites exist in the town art; the focus shop gets the first. */
export type ShopSprite = 'simffee' | 'starbucks'

const PALETTE = ['#2f7d6d', '#1d6b4a', '#8a5a2b', '#5b4a8a', '#a34a4a']

export function shopIds(runs: Runs): ShopId[] {
  const focus = focusShopOf(runs)
  return [focus, ...Object.keys(runs.shops).filter((s) => s !== focus)]
}

export function shopColor(runs: Runs, id: ShopId): string {
  const i = shopIds(runs).indexOf(id)
  return PALETTE[Math.max(0, i) % PALETTE.length]
}

export function shopName(runs: Runs, id: ShopId): string {
  return runs.shops[id]?.name ?? id
}

export function spriteFor(runs: Runs, id: ShopId): ShopSprite {
  return id === focusShopOf(runs) ? 'simffee' : 'starbucks'
}

/** The sprite art only distinguishes "ours" and "the other one"; map back by bundle order. */
export function shopForSprite(runs: Runs, sprite: ShopSprite): ShopId | null {
  const ids = shopIds(runs)
  if (sprite === 'simffee') return ids[0] ?? null
  return ids[1] ?? null
}
