import { expect, test } from '@playwright/test'
import { cleanup, launch, mainEval, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

let fx: Fixture
test.beforeAll(async () => {
  fx = await startFixtureServer()
})
test.afterAll(async () => {
  await fx.close()
})

let l: Launched
test.afterEach(async () => {
  await cleanup(l)
})

test('launches with the app bar, owl mark and bundled fonts, with no external requests', async () => {
  l = await launch()
  const external: string[] = []
  l.shell.on('request', (r) => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.push(r.url())
  })
  await l.shell.reload()
  await l.shell.waitForSelector('[data-testid="owl"]')
  const owl = await l.shell.locator('[data-testid="owl"]').boundingBox()
  expect(owl?.width).toBe(22)
  expect(owl?.height).toBe(22)
  const fonts = await l.shell.evaluate(async () => {
    const loaded = await Promise.all([
      document.fonts.load('700 16px "Bricolage Grotesque"', 'N'),
      document.fonts.load('400 16px "IBM Plex Sans"', 'N'),
      document.fonts.load('400 16px "IBM Plex Sans Arabic"', 'ع')
    ])
    return loaded.map((faces) => faces.length > 0 && faces.every((f) => f.status === 'loaded'))
  })
  expect(fonts).toEqual([true, true, true])
  expect(external).toEqual([])
  await expect(l.shell.locator('[data-testid="card"]')).toHaveCount(1)
})

test('loads a real page into a native view that sits exactly on the card body', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const body = l.shell.locator('[data-testid="card-body"]')
  await expect(body).toHaveAttribute('data-url', `${fx.origin}/a`)
  const tabId = (await body.getAttribute('data-tab-id')) as string
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
  await expect.poll(() => mainEval<boolean | null>(l.app, `h.visible(${JSON.stringify(tabId)})`)).toBe(true)

  const dom = await body.boundingBox()
  const native = await mainEval<{ x: number; y: number; width: number; height: number }>(l.app, `h.bounds(${JSON.stringify(tabId)})`)
  expect(Math.abs(native.x - dom!.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.y - dom!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.width - dom!.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.height - dom!.height)).toBeLessThanOrEqual(1)
  await expect(l.shell.locator('[data-testid="tab"]').first()).toContainText('Page A')
})
