import { keyBetween } from '../ordering'
import { DEFAULT_SEARCH_TEMPLATE } from '../url/omnibox'
import {
  DEFAULT_CARD_WIDTH,
  SCHEMA_VERSION,
  type PersistedCard,
  type PersistedRoot,
  type PersistedTab
} from './persisted-schema'

export const DEFAULT_PROFILE_ID = 'default'

export function createTab(args: {
  id: string
  index: string
  url: string
  now: number
  openerTabId?: string | null
}): PersistedTab {
  return {
    id: args.id,
    index: args.index,
    url: args.url,
    title: '',
    favicon: null,
    customName: null,
    customEmoji: null,
    isDeleted: false,
    openerTabId: args.openerTabId ?? null,
    createdAt: args.now
  }
}

export function createCard(args: {
  id: string
  index: string
  profileId: string
  url: string
  now: number
  newId: () => string
  width?: number
  openerTabId?: string | null
}): PersistedCard {
  const tab = createTab({
    id: args.newId(),
    index: keyBetween(null, null),
    url: args.url,
    now: args.now,
    openerTabId: args.openerTabId ?? null
  })
  return {
    id: args.id,
    index: args.index,
    kind: 'web',
    width: args.width ?? DEFAULT_CARD_WIDTH,
    isMaximized: false,
    isSleeping: false,
    profileId: args.profileId,
    soundMuted: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: args.now,
    lastActiveAt: args.now,
    tabs: [tab],
    activeTabId: tab.id,
    pinnedTabId: null
  }
}

export function createDefaultRoot(now: number, newId: () => string): PersistedRoot {
  const card = createCard({
    id: newId(),
    index: keyBetween(null, null),
    profileId: DEFAULT_PROFILE_ID,
    url: 'about:blank',
    now,
    newId
  })
  const spaceId = newId()
  return {
    schemaVersion: SCHEMA_VERSION,
    spaces: [
      {
        id: spaceId,
        index: keyBetween(null, null),
        name: 'Home',
        emoji: '🌙',
        defaultProfileId: DEFAULT_PROFILE_ID,
        stacks: [{ id: newId(), index: keyBetween(null, null), cards: [card] }],
        activeCardId: card.id,
        isArchived: false,
        lastActiveAt: now
      }
    ],
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default' }],
    ui: { locale: 'en', searchEngine: DEFAULT_SEARCH_TEMPLATE, activeSpaceId: spaceId },
    flags: {}
  }
}
