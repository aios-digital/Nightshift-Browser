import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_TEMPLATE } from '../url/omnibox'
import { createCard, createDefaultRoot, DEFAULT_PROFILE_ID } from './defaults'
import { persistedRootSchema, type PersistedRoot } from './persisted-schema'
import { repairRoot } from './repair'

let n = 0
const newId = () => `r${++n}`
const ctx = { now: 5000, newId }

/** A valid root: one space, one stack, three cards (c1..c3), each with one tab (t1..t3). */
function base(): PersistedRoot {
  const root = createDefaultRoot(1, newId)
  const cards = [1, 2, 3].map((k) => {
    const card = createCard({ id: `c${k}`, index: `a${k}`, profileId: DEFAULT_PROFILE_ID, url: `https://s${k}.test/`, now: 1, newId })
    const tab = { ...card.tabs[0]!, id: `t${k}` }
    return { ...card, tabs: [tab], activeTabId: tab.id }
  })
  const space = root.spaces[0]!
  return { ...root, spaces: [{ ...space, id: 'sp1', stacks: [{ ...space.stacks[0]!, id: 'st1', cards }], activeCardId: 'c1' }], ui: { ...root.ui, activeSpaceId: 'sp1' } }
}
/** Deep copy as plain JSON, so tests can break it freely. */
const raw = (root: PersistedRoot = base()): any => JSON.parse(JSON.stringify(root)) // eslint-disable-line @typescript-eslint/no-explicit-any
const cardsOf = (r: PersistedRoot) => r.spaces[0]!.stacks[0]!.cards
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}
function ok(input: unknown) {
  const r = repairRoot(input, ctx)
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.reason}`)
  expect(persistedRootSchema.safeParse(r.root).success).toBe(true)
  return r
}

describe('repairRoot: records', () => {
  it('leaves a valid root unchanged and reports nothing', () => {
    const r = ok(raw())
    expect(r.repairs).toEqual([])
    expect(r.root).toEqual(base())
  })

  it('keeps valid cards and drops the one bad card', () => {
    const input = raw()
    input.spaces[0].stacks[0].cards[1].id = 'not valid!'
    const r = ok(input)
    expect(cardsOf(r.root).map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(r.repairs).toContainEqual({ path: 'spaces[0].stacks[0].cards[1]', action: 'dropped' })
  })

  it('resets a bad favicon or custom name instead of dropping the tab', () => {
    const input = raw()
    Object.assign(input.spaces[0].stacks[0].cards[0].tabs[0], { favicon: 'https://x.test/f.ico', customName: 42, title: 'x'.repeat(900) })
    const r = ok(input)
    const tab = cardsOf(r.root)[0]!.tabs[0]!
    expect(tab).toMatchObject({ id: 't1', favicon: null, customName: null })
    expect(tab.title).toHaveLength(512)
    expect(r.repairs.map((x) => x.path)).toEqual(expect.arrayContaining([
      'spaces[0].stacks[0].cards[0].tabs[0].favicon', 'spaces[0].stacks[0].cards[0].tabs[0].customName'
    ]))
  })

  it('drops a tab with a disallowed URL and moves activeTabId to a live tab', () => {
    const input = raw()
    const card = input.spaces[0].stacks[0].cards[0]
    card.tabs.push({ ...card.tabs[0], id: 't1b', index: 'a1', url: 'file:///c:/secret' })
    card.activeTabId = 't1b'
    const r = ok(input)
    expect(cardsOf(r.root)[0]).toMatchObject({ activeTabId: 't1', tabs: [{ id: 't1' }] })
  })

  it('drops a live card left with no live tabs, and fixes the space active card', () => {
    const input = raw()
    input.spaces[0].stacks[0].cards[0].tabs[0].url = 'javascript:alert(1)'
    const r = ok(input)
    expect(cardsOf(r.root).map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(r.root.spaces[0]!.activeCardId).toBe('c2')
  })

  it('clamps a bad width and resets bad flags on a card', () => {
    const input = raw()
    Object.assign(input.spaces[0].stacks[0].cards[0], { width: 99_999, isMaximized: 'yes', createdAt: -1 })
    const card = cardsOf(ok(input).root)[0]!
    expect(card).toMatchObject({ width: 8000, isMaximized: false, createdAt: 5000 })
  })
})

describe('repairRoot: references, ids and keys', () => {
  it('drops later duplicate ids, keeping the first', () => {
    const input = raw()
    input.spaces[0].stacks[0].cards[2].id = 'c1'
    input.spaces[0].stacks[0].cards[2].tabs[0].id = 't9'
    const r = ok(input)
    expect(cardsOf(r.root).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(r.repairs).toContainEqual({ path: 'spaces[0].stacks[0].cards[2]', action: 'deduped' })
  })

  it('an invalid record does not make a later valid record with the same id a duplicate', () => {
    const input = raw()
    const cards = input.spaces[0].stacks[0].cards
    cards[0].isDeleted = 'maybe' // c1 is dropped as invalid...
    cards[1].id = 'c1' // ...so this one, also called c1, must survive
    cards[1].tabs[0].id = 't9'
    const r = ok(input)
    expect(cardsOf(r.root).map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(cardsOf(r.root)[0]!.tabs[0]!.id).toBe('t9')
  })

  it('re-keys duplicate or missing index keys, keeping the array order', () => {
    const input = raw()
    input.spaces[0].stacks[0].cards.forEach((c: { index: string }) => (c.index = 'a0'))
    const r = ok(input)
    const keys = cardsOf(r.root).map((c) => c.index)
    expect(new Set(keys).size).toBe(3)
    expect([...keys].sort()).toEqual(keys)
    expect(r.repairs).toContainEqual({ path: 'spaces[0].stacks[0].cards', action: 're-keyed' })
  })

  it('fixes dangling activeCardId, pinnedTabId and ui.activeSpaceId', () => {
    const input = raw()
    input.spaces[0].activeCardId = 'ghost'
    input.spaces[0].stacks[0].cards[0].pinnedTabId = 'ghost'
    input.ui.activeSpaceId = 'ghost'
    const r = ok(input)
    expect(r.root.spaces[0]!.activeCardId).toBe('c1')
    expect(cardsOf(r.root)[0]!.pinnedTabId).toBeNull()
    expect(r.root.ui.activeSpaceId).toBe('sp1')
    expect(r.repairs.filter((x) => x.action === 'fixed-ref')).toHaveLength(3)
  })

  it('falls back field by field for ui, profiles and flags', () => {
    const input = raw()
    input.ui = { locale: 'fr', searchEngine: 'javascript:%s', activeSpaceId: 'sp1' }
    input.profiles = [{ id: 'work', name: 'Work' }, { id: 'bad id', name: 'x' }]
    input.flags = { ok: true, bad: 'yes' }
    const r = ok(input)
    expect(r.root.ui).toEqual({ locale: 'en', searchEngine: DEFAULT_SEARCH_TEMPLATE, activeSpaceId: 'sp1' })
    expect(r.root.profiles.map((p) => p.id)).toEqual(['work', DEFAULT_PROFILE_ID])
    expect(r.root.flags).toEqual({ ok: true })
  })

  it('gives a space without stacks an empty stack', () => {
    const input = raw()
    input.spaces[0].stacks = 'nope'
    const r = ok(input)
    expect(r.root.spaces[0]!.stacks).toHaveLength(1)
    expect(r.root.spaces[0]!.stacks[0]!.cards).toEqual([])
    expect(r.root.spaces[0]!.activeCardId).toBeNull()
  })
})

describe('repairRoot: limits', () => {
  it('every repair names a path', () => {
    const input = raw()
    input.spaces[0].stacks[0].cards[1].id = '!'
    input.ui.locale = 'xx'
    for (const r of ok(input).repairs) expect(r.path).toMatch(/^(spaces|ui|profiles|flags)/)
  })

  it('no valid space, or a non-object, is unrepairable', () => {
    const input = raw()
    input.spaces = [{ id: '!!' }]
    expect(repairRoot(input, ctx).status).toBe('unrepairable')
    expect(repairRoot(null, ctx).status).toBe('unrepairable')
    expect(repairRoot({ ...raw(), schemaVersion: 1 }, ctx).status).toBe('unrepairable')
  })

  it('does not mutate its input', () => {
    // Frozen input: any write inside repair would throw in strict mode.
    expect(() => repairRoot(deepFreeze(raw()), ctx)).not.toThrow()
    const broken = raw()
    broken.spaces[0].stacks[0].cards[1].id = '!'
    expect(() => repairRoot(deepFreeze(broken), ctx)).not.toThrow()
  })
})
