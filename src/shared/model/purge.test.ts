import { describe, expect, it } from 'vitest'
import { createDefaultRoot } from './defaults'
import { purgeDeleted, PURGE } from './purge'
import { persistedRootSchema, type PersistedCard, type PersistedRoot } from './persisted-schema'

const DAY = 24 * 3600 * 1000
let n = 0
const id = () => `p${++n}`

function withCards(root: PersistedRoot, cards: PersistedCard[]): PersistedRoot {
  const space = root.spaces[0]!
  return { ...root, spaces: [{ ...space, stacks: [{ ...space.stacks[0]!, cards }] }] }
}

describe('purgeDeleted', () => {
  const root = createDefaultRoot(1, id)
  const live = root.spaces[0]!.stacks[0]!.cards[0]!
  const dead = (k: number, deletedAt: number): PersistedCard => ({
    ...live, id: `d${k}`, index: `a${k}`, isDeleted: true, deletedAt
  })

  it('clears favicons of deleted tabs and of every tab in a deleted card; live tabs keep theirs', () => {
    const ICON = 'data:image/png;base64,iVBORw0KGgo='
    const tab = { ...live.tabs[0]!, favicon: ICON }
    const liveCard = { ...live, tabs: [tab, { ...tab, id: 'closedTab', index: 'a1', isDeleted: true }] }
    const deadCard = { ...dead(9, 5), tabs: [{ ...tab, id: 'inDead' }] }
    const out = purgeDeleted(withCards(root, [liveCard, deadCard]), 10)
    const [a, b] = out.spaces[0]!.stacks[0]!.cards
    expect(a!.tabs.map((t) => t.favicon)).toEqual([ICON, null])
    expect(b!.tabs.map((t) => t.favicon)).toEqual([null])
  })

  it('removes deleted cards older than the retention window and keeps recent ones', () => {
    const now = 100 * DAY
    const out = purgeDeleted(withCards(root, [live, dead(1, 1), dead(2, now - DAY)]), now)
    expect(out.spaces[0]!.stacks[0]!.cards.map((c) => c.id)).toEqual([live.id, 'd2'])
  })

  it('caps the number of deleted cards per stack, keeping the most recently closed', () => {
    const now = 10 * DAY
    const many = Array.from({ length: PURGE.maxDeletedCards + 10 }, (_, k) => dead(k, now - k))
    const cards = purgeDeleted(withCards(root, [live, ...many]), now).spaces[0]!.stacks[0]!.cards
    expect(cards.filter((c) => c.isDeleted)).toHaveLength(PURGE.maxDeletedCards)
    expect(cards.some((c) => c.id === 'd0')).toBe(true)
    expect(cards.some((c) => c.id === `d${PURGE.maxDeletedCards + 9}`)).toBe(false)
  })

  it('caps deleted tabs per card, keeping the latest closed', () => {
    const tab = live.tabs[0]!
    const closed = Array.from({ length: PURGE.maxDeletedTabs + 5 }, (_, k) => ({
      ...tab, id: `t${k}`, index: `b${k}`, isDeleted: true
    }))
    const card = { ...live, tabs: [tab, ...closed] }
    const tabs = purgeDeleted(withCards(root, [card]), 1).spaces[0]!.stacks[0]!.cards[0]!.tabs
    expect(tabs.filter((t) => t.isDeleted)).toHaveLength(PURGE.maxDeletedTabs)
    expect(tabs[0]!.id).toBe(tab.id)
    expect(tabs.some((t) => t.id === `t${PURGE.maxDeletedTabs + 4}`)).toBe(true)
  })

  it('never removes live items, does not mutate input, and returns a valid root', () => {
    const input = withCards(root, [live, dead(1, 1)])
    const before = JSON.stringify(input)
    const out = purgeDeleted(input, 1000 * DAY)
    expect(JSON.stringify(input)).toBe(before)
    expect(out.spaces[0]!.stacks[0]!.cards[0]!.id).toBe(live.id)
    expect(persistedRootSchema.safeParse(out).success).toBe(true)
  })
})
