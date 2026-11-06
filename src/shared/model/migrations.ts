import { isFaviconDataUrl } from '../favicon/favicon'
import { persistedRootSchema, SCHEMA_VERSION, type PersistedRoot } from './persisted-schema'

export type MigrationResult =
  | { status: 'ok'; root: PersistedRoot; migratedFrom: number | null }
  | { status: 'future'; version: number }
  | { status: 'corrupt'; reason: string }

export type Json = Record<string, unknown>

/** Result of bringing raw JSON up to the current version, before it is validated. */
export type UpgradeResult =
  | { status: 'ok'; raw: Json; from: number | null }
  | { status: 'future'; version: number }
  | { status: 'corrupt'; reason: string }

export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const mapObjects = (list: unknown, fn: (o: Json) => Json): unknown[] => asArray(list).map((x) => (isObject(x) ? fn(x) : x))

/** Applies `fn` to every card object in raw state. Pure: returns new objects, leaves anything malformed as it is. */
export function mapCards(raw: Json, fn: (card: Json) => Json): Json {
  return {
    ...raw,
    spaces: mapObjects(raw.spaces, (space) => ({
      ...space,
      stacks: mapObjects(space.stacks, (stack) => ({ ...stack, cards: mapObjects(stack.cards, fn) }))
    }))
  }
}

/** Each entry upgrades the given version to version + 1. Pure: returns new objects. */
const steps: Record<number, (raw: Json) => Json> = {
  // v1 -> v2: cards gain `kind` ("web") and `isSleeping`.
  1: (raw) => ({ ...mapCards(raw, (card) => ({ kind: 'web', isSleeping: false, ...card })), schemaVersion: 2 }),
  // v2 -> v3: favicons were web URLs the shell loaded itself; only image data URLs fetched by main are kept.
  2: (raw) => ({
    ...mapCards(raw, (card) => ({
      ...card,
      tabs: mapObjects(card.tabs, (tab) => ({
        ...tab,
        favicon: typeof tab.favicon === 'string' && isFaviconDataUrl(tab.favicon) ? tab.favicon : null
      }))
    })),
    schemaVersion: 3
  })
}

/** Brings raw JSON to the current version without validating it. */
export function upgradeRaw(raw: unknown): UpgradeResult {
  if (!isObject(raw)) return { status: 'corrupt', reason: 'not an object' }
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'corrupt', reason: 'missing or invalid schemaVersion' }
  }
  if (version > SCHEMA_VERSION) return { status: 'future', version }
  let current: Json = raw
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = steps[v]
    if (!step) return { status: 'corrupt', reason: `no migration from version ${v}` }
    current = step(current)
  }
  return { status: 'ok', raw: current, from: version === SCHEMA_VERSION ? null : version }
}

export function migrate(raw: unknown): MigrationResult {
  const up = upgradeRaw(raw)
  if (up.status !== 'ok') return up
  const parsed = persistedRootSchema.safeParse(up.raw)
  if (!parsed.success) return { status: 'corrupt', reason: parsed.error.issues[0]?.message ?? 'invalid shape' }
  return { status: 'ok', root: parsed.data, migratedFrom: up.from }
}

export function parseStateText(text: string): MigrationResult {
  try {
    return migrate(JSON.parse(text))
  } catch {
    return { status: 'corrupt', reason: 'invalid JSON' }
  }
}
