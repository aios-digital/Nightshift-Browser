import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { persistedRootSchema, type PersistedRoot } from '@shared/model/persisted-schema'
import { purgeDeleted } from '@shared/model/purge'
import { repairRoot } from '@shared/model/repair'
import { atomicWriteFile } from './atomic-write'
import { createPersister } from './persister'
import { loadState } from './state-files'

export type StoreService = {
  load: () => Promise<PersistedRoot>
  save: (snapshot: unknown) => void
  flush: () => Promise<void>
}

type Options = {
  dir: string
  now: () => number
  newId: () => string
  debounceMs: number
  onError: (error: unknown) => void
  onLog?: (message: string) => void
  /** Injectable for tests. */
  readText?: (path: string) => Promise<string>
  readRetryMs?: number
  readAttempts?: number
}

export function createStoreService(opts: Options): StoreService {
  const read = opts.readText ?? ((p: string) => readFile(p, 'utf8'))
  // Set when state.json exists but could not be read: never overwrite data we have not seen. Each load re-decides.
  let blocked = false
  const persister = createPersister<PersistedRoot>({
    debounceMs: opts.debounceMs,
    onError: opts.onError,
    write: async (root) => {
      await mkdir(opts.dir, { recursive: true })
      await atomicWriteFile(join(opts.dir, 'state.json'), JSON.stringify(root))
    }
  })
  const load = async () => {
    await persister.flush() // a reloaded shell must see the save its previous document just sent
    const ctx = { dir: opts.dir, read, retryMs: opts.readRetryMs ?? 50, attempts: opts.readAttempts ?? 6, now: opts.now(), newId: opts.newId }
    const result = await loadState({ ...ctx, onError: opts.onError, onLog: opts.onLog ?? (() => undefined) })
    blocked = result.blocked
    return purgeDeleted(result.root, opts.now())
  }
  const save = (snapshot: unknown) => {
    if (blocked) return opts.onError(new Error('Not saving: the existing state file could not be read, so it is left untouched.'))
    const parsed = persistedRootSchema.safeParse(snapshot)
    if (parsed.success) return persister.schedule(purgeDeleted(parsed.data, opts.now()))
    // One bad record must not make every later save fail: repair the snapshot (drop or reset only what is invalid).
    const repaired = repairRoot(snapshot, { now: opts.now(), newId: opts.newId })
    if (repaired.status !== 'ok') return opts.onError(new Error(`Refused to save invalid state: ${repaired.reason}`))
    opts.onError(new Error(`Saved a repaired snapshot (${repaired.repairs.length} fix(es), first: ${repaired.repairs[0]?.path ?? '?'})`))
    persister.schedule(purgeDeleted(repaired.root, opts.now()))
  }
  return { load, save, flush: () => persister.flush() }
}
