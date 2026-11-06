import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDefaultRoot } from '@shared/model/defaults'
import { SCHEMA_VERSION } from '@shared/model/persisted-schema'
import { decideLoad, needsBak, parseState, type ReadOutcome } from './recovery'

let n = 0
const ctx = { now: 777, newId: () => `rc${++n}` }
const good = () => createDefaultRoot(1, () => `g${++n}`)
const text = (value: unknown): ReadOutcome => ({ kind: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) })
const missing: ReadOutcome = { kind: 'missing' }
const locked: ReadOutcome = { kind: 'locked' }
function oneBadCard() {
  const root = JSON.parse(JSON.stringify(good()))
  const card = root.spaces[0].stacks[0].cards[0]
  root.spaces[0].stacks[0].cards.push({ ...card, id: 'bad id!', index: 'a1' })
  return root
}

describe('parseState', () => {
  it('ok, repaired, future and corrupt', () => {
    expect(parseState(JSON.stringify(good()), ctx).kind).toBe('ok')
    const repaired = parseState(JSON.stringify(oneBadCard()), ctx)
    expect(repaired.kind).toBe('repaired')
    expect(repaired.kind === 'repaired' && repaired.repairs).toContainEqual({ path: 'spaces[0].stacks[0].cards[1]', action: 'dropped' })
    expect(parseState(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }), ctx)).toEqual({ kind: 'future', version: SCHEMA_VERSION + 1 })
    expect(parseState('{truncated', ctx).kind).toBe('corrupt')
    expect(parseState(JSON.stringify({ schemaVersion: SCHEMA_VERSION, spaces: [] }), ctx).kind).toBe('corrupt')
  })
  it('migrates old files and reports where from', () => {
    const r = parseState(readFileSync('tests/fixtures/state-v1.json', 'utf8'), ctx)
    expect(r.kind === 'ok' && r.migratedFrom).toBe(1)
  })
})

describe('decideLoad', () => {
  it('valid: use it, no backups', () => {
    const root = good()
    expect(decideLoad(text(root), missing, ctx)).toMatchObject({ root, source: 'primary', blocked: false, backups: [], moveAside: null })
  })
  it('migrated: keeps a state.pre-vN.json copy of the original text', () => {
    const v1 = readFileSync('tests/fixtures/state-v1.json', 'utf8')
    expect(decideLoad(text(v1), missing, ctx).backups).toEqual([{ name: 'state.pre-v1.json', text: v1 }])
  })
  it('repairable: uses the repaired root and backs up the original as state.repaired-<ts>.json', () => {
    const plan = decideLoad(text(oneBadCard()), missing, ctx)
    expect(plan.source).toBe('primary')
    expect(plan.root.spaces[0]!.stacks[0]!.cards).toHaveLength(1)
    expect(plan.backups.map((b) => b.name)).toEqual(['state.repaired-777.json'])
    expect(plan.repairs.length).toBeGreaterThan(0)
  })
  it('corrupt: moves the file aside (not copied) and recovers from state.json.bak', () => {
    const bak = good()
    const plan = decideLoad(text('{trunc'), text(bak), ctx)
    expect(plan).toMatchObject({ root: bak, source: 'bak', blocked: false, moveAside: 'state.corrupt-777.json' })
  })
  it('future: moved aside as state.future-<ts>.json, then .bak', () => {
    const plan = decideLoad(text({ schemaVersion: SCHEMA_VERSION + 3 }), text(good()), ctx)
    expect(plan).toMatchObject({ source: 'bak', moveAside: 'state.future-777.json' })
  })
  it('a repairable .bak is repaired too', () => {
    const plan = decideLoad(text('{trunc'), text(oneBadCard()), ctx)
    expect(plan.source).toBe('bak')
    expect(plan.root.spaces[0]!.stacks[0]!.cards).toHaveLength(1)
  })
  it('a bad .bak with a bad primary gives defaults', () => {
    const plan = decideLoad(text('{trunc'), text('also broken'), ctx)
    expect(plan).toMatchObject({ source: 'defaults', moveAside: 'state.corrupt-777.json', blocked: false })
    expect(plan.root.spaces).toHaveLength(1)
  })
  it('locked: loads .bak (or defaults) and blocks saving for the session', () => {
    const bak = good()
    expect(decideLoad(locked, text(bak), ctx)).toMatchObject({ root: bak, source: 'bak', blocked: true, moveAside: null })
    expect(decideLoad(locked, locked, ctx)).toMatchObject({ source: 'defaults', blocked: true })
  })
  it('a bad primary with a locked .bak: defaults, but saving is blocked so the good .bak is never overwritten', () => {
    expect(decideLoad(text('{trunc'), locked, ctx)).toMatchObject({ source: 'defaults', blocked: true, moveAside: 'state.corrupt-777.json' })
  })
  it('recovered from .bak: the recovered root is written back as state.json', () => {
    const bak = good()
    expect(decideLoad(text('{trunc'), text(bak), ctx).restore).toBe(true)
    expect(decideLoad(text(good()), missing, ctx).restore).toBe(false)
    expect(decideLoad(text('{trunc'), text('bad'), ctx).restore).toBe(false)
  })
  it('needsBak: only when state.json is locked or unusable', () => {
    expect(needsBak(text(good()), ctx)).toBe(false)
    expect(needsBak(text(oneBadCard()), ctx)).toBe(false)
    expect(needsBak(missing, ctx)).toBe(false)
    expect(needsBak(locked, ctx)).toBe(true)
    expect(needsBak(text('{trunc'), ctx)).toBe(true)
  })
  it('missing: defaults, and .bak is ignored (a deleted state file means reset)', () => {
    expect(decideLoad(missing, text(good()), ctx)).toMatchObject({ source: 'defaults', blocked: false, moveAside: null })
  })
})
