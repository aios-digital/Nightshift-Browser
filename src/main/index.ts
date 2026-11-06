import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, Menu, type BaseWindow, type WebContentsView } from 'electron'
import { CH } from '@shared/ipc/channels'
import { sameAppUrl } from './ipc/guard'
import { registerIpc } from './ipc/register'
import { createRendererFlush } from './lifecycle/renderer-flush'
import { watchShell } from './lifecycle/shell-lifecycle'
import { installShutdown } from './lifecycle/shutdown'
import { focusExistingWindow } from './lifecycle/single-instance'
import { createStoreService } from './store/store-service'
import { createElectronViewFactory } from './tabs/electron-view-factory'
import { createTabViewManager } from './tabs/tab-view-manager'
import { installTestHooks } from './test-hooks'
import { createShellWindow } from './window/create-window'

const FLUSH_TIMEOUT_MS = 500 // never hang the quit if the renderer is gone
const log = (line: string) => process.stderr.write(`${line}\n`)

// Set at build time (`electron-vite build --mode e2e`). In a normal build it is the constant false, so the bundler
// removes the test hooks and the E2E switches entirely.
declare const __NS_TEST_BUILD__: boolean

// Development and test switches are ignored in a packaged build.
const DEV = !app.isPackaged
if (DEV && process.env.NS_USER_DATA_DIR) app.setPath('userData', process.env.NS_USER_DATA_DIR)
const E2E = __NS_TEST_BUILD__ && DEV && process.env.NS_E2E === '1'
const DEV_RENDERER_URL = DEV ? process.env.ELECTRON_RENDERER_URL : undefined

// Never hand a client certificate to a site without asking; there is no chooser yet.
app.on('select-client-certificate', (event, _wc, _url, _list, callback) => {
  event.preventDefault()
  callback()
})

if (!app.requestSingleInstanceLock() && !E2E) {
  app.quit()
} else {
  void start()
}

const openStore = () =>
  createStoreService({
    dir: app.getPath('userData'),
    now: () => Date.now(),
    newId: () => randomUUID(),
    debounceMs: 500,
    onError: (error) => log(`[store] ${String(error)}`),
    onLog: log
  })

/** The tab view manager, reporting page events to the shell. `views` lets the E2E hooks find views by tab id. */
function createTabs(window: BaseWindow, shell: WebContentsView, views: Map<string, WebContentsView>) {
  const send = (channel: string, payload: unknown) => {
    if (!shell.webContents.isDestroyed()) shell.webContents.send(channel, payload)
  }
  const tabs = createTabViewManager({
    factory: createElectronViewFactory(window, views),
    onState: (state) => send(CH.tabState, state),
    onOpenRequest: (request) => send(CH.tabOpenRequest, request),
    onFocus: (tabId) => send(CH.tabFocus, { tabId })
  })
  return { tabs, send }
}

async function start(): Promise<void> {
  await app.whenReady()
  Menu.setApplicationMenu(null)
  const store = openStore()
  const rendererFile = join(__dirname, '../renderer/index.html')
  const appUrl = DEV_RENDERER_URL ?? pathToFileURL(rendererFile).href
  const { window, shell } = createShellWindow({
    preloadPath: join(__dirname, '../preload/index.js'),
    iconPath: join(app.getAppPath(), 'resources/icon.png'),
    appUrl
  })
  app.on('second-instance', () => focusExistingWindow(window))

  const views = new Map<string, WebContentsView>()
  const { tabs, send } = createTabs(window, shell, views)
  const rendererFlush = createRendererFlush(send, FLUSH_TIMEOUT_MS)
  const disposeIpc = registerIpc({
    shell: shell.webContents,
    appUrl,
    store,
    tabs,
    onFlushDone: rendererFlush.done,
    onReject: (channel, reason) => log(`[ipc] rejected ${channel}: ${reason}`)
  })
  if (E2E) installTestHooks(views, shell)

  const shutdown = installShutdown({
    app,
    window,
    requestRendererFlush: rendererFlush.request,
    flushStore: () => store.flush(),
    teardown: () => {
      disposeIpc()
      tabs.destroyAll()
    },
    onError: (error) => log(`[shutdown] ${String(error)}`)
  })
  watchShell({
    contents: shell.webContents,
    destroyAllTabs: tabs.destroyAll,
    reload: () => shell.webContents.reload(),
    isShuttingDown: shutdown.isShuttingDown,
    isAppUrl: (url) => sameAppUrl(url, appUrl),
    now: Date.now,
    onLog: log
  })
  app.on('window-all-closed', () => app.quit())
}
