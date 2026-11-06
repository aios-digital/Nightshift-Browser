import { describe, expect, it } from 'vitest'
import { createDefaultRoot, createCard, createTab } from './defaults'
import { persistedRootSchema, SCHEMA_VERSION } from './persisted-schema'
import { DEFAULT_SEARCH_TEMPLATE } from '../url/omnibox'

let n = 0
const id = () => `id${++n}`

describe('defaults', () => {
  it('creates a valid default root at the current schema version', () => {
    const root = createDefaultRoot(1000, id)
    expect(persistedRootSchema.parse(root)).toEqual(root)
    expect(root.schemaVersion).toBe(SCHEMA_VERSION)
    expect(root.ui.searchEngine).toBe(DEFAULT_SEARCH_TEMPLATE)
    expect(root.spaces).toHaveLength(1)
    expect(root.profiles[0]?.id).toBe('default')
  })

  it('default space has an active, awake card with one tab', () => {
    const root = createDefaultRoot(1000, id)
    const space = root.spaces[0]!
    const card = space.stacks[0]!.cards[0]!
    expect(space.activeCardId).toBe(card.id)
    expect(card.width).toBe(1200)
    expect(card.kind).toBe('web')
    expect(card.isSleeping).toBe(false)
    expect(card.tabs[0]?.id).toBe(card.activeTabId)
  })

  it('createTab / createCard build valid records', () => {
    const tab = createTab({ id: 'x', index: 'a0', url: 'https://a.com/', now: 5 })
    expect(tab.isDeleted).toBe(false)
    const card = createCard({ id: 'c', index: 'a0', profileId: 'default', url: 'https://a.com/', now: 5, newId: id })
    expect(card.tabs).toHaveLength(1)
    expect(card.activeTabId).toBe(card.tabs[0]!.id)
    expect(card.createdAt).toBe(5)
  })
})
