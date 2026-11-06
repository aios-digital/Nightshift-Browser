import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createDefaultRoot } from '../../src/shared/model/defaults'
import { cleanup, launch, newTab, mainEval, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

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

const card = () => l.shell.locator('[data-testid="card"][data-active="true"]')
const body = () => card().getByTestId('card-body')

test('tabs: add, switch, keep background pages alive, and closing the last tab closes the card', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await expect(card().getByTestId('tab')).toHaveCount(1)
  await newTab(l.shell)
  await expect(card().getByTestId('tab')).toHaveCount(2)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/b`)
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(2)

  await card().getByTestId('tab').first().getByRole('tab').click()
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/a`)
  // switching does not destroy the other tab's page
  expect(await mainEval<number>(l.app, 'h.viewCount()')).toBe(2)
  const activeTabId = (await body().getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<boolean | null>(l.app, `h.visible(${JSON.stringify(activeTabId)})`)).toBe(true)

  await card().getByTestId('tab').nth(1).getByRole('button', { name: 'Close tab' }).click()
  await expect(card().getByTestId('tab')).toHaveCount(1)
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(1)
  await card().getByTestId('tab').first().getByRole('button', { name: 'Close tab' }).click()
  await expect(l.shell.getByTestId('empty-open')).toBeVisible()
})

test('omnibox: URLs navigate, text searches Google by default, javascript: is never navigated', async () => {
  l = await launch()
  const input = card().locator('input')
  await input.fill('hello world')
  await input.press('Enter')
  await expect(body()).toHaveAttribute('data-url', 'https://www.google.com/search?q=hello%20world')

  await input.fill('javascript:alert(1)')
  await input.press('Enter')
  const url = (await body().getAttribute('data-url'))!
  expect(url.startsWith('https://www.google.com/search?q=javascript')).toBe(true)

  await navigateActiveCard(l.shell, `127.0.0.1:${new URL(fx.origin).port}/a`)
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/a`)
})

test('the search engine is a setting: a seeded engine is used', async () => {
  const dir = await (await import('node:fs/promises')).mkdtemp(join((await import('node:os')).tmpdir(), 'ns-e2e-seed-'))
  let i = 0
  const root = createDefaultRoot(Date.now(), () => `seed${++i}`)
  const seeded = { ...root, ui: { ...root.ui, searchEngine: `${fx.origin}/a?q=%s` } }
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'state.json'), JSON.stringify(seeded))
  l = await launch({ userData: dir })
  const input = card().locator('input')
  await input.fill('owls')
  await input.press('Enter')
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/a?q=owls`)
})

test('back, forward and reload work', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await expect(card().getByTestId('tab').first()).toContainText('Page A')
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await expect(card().getByTestId('tab').first()).toContainText('Page B')

  await card().getByRole('button', { name: 'Back' }).click()
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/a`)
  await card().getByRole('button', { name: 'Forward' }).click()
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/b`)

  await expect(body()).toHaveAttribute('data-loading', 'false')
  await card().getByRole('button', { name: /Reload|Stop/ }).click()
  await expect(body()).toHaveAttribute('data-url', `${fx.origin}/b`)
  await expect(card().getByTestId('tab').first()).toContainText('Page B')
})

test('sleeping a card destroys its view and waking reloads it', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(1)
  await card().getByTestId('sleep-toggle').click()
  await expect(card().getByTestId('sleeping')).toBeVisible()
  await expect(card()).toHaveAttribute('data-sleeping', 'true')
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(0)

  await card().getByRole('button', { name: 'Wake card' }).first().click()
  await expect(card()).toHaveAttribute('data-sleeping', 'false')
  await expect.poll(() => mainEval<number>(l.app, 'h.viewCount()')).toBe(1)
  const tabId = (await body().getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
})

test('a refused connection shows a plain-words error, in English and in Arabic', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.deadOrigin}/`)
  const err = l.shell.getByTestId('error-page')
  await expect(err).toBeVisible()
  await expect(err).toHaveAttribute('data-error-key', 'errors.refused')
  await expect(err).toContainText("That site isn't answering")
  await expect(err).not.toContainText('ERR_')
  const tabId = (await body().getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<boolean | null>(l.app, `h.visible(${JSON.stringify(tabId)})`)).toBe(false)

  await l.shell.getByTestId('language-toggle').click()
  await expect(err).toContainText('هذا الموقع لا يستجيب')
  await expect(err).not.toContainText('ERR_')

  // navigating to a good page clears the error and shows the view again
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await expect(err).toHaveCount(0)
  await expect.poll(() => mainEval<boolean | null>(l.app, `h.visible(${JSON.stringify(tabId)})`)).toBe(true)
})

test('target=_blank opens a new card after the opener, never a native window', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  const tabId = (await body().getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/a`)
  await mainEval(l.app, `h.evalInTab(${JSON.stringify(tabId)}, "document.getElementById('blank').click()")`)
  const cards = l.shell.locator('[data-testid="card"]')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(1).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/b`)
  await expect(cards.nth(1)).toHaveAttribute('data-active', 'true')
  expect(l.app.windows().filter((p) => !p.url().includes('renderer/index.html') && p.url().startsWith('http')).length).toBeLessThanOrEqual(2)
  expect(await mainEval<number>(l.app, 'h.viewCount()')).toBe(2)
})

test('a pop-up with a URL over the save limit opens nothing, and the state still saves and restores', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/long-popup`)
  const tabId = (await body().getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(tabId)})`)).toBe(`${fx.origin}/long-popup`)
  await mainEval(l.app, `h.evalInTab(${JSON.stringify(tabId)}, "document.getElementById('long').click()")`)
  await mainEval(l.app, `h.evalInTab(${JSON.stringify(tabId)}, "document.getElementById('ok').click()")`)
  const cards = l.shell.locator('[data-testid="card"]')
  await expect(cards).toHaveCount(2) // only the short pop-up opened a card
  await expect(cards.nth(1).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/b`)
  const userData = l.userData
  await l.close()
  const saved = JSON.parse(await (await import('node:fs/promises')).readFile(join(userData, 'state.json'), 'utf8'))
  expect(saved.spaces[0].stacks[0].cards).toHaveLength(2)
  l = await launch({ userData })
  await expect(l.shell.locator('[data-testid="card"]')).toHaveCount(2)
})
