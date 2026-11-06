import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

export type Indexed = { id: string; index: string }

export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

/** Key for inserting at position `at` of a list whose keys are already sorted. */
export function keyForInsertAt(sortedKeys: readonly string[], at: number): string {
  const i = Math.max(0, Math.min(at, sortedKeys.length))
  return generateKeyBetween(sortedKeys[i - 1] ?? null, sortedKeys[i] ?? null)
}

export function sortByIndex<T extends { index: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
}

/** New key for `id` so it ends up at `toIndex` in the final order. */
export function keyForMove(items: readonly Indexed[], id: string, toIndex: number): string {
  const others = sortByIndex(items.filter((i) => i.id !== id))
  return keyForInsertAt(others.map((i) => i.index), toIndex)
}

/** If keys are missing or duplicated, re-key everything in array order. Otherwise return the input unchanged. */
export function repairDuplicateKeys<T extends { index: string }>(items: readonly T[]): T[] {
  const keys = items.map((i) => i.index)
  if (keys.every((k) => k.length > 0) && new Set(keys).size === keys.length) return [...items]
  const fresh = generateNKeysBetween(null, null, items.length)
  return items.map((item, n) => ({ ...item, index: fresh[n] as string }))
}
