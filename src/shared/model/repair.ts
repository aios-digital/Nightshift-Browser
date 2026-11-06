import type { ZodType } from 'zod'
import { repairDuplicateKeys } from '../ordering'
import { DEFAULT_SEARCH_TEMPLATE } from '../url/omnibox'
import { DEFAULT_PROFILE_ID } from './defaults'
import { asArray, isObject, type Json } from './migrations'
import {
  cardSchema, DEFAULT_CARD_WIDTH, idSchema, MAX_CARD_WIDTH, MAX_TITLE_LENGTH, MIN_CARD_WIDTH, persistedRootSchema,
  profileSchema, SCHEMA_VERSION, spaceSchema, stackSchema, tabSchema, uiSchema,
  type PersistedCard, type PersistedRoot, type PersistedSpace, type PersistedStack, type PersistedTab
} from './persisted-schema'

/**
 * Repairs a state file record by record instead of discarding it whole. Rules:
 * - a record whose identity is broken (bad id, URL or deleted flag) is dropped, and so is a later duplicate id;
 * - a bad optional or descriptive field is reset to its empty default (never invented data);
 * - references (active card/tab, pinned tab, active space) are re-pointed at live records;
 * - sibling index keys are regenerated if missing or duplicated, keeping array order.
 * Pure: the input is never modified.
 */
export type RepairAction = 'dropped' | 'reset-field' | 'fixed-ref' | 'deduped' | 're-keyed'
export type Repair = { path: string; action: RepairAction }
export type RepairResult =
  | { status: 'ok'; root: PersistedRoot; repairs: readonly Repair[] }
  | { status: 'unrepairable'; reason: string }

type Ctx = { now: number; newId: () => string }
type Out<T> = { value: T | null; repairs: Repair[] }
type Fixes = Record<string, (value: unknown, ctx: Ctx) => unknown>
/** `has` asks whether an id was already kept; `claim` records it. Ids are claimed only once their record is kept. */
type Seen = { has: (kind: string, id: string) => boolean; claim: (kind: string, id: string) => void }

const drop = <T>(path: string, action: RepairAction = 'dropped'): Out<T> => ({ value: null, repairs: [{ path, action }] })
const fixRef = (path: string): Repair => ({ path, action: 'fixed-ref' })
const text = (max: number) => (v: unknown) => (typeof v === 'string' ? v.slice(0, max) : '')
const nowFix = (_v: unknown, c: Ctx) => c.now

/** Returns a copy with every invalid field in `fixes` replaced by its fallback. */
function resetFields(obj: Json, shape: Record<string, ZodType>, fixes: Fixes, path: string, ctx: Ctx) {
  const bad = Object.keys(fixes).filter((k) => !shape[k]?.safeParse(obj[k]).success)
  const value: Json = { ...obj, ...Object.fromEntries(bad.map((k) => [k, fixes[k]!(obj[k], ctx)])) }
  return { value, repairs: bad.map((k): Repair => ({ path: `${path}.${k}`, action: 'reset-field' })) }
}

/** Checks the object and its id; claims the id so later duplicates are dropped. */
function identify(raw: unknown, path: string, kind: string, seen: Seen): Json | Out<never> {
  if (!isObject(raw) || !idSchema.safeParse(raw.id).success) return drop(path)
  if (seen.has(kind, raw.id as string)) return drop(path, 'deduped')
  return raw
}
const isOut = (x: Json | Out<never>): x is Out<never> => 'repairs' in x && 'value' in x && x.value === null

function repairList<T extends { index: string }>(items: unknown, path: string, one: (raw: unknown, path: string) => Out<T>) {
  const results = asArray(items).map((x, i) => one(x, `${path}[${i}]`))
  const kept = results.flatMap((r) => (r.value ? [r.value] : []))
  const value = repairDuplicateKeys(kept)
  const rekeyed = value.some((x, i) => x !== kept[i])
  return { value, repairs: [...results.flatMap((r) => r.repairs), ...(rekeyed ? [{ path, action: 're-keyed' as const }] : [])] }
}

const TAB_FIXES: Fixes = {
  index: () => 'a0', title: text(MAX_TITLE_LENGTH), favicon: () => null, customName: () => null,
  customEmoji: () => null, openerTabId: () => null, createdAt: nowFix
}

function repairTab(raw: unknown, path: string, ctx: Ctx, seen: Seen): Out<PersistedTab> {
  const tab = identify(raw, path, 'tab', seen)
  if (isOut(tab)) return tab
  if (!tabSchema.shape.url.safeParse(tab.url).success || typeof tab.isDeleted !== 'boolean') return drop(path)
  const fixed = resetFields(tab, tabSchema.shape, TAB_FIXES, path, ctx)
  const parsed = tabSchema.safeParse(fixed.value)
  if (!parsed.success) return drop(path)
  seen.claim('tab', parsed.data.id)
  return { value: parsed.data, repairs: fixed.repairs }
}

const CARD_FIXES: Fixes = {
  index: () => 'a0', kind: () => 'web', isMaximized: () => false, isSleeping: () => false,
  profileId: () => DEFAULT_PROFILE_ID, soundMuted: () => false, createdAt: nowFix, lastActiveAt: nowFix,
  width: (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(v))) : DEFAULT_CARD_WIDTH)
}

/** Points `key` at a live id, or the first live id (or null when `fallbackToFirst` is false). */
function pointAt(obj: Json, key: string, live: readonly string[], fallbackToFirst: boolean, path: string) {
  const current = obj[key]
  if (current === null && !fallbackToFirst) return { value: null, repairs: [] }
  if (typeof current === 'string' && live.includes(current)) return { value: current, repairs: [] }
  const value = fallbackToFirst ? (live[0] ?? null) : null
  return { value, repairs: value === current ? [] : [fixRef(`${path}.${key}`)] }
}

function repairCard(raw: unknown, path: string, ctx: Ctx, seen: Seen): Out<PersistedCard> {
  const card = identify(raw, path, 'card', seen)
  if (isOut(card)) return card
  if (typeof card.isDeleted !== 'boolean') return drop(path)
  const fixed = resetFields(card, cardSchema.shape, CARD_FIXES, path, ctx)
  const tabs = repairList(card.tabs, `${path}.tabs`, (t, p) => repairTab(t, p, ctx, seen))
  const live = tabs.value.filter((t) => !t.isDeleted).map((t) => t.id)
  if (!card.isDeleted && live.length === 0) return drop(path)
  const deletedAt = card.isDeleted ? (cardSchema.shape.deletedAt.safeParse(card.deletedAt).data ?? ctx.now) : null
  const active = pointAt(card, 'activeTabId', live, true, path)
  const pinned = pointAt(card, 'pinnedTabId', live, false, path)
  const parsed = cardSchema.safeParse({ ...fixed.value, tabs: tabs.value, deletedAt, activeTabId: active.value, pinnedTabId: pinned.value })
  if (!parsed.success) return drop(path)
  seen.claim('card', parsed.data.id)
  const deletedAtFixed = deletedAt !== card.deletedAt ? [{ path: `${path}.deletedAt`, action: 'reset-field' as const }] : []
  return { value: parsed.data, repairs: [...fixed.repairs, ...tabs.repairs, ...deletedAtFixed, ...active.repairs, ...pinned.repairs] }
}

function repairStack(raw: unknown, path: string, ctx: Ctx, seen: Seen): Out<PersistedStack> {
  const stack = identify(raw, path, 'stack', seen)
  if (isOut(stack)) return stack
  const fixed = resetFields(stack, stackSchema.shape, { index: () => 'a0' }, path, ctx)
  const cards = repairList(stack.cards, `${path}.cards`, (c, p) => repairCard(c, p, ctx, seen))
  const parsed = stackSchema.safeParse({ ...fixed.value, cards: cards.value })
  if (!parsed.success) return drop(path)
  seen.claim('stack', parsed.data.id)
  return { value: parsed.data, repairs: [...fixed.repairs, ...cards.repairs] }
}

const SPACE_FIXES: Fixes = {
  index: () => 'a0', name: text(512), emoji: text(16), defaultProfileId: () => DEFAULT_PROFILE_ID,
  isArchived: () => false, lastActiveAt: nowFix
}

function repairSpace(raw: unknown, path: string, ctx: Ctx, seen: Seen): Out<PersistedSpace> {
  const space = identify(raw, path, 'space', seen)
  if (isOut(space)) return space
  const fixed = resetFields(space, spaceSchema.shape, SPACE_FIXES, path, ctx)
  const listed = repairList(space.stacks, `${path}.stacks`, (s, p) => repairStack(s, p, ctx, seen))
  const empty = listed.value.length === 0
  const stacks = empty ? [{ id: ctx.newId(), index: 'a0', cards: [] }] : listed.value
  const live = stacks.flatMap((s) => s.cards.filter((c) => !c.isDeleted).map((c) => c.id))
  const active = pointAt(space, 'activeCardId', live, true, path)
  const parsed = spaceSchema.safeParse({ ...fixed.value, stacks, activeCardId: active.value })
  if (!parsed.success) return drop(path)
  seen.claim('space', parsed.data.id)
  const added = empty ? [{ path: `${path}.stacks`, action: 'reset-field' as const }] : []
  return { value: parsed.data, repairs: [...fixed.repairs, ...listed.repairs, ...added, ...active.repairs] }
}

function repairProfiles(raw: unknown, seen: Seen) {
  const results = asArray(raw).map((p, i): Out<{ id: string; name: string }> => {
    const parsed = profileSchema.safeParse(p)
    if (!parsed.success) return drop(`profiles[${i}]`)
    if (seen.has('profile', parsed.data.id)) return drop(`profiles[${i}]`, 'deduped')
    seen.claim('profile', parsed.data.id)
    return { value: parsed.data, repairs: [] }
  })
  const kept = results.flatMap((r) => (r.value ? [r.value] : []))
  const repairs = results.flatMap((r) => r.repairs)
  if (kept.some((p) => p.id === DEFAULT_PROFILE_ID)) return { value: kept, repairs }
  return { value: [...kept, { id: DEFAULT_PROFILE_ID, name: 'Default' }], repairs: [...repairs, { path: 'profiles', action: 'reset-field' as const }] }
}

function repairUiAndFlags(raw: Json, spaceIds: readonly string[], ctx: Ctx) {
  const ui = isObject(raw.ui) ? raw.ui : {}
  const fixed = resetFields(ui, uiSchema.shape, { locale: () => 'en', searchEngine: () => DEFAULT_SEARCH_TEMPLATE }, 'ui', ctx)
  const active = pointAt(ui, 'activeSpaceId', spaceIds, true, 'ui')
  const flagsIn = isObject(raw.flags) ? raw.flags : {}
  const flags = Object.fromEntries(Object.entries(flagsIn).filter(([k, v]) => k.length <= 64 && typeof v === 'boolean'))
  const flagRepairs = Object.keys(flagsIn).filter((k) => !(k in flags)).map((k): Repair => ({ path: `flags.${k}`, action: 'dropped' }))
  return { ui: { ...fixed.value, activeSpaceId: active.value }, flags, repairs: [...fixed.repairs, ...active.repairs, ...flagRepairs] }
}

function createSeen(): Seen {
  const ids = new Set<string>() // local to this repair run, so a plain mutable Set is fine and keeps it linear
  return { has: (kind, id) => ids.has(`${kind}:${id}`), claim: (kind, id) => void ids.add(`${kind}:${id}`) }
}

/** Repairs raw state that is already at the current schema version (see upgradeRaw). */
export function repairRoot(raw: unknown, ctx: Ctx): RepairResult {
  if (!isObject(raw)) return { status: 'unrepairable', reason: 'not an object' }
  if (raw.schemaVersion !== SCHEMA_VERSION) return { status: 'unrepairable', reason: 'not at the current schema version' }
  const seen = createSeen()
  const spaces = repairList(raw.spaces, 'spaces', (s, p) => repairSpace(s, p, ctx, seen))
  if (spaces.value.length === 0) return { status: 'unrepairable', reason: 'no valid space' }
  const profiles = repairProfiles(raw.profiles, seen)
  const rest = repairUiAndFlags(raw, spaces.value.map((s) => s.id), ctx)
  const root = { schemaVersion: SCHEMA_VERSION, spaces: spaces.value, profiles: profiles.value, ui: rest.ui, flags: rest.flags }
  const parsed = persistedRootSchema.safeParse(root)
  if (!parsed.success) return { status: 'unrepairable', reason: parsed.error.issues[0]?.message ?? 'invalid shape' }
  return { status: 'ok', root: parsed.data, repairs: [...spaces.repairs, ...profiles.repairs, ...rest.repairs] }
}
