import type { WebContents } from 'electron'
import type { NavEvent } from './nav-state'
import type { ViewEvent } from './tab-view-manager'

export type ViewEventSink = {
  /** Applies a navigation event. Returns whether the navigation state changed. */
  dispatch(event: NavEvent): boolean
  /** Reports the current tab state; `loading` defaults to the page's own loading flag. */
  publish(loading?: boolean): void
  emit(event: ViewEvent): void
  favicons(urls: readonly string[]): void
}

/** Turns a tab's WebContents events into navigation events and reports. Needs a real Electron runtime (E2E). */
export function wireViewEvents(wc: WebContents, sink: ViewEventSink): void {
  wc.setWindowOpenHandler(({ url }) => {
    sink.emit({ type: 'open-request', url })
    return { action: 'deny' }
  })
  wc.on('did-start-navigation', (d) => {
    sink.dispatch({ type: 'start-navigation', url: d.url, isMainFrame: d.isMainFrame, isSameDocument: d.isSameDocument })
  })
  wc.on('did-start-loading', () => sink.publish(true))
  wc.on('did-stop-loading', () => sink.publish(false))
  wc.on('did-navigate', (_e, url) => {
    sink.dispatch({ type: 'did-navigate', url })
    sink.publish()
  })
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    sink.dispatch({ type: 'in-page', url, isMainFrame })
    sink.publish()
  })
  wc.on('page-title-updated', () => sink.publish())
  wc.on('page-favicon-updated', (_e, urls) => sink.favicons(urls))
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (sink.dispatch({ type: 'fail', code, url, isMainFrame })) sink.publish(false)
  })
  wc.on('render-process-gone', () => {
    sink.dispatch({ type: 'crash' })
    sink.publish(false)
  })
  // Only real user input makes this card active. Chromium may focus a view by itself when a page loads,
  // and treating that as a click would steal the active card from the one the user is working in.
  wc.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown' || input.type === 'touchStart') sink.emit({ type: 'focus' })
  })
}
