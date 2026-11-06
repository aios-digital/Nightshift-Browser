import { describe, expect, it } from 'vitest'
import { allowInWindow } from './rate-window'

describe('allowInWindow', () => {
  it('allows `limit` per window then refuses', () => {
    let history: readonly number[] = []
    const results: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const r = allowInWindow(history, 1000 + i, 3, 10_000)
      results.push(r.allowed)
      history = r.history
    }
    expect(results).toEqual([true, true, true, false])
    expect(history).toEqual([1000, 1001, 1002])
  })

  it('the window slides: old entries expire', () => {
    const r = allowInWindow([0, 1, 2], 10_001, 3, 10_000)
    expect(r.allowed).toBe(true)
    expect(r.history).toEqual([2, 10_001])
  })

  it('returns a new history array and never mutates the input', () => {
    const before = Object.freeze([5])
    const r = allowInWindow(before, 6, 3, 10_000)
    expect(r.history).not.toBe(before)
    expect(before).toEqual([5])
  })

  it('a refusal still drops expired entries', () => {
    expect(allowInWindow([0, 9_999], 10_000, 1, 10_000)).toEqual({ allowed: false, history: [9_999] })
  })
})
