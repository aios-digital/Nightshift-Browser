import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export type Fixture = { origin: string; deadOrigin: string; hits: (path: string) => number; close: () => Promise<void> }

/** A valid 1x1 PNG. */
export const ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'
)
/** Starts like a PNG but is 40 KiB, over the 32 KiB favicon cap. */
const ICON_BIG = Buffer.concat([ICON_PNG, Buffer.alloc(40 * 1024)])

const ICONS: Record<string, { type: string; body: Buffer | string }> = {
  '/icon.png': { type: 'image/png', body: ICON_PNG },
  '/icon-big.png': { type: 'image/png', body: ICON_BIG },
  '/icon-html': { type: 'text/html', body: '<!doctype html><p>not an icon</p>' }
}

/** Local pages for the browser to load, plus a port that refuses connections. Counts requests per path. */
export async function startFixtureServer(): Promise<Fixture> {
  const page = (title: string, body = '', head = '') =>
    `<!doctype html><html><head><title>${title}</title>${head}</head><body style="background:#fff"><h1>${title}</h1>${body}</body></html>`
  const counts = new Map<string, number>()
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    counts.set(url, (counts.get(url) ?? 0) + 1)
    if (url === '/icon-redirect') {
      res.statusCode = 302
      res.setHeader('location', '/icon.png')
      res.end()
      return
    }
    const icon = ICONS[url]
    if (icon) {
      res.setHeader('content-type', icon.type)
      res.end(icon.body)
      return
    }
    res.setHeader('content-type', 'text/html')
    if (url.startsWith('/fav-redirect')) res.end(page('Redirected icon', '', '<link rel="icon" href="/icon-redirect">'))
    else if (url.startsWith('/long-popup')) {
      res.end(page('Long popup', `<a id="long" target="_blank" href="/b?${'a'.repeat(9000)}">long</a><a id="ok" target="_blank" href="/b">ok</a>`))
    } else if (url.startsWith('/fav-bad')) {
      res.end(page('Bad icons', '', '<link rel="icon" href="/icon-big.png"><link rel="icon" href="/icon-html">'))
    } else if (url.startsWith('/fav')) res.end(page('With icon', '', '<link rel="icon" href="/icon.png">'))
    else if (url.startsWith('/a')) res.end(page('Page A', '<a id="blank" target="_blank" href="/b">open b</a>'))
    else if (url.startsWith('/b')) res.end(page('Page B', '<a href="/c">to c</a>'))
    else if (url.startsWith('/c')) res.end(page('Page C'))
    else res.end(page('Home'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port

  const dead = createServer()
  await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r))
  const deadPort = (dead.address() as AddressInfo).port
  await new Promise<void>((r) => dead.close(() => r())) // nothing listens here any more: connection refused

  return {
    origin: `http://127.0.0.1:${port}`,
    deadOrigin: `http://127.0.0.1:${deadPort}`,
    hits: (path: string) => counts.get(path) ?? 0,
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}

export type Launched = { app: ElectronApplication; shell: Page; userData: string; close: () => Promise<void> }

export async function launch(opts: { userData?: string; scale?: number } = {}): Promise<Launched> {
  const userData = opts.userData ?? (await mkdtemp(join(tmpdir(), 'ns-e2e-')))
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NS_E2E: '1',
    NS_USER_DATA_DIR: userData
  }
  delete env.ELECTRON_RUN_AS_NODE
  // Hermetic: every host except loopback fails fast, so no test depends on the real internet.
  const args = [resolve('.'), '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
  if (opts.scale) args.push(`--force-device-scale-factor=${opts.scale}`)
  const app = await electron.launch({ args, env, timeout: 60_000 })
  if (process.env.NS_E2E_DEBUG) app.process().stderr?.on('data', (d) => process.stderr.write(`[main] ${d}`))

  const isShell = (p: Page) => p.url().includes('renderer/index.html')
  let shell = app.windows().find(isShell)
  if (!shell) {
    shell = await app.waitForEvent('window', { predicate: isShell, timeout: 60_000 })
  }
  await shell.waitForSelector('[data-testid="app-bar"]')
  return {
    app,
    shell,
    userData,
    close: async () => {
      await app.close().catch(() => undefined)
    }
  }
}

export async function cleanup(l: Launched, removeData = true): Promise<void> {
  await l.close()
  if (removeData) await rm(l.userData, { recursive: true, force: true }).catch(() => undefined)
}

/** Reads a test hook value from the main process. */
export function mainEval<T>(app: ElectronApplication, expr: string): Promise<T> {
  return app.evaluate((_electron, e) => {
    const hook = (globalThis as unknown as { __nsTest: Record<string, (...a: never[]) => unknown> }).__nsTest
    return new Function('h', `return ${e}`)(hook)
  }, expr) as Promise<T>
}

/** Opens a new card from the app bar and waits until it is rendered, active and blank. */
export async function newCard(shell: Page): Promise<void> {
  const cards = shell.locator('[data-testid="card"]')
  const before = await cards.count()
  await shell.getByTestId('new-card').click()
  await cards.nth(before).waitFor()
  await shell
    .locator('[data-testid="card"][data-active="true"] [data-testid="card-body"][data-url="about:blank"]')
    .waitFor()
}

/** Adds a tab to the active card and waits until the new blank tab is the active one. */
export async function newTab(shell: Page): Promise<void> {
  const card = shell.locator('[data-testid="card"][data-active="true"]')
  const before = await card.getByTestId('tab').count()
  await card.getByTestId('new-tab').click()
  await card.getByTestId('tab').nth(before).waitFor()
  await card.locator('[data-testid="card-body"][data-url="about:blank"]').waitFor()
}

// Note on drags: Playwright sends synthetic mouse events while the real OS cursor stays parked. If a native page view
// slides under that parked cursor mid-drag, Chromium hands it a synthetic move and the shell loses pointer capture.
// Real drags hold OS mouse capture, so this only affects tests: keep test drags to one or two large steps.
export async function navigateActiveCard(shell: Page, url: string): Promise<void> {
  const input = shell.locator('[data-testid="card"][data-active="true"] input').first()
  await input.click()
  await input.fill(url)
  await input.press('Enter')
}
