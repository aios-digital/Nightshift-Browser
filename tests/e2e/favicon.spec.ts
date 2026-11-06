import { expect, test } from '@playwright/test'
import { cleanup, ICON_PNG, launch, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

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

const activeTabIcon = () => l.shell.locator('[data-testid="card"][data-active="true"] [data-testid="tab"] img')

test('the favicon is fetched by main and shown as a data: URL; the shell never requests it', async () => {
  l = await launch()
  const shellRequests: string[] = []
  l.shell.on('request', (r) => shellRequests.push(r.url()))
  await navigateActiveCard(l.shell, `${fx.origin}/fav`)
  await expect(activeTabIcon()).toHaveAttribute('src', `data:image/png;base64,${ICON_PNG.toString('base64')}`)
  expect(fx.hits('/icon.png')).toBeGreaterThanOrEqual(1)
  expect(shellRequests.filter((u) => u.startsWith('http'))).toEqual([])
})

test('oversized or non-image favicons are not shown', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/fav-bad`)
  await expect(l.shell.locator('[data-testid="card"][data-active="true"] [data-testid="tab"]')).toContainText('Bad icons')
  await expect.poll(() => fx.hits('/icon-html')).toBeGreaterThanOrEqual(1) // both candidates were tried
  expect(fx.hits('/icon-big.png')).toBeGreaterThanOrEqual(1)
  await expect(activeTabIcon()).toHaveCount(0)
})

test('the shell CSP blocks http images', async () => {
  l = await launch()
  const before = fx.hits('/icon.png')
  const loaded = await l.shell.evaluate(
    (src) =>
      new Promise<boolean>((resolve) => {
        const img = new Image()
        img.onload = () => resolve(true)
        img.onerror = () => resolve(false)
        img.src = src
      }),
    `${fx.origin}/icon.png`
  )
  expect(loaded).toBe(false)
  expect(fx.hits('/icon.png')).toBe(before)
})

test('an icon that redirects is followed by hand and still shown', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/fav-redirect`)
  await expect(activeTabIcon()).toHaveAttribute('src', `data:image/png;base64,${ICON_PNG.toString('base64')}`)
  expect(fx.hits('/icon-redirect')).toBeGreaterThanOrEqual(1)
})
