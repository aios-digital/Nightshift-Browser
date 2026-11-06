import { createDefaultRoot } from '@shared/model/defaults'
import { upgradeRaw } from '@shared/model/migrations'
import { persistedRootSchema, type PersistedRoot } from '@shared/model/persisted-schema'
import { repairRoot, type Repair } from '@shared/model/repair'

type Ctx = { now: number; newId: () => string }

export type ParseOutcome =
  | { kind: 'ok'; root: PersistedRoot; migratedFrom: number | null }
  | { kind: 'repaired'; root: PersistedRoot; repairs: readonly Repair[] }
  | { kind: 'future'; version: number }
  | { kind: 'corrupt'; reason: string }

/** What reading a file gave: nothing there, locked by another process, or its text. */
export type ReadOutcome = { kind: 'missing' } | { kind: 'locked' } | { kind: 'text'; text: string }

export type LoadPlan = {
  root: PersistedRoot
  source: 'primary' | 'bak' | 'defaults'
  /** Saving stays off for the session: state.json exists but could not be read, so it must not be overwritten. */
  blocked: boolean
  /** Rename state.json to this name (bad or future file), so the next save cannot copy it over the good .bak. */
  moveAside: string | null
  /** Copies to write next to state.json before anything else happens. */
  backups: ReadonlyArray<{ name: string; text: string }>
  /** Write `root` back as state.json (it was recovered from .bak after the bad file was moved aside). */
  restore: boolean
  repairs: readonly Repair[]
}

/** Parses, migrates and, if needed, repairs a state file's text. Pure. */
export function parseState(text: string, ctx: Ctx): ParseOutcome {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'corrupt', reason: 'invalid JSON' }
  }
  const up = upgradeRaw(json)
  if (up.status === 'future') return { kind: 'future', version: up.version }
  if (up.status === 'corrupt') return { kind: 'corrupt', reason: up.reason }
  const strict = persistedRootSchema.safeParse(up.raw)
  if (strict.success) return { kind: 'ok', root: strict.data, migratedFrom: up.from }
  const repaired = repairRoot(up.raw, ctx)
  if (repaired.status === 'ok') return { kind: 'repaired', root: repaired.root, repairs: repaired.repairs }
  return { kind: 'corrupt', reason: repaired.reason }
}

/** Whether state.json.bak is needed: state.json is locked, or its text cannot be used even after repair. */
export function needsBak(primary: ReadOutcome, ctx: Ctx): boolean {
  if (primary.kind === 'locked') return true
  return primary.kind === 'text' && !usable(parseState(primary.text, ctx))
}

const usable = (o: ParseOutcome): o is Extract<ParseOutcome, { kind: 'ok' | 'repaired' }> => o.kind === 'ok' || o.kind === 'repaired'

/** The backup in state.json.bak, if it is usable; otherwise fresh defaults. */
function fromBak(bak: ReadOutcome, ctx: Ctx): Pick<LoadPlan, 'root' | 'source' | 'repairs'> {
  const parsed = bak.kind === 'text' ? parseState(bak.text, ctx) : null
  if (parsed && usable(parsed)) return { root: parsed.root, source: 'bak', repairs: parsed.kind === 'repaired' ? parsed.repairs : [] }
  return { root: createDefaultRoot(ctx.now, ctx.newId), source: 'defaults', repairs: [] }
}

/**
 * Decides how to load, given what reading state.json and state.json.bak gave. Pure; the store service carries
 * the plan out. A missing state.json means a fresh start (a deliberate delete is a reset), so .bak is not used.
 */
export function decideLoad(primary: ReadOutcome, bak: ReadOutcome, ctx: Ctx): LoadPlan {
  const none = { blocked: false, moveAside: null, backups: [], restore: false, repairs: [] }
  if (primary.kind === 'missing') return { ...none, root: createDefaultRoot(ctx.now, ctx.newId), source: 'defaults' }
  if (primary.kind === 'locked') return { ...none, ...fromBak(bak, ctx), blocked: true }
  const parsed = parseState(primary.text, ctx)
  if (parsed.kind === 'ok') {
    const backups = parsed.migratedFrom === null ? [] : [{ name: `state.pre-v${parsed.migratedFrom}.json`, text: primary.text }]
    return { ...none, root: parsed.root, source: 'primary', backups }
  }
  if (parsed.kind === 'repaired') {
    return { ...none, root: parsed.root, source: 'primary', repairs: parsed.repairs, backups: [{ name: `state.repaired-${ctx.now}.json`, text: primary.text }] }
  }
  const tag = parsed.kind === 'future' ? 'future' : 'corrupt'
  const recovered = fromBak(bak, ctx)
  // A .bak we could not read may well be good: start from defaults but never save over it this session.
  return { ...none, ...recovered, moveAside: `state.${tag}-${ctx.now}.json`, blocked: bak.kind === 'locked', restore: recovered.source === 'bak' }
}
