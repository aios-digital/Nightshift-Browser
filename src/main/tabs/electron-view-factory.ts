import { session, WebContentsView, type BaseWindow, type Session, type WebContents } from 'electron'
import { pickFaviconCandidates } from '@shared/favicon/favicon'
import { createFaviconFetcher, fetchFirstFavicon } from './favicon-fetcher'
import { allowInWindow } from './rate-window'
import { sessionFetch } from './session-fetch'
import { iconChange, INITIAL_NAV, reduceNav, toTabState, type NavEvent, type NavState } from './nav-state'
import { guardNavigation, hardenSession, refuseBluetooth } from './session-hardening'
import type { ManagedView, ViewEvent, ViewFactory } from './tab-view-manager'
import { wireViewEvents } from './view-events'

const NIGHT = '#0E1530'

/** A hidden, sandboxed view in the profile's own session. Web content gets no preload. */
function createTabWebView(window: BaseWindow, partition: string): WebContentsView {
  const ses = session.fromPartition(partition)
  hardenSession(ses)
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  view.setBackgroundColor(NIGHT)
  view.setVisible(false)
  window.contentView.addChildView(view)
  return view
}

const ICON_FETCHES = { limit: 3, windowMs: 10_000 }

/**
 * Fetches a page's icon through the tab's own session. A newer icon list or a newly committed page aborts the
 * previous fetch, a result is only used if it still belongs to the current page, and each tab may start at most
 * 3 icon fetches per 10 s (a page cannot use icon changes to make the browser send a stream of requests).
 */
function createFaviconLoader(ses: Session) {
  const fetchOne = createFaviconFetcher({ fetch: sessionFetch(ses) })
  let current = new AbortController()
  let starts: readonly number[] = []
  const reset = () => {
    current.abort()
    current = new AbortController()
  }
  return {
    reset,
    load(urls: readonly string[], pageUrl: string, onIcon: (dataUrl: string) => void) {
      reset()
      const ctl = current
      const candidates = pickFaviconCandidates(urls, pageUrl)
      if (candidates.length === 0) return
      const budget = allowInWindow(starts, Date.now(), ICON_FETCHES.limit, ICON_FETCHES.windowMs)
      starts = budget.history
      if (!budget.allowed) return
      void fetchFirstFavicon((url, signal) => fetchOne(url, pageUrl, signal), candidates, ctl.signal).then((icon) => {
        if (icon && ctl === current && !ctl.signal.aborted) onIcon(icon)
      })
    },
    dispose: () => current.abort()
  }
}

/** The plain pass-through controls of a view. */
const viewControls = (view: WebContentsView): Pick<ManagedView, 'setBounds' | 'setVisible' | 'goBack' | 'goForward' | 'reload' | 'stop'> => ({
  setBounds: (rect) => view.setBounds(rect),
  setVisible: (visible) => view.setVisible(visible),
  goBack: () => view.webContents.navigationHistory.goBack(),
  goForward: () => view.webContents.navigationHistory.goForward(),
  reload: () => view.webContents.reload(),
  stop: () => view.webContents.stop()
})

/** Holds a view's navigation state (reduced by nav-state.ts) and builds its reports for the shell. */
function createNavTracker(wc: WebContents) {
  let nav: NavState = INITIAL_NAV
  let clearIcon = false // set when a different origin commits; the next report tells the shell to drop the icon
  return {
    committed: () => nav.committed,
    dispatch(event: NavEvent) {
      const next = reduceNav(nav, event)
      const icon = iconChange(nav, next, event)
      clearIcon = clearIcon || icon.clear
      const changed = next !== nav
      nav = next
      return { changed, icon }
    },
    state(loading: boolean) {
      const h = wc.navigationHistory
      const s = toTabState(nav, { title: wc.getTitle(), loading, canGoBack: h.canGoBack(), canGoForward: h.canGoForward() })
      if (!clearIcon) return s
      clearIcon = false
      return { ...s, favicon: null }
    }
  }
}

/** Wraps a real view as a ManagedView. Navigation state lives in a pure reducer (nav-state.ts). */
function toManagedView(view: WebContentsView, onDestroy: () => void): ManagedView {
  const wc = view.webContents
  const listeners = new Set<(event: ViewEvent) => void>()
  const emit = (event: ViewEvent) => listeners.forEach((l) => l(event))
  const icons = createFaviconLoader(wc.session)
  const nav = createNavTracker(wc)
  const dispatch = (event: NavEvent) => {
    const { changed, icon } = nav.dispatch(event)
    if (icon.abort) icons.reset()
    return changed
  }
  const publish = (loading = wc.isLoading()) => {
    if (!wc.isDestroyed()) emit({ type: 'state', state: nav.state(loading) })
  }
  const favicons = (urls: readonly string[]) =>
    icons.load(urls, nav.committed(), (favicon) => {
      if (!wc.isDestroyed()) emit({ type: 'state', state: { ...nav.state(wc.isLoading()), favicon } })
    })
  wireViewEvents(wc, { dispatch, publish, emit, favicons })
  guardNavigation(wc)
  refuseBluetooth(wc)

  return {
    loadURL: (url) => {
      dispatch({ type: 'load-requested', url })
      return wc.loadURL(url).finally(() => dispatch({ type: 'load-settled', url }))
    },
    ...viewControls(view),
    onEvent(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    destroy() {
      listeners.clear()
      icons.dispose()
      onDestroy()
      if (!wc.isDestroyed()) wc.close()
    }
  }
}

/** Real WebContentsView per tab. `registry` lets the E2E test hooks look views up by tab id. */
export function createElectronViewFactory(window: BaseWindow, registry?: Map<string, WebContentsView>): ViewFactory {
  return {
    create({ tabId, partition }): ManagedView {
      const view = createTabWebView(window, partition)
      registry?.set(tabId, view)
      return toManagedView(view, () => {
        registry?.delete(tabId)
        window.contentView.removeChildView(view)
      })
    }
  }
}
