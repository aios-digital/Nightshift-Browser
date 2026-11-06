import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStoreService } from './store-service'
import { createDefaultRoot } from '@shared/model/defaults'
import { SCHEMA_VERSION } from '@shared/model/persisted-schema'

let dir: string
let n = 0
const newId = () => `id${++n}`
const make = () => createStoreService({ dir, now: () => 1000, newId, debounceMs: 5, onError: () => {} })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns-store-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('store service', () => {
  it('returns defaults when no file exists', async () => {
    const root = await make().load()
    expect(root.schemaVersion).toBe(SCHEMA_VERSION)
    expect(root.spaces).toHaveLength(1)
  })

  it('saves (debounced) and loads the same state back', async () => {
    const svc = make()
    const root = createDefaultRoot(1, newId)
    svc.save(root)
    await svc.flush()
    expect(await make().load()).toEqual(root)
  })

  it('backs up a corrupt file and returns defaults', async () => {
    await writeFile(join(dir, 'state.json'), '{broken')
    const root = await make().load()
    expect(root.spaces).toHaveLength(1)
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('state.corrupt-'))).toBe(true)
  })

  it('backs up a future-version file before it can be overwritten', async () => {
    await writeFile(join(dir, 'state.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, spaces: [] }))
    const root = await make().load()
    expect(root.schemaVersion).toBe(SCHEMA_VERSION)
    const files = await readdir(dir)
    const backup = files.find((f) => f.startsWith('state.future-'))
    expect(backup).toBeDefined()
    expect(JSON.parse(await readFile(join(dir, backup!), 'utf8')).schemaVersion).toBe(SCHEMA_VERSION + 5)
  })

  it('keeps a copy of the pre-migration file', async () => {
    const v1 = await readFile('tests/fixtures/state-v1.json', 'utf8')
    await writeFile(join(dir, 'state.json'), v1)
    const root = await make().load()
    expect(root.schemaVersion).toBe(SCHEMA_VERSION)
    expect(await readFile(join(dir, 'state.pre-v1.json'), 'utf8')).toBe(v1)
  })

  it('retries a locked state file and loads it once the lock clears', async () => {
    const root = createDefaultRoot(1, newId)
    await writeFile(join(dir, 'state.json'), JSON.stringify(root))
    let calls = 0
    const read = async (p: string) => {
      if (++calls < 3) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      return readFile(p, 'utf8')
    }
    const svc = createStoreService({ dir, now: () => 1000, newId, debounceMs: 5, onError: () => {}, readText: read, readRetryMs: 1 })
    expect(await svc.load()).toEqual(root)
  })

  it('never overwrites a state file it could not read', async () => {
    await writeFile(join(dir, 'state.json'), 'REAL DATA')
    const read = async () => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' })
    }
    const errors: unknown[] = []
    const svc = createStoreService({
      dir, now: () => 1000, newId, debounceMs: 5, onError: (e) => errors.push(e), readText: read, readRetryMs: 1
    })
    const root = await svc.load()
    expect(root.spaces).toHaveLength(1)
    svc.save(root)
    await svc.flush()
    expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe('REAL DATA')
    expect(errors.length).toBeGreaterThan(0)
  })

  it('purges old soft-deleted cards when loading and saving', async () => {
    const root = createDefaultRoot(1, newId)
    const space = root.spaces[0]!
    const card = space.stacks[0]!.cards[0]!
    const old = { ...card, id: 'old', index: 'a5', isDeleted: true, deletedAt: 1 }
    const withOld = { ...root, spaces: [{ ...space, stacks: [{ ...space.stacks[0]!, cards: [card, old] }] }] }
    await writeFile(join(dir, 'state.json'), JSON.stringify(withOld))
    const svc = createStoreService({ dir, now: () => 100 * 24 * 3600 * 1000, newId, debounceMs: 5, onError: () => {} })
    const loaded = await svc.load()
    expect(loaded.spaces[0]!.stacks[0]!.cards.map((c) => c.id)).toEqual([card.id])
    svc.save(withOld)
    await svc.flush()
    const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
    expect(saved.spaces[0].stacks[0].cards).toHaveLength(1)
  })

  it('rejects an invalid snapshot instead of writing it', async () => {
    const svc = make()
    svc.save({ nope: true } as never)
    await svc.flush()
    expect((await readdir(dir)).includes('state.json')).toBe(false)
  })
})

describe('store service: recovery', () => {
  const withBadCard = () => {
    const root = JSON.parse(JSON.stringify(createDefaultRoot(1, newId)))
    const card = root.spaces[0].stacks[0].cards[0]
    root.spaces[0].stacks[0].cards.push({ ...card, id: 'bad id!', index: 'a1' }, { ...card, id: 'keep2', index: 'a2', tabs: [{ ...card.tabs[0], id: 'tk2' }] })
    return root
  }

  it('repairs one bad card, keeps the others, and keeps the original as a backup', async () => {
    const raw = withBadCard()
    await writeFile(join(dir, 'state.json'), JSON.stringify(raw))
    const root = await make().load()
    expect(root.spaces[0]!.stacks[0]!.cards.map((c) => c.id)).toEqual([raw.spaces[0].stacks[0].cards[0].id, 'keep2'])
    expect(JSON.parse(await readFile(join(dir, 'state.repaired-1000.json'), 'utf8'))).toEqual(raw)
  })

  it('recovers from .bak when state.json is truncated, and the next save keeps the good .bak', async () => {
    const good = createDefaultRoot(1, newId)
    await writeFile(join(dir, 'state.json.bak'), JSON.stringify(good))
    await writeFile(join(dir, 'state.json'), '{"schemaVersion":3,"spa')
    const svc = make()
    expect(await svc.load()).toEqual(good)
    expect(await readFile(join(dir, 'state.corrupt-1000.json'), 'utf8')).toBe('{"schemaVersion":3,"spa')
    svc.save(good)
    await svc.flush()
    expect(JSON.parse(await readFile(join(dir, 'state.json.bak'), 'utf8'))).toEqual(good)
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))).toEqual(good)
  })

  it('after recovering from .bak, a second load without any save still returns the recovered data', async () => {
    const good = createDefaultRoot(1, newId)
    await writeFile(join(dir, 'state.json.bak'), JSON.stringify(good))
    await writeFile(join(dir, 'state.json'), '{"schemaVersion":3,"spa')
    expect(await make().load()).toEqual(good)
    expect(await make().load()).toEqual(good)
    expect(JSON.parse(await readFile(join(dir, 'state.json.bak'), 'utf8'))).toEqual(good)
  })

  it('a backup that cannot be written does not stop the app from starting, and blocks saving', async () => {
    const v1 = await readFile('tests/fixtures/state-v1.json', 'utf8')
    await writeFile(join(dir, 'state.json'), v1)
    await mkdir(join(dir, 'state.pre-v1.json')) // a folder in the way: writing the backup fails
    const errors: unknown[] = []
    const svc = createStoreService({ dir, now: () => 1000, newId, debounceMs: 5, onError: (e) => errors.push(e) })
    const root = await svc.load()
    expect(root.schemaVersion).toBe(SCHEMA_VERSION)
    svc.save(root)
    await svc.flush()
    expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe(v1)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('does not read state.json.bak when state.json is fine', async () => {
    await writeFile(join(dir, 'state.json'), JSON.stringify(createDefaultRoot(1, newId)))
    const reads: string[] = []
    const read = async (p: string) => (reads.push(p), readFile(p, 'utf8'))
    await createStoreService({ dir, now: () => 1000, newId, debounceMs: 5, onError: () => {}, readText: read }).load()
    expect(reads.map((p) => p.split(/[\\/]/).pop())).toEqual(['state.json'])
  })

  it('prunes old backups on load, keeping the newest of each kind', async () => {
    for (const t of [1, 2, 3, 4, 5]) await writeFile(join(dir, `state.corrupt-${t}.json`), 'x')
    await writeFile(join(dir, 'notes.txt'), 'mine')
    await make().load()
    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['notes.txt', 'state.corrupt-3.json', 'state.corrupt-4.json', 'state.corrupt-5.json'])
  })

  it('a snapshot with one bad record is repaired and saved instead of being refused for the whole session', async () => {
    const svc = make()
    const root = JSON.parse(JSON.stringify(createDefaultRoot(1, newId)))
    const card = root.spaces[0].stacks[0].cards[0]
    root.spaces[0].stacks[0].cards.push({ ...card, id: 'c2', index: 'a5', tabs: [{ ...card.tabs[0], id: 't2', url: `https://x.test/?${'a'.repeat(9000)}` }] })
    svc.save(root)
    await svc.flush()
    const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
    expect(saved.spaces[0].stacks[0].cards.map((c: { id: string }) => c.id)).toEqual([card.id])
  })

  it('load waits for a pending save, so a reloaded shell sees the latest state', async () => {
    const svc = createStoreService({ dir, now: () => 1000, newId, debounceMs: 10_000, onError: () => {} })
    const root = createDefaultRoot(1, newId)
    svc.save(root)
    expect(await svc.load()).toEqual(root)
  })

  it('a later successful load lifts the save block', async () => {
    let lockedReads = 2 // state.json and .bak
    const read = async (p: string) => {
      if (lockedReads-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      return readFile(p, 'utf8')
    }
    const svc = createStoreService({ dir, now: () => 1000, newId, debounceMs: 5, onError: () => {}, readText: read, readRetryMs: 0, readAttempts: 1 })
    await writeFile(join(dir, 'state.json'), JSON.stringify(createDefaultRoot(1, newId)))
    await svc.load()
    const next = await svc.load()
    svc.save(next)
    await svc.flush()
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))).toEqual(next)
  })
})
