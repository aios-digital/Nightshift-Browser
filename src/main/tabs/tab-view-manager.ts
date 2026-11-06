import { openRequestSchema, type LayoutEntry, type OpenRequest, type TabState } from '@shared/ipc/schemas'
import { isAllowedNavigation } from '@shared/url/navigation-policy'
import { allowInWindow } from './rate-window'

export type ViewEvent =
  | { type: 'state'; state: Omit<TabState, 'tabId'> }
  | { type: 'open-request'; url: string }
  | { type: 'focus' }

export interface ManagedView {
  loadURL(url: string): Promise<void>
  setBounds(rect: { x: number; y: number; width: number; height: number }): void
  setVisible(visible: boolean): void
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  destroy(): void
  onEvent(cb: (event: ViewEvent) => void): () => void
}

export interface ViewFactory {
  create(args: { tabId: string; partition: string }): ManagedView
}

type Entry = { view: ManagedView; dispose: () => void }

type Handlers = {
  onState: (state: TabState) => void
  onOpenRequest: (request: OpenRequest) => void
  onFocus: (tabId: string) => void
}

const POPUP_LIMIT = 5
const POPUP_WINDOW_MS = 10_000

export function partitionFor(profileId: string): string {
  return `persist:profile-${profileId}`
}

/** Sends one page event to the right handler, tagged with its tab id. Pop-ups must be allowed URLs and in budget. */
export function routeViewEvent(tabId: string, event: ViewEvent, h: Handlers & { allowPopup: (tabId: string) => boolean }): void {
  if (event.type === 'state') h.onState({ tabId, ...event.state })
  else if (event.type === 'focus') h.onFocus(tabId)
  else {
    const request = openRequestSchema.safeParse({ openerTabId: tabId, url: event.url })
    if (request.success && h.allowPopup(tabId)) h.onOpenRequest(request.data)
  }
}

/** Places known views at the given integer DIP rects and hides every view missing from the payload. */
export function applyLayoutTo(entries: ReadonlyMap<string, Pick<Entry, 'view'>>, layout: readonly LayoutEntry[]): void {
  const seen = new Set<string>()
  for (const e of layout) {
    const entry = entries.get(e.tabId)
    if (!entry) continue
    seen.add(e.tabId)
    entry.view.setBounds({ x: e.x, y: e.y, width: e.w, height: e.h })
    entry.view.setVisible(e.visible)
  }
  for (const [tabId, entry] of entries) if (!seen.has(tabId)) entry.view.setVisible(false)
}

/** At most POPUP_LIMIT pop-ups per page per POPUP_WINDOW_MS, so a page cannot flood the row with cards. */
function createPopupBudget(now: () => number) {
  let history = new Map<string, readonly number[]>()
  return {
    allow(tabId: string): boolean {
      const r = allowInWindow(history.get(tabId) ?? [], now(), POPUP_LIMIT, POPUP_WINDOW_MS)
      history = new Map(history).set(tabId, r.history)
      return r.allowed
    },
    forget(tabId: string) {
      history = new Map([...history].filter(([id]) => id !== tabId))
    }
  }
}

/** Owns the live view for each awake tab. Knows nothing about Electron; the factory supplies real views. */
export function createTabViewManager(opts: Handlers & { factory: ViewFactory; now?: () => number }) {
  const entries = new Map<string, Entry>()
  const popups = createPopupBudget(opts.now ?? Date.now)
  const allowPopup = popups.allow
  const remove = (tabId: string) => {
    const entry = entries.get(tabId)
    if (!entry) return
    entries.delete(tabId)
    popups.forget(tabId)
    entry.dispose()
    entry.view.destroy()
  }
  const withView = (tabId: string, fn: (v: ManagedView) => void) => {
    const entry = entries.get(tabId)
    if (entry) fn(entry.view)
  }
  // Load failures are reported through did-fail-load events, so the promise is only kept from going unhandled.
  const loadSafely = (view: ManagedView, url: string) => void view.loadURL(url).catch(() => undefined)

  return {
    has: (tabId: string) => entries.has(tabId),
    /** Creates the tab's view if needed. Returns whether a view exists afterwards. */
    wake(args: { tabId: string; profileId: string; url: string }): boolean {
      if (entries.has(args.tabId)) return true
      if (!isAllowedNavigation(args.url)) return false
      const view = opts.factory.create({ tabId: args.tabId, partition: partitionFor(args.profileId) })
      const dispose = view.onEvent((event) => routeViewEvent(args.tabId, event, { ...opts, allowPopup }))
      entries.set(args.tabId, { view, dispose })
      loadSafely(view, args.url)
      return true
    },
    navigate: (tabId: string, url: string) => {
      if (isAllowedNavigation(url)) withView(tabId, (v) => loadSafely(v, url))
    },
    applyLayout: (layout: readonly LayoutEntry[]) => applyLayoutTo(entries, layout),
    back: (tabId: string) => withView(tabId, (v) => v.goBack()),
    forward: (tabId: string) => withView(tabId, (v) => v.goForward()),
    reload: (tabId: string) => withView(tabId, (v) => v.reload()),
    stop: (tabId: string) => withView(tabId, (v) => v.stop()),
    sleep: remove,
    close: remove,
    destroyAll: () => [...entries.keys()].forEach(remove)
  }
}

export type TabViewManager = ReturnType<typeof createTabViewManager>
