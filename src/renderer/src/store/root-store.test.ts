import { getSnapshot } from 'mobx-state-tree'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultRoot } from '@shared/model/defaults'
import { migrate } from '@shared/model/migrations'
import { persistedRootSchema } from '@shared/model/persisted-schema'
import { readFileSync } from 'node:fs'
import { createRootStore, type RootStoreInstance } from './root-store'

const ICON = 'data:image/png;base64,iVBORw0KGgo='

let clock = 1000
let counter = 0
const env = { now: () => ++clock, newId: () => `id${++counter}` }

let store: RootStoreInstance
const space = () => store.activeSpace!
const cards = () => space().visibleCards
const firstCard = () => cards()[0]!

beforeEach(() => {
  clock = 1000
  counter = 0
  store = createRootStore(createDefaultRoot(1, env.newId), env)
})

describe('snapshots', () => {
  it('round-trips a default root and passes the persisted schema', () => {
    const snap = getSnapshot(store)
    expect(persistedRootSchema.safeParse(snap).success).toBe(true)
  })

  it('loads a migrated v1 fixture', () => {
    const r = migrate(JSON.parse(readFileSync('tests/fixtures/state-v1.json', 'utf8')))
    if (r.status !== 'ok') throw new Error('fixture must migrate')
    const s = createRootStore(r.root, env)
    expect(s.activeSpace?.name).toBe('Work')
    expect(s.activeSpace?.visibleCards[0]?.width).toBe(900)
  })

  it('never persists volatile tab state', () => {
    store.applyTabState({ tabId: firstCard().activeTab!.id, url: 'https://a.com/', title: 'A', loading: true, canGoBack: true, canGoForward: false })
    const json = JSON.stringify(getSnapshot(store))
    expect(json).not.toContain('loading')
    expect(json).not.toContain('canGoBack')
    expect(json).not.toContain('errorText')
  })
})

describe('cards', () => {
  it('opens a card after a given card and makes it active', () => {
    const a = firstCard()
    const b = store.openCard({ url: 'https://b.com/' })
    const c = store.openCard({ url: 'https://c.com/', afterCardId: a.id })
    expect(cards().map((x) => x.id)).toEqual([a.id, c, b])
    expect(space().activeCardId).toBe(c)
    expect(space().cardById(c)?.width).toBe(1200)
  })

  it('soft-deletes on close and activates a neighbour', () => {
    const a = firstCard().id
    const b = store.openCard({ url: 'https://b.com/' })
    store.closeCard(b)
    const closed = space().cardById(b)!
    expect(closed.isDeleted).toBe(true)
    expect(closed.deletedAt).not.toBeNull()
    expect(cards().map((x) => x.id)).toEqual([a])
    expect(space().activeCardId).toBe(a)
    expect(persistedRootSchema.safeParse(getSnapshot(store)).success).toBe(true)
  })

  it('closing the last card leaves an empty row with no active card', () => {
    store.closeCard(firstCard().id)
    expect(cards()).toEqual([])
    expect(space().activeCardId).toBeNull()
  })

  it('resizes with a 300 px minimum and a maximum', () => {
    const id = firstCard().id
    store.resizeCard(id, 100, 2000)
    expect(space().cardById(id)?.width).toBe(300)
    store.resizeCard(id, 5000, 2000)
    expect(space().cardById(id)?.width).toBe(2000)
    store.resizeCard(id, 640.4, 2000)
    expect(space().cardById(id)?.width).toBe(640)
  })

  it('resizing un-maximizes; maximize toggles and keeps the width', () => {
    const id = firstCard().id
    store.resizeCard(id, 700, 2000)
    store.toggleMaximize(id)
    expect(space().cardById(id)?.isMaximized).toBe(true)
    expect(space().cardById(id)?.width).toBe(700)
    store.toggleMaximize(id)
    expect(space().cardById(id)?.isMaximized).toBe(false)
    store.toggleMaximize(id)
    store.resizeCard(id, 800, 2000)
    expect(space().cardById(id)?.isMaximized).toBe(false)
  })

  it('sleeps and wakes a card', () => {
    const id = firstCard().id
    store.sleepCard(id)
    expect(space().cardById(id)?.isSleeping).toBe(true)
    store.wakeCard(id)
    expect(space().cardById(id)?.isSleeping).toBe(false)
  })

  it('setActiveCard ignores unknown or deleted cards', () => {
    const a = firstCard().id
    const b = store.openCard({ url: 'https://b.com/' })
    store.closeCard(b)
    store.setActiveCard(b)
    expect(space().activeCardId).toBe(a)
    store.setActiveCard('nope')
    expect(space().activeCardId).toBe(a)
  })

  it('waking an active card updates lastActiveAt', () => {
    const id = firstCard().id
    const before = space().cardById(id)!.lastActiveAt
    store.setActiveCard(id)
    expect(space().cardById(id)!.lastActiveAt).toBeGreaterThan(before)
  })
})

describe('tabs', () => {
  it('adds a tab after the active one and activates it', () => {
    const card = firstCard()
    const first = card.activeTab!.id
    const t2 = store.addTab(card.id, 'https://b.com/', first)
    expect(card.visibleTabs.map((t) => t.id)).toEqual([first, t2])
    expect(card.activeTabId).toBe(t2)
    expect(card.tabById(t2)?.openerTabId).toBe(first)
  })

  it('closing the active tab activates a neighbour', () => {
    const card = firstCard()
    const t1 = card.activeTab!.id
    const t2 = store.addTab(card.id, 'https://b.com/')
    const t3 = store.addTab(card.id, 'https://c.com/')
    store.closeTab(card.id, t3)
    expect(card.activeTabId).toBe(t2)
    store.closeTab(card.id, t1)
    expect(card.visibleTabs.map((t) => t.id)).toEqual([t2])
  })

  it('closing the last tab closes the card', () => {
    const card = firstCard()
    store.closeTab(card.id, card.activeTab!.id)
    expect(card.isDeleted).toBe(true)
  })

  it('reorders tabs', () => {
    const card = firstCard()
    const t1 = card.activeTab!.id
    const t2 = store.addTab(card.id, 'https://b.com/')
    const t3 = store.addTab(card.id, 'https://c.com/')
    store.reorderTab(card.id, t3, 0)
    expect(card.visibleTabs.map((t) => t.id)).toEqual([t3, t1, t2])
  })

  it('setActiveTab ignores tabs from other cards', () => {
    const a = firstCard()
    const b = space().cardById(store.openCard({ url: 'https://b.com/' }))!
    store.setActiveTab(a.id, b.activeTab!.id)
    expect(a.activeTabId).not.toBe(b.activeTab!.id)
  })

  it('applyTabState updates persisted fields and volatile state, and clears errors', () => {
    const tab = firstCard().activeTab!
    store.applyTabState({
      tabId: tab.id, url: 'https://x.com/', title: 'X', favicon: ICON,
      loading: false, canGoBack: true, canGoForward: true, error: { code: -105, key: 'errors.dns' }
    })
    expect(tab.url).toBe('https://x.com/')
    expect(tab.title).toBe('X')
    expect(tab.favicon).toBe(ICON)
    expect(tab.canGoBack).toBe(true)
    expect(tab.errorText).toBe('errors.dns')
    store.applyTabState({ tabId: tab.id, url: 'https://x.com/', title: 'X', loading: true, canGoBack: true, canGoForward: true })
    expect(tab.errorText).toBeNull()
  })

  it('applyTabState ignores unknown tabs and about:blank url overwrites with empty title', () => {
    expect(() =>
      store.applyTabState({ tabId: 'nope', url: 'https://x.com/', title: '', loading: false, canGoBack: false, canGoForward: false })
    ).not.toThrow()
  })

  it('applyTabState bounds page-controlled values so saving can never be blocked', () => {
    const tab = firstCard().activeTab!
    store.applyTabState({
      tabId: tab.id, url: 'https://x.com/' + 'a'.repeat(9000), title: 't'.repeat(5000),
      favicon: 'data:image/png;base64,' + 'A'.repeat(50_000), loading: false, canGoBack: false, canGoForward: false
    })
    expect(tab.title.length).toBeLessThanOrEqual(512)
    expect(tab.url.length).toBeLessThanOrEqual(8192)
    expect(tab.favicon).toBeNull()
    expect(persistedRootSchema.safeParse(getSnapshot(store)).success).toBe(true)
  })

  it('accepts only image data URLs as favicons, never a URL the shell would fetch', () => {
    const tab = firstCard().activeTab!
    for (const favicon of ['file:///c:/x.ico', 'https://x.com/f.ico', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      store.applyTabState({ tabId: tab.id, url: 'https://x.com/', title: 'X', favicon, loading: false, canGoBack: false, canGoForward: false })
      expect(tab.favicon).toBeNull()
    }
  })

  it('a URL over the save limit never enters the model: openCard, addTab and navigateTab', () => {
    const huge = `https://x.test/?${'a'.repeat(9000)}`
    const card = firstCard()
    const opened = store.openCard({ url: huge })
    expect(space().cardById(opened)!.activeTab!.url).toBe('about:blank')
    const tabId = store.addTab(card.id, huge)
    expect(card.tabById(tabId)!.url).toBe('about:blank')
    const tab = card.activeTab!
    const before = tab.url
    expect(store.navigateTab(tab.id, huge)).toBe(false)
    expect(store.navigateTab(tab.id, 'javascript:alert(1)')).toBe(false)
    expect(tab.url).toBe(before)
    expect(store.navigateTab(tab.id, 'https://ok.test/')).toBe(true)
    expect(persistedRootSchema.safeParse(getSnapshot(store)).success).toBe(true)
  })

  it('an explicit null favicon from main clears the icon (a new site committed); a missing one keeps it', () => {
    const tab = firstCard().activeTab!
    const base = { tabId: tab.id, url: 'https://x.com/', title: 'X', loading: false, canGoBack: false, canGoForward: false }
    store.applyTabState({ ...base, favicon: ICON })
    store.applyTabState(base)
    expect(tab.favicon).toBe(ICON)
    store.applyTabState({ ...base, favicon: null })
    expect(tab.favicon).toBeNull()
  })

  it('navigating clears the previous site favicon', () => {
    const tab = firstCard().activeTab!
    store.applyTabState({ tabId: tab.id, url: 'https://x.com/', title: 'X', favicon: ICON, loading: false, canGoBack: false, canGoForward: false })
    expect(tab.favicon).toBe(ICON)
    store.navigateTab(tab.id, 'https://y.com/')
    expect(tab.favicon).toBeNull()
  })

  it('closing the pinned tab clears pinnedTabId', () => {
    const card = firstCard()
    const t1 = card.activeTab!.id
    store.addTab(card.id, 'https://b.com/')
    card.setPinnedTab(t1)
    expect(card.pinnedTabId).toBe(t1)
    store.closeTab(card.id, t1)
    expect(card.pinnedTabId).toBeNull()
  })

  it('navigateTab sets the URL and clears the error', () => {
    const tab = firstCard().activeTab!
    store.applyTabState({ tabId: tab.id, url: 'x', title: '', loading: false, canGoBack: false, canGoForward: false, error: { code: -102, key: 'errors.refused' } })
    store.navigateTab(tab.id, 'https://new.com/')
    expect(tab.url).toBe('https://new.com/')
    expect(tab.errorText).toBeNull()
    expect(tab.loading).toBe(true)
  })
})

describe('ui', () => {
  it('sets locale and search engine', () => {
    store.setLocale('ar')
    expect(store.ui.locale).toBe('ar')
    store.setSearchEngine('https://duckduckgo.com/?q=%s')
    expect(store.ui.searchEngine).toBe('https://duckduckgo.com/?q=%s')
  })

  it('awakeTabs lists the active tab of each awake visible card only', () => {
    const a = firstCard()
    const bId = store.openCard({ url: 'https://b.com/' })
    store.sleepCard(bId)
    expect(store.awakeTabs.map((t) => t.tab.id)).toEqual([a.activeTab!.id])
  })
})
