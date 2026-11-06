import type { PersistedCard, PersistedRoot, PersistedTab } from './persisted-schema'

const DAY = 24 * 3600 * 1000

/** Retention for soft-deleted items. Keeps "reopen closed card/tab" possible without growing state forever. */
export const PURGE = { maxAgeMs: 30 * DAY, maxDeletedCards: 100, maxDeletedTabs: 50 } as const

/** Closed items keep no favicon: icons are up to ~44 KB each and only matter while a tab is shown. */
const withoutIcon = (t: PersistedTab): PersistedTab => (t.favicon === null ? t : { ...t, favicon: null })

function purgeTabs(tabs: readonly PersistedTab[], cardDeleted: boolean): PersistedTab[] {
  const deleted = tabs.filter((t) => t.isDeleted)
  const keep = new Set(deleted.slice(-PURGE.maxDeletedTabs).map((t) => t.id))
  return tabs
    .filter((t) => !t.isDeleted || keep.has(t.id))
    .map((t) => (cardDeleted || t.isDeleted ? withoutIcon(t) : t))
}

function purgeCards(cards: readonly PersistedCard[], now: number): PersistedCard[] {
  const recent = cards
    .filter((c) => c.isDeleted && now - (c.deletedAt ?? now) <= PURGE.maxAgeMs)
    .sort((a, b) => (b.deletedAt ?? now) - (a.deletedAt ?? now))
    .slice(0, PURGE.maxDeletedCards)
  const keep = new Set(recent.map((c) => c.id))
  return cards
    .filter((c) => !c.isDeleted || keep.has(c.id))
    .map((c) => ({ ...c, tabs: purgeTabs(c.tabs, c.isDeleted) }))
}

/** Pure: returns a new root without soft-deleted items past their retention. Live items are never touched. */
export function purgeDeleted(root: PersistedRoot, now: number): PersistedRoot {
  return {
    ...root,
    spaces: root.spaces.map((space) => ({
      ...space,
      stacks: space.stacks.map((stack) => ({ ...stack, cards: purgeCards(stack.cards, now) }))
    }))
  }
}
