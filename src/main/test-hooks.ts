import type { WebContentsView } from 'electron'

/**
 * E2E-only hooks, read by tests through `app.evaluate`. Installed only when NS_E2E=1 in an unpackaged build;
 * `evalInTab` runs arbitrary script in a page, so this must never be reachable in a packaged app.
 */
export function installTestHooks(views: ReadonlyMap<string, WebContentsView>, shell: WebContentsView): void {
  const wc = (tabId: string) => views.get(tabId)?.webContents
  ;(globalThis as Record<string, unknown>).__nsTest = {
    bounds: (tabId: string) => views.get(tabId)?.getBounds() ?? null,
    visible: (tabId: string) => views.get(tabId)?.getVisible() ?? null,
    viewCount: () => views.size,
    shellId: shell.webContents.id,
    tabIds: () => [...views.keys()],
    tabUrl: (tabId: string) => wc(tabId)?.getURL() ?? null,
    clickInTab: (tabId: string) => {
      wc(tabId)?.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 })
      wc(tabId)?.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 })
    },
    evalInTab: (tabId: string, js: string) => wc(tabId)?.executeJavaScript(js, true) ?? null,
    crashShell: () => shell.webContents.forcefullyCrashRenderer()
  }
}
