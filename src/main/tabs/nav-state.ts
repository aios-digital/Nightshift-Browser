import { describeLoadError, type LoadErrorKey } from '@shared/errors/load-errors'
import type { TabState } from '@shared/ipc/schemas'
import { MAX_TITLE_LENGTH } from '@shared/model/persisted-schema'
import { isAllowedNavigation } from '@shared/url/navigation-policy'

const ERR_ABORTED = -3

/**
 * What a tab view knows about its own navigation, kept separate from Electron so it can be unit-tested.
 * - `committed`: the last URL from a committed main-frame navigation. Only these are ever reported.
 * - `intended`: set by loadURL(x). Until navigation to x has started, older commits (such as a new view's initial
 *   about:blank) are ignored and x is reported, so a late commit can never overwrite the tab's real URL.
 */
export type NavState = Readonly<{
  intended: string | null
  committed: string
  error?: Readonly<{ code: number; key: LoadErrorKey }>
}>

export type NavEvent =
  | { type: 'load-requested'; url: string }
  | { type: 'load-settled'; url: string }
  | { type: 'start-navigation'; url: string; isMainFrame: boolean; isSameDocument: boolean }
  | { type: 'did-navigate'; url: string }
  | { type: 'in-page'; url: string; isMainFrame: boolean }
  | { type: 'fail'; code: number; url: string; isMainFrame: boolean }
  | { type: 'crash' }

export type PageFacts = { title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

export const INITIAL_NAV: NavState = Object.freeze({ intended: null, committed: '' })

export function normalUrl(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

const withoutError = ({ intended, committed }: NavState): NavState => ({ intended, committed })

const commit = (s: NavState, url: string): NavState =>
  s.intended === null && isAllowedNavigation(url) ? { ...s, committed: url } : s

function onStart(s: NavState, e: Extract<NavEvent, { type: 'start-navigation' }>): NavState {
  if (!e.isMainFrame || e.isSameDocument) return s
  const cleared = withoutError(s)
  return cleared.intended !== null && normalUrl(e.url) === cleared.intended ? { ...cleared, intended: null } : cleared
}

function onFail(s: NavState, e: Extract<NavEvent, { type: 'fail' }>): NavState {
  if (!e.isMainFrame || e.code === ERR_ABORTED) return s
  const key = describeLoadError(e.code)
  if (!key) return s
  return { ...commit({ ...s, intended: null }, e.url), error: { code: e.code, key } }
}

/** Pure navigation reducer. Returns the same reference when an event changes nothing. */
export function reduceNav(s: NavState, e: NavEvent): NavState {
  switch (e.type) {
    case 'load-requested':
      return { ...s, intended: normalUrl(e.url) }
    case 'load-settled':
      return s.intended === normalUrl(e.url) ? { ...s, intended: null } : s
    case 'start-navigation':
      return onStart(s, e)
    case 'did-navigate':
      return commit(s, e.url)
    case 'in-page':
      return e.isMainFrame ? commit(s, e.url) : s
    case 'fail':
      return onFail(s, e)
    case 'crash':
      return { ...s, error: { code: -1, key: 'errors.generic' } }
  }
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * What an event means for the tab's icon. Only a committed new document aborts the pending icon fetch (a
 * navigation that merely starts may be cancelled, e.g. a download or a blocked URL). Committing a different origin
 * also clears the old site's icon, so a site that has no usable icon never shows the previous site's.
 */
export function iconChange(prev: NavState, next: NavState, event: NavEvent): { abort: boolean; clear: boolean } {
  const clear = prev.committed !== next.committed && originOf(prev.committed) !== originOf(next.committed)
  return { abort: event.type === 'did-navigate', clear }
}

/** The tab state reported to the renderer. Titles are hidden on errors and blank pages, and bounded. */
export function toTabState(s: NavState, page: PageFacts): Omit<TabState, 'tabId'> {
  return {
    url: s.intended ?? s.committed,
    title: s.error || s.committed === 'about:blank' ? '' : page.title.slice(0, MAX_TITLE_LENGTH),
    loading: page.loading,
    canGoBack: page.canGoBack,
    canGoForward: page.canGoForward,
    ...(s.error ? { error: s.error } : {})
  }
}
