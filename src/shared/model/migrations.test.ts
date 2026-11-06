import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { migrate, parseStateText } from './migrations'
import { persistedRootSchema, SCHEMA_VERSION } from './persisted-schema'
import { createDefaultRoot } from './defaults'

const v1 = () => JSON.parse(readFileSync('tests/fixtures/state-v1.json', 'utf8'))
const v2 = () => JSON.parse(readFileSync('tests/fixtures/state-v2.json', 'utf8'))
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

describe('migrate', () => {
  it('migrates v1 to current, adding Card.kind and dropping volatile fields', () => {
    const r = migrate(v1())
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.migratedFrom).toBe(1)
    expect(r.root.schemaVersion).toBe(SCHEMA_VERSION)
    const card = r.root.spaces[0]!.stacks[0]!.cards[0]!
    expect(card.kind).toBe('web')
    expect(card.isSleeping).toBe(false)
    const tab = card.tabs[0]! as Record<string, unknown>
    expect('loading' in tab).toBe(false)
    expect('canGoBack' in tab).toBe(false)
    expect(persistedRootSchema.safeParse(r.root).success).toBe(true)
  })

  it('leaves current-version state alone', () => {
    let i = 0
    const root = createDefaultRoot(1, () => `x${++i}`)
    const r = migrate(root)
    expect(r).toEqual({ status: 'ok', root, migratedFrom: null })
  })

  it('refuses a future version without touching data', () => {
    const r = migrate({ schemaVersion: SCHEMA_VERSION + 1, spaces: [] })
    expect(r).toEqual({ status: 'future', version: SCHEMA_VERSION + 1 })
  })

  it.each([null, 42, 'x', [], {}, { schemaVersion: 'a' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }])(
    'reports corrupt for %j',
    (raw) => {
      expect(migrate(raw).status).toBe('corrupt')
    }
  )

  it('reports corrupt when the migrated shape is invalid', () => {
    const bad = v1()
    bad.spaces[0].stacks[0].cards[0].width = 'wide'
    expect(migrate(bad).status).toBe('corrupt')
  })

  it('v2 -> v3 drops web-URL favicons (only data: icons are stored now) and changes nothing else', () => {
    const before = v2()
    const r = migrate(before)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.migratedFrom).toBe(2)
    expect(r.root.schemaVersion).toBe(3)
    const tabs = r.root.spaces[0]!.stacks[0]!.cards[0]!.tabs
    expect(tabs.map((t) => t.favicon)).toEqual([null, null])
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'favicon' || k === 'schemaVersion' ? undefined : v)))
    expect(strip(r.root)).toEqual(strip(before))
  })

  it('v2 -> v3 keeps a valid favicon data URL', () => {
    const raw = v2()
    raw.spaces[0].stacks[0].cards[0].tabs[0].favicon = 'data:image/png;base64,iVBORw0KGgo='
    const r = migrate(raw)
    expect(r.status === 'ok' && r.root.spaces[0]!.stacks[0]!.cards[0]!.tabs[0]!.favicon).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('migration never mutates its input', () => {
    const raw = deepFreeze(v1())
    expect(migrate(raw).status).toBe('ok')
  })

  it('parseStateText handles bad JSON', () => {
    expect(parseStateText('{not json').status).toBe('corrupt')
    expect(parseStateText(JSON.stringify(v1())).status).toBe('ok')
  })
})
