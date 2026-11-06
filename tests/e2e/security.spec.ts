import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
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

const evalTab = (tabId: string, js: string) =>
  mainEval<unknown>(l.app, `h.evalInTab(${JSON.stringify(tabId)}, ${JSON.stringify(js)})`)

test('web pages get no app API, no Node, and denied permissions', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const body = l.shell.locator('[data-testid="card"][data-active="true"]').getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)

  expect(await evalTab(tabId, 'typeof window.ns')).toBe('undefined')
  expect(await evalTab(tabId, 'typeof require + "," + typeof process')).toBe('undefined,undefined')
  expect(await evalTab(tabId, 'new Promise((r) => navigator.geolocation.getCurrentPosition(() => r("granted"), (e) => r("code" + e.code)))')).toBe('code1')
  expect(await evalTab(tabId, 'Notification.requestPermission()')).toBe('denied')
})

test('pages cannot navigate themselves to file:, javascript: or chrome: URLs', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const body = l.shell.locator('[data-testid="card"][data-active="true"]').getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
  await evalTab(tabId, 'location.href = "file:///C:/Windows/win.ini"').catch(() => undefined)
  await l.shell.waitForTimeout(500)
  expect(await mainEval<string>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
})

test('certificate errors are not overridden anywhere', async () => {
  l = await launch()
  const listeners = await l.app.evaluate(({ app }) => app.listenerCount('certificate-error'))
  expect(listeners).toBe(0)
  const switches = await l.app.evaluate(({ app }) => ['ignore-certificate-errors', 'allow-insecure-localhost'].map((s) => app.commandLine.hasSwitch(s)))
  expect(switches).toEqual([false, false])
})

test('the shell window is sandboxed with context isolation', async () => {
  l = await launch()
  const info = await l.shell.evaluate(() => ({
    hasRequire: typeof (window as unknown as { require?: unknown }).require,
    hasProcess: typeof (window as unknown as { process?: unknown }).process,
    api: Object.keys((window as unknown as { ns: object }).ns).sort(),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
  }))
  expect(info.hasRequire).toBe('undefined')
  expect(info.hasProcess).toBe('undefined')
  expect(info.api).toEqual(['shell', 'store', 'tabs', 'views'])
  expect(info.csp).toContain("default-src 'none'")
  expect(info.csp).not.toContain('unsafe-eval')
  // The dev-only CSP plugin must never reach the built app: the shell's policy is the source policy, byte for byte.
  const source = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(readFileSync(resolve('src/renderer/index.html'), 'utf8'))?.[1]
  expect(info.csp).toBe(source)
  expect(info.csp).not.toMatch(/sha256|ws:/)
})
