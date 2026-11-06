import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import electronPath from 'electron'
import { cleanup, launch, mainEval, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

let fx: Fixture
let l: Launched
test.beforeAll(async () => {
  fx = await startFixtureServer()
})
test.afterAll(async () => {
  await fx.close()
})
test.afterEach(async () => {
  await cleanup(l)
})

const activeTabId = async () =>
  (await l.shell.locator('[data-testid="card"][data-active="true"] [data-testid="card-body"]').getAttribute('data-tab-id'))!
/**
 * A marker set inside the page; a new view for the same tab will not have it. Returns the marker's type from the
 * live view ('number' or 'undefined'), or null when the tab has no view at all.
 */
const marker = (tabId: string) =>
  mainEval<string | null>(l.app, `h.evalInTab(${JSON.stringify(tabId)}, 'typeof window.__nsMarker')`).catch(() => null) // a page being torn down has no marker
async function markPage(tabId: string) {
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
  await mainEval(l.app, `h.evalInTab(${JSON.stringify(tabId)}, 'window.__nsMarker = 42')`)
  expect(await marker(tabId)).toBe('number')
}

test('reloading the shell destroys the old tab views and the new shell recreates them', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const tabId = await activeTabId()
  await markPage(tabId)
  await l.shell.reload()
  await l.shell.waitForSelector('[data-testid="app-bar"]')
  await expect.poll(() => mainEval<string[]>(l.app, 'h.tabIds()')).toEqual([tabId])
  await expect.poll(() => marker(tabId)).toBe('undefined') // a fresh view for the same tab
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
})

test('a shell crash destroys the tab views and the shell comes back with the same card', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const tabId = await activeTabId()
  await markPage(tabId)
  // A crash loses whatever the shell had not sent yet (up to ~300 ms) plus main's 500 ms write delay, so crash
  // only once the page is in the saved file.
  await expect.poll(() => readFile(join(l.userData, 'state.json'), 'utf8').catch(() => ''), { timeout: 15_000 }).toContain(`${fx.origin}/a`)
  await mainEval(l.app, 'h.crashShell()')
  // Main destroys the old view, reloads the shell, and the shell wakes the saved tab in a fresh view.
  await expect.poll(() => marker(tabId), { timeout: 60_000 }).toBe('undefined')
  await expect.poll(() => mainEval<string[]>(l.app, 'h.tabIds()')).toEqual([tabId])
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
})

test('a second launch restores the existing window and exits', async () => {
  l = await launch()
  await l.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.minimize())
  await expect.poll(() => l.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.isMinimized())).toBe(true)

  const env: Record<string, string> = { ...(process.env as Record<string, string>), NS_USER_DATA_DIR: l.userData }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NS_E2E // the second instance must take the real single-instance path
  const second = spawn(electronPath as unknown as string, [resolve('.'), '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], { env })
  const code = await new Promise<number | null>((done) => second.on('exit', done))
  expect(code).toBe(0)
  await expect.poll(() => l.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.isMinimized())).toBe(false)
  expect(await l.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1)
})
