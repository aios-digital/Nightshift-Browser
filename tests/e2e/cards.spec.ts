import { expect, test, type Locator } from '@playwright/test'
import { cleanup, launch, newCard, mainEval, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

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

const cards = () => l.shell.locator('[data-testid="card"]')
const handle = (card: Locator) => card.locator('[role="separator"]')

async function nativeMatchesDom(tabId: string, body: Locator) {
  const dom = (await body.boundingBox())!
  const native = await mainEval<{ x: number; y: number; width: number; height: number }>(l.app, `h.bounds(${JSON.stringify(tabId)})`)
  expect(Math.abs(native.x - dom.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.y - dom.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.width - dom.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(native.height - dom.height)).toBeLessThanOrEqual(1)
}

test('opens several cards that each load a real page', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await newCard(l.shell)
  await expect(cards()).toHaveCount(2)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await newCard(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/c`)
  await expect(cards()).toHaveCount(3)
  // Compare ids, not counts, so a failure names the extra or missing view.
  const domTabIds = async () => (await l.shell.locator('[data-testid="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab-id')))).sort()
  const mainTabIds = async () => (await mainEval<string[]>(l.app, 'h.tabIds()')).sort()
  await expect.poll(async () => ({ main: await mainTabIds(), dom: await domTabIds() })).toEqual({ main: await domTabIds(), dom: await domTabIds() })
  const titles = await l.shell.locator('[data-testid="tab"]').allInnerTexts()
  expect(titles.join('|')).toContain('Page A')
})

test('resizes a card with a 300 px minimum, then maximizes and restores it by double-click', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const card = cards().first()
  await expect(card).toHaveAttribute('data-width', '1200')

  const box = (await handle(card).boundingBox())!
  await l.shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await l.shell.mouse.down()
  // One move per drag: see the note on synthetic drags in helpers.ts (pointer capture can be lost between moves).
  await l.shell.mouse.move(Math.max(2, box.x - 1100), box.y + 20, { steps: 1 })
  await l.shell.mouse.up()
  await expect(card).toHaveAttribute('data-width', '300')

  const box2 = (await handle(card).boundingBox())!
  await l.shell.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
  await l.shell.mouse.down()
  await l.shell.mouse.move(box2.x + 250, box2.y + 20, { steps: 1 })
  await l.shell.mouse.up()
  // Wait for the resize to land instead of sampling once; the row re-renders a frame or more after the drag ends.
  await expect.poll(async () => Number(await card.getAttribute('data-width'))).toBeGreaterThan(450)
  expect(Number(await card.getAttribute('data-width'))).toBeLessThan(600)

  // the native view follows the new size
  const body = card.getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(async () => Math.abs((await mainEval<{ width: number }>(l.app, `h.bounds(${JSON.stringify(tabId)})`)).width - (await body.boundingBox())!.width)).toBeLessThanOrEqual(1)

  // double-click on the tab strip's empty area maximizes
  const strip = (await card.getByTestId('tab-strip').boundingBox())!
  await l.shell.mouse.dblclick(strip.x + strip.width - 12, strip.y + strip.height / 2)
  await expect(card).toHaveAttribute('data-maximized', 'true')
  const row = (await l.shell.getByTestId('card-row').boundingBox())!
  const cardBox = (await card.boundingBox())!
  expect(Math.abs(cardBox.width - (row.width - 24))).toBeLessThanOrEqual(2)
  await expect.poll(async () => nativeMatchesDom(tabId, body).then(() => true).catch(() => false)).toBe(true)

  await l.shell.mouse.dblclick(strip.x + strip.width - 12, strip.y + strip.height / 2)
  await expect(card).toHaveAttribute('data-maximized', 'false')
})

test('closes a card, destroys its view, and the next card becomes active', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await newCard(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(2)
  await cards().nth(1).getByTestId('close-card').click()
  await expect(cards()).toHaveCount(1)
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(1)
  await expect(cards().first()).toHaveAttribute('data-active', 'true')
  await cards().first().getByTestId('close-card').click()
  await expect(l.shell.getByTestId('empty-open')).toBeVisible()
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(0)
})

test('scrolling the row keeps native views glued to their cards', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  for (let i = 0; i < 3; i++) {
    await newCard(l.shell)
    await navigateActiveCard(l.shell, `${fx.origin}/${'bc'[i % 2]}`)
  }
  await expect(cards()).toHaveCount(4)
  const row = l.shell.getByTestId('card-row')
  const overflow = await row.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(overflow).toBe(true)

  await row.evaluate((el) => (el.scrollLeft = 900))
  const last = cards().nth(3)
  const body = last.getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(async () => nativeMatchesDom(tabId, body).then(() => true).catch(() => false)).toBe(true)
})

test('fractional DPI: native views still match at 150% scale', async () => {
  l = await launch({ scale: 1.5 })
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const body = cards().first().getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
  await expect.poll(async () => nativeMatchesDom(tabId, body).then(() => true).catch(() => false)).toBe(true)
})

test('clicking inside a page makes its card active, but a page loading by itself does not', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await newCard(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await expect(cards().nth(1)).toHaveAttribute('data-active', 'true')
  // card 0 reloading on its own must not steal the active card
  const first = cards().nth(0).getByTestId('card-body')
  const firstTab = (await first.getAttribute('data-tab-id'))!
  await mainEval(l.app, `h.evalInTab(${JSON.stringify(firstTab)}, "location.reload()")`)
  await l.shell.waitForTimeout(1500)
  await expect(cards().nth(1)).toHaveAttribute('data-active', 'true')
  // a real click inside card 0's page does
  await mainEval(l.app, `h.clickInTab(${JSON.stringify(firstTab)})`)
  await expect(cards().nth(0)).toHaveAttribute('data-active', 'true')
})
