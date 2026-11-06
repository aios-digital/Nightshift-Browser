import { describe, expect, it } from 'vitest'
import { keyBetween, keyForInsertAt, keyForMove, repairDuplicateKeys, sortByIndex } from './ordering'

type Item = { id: string; index: string }
const mk = (ids: string[]): Item[] => {
  const out: Item[] = []
  for (const id of ids) out.push({ id, index: keyForInsertAt(out.map((i) => i.index), out.length) })
  return out
}
const order = (items: Item[]) => sortByIndex(items).map((i) => i.id)

describe('ordering', () => {
  it('keyBetween is strictly between', () => {
    const a = keyBetween(null, null)
    const b = keyBetween(a, null)
    const m = keyBetween(a, b)
    expect(a < m && m < b).toBe(true)
  })

  it('inserts at start, middle and end', () => {
    const keys = mk(['a', 'b', 'c']).map((i) => i.index)
    const start = keyForInsertAt(keys, 0)
    const mid = keyForInsertAt(keys, 1)
    const end = keyForInsertAt(keys, 3)
    expect(start < keys[0]!).toBe(true)
    expect(keys[0]! < mid && mid < keys[1]!).toBe(true)
    expect(end > keys[2]!).toBe(true)
  })

  it('clamps out-of-range insert positions', () => {
    const keys = mk(['a', 'b']).map((i) => i.index)
    expect(keyForInsertAt(keys, -5) < keys[0]!).toBe(true)
    expect(keyForInsertAt(keys, 99) > keys[1]!).toBe(true)
  })

  it('sortByIndex does not mutate and sorts by raw string order', () => {
    const items = [{ id: 'b', index: 'a1' }, { id: 'a', index: 'a0' }]
    const sorted = sortByIndex(items)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b'])
    expect(items[0]!.id).toBe('b')
  })

  it('moves an item to a new position', () => {
    const items = mk(['a', 'b', 'c', 'd'])
    const key = keyForMove(items, 'a', 2)
    const moved = items.map((i) => (i.id === 'a' ? { ...i, index: key } : i))
    expect(order(moved)).toEqual(['b', 'c', 'a', 'd'])
    const key2 = keyForMove(moved, 'd', 0)
    const moved2 = moved.map((i) => (i.id === 'd' ? { ...i, index: key2 } : i))
    expect(order(moved2)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('keeps keys strictly increasing over 1000 random inserts', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    let items: Item[] = []
    for (let n = 0; n < 1000; n++) {
      const pos = Math.floor(rnd() * (items.length + 1))
      const sorted = sortByIndex(items)
      const key = keyForInsertAt(sorted.map((i) => i.index), pos)
      items = [...items, { id: `i${n}`, index: key }]
    }
    const keys = sortByIndex(items).map((i) => i.index)
    expect(new Set(keys).size).toBe(1000)
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1]! < keys[i]!).toBe(true)
  })

  it('repairs duplicate and missing keys while keeping order', () => {
    const items = [
      { id: 'a', index: 'a0' }, { id: 'b', index: 'a0' }, { id: 'c', index: '' }, { id: 'd', index: 'a1' }
    ]
    const fixed = repairDuplicateKeys(items)
    expect(new Set(fixed.map((i) => i.index)).size).toBe(4)
    expect(fixed.every((i) => i.index.length > 0)).toBe(true)
    expect(order(fixed)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('repair leaves valid input untouched', () => {
    const items = mk(['a', 'b', 'c'])
    expect(repairDuplicateKeys(items)).toEqual(items)
  })
})
