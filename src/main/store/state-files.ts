import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PersistedRoot } from '@shared/model/persisted-schema'
import { planBackupPrune } from './backup-retention'
import { atomicWriteFile } from './atomic-write'
import { decideLoad, needsBak, type LoadPlan, type ReadOutcome } from './recovery'

const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES'])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code ?? ''

export type LoadCtx = {
  dir: string
  read: (path: string) => Promise<string>
  retryMs: number
  attempts: number
  now: number
  newId: () => string
  onError: (error: unknown) => void
  onLog: (message: string) => void
}

/**
 * Reads a file. Missing is not an error. While another process (antivirus, indexer, sync) locks it, retry with
 * backoff; if it stays unreadable, report "locked" so the caller never overwrites data it has not seen.
 */
export async function readOutcome(path: string, ctx: Pick<LoadCtx, 'read' | 'retryMs' | 'attempts' | 'onError'>): Promise<ReadOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { kind: 'text', text: await ctx.read(path) }
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'missing' }
      if (!LOCKED.has(codeOf(error)) || attempt >= ctx.attempts) {
        ctx.onError(error)
        return { kind: 'locked' }
      }
      await sleep(ctx.retryMs * 2 ** (attempt - 1))
    }
  }
}

/**
 * Writes the plan's backups and moves a bad state.json aside. Moving (not copying) matters: the next atomic save
 * copies state.json to state.json.bak, which would otherwise replace the good backup we just loaded from. A root
 * recovered from .bak is then written back as state.json (the target is gone, so .bak stays as it is), so the
 * recovery survives even if nothing is saved before the next load.
 * Returns true if anything failed, in which case saving must stay blocked for the session.
 */
async function applyPlan(plan: LoadPlan, primaryText: string | null, ctx: LoadCtx): Promise<boolean> {
  try {
    await mkdir(ctx.dir, { recursive: true })
    for (const b of plan.backups) await writeFile(join(ctx.dir, b.name), b.text, 'utf8')
    if (!plan.moveAside) return false
    await moveAside(plan.moveAside, primaryText, ctx)
    if (plan.restore) await atomicWriteFile(join(ctx.dir, 'state.json'), JSON.stringify(plan.root))
    return false
  } catch (error) {
    ctx.onError(error)
    return true
  }
}

/** Renames state.json; if it is locked, keeps a copy instead and throws so saving stays blocked. */
async function moveAside(name: string, primaryText: string | null, ctx: LoadCtx): Promise<void> {
  try {
    await rename(join(ctx.dir, 'state.json'), join(ctx.dir, name))
  } catch (error) {
    if (primaryText !== null) await writeFile(join(ctx.dir, name), primaryText, 'utf8').catch(ctx.onError)
    throw error
  }
}

/** Best effort: deletes old backups beyond the retention limits. Never fails the load. */
export async function pruneBackups(dir: string, onError: (error: unknown) => void): Promise<void> {
  try {
    const doomed = planBackupPrune(await readdir(dir))
    await Promise.all(doomed.map((name) => rm(join(dir, name), { force: true }).catch(onError)))
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') onError(error)
  }
}

function describePlan(plan: LoadPlan): string | null {
  if (plan.source === 'primary' && plan.repairs.length === 0) return null
  const repaired = plan.repairs.length ? `, repaired ${plan.repairs.length} record(s): ${plan.repairs.map((r) => JSON.stringify(`${r.path} ${r.action}`)).join('; ')}` : ''
  return `[store] loaded from ${plan.source}${plan.moveAside ? `, moved state.json to ${plan.moveAside}` : ''}${repaired}`
}

/** Reads state.json (and its .bak if needed), repairs or recovers, writes backups, and prunes old ones. */
export async function loadState(ctx: LoadCtx): Promise<{ root: PersistedRoot; blocked: boolean }> {
  const file = join(ctx.dir, 'state.json')
  const primary = await readOutcome(file, ctx)
  const ids = { now: ctx.now, newId: ctx.newId }
  const bak: ReadOutcome = needsBak(primary, ids) ? await readOutcome(`${file}.bak`, ctx) : { kind: 'missing' }
  const plan = decideLoad(primary, bak, ids)
  const moveFailed = await applyPlan(plan, primary.kind === 'text' ? primary.text : null, ctx)
  const note = describePlan(plan)
  if (note) ctx.onLog(note)
  await pruneBackups(ctx.dir, ctx.onError)
  return { root: plan.root, blocked: plan.blocked || moveFailed }
}
