import { getEnv, types, type Instance, type SnapshotIn } from 'mobx-state-tree'
import { keyBetween, keyForInsertAt, keyForMove, sortByIndex } from '@shared/ordering'
import { isFaviconDataUrl } from '@shared/favicon/favicon'
import { isAllowedNavigation } from '@shared/url/navigation-policy'
import {
  DEFAULT_CARD_WIDTH,
  MAX_CARD_WIDTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MIN_CARD_WIDTH,
  SCHEMA_VERSION,
  type PersistedRoot
} from '@shared/model/persisted-schema'
import type { TabState } from '@shared/ipc/schemas'

export type StoreEnv = { now: () => number; newId: () => string }
const envOf = (self: object) => getEnv<StoreEnv>(self)
const nullableString = types.maybeNull(types.string)
const isWebUrl = (url: string) => url.length <= MAX_URL_LENGTH && isAllowedNavigation(url)
/** URLs the model may hold (and so save): empty, about:blank or a bounded web URL. Anything else becomes a blank tab. */
const storableUrl = (url: string) => (isWebUrl(url) ? url : 'about:blank')

export const TabModel = types
  .model('Tab', {
    id: types.identifier,
    index: types.string,
    url: types.string,
    title: types.string,
    favicon: nullableString,
    customName: nullableString,
    customEmoji: nullableString,
    isDeleted: types.boolean,
    openerTabId: nullableString,
    createdAt: types.number
  })
  .volatile(() => ({
    loading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null as string | null
  }))
  .actions((self) => ({
    /** Values come from web pages, so each is bounded to what the save schema accepts. */
    applyState(s: Omit<TabState, 'tabId'>) {
      if (isWebUrl(s.url)) self.url = s.url
      self.title = s.title.slice(0, MAX_TITLE_LENGTH)
      // Only icons main fetched and encoded; the shell never loads a favicon URL itself.
      if (s.favicon === null) self.favicon = null
      else if (s.favicon !== undefined && isFaviconDataUrl(s.favicon)) self.favicon = s.favicon
      self.loading = s.loading
      self.canGoBack = s.canGoBack
      self.canGoForward = s.canGoForward
      self.errorText = s.error?.key ?? null
    },
    /** Returns false (and changes nothing) for a URL the model cannot hold or main would refuse. */
    startNavigation(url: string): boolean {
      if (!isWebUrl(url)) return false
      self.url = url
      self.favicon = null
      self.loading = true
      self.errorText = null
      return true
    },
    softDelete() {
      self.isDeleted = true
    }
  }))

export const CardModel = types
  .model('Card', {
    id: types.identifier,
    index: types.string,
    kind: types.literal('web'),
    width: types.number,
    isMaximized: types.boolean,
    isSleeping: types.boolean,
    profileId: types.string,
    soundMuted: types.boolean,
    isDeleted: types.boolean,
    deletedAt: types.maybeNull(types.number),
    createdAt: types.number,
    lastActiveAt: types.number,
    tabs: types.array(TabModel),
    activeTabId: nullableString,
    pinnedTabId: nullableString
  })
  .views((self) => ({
    get visibleTabs() {
      return sortByIndex(self.tabs.filter((t) => !t.isDeleted))
    },
    tabById(id: string) {
      return self.tabs.find((t) => t.id === id)
    }
  }))
  .views((self) => ({
    get activeTab() {
      return self.visibleTabs.find((t) => t.id === self.activeTabId) ?? self.visibleTabs[0]
    }
  }))
  .actions((self) => ({
    addTab(url: string, openerTabId: string | null): string {
      const { now, newId } = envOf(self)
      const visible = self.visibleTabs
      const refId = openerTabId ?? self.activeTabId
      const refAt = visible.findIndex((t) => t.id === refId)
      const at = refAt === -1 ? visible.length : refAt + 1
      const id = newId()
      self.tabs.push({
        id, index: keyForInsertAt(visible.map((t) => t.index), at), url: storableUrl(url), title: '', favicon: null,
        customName: null, customEmoji: null, isDeleted: false, openerTabId, createdAt: now()
      })
      self.activeTabId = id
      return id
    },
    setPinnedTab(tabId: string | null) {
      if (tabId === null || self.visibleTabs.some((t) => t.id === tabId)) self.pinnedTabId = tabId
    },
    setActiveTab(tabId: string) {
      if (self.visibleTabs.some((t) => t.id === tabId)) self.activeTabId = tabId
    },
    reorderTab(tabId: string, toIndex: number) {
      const tab = self.tabById(tabId)
      if (tab) tab.index = keyForMove(self.visibleTabs, tabId, toIndex)
    },
    /** Soft-deletes the tab. Returns false when no tabs are left, so the caller can close the card. */
    removeTab(tabId: string): boolean {
      const visible = self.visibleTabs
      const at = visible.findIndex((t) => t.id === tabId)
      if (at === -1) return visible.length > 0
      visible[at]?.softDelete()
      if (self.pinnedTabId === tabId) self.pinnedTabId = null
      const remaining = self.visibleTabs
      if (self.activeTabId === tabId) self.activeTabId = (remaining[at] ?? remaining[at - 1])?.id ?? null
      return remaining.length > 0
    }
  }))
  .actions((self) => ({
    setWidth(width: number, max: number) {
      self.width = Math.max(MIN_CARD_WIDTH, Math.min(Math.min(max, MAX_CARD_WIDTH), Math.round(width)))
      self.isMaximized = false
    },
    toggleMaximize() {
      self.isMaximized = !self.isMaximized
    },
    setSleeping(sleeping: boolean) {
      self.isSleeping = sleeping
    },
    touch() {
      self.lastActiveAt = envOf(self).now()
    },
    softDelete() {
      self.isDeleted = true
      self.deletedAt = envOf(self).now()
    }
  }))

export const StackModel = types.model('Stack', {
  id: types.identifier,
  index: types.string,
  cards: types.array(CardModel)
})

type StackInstance = Instance<typeof StackModel>

export const SpaceModel = types
  .model('Space', {
    id: types.identifier,
    index: types.string,
    name: types.string,
    emoji: types.string,
    defaultProfileId: types.string,
    stacks: types.array(StackModel),
    activeCardId: nullableString,
    isArchived: types.boolean,
    lastActiveAt: types.number
  })
  .views((self) => ({
    get visibleCards() {
      return sortByIndex<StackInstance>([...self.stacks]).flatMap((s) => sortByIndex(s.cards.filter((c) => !c.isDeleted)))
    },
    cardById(id: string) {
      for (const s of self.stacks) {
        const found = s.cards.find((c) => c.id === id)
        if (found) return found
      }
      return undefined
    }
  }))
  .views((self) => ({
    get activeCard() {
      return self.visibleCards.find((c) => c.id === self.activeCardId)
    }
  }))
  .actions((self) => ({
    openCard(args: { url: string; afterCardId?: string; profileId: string; openerTabId?: string | null }): string {
      const { now, newId } = envOf(self)
      const stack = sortByIndex<StackInstance>([...self.stacks])[0]
      if (!stack) throw new Error('Space has no stack')
      const visible = self.visibleCards.filter((c) => stack.cards.includes(c))
      const refAt = args.afterCardId ? visible.findIndex((c) => c.id === args.afterCardId) : -1
      const at = refAt === -1 ? visible.length : refAt + 1
      const t = now()
      const tabId = newId()
      const id = newId()
      stack.cards.push({
        id, index: keyForInsertAt(visible.map((c) => c.index), at), kind: 'web', width: DEFAULT_CARD_WIDTH,
        isMaximized: false, isSleeping: false, profileId: args.profileId, soundMuted: false, isDeleted: false,
        deletedAt: null, createdAt: t, lastActiveAt: t,
        tabs: [{
          id: tabId, index: keyBetween(null, null), url: storableUrl(args.url), title: '', favicon: null, customName: null,
          customEmoji: null, isDeleted: false, openerTabId: args.openerTabId ?? null, createdAt: t
        }],
        activeTabId: tabId, pinnedTabId: null
      })
      self.activeCardId = id
      self.lastActiveAt = t
      return id
    },
    setActiveCard(id: string) {
      const card = self.visibleCards.find((c) => c.id === id)
      if (!card) return
      self.activeCardId = id
      card.touch()
      self.lastActiveAt = envOf(self).now()
    },
    closeCard(id: string) {
      const visible = self.visibleCards
      const at = visible.findIndex((c) => c.id === id)
      if (at === -1) return
      visible[at]?.softDelete()
      if (self.activeCardId === id) {
        const remaining = self.visibleCards
        self.activeCardId = (remaining[at] ?? remaining[at - 1])?.id ?? null
      }
    }
  }))

const ProfileModel = types.model('Profile', { id: types.identifier, name: types.string })

const UiModel = types
  .model('Ui', {
    locale: types.enumeration(['en', 'ar']),
    searchEngine: types.string,
    activeSpaceId: nullableString
  })
  .actions((self) => ({
    setLocale(locale: 'en' | 'ar') {
      self.locale = locale
    },
    setSearchEngine(template: string) {
      if (template.includes('%s')) self.searchEngine = template
    }
  }))

export const RootModel = types
  .model('Root', {
    schemaVersion: types.literal(SCHEMA_VERSION),
    spaces: types.array(SpaceModel),
    profiles: types.array(ProfileModel),
    ui: UiModel,
    flags: types.map(types.boolean)
  })
  .views((self) => ({
    get activeSpace() {
      return self.spaces.find((s) => s.id === self.ui.activeSpaceId) ?? self.spaces[0]
    },
    findTab(tabId: string) {
      for (const space of self.spaces)
        for (const stack of space.stacks)
          for (const card of stack.cards) {
            const tab = card.tabById(tabId)
            if (tab) return { card, tab }
          }
      return undefined
    }
  }))
  .views((self) => ({
    get awakeTabs() {
      return (self.activeSpace?.visibleCards ?? []).flatMap((card) => {
        const tab = card.activeTab
        return card.isSleeping || !tab ? [] : [{ card, tab }]
      })
    }
  }))
  .actions((self) => {
    const space = () => {
      const s = self.activeSpace
      if (!s) throw new Error('No active space')
      return s
    }
    return {
      openCard(args: { url: string; afterCardId?: string; profileId?: string; openerTabId?: string | null }) {
        const s = space()
        return s.openCard({ ...args, profileId: args.profileId ?? s.defaultProfileId })
      },
      closeCard: (id: string) => space().closeCard(id),
      setActiveCard: (id: string) => space().setActiveCard(id),
      resizeCard: (id: string, width: number, max: number) => space().cardById(id)?.setWidth(width, max),
      toggleMaximize: (id: string) => space().cardById(id)?.toggleMaximize(),
      sleepCard: (id: string) => space().cardById(id)?.setSleeping(true),
      wakeCard: (id: string) => space().cardById(id)?.setSleeping(false),
      addTab(cardId: string, url: string, openerTabId: string | null = null): string {
        const card = space().cardById(cardId)
        if (!card) throw new Error(`Unknown card ${cardId}`)
        return card.addTab(url, openerTabId)
      },
      closeTab(cardId: string, tabId: string) {
        const s = space()
        const card = s.cardById(cardId)
        if (card && !card.removeTab(tabId)) s.closeCard(cardId)
      },
      setActiveTab: (cardId: string, tabId: string) => space().cardById(cardId)?.setActiveTab(tabId),
      reorderTab: (cardId: string, tabId: string, toIndex: number) => space().cardById(cardId)?.reorderTab(tabId, toIndex),
      applyTabState(state: TabState) {
        const { tabId, ...rest } = state
        self.findTab(tabId)?.tab.applyState(rest)
      },
      navigateTab(tabId: string, url: string): boolean {
        return self.findTab(tabId)?.tab.startNavigation(url) ?? false
      },
      setLocale: (locale: 'en' | 'ar') => self.ui.setLocale(locale),
      setSearchEngine: (template: string) => self.ui.setSearchEngine(template)
    }
  })

export type RootStoreInstance = Instance<typeof RootModel>
export type CardInstance = Instance<typeof CardModel>
export type TabInstance = Instance<typeof TabModel>

export function createRootStore(snapshot: PersistedRoot, env: StoreEnv): RootStoreInstance {
  return RootModel.create(snapshot as SnapshotIn<typeof RootModel>, env)
}
