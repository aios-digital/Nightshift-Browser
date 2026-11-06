import { z } from 'zod'
import { isFaviconDataUrl } from '../favicon/favicon'
import { isAllowedNavigation } from '../url/navigation-policy'

/**
 * Version 1 = the spec model. Version 2 adds Card.kind and Card.isSleeping.
 * Version 3 stores favicons only as small image data URLs fetched by main (never a web URL the shell would load).
 */
export const SCHEMA_VERSION = 3

export const MIN_CARD_WIDTH = 300
export const DEFAULT_CARD_WIDTH = 1200
export const MAX_CARD_WIDTH = 8000
export const MAX_URL_LENGTH = 8192
export const MAX_TITLE_LENGTH = 512

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const indexSchema = z.string().min(1).max(64)
const timeSchema = z.number().int().nonnegative()
const shortText = z.string().max(512)

/** Persisted URLs may be empty (new tab), about:blank, or a web URL. Anything else is dropped as corrupt. */
const persistedUrl = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((u) => u === '' || isAllowedNavigation(u), 'unsupported URL')

export const tabSchema = z.object({
  id: idSchema,
  index: indexSchema,
  url: persistedUrl,
  title: shortText,
  favicon: z.string().refine(isFaviconDataUrl, 'favicon must be an image data URL').nullable(),
  customName: shortText.nullable(),
  customEmoji: z.string().max(16).nullable(),
  isDeleted: z.boolean(),
  openerTabId: idSchema.nullable(),
  createdAt: timeSchema
})

export const cardSchema = z.object({
  id: idSchema,
  index: indexSchema,
  kind: z.literal('web'),
  width: z.number().int().min(MIN_CARD_WIDTH).max(MAX_CARD_WIDTH),
  isMaximized: z.boolean(),
  isSleeping: z.boolean(),
  profileId: idSchema,
  soundMuted: z.boolean(),
  isDeleted: z.boolean(),
  deletedAt: timeSchema.nullable(),
  createdAt: timeSchema,
  lastActiveAt: timeSchema,
  tabs: z.array(tabSchema).max(2000),
  activeTabId: idSchema.nullable(),
  pinnedTabId: idSchema.nullable()
})

export const stackSchema = z.object({
  id: idSchema,
  index: indexSchema,
  cards: z.array(cardSchema).max(5000)
})

export const spaceSchema = z.object({
  id: idSchema,
  index: indexSchema,
  name: shortText,
  emoji: z.string().max(16),
  defaultProfileId: idSchema,
  stacks: z.array(stackSchema).max(100),
  activeCardId: idSchema.nullable(),
  isArchived: z.boolean(),
  lastActiveAt: timeSchema
})

export const profileSchema = z.object({ id: idSchema, name: shortText })

export const localeSchema = z.enum(['en', 'ar'])

export const uiSchema = z.object({
  locale: localeSchema,
  searchEngine: z.string().max(MAX_URL_LENGTH).refine((s) => s.includes('%s') && isAllowedNavigation(s.replace('%s', 'x'))),
  activeSpaceId: idSchema.nullable()
})

export const persistedRootSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  spaces: z.array(spaceSchema).max(100),
  profiles: z.array(profileSchema).min(1).max(50),
  ui: uiSchema,
  flags: z.record(z.string().max(64), z.boolean())
})

export type PersistedTab = z.infer<typeof tabSchema>
export type PersistedCard = z.infer<typeof cardSchema>
export type PersistedStack = z.infer<typeof stackSchema>
export type PersistedSpace = z.infer<typeof spaceSchema>
export type PersistedRoot = z.infer<typeof persistedRootSchema>
export type Locale = z.infer<typeof localeSchema>
