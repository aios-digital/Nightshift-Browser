import { describe, expect, it } from 'vitest'
import {
  layoutPayloadSchema, navigatePayloadSchema, tabIdPayloadSchema, wakePayloadSchema,
  savePayloadSchema, tabStateSchema
} from './schemas'
import { createDefaultRoot } from '../model/defaults'

const entry = { tabId: 't1', x: 0, y: 34, w: 1200, h: 700, visible: true }

describe('layoutPayloadSchema', () => {
  it('accepts a valid layout', () => {
    expect(layoutPayloadSchema.safeParse({ entries: [entry] }).success).toBe(true)
    expect(layoutPayloadSchema.safeParse({ entries: [{ ...entry, x: -300 }] }).success).toBe(true)
  })
  it.each([
    ['extra keys', { entries: [{ ...entry, evil: 1 }] }],
    ['NaN', { entries: [{ ...entry, w: NaN }] }],
    ['Infinity', { entries: [{ ...entry, h: Infinity }] }],
    ['float', { entries: [{ ...entry, x: 1.5 }] }],
    ['negative width', { entries: [{ ...entry, w: -1 }] }],
    ['bad tabId', { entries: [{ ...entry, tabId: '../x' }] }],
    ['too many entries', { entries: Array.from({ length: 257 }, () => entry) }],
    ['extra top-level key', { entries: [], more: 1 }],
    ['missing entries', {}]
  ])('rejects %s', (_n, payload) => {
    expect(layoutPayloadSchema.safeParse(payload).success).toBe(false)
  })
})

describe('other payloads', () => {
  it('tab id payload', () => {
    expect(tabIdPayloadSchema.safeParse({ tabId: 'abc_1-2' }).success).toBe(true)
    expect(tabIdPayloadSchema.safeParse({ tabId: '' }).success).toBe(false)
    expect(tabIdPayloadSchema.safeParse({ tabId: 'a b' }).success).toBe(false)
  })
  it('navigate payload enforces the navigation policy and length', () => {
    expect(navigatePayloadSchema.safeParse({ tabId: 't', url: 'https://a.com' }).success).toBe(true)
    expect(navigatePayloadSchema.safeParse({ tabId: 't', url: 'javascript:alert(1)' }).success).toBe(false)
    expect(navigatePayloadSchema.safeParse({ tabId: 't', url: 'https://a.com/' + 'x'.repeat(9000) }).success).toBe(false)
  })
  it('wake payload only takes a profile id, never a raw partition', () => {
    expect(wakePayloadSchema.safeParse({ tabId: 't', profileId: 'default', url: 'about:blank' }).success).toBe(true)
    expect(wakePayloadSchema.safeParse({ tabId: 't', profileId: 'persist:x', url: 'about:blank' }).success).toBe(false)
    expect(wakePayloadSchema.safeParse({ tabId: 't', profileId: 'default', url: 'file:///x' }).success).toBe(false)
  })
  it('save payload validates the snapshot and rejects extra keys', () => {
    let i = 0
    const root = createDefaultRoot(1, () => `i${++i}`)
    expect(savePayloadSchema.safeParse({ snapshot: root }).success).toBe(true)
    expect(savePayloadSchema.safeParse({ snapshot: { ...root, schemaVersion: 'x' } }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ snapshot: root, extra: 1 }).success).toBe(false)
  })
  it('tab state schema', () => {
    const s = { tabId: 't', url: 'https://a.com', title: 'A', loading: false, canGoBack: false, canGoForward: true }
    expect(tabStateSchema.safeParse(s).success).toBe(true)
    expect(tabStateSchema.safeParse({ ...s, error: { code: -105, key: 'errors.dns' } }).success).toBe(true)
    expect(tabStateSchema.safeParse({ ...s, loading: 'yes' }).success).toBe(false)
  })
})
