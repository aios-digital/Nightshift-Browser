import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createCard, createDefaultRoot } from '../../src/shared/model/defaults'
import type { PersistedRoot } from '../../src/shared/model/persisted-schema'
import { cleanup, launch, newCard, newTab, mainEval, navigateActiveCard, startFixtureServer, type Fixture, type Launched } from './helpers'

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

test('Arabic mirrors the layout: dir=rtl, card 0 at the right edge, URLs stay left-to-right', async () => {
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/a`)
  await newCard(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)

  const vw = await l.shell.evaluate(() => window.innerWidth)
  const ltr0 = (await cards().nth(0).boundingBox())!
  const ltr1 = (await cards().nth(1).boundingBox())!
  expect(ltr0.x).toBeLessThan(ltr1.x)
  expect(ltr0.x).toBeLessThanOrEqual(14)

  await l.shell.getByTestId('language-toggle').click()
  await expect(l.shell.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(l.shell.locator('html')).toHaveAttribute('lang', 'ar')

  await expect.poll(async () => {
    const b = (await cards().nth(0).boundingBox())!
    return Math.round(vw - (b.x + b.width))
  }).toBeLessThanOrEqual(14)
  const rtl0 = (await cards().nth(0).boundingBox())!
  const rtl1 = (await cards().nth(1).boundingBox())!
  expect(rtl1.x).toBeLessThan(rtl0.x) // card 1 sits to the left of card 0

  // app bar content starts on the right in RTL; caption buttons are on the right, so there is physical padding there
  const owl = (await l.shell.getByTestId('owl').boundingBox())!
  expect(owl.x).toBeLessThan(vw - 138)

  // URL fields are always LTR
  await expect(cards().nth(0).locator('input')).toHaveAttribute('dir', 'ltr')
  // UI strings are Arabic
  await expect(l.shell.getByTestId('new-card')).toContainText('بطاقة جديدة')

  // native views mirror too: main just gets physical rects
  const body = cards().nth(0).getByTestId('card-body')
  const tabId = (await body.getAttribute('data-tab-id'))!
  await expect.poll(async () => {
    const dom = (await body.boundingBox())!
    const native = await mainEval<{ x: number; width: number }>(l.app, `h.bounds(${JSON.stringify(tabId)})`)
    return Math.abs(native.x - dom.x) <= 1 && Math.abs(native.width - dom.width) <= 1
  }).toBe(true)

  await l.shell.getByTestId('language-toggle').click()
  await expect(l.shell.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('resizing mirrors in RTL: dragging the left edge to the left grows the card', async () => {
  l = await launch()
  await l.shell.getByTestId('language-toggle').click()
  const card = cards().first()
  await expect(card).toHaveAttribute('data-width', '1200')
  const h = (await card.locator('[role="separator"]').boundingBox())!
  await l.shell.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await l.shell.mouse.down()
  await l.shell.mouse.move(h.x + 300, h.y + 20, { steps: 1 }) // toward the card, so it shrinks in RTL
  await l.shell.mouse.up()
  const w = Number(await card.getAttribute('data-width'))
  expect(w).toBeLessThan(1000)
})

test('restart restores the same cards, tabs, widths, URLs, favicons and language', async () => {
  test.slow() // launches the app twice
  l = await launch()
  await navigateActiveCard(l.shell, `${fx.origin}/fav`)
  await expect(cards().nth(0).locator('[data-testid="tab"] img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await newCard(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/b`)
  await newTab(l.shell)
  await navigateActiveCard(l.shell, `${fx.origin}/c`)
  const h = (await cards().nth(1).locator('[role="separator"]').boundingBox())!
  await l.shell.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await l.shell.mouse.down()
  await l.shell.mouse.move(h.x - 500, h.y + 20, { steps: 1 }) // one move per drag, see helpers.ts
  await l.shell.mouse.up()
  const widthBefore = Number(await cards().nth(1).getAttribute('data-width'))
  expect(widthBefore).toBeLessThan(1200)
  await l.shell.getByTestId('language-toggle').click()
  await expect(l.shell.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(cards().nth(1).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/c`)
  await expect(cards().nth(1).getByTestId('tab')).toHaveCount(2)

  const userData = l.userData
  await l.close() // window close flushes the pending save before quitting
  const saved = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8'))
  expect(saved.ui.locale).toBe('ar')
  expect(saved.schemaVersion).toBe(3)
  expect(saved.spaces[0].stacks[0].cards[0].tabs[0].favicon).toMatch(/^data:image\/png;base64,/)

  l = await launch({ userData })
  await expect(l.shell.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(cards()).toHaveCount(2)
  await expect(cards().nth(1)).toHaveAttribute('data-width', String(widthBefore))
  await expect(cards().nth(1).getByTestId('tab')).toHaveCount(2)
  await expect(cards().nth(0).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/fav`)
  await expect(cards().nth(1).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/c`)
  const id = (await cards().nth(0).getByTestId('card-body').getAttribute('data-tab-id'))!
  await expect.poll(() => mainEval<string | null>(l.app, `h.tabUrl(${JSON.stringify(id)})`)).toBe(`${fx.origin}/fav`)
})

test('closed cards are soft-deleted in the saved file, not erased', async () => {
  l = await launch()
  await newCard(l.shell)
  await expect(cards()).toHaveCount(2)
  await cards().nth(1).getByTestId('close-card').click()
  await expect(cards()).toHaveCount(1)
  const userData = l.userData
  await l.close()
  const saved = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8'))
  const all = saved.spaces[0].stacks[0].cards as Array<{ isDeleted: boolean; deletedAt: number | null }>
  expect(all).toHaveLength(2)
  const deleted = all.filter((c) => c.isDeleted)
  expect(deleted).toHaveLength(1)
  expect(typeof deleted[0]!.deletedAt).toBe('number')
})

/** A seeded user-data folder holding the given state.json (and optionally state.json.bak) text. */
async function seed(stateText: string, bakText?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ns-e2e-recover-'))
  await writeFile(join(dir, 'state.json'), stateText)
  if (bakText !== undefined) await writeFile(join(dir, 'state.json.bak'), bakText)
  return dir
}
/** A valid root with cards on the fixture pages /a and /b. */
function twoCards(): PersistedRoot {
  let i = 0
  const newId = () => `seed${++i}`
  const root = createDefaultRoot(Date.now(), newId)
  const space = root.spaces[0]!
  const cardsIn = ['a', 'b'].map((p, k) =>
    createCard({ id: `card${p}`, index: `a${k}`, profileId: 'default', url: `${fx.origin}/${p}`, now: Date.now(), newId })
  )
  return { ...root, spaces: [{ ...space, stacks: [{ ...space.stacks[0]!, cards: cardsIn }], activeCardId: 'carda' }] }
}

test('a state file with one bad card loads the other cards and keeps the original as a backup', async () => {
  const root = JSON.parse(JSON.stringify(twoCards()))
  root.spaces[0].stacks[0].cards[1].tabs[0].url = 'file:///c:/not-allowed' // the only tab of card b is invalid
  const dir = await seed(JSON.stringify(root))
  l = await launch({ userData: dir })
  await expect(cards()).toHaveCount(1)
  await expect(cards().nth(0).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/a`)
  const files = await readdir(dir)
  expect(files.filter((f) => /^state\.repaired-\d+\.json$/.test(f))).toHaveLength(1)
})

test('a truncated state.json is recovered from state.json.bak', async () => {
  const good = JSON.stringify(twoCards())
  const dir = await seed(good.slice(0, good.length / 2), good)
  l = await launch({ userData: dir })
  await expect(cards()).toHaveCount(2)
  await expect(cards().nth(1).getByTestId('card-body')).toHaveAttribute('data-url', `${fx.origin}/b`)
  expect((await readdir(dir)).some((f) => /^state\.corrupt-\d+\.json$/.test(f))).toBe(true)
  // The good backup survives: later saves may rewrite it, but never with the truncated file.
  const bak = JSON.parse(await readFile(join(dir, 'state.json.bak'), 'utf8'))
  expect(bak.spaces[0].stacks[0].cards).toHaveLength(2)
})
