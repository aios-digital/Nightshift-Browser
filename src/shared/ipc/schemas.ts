import { z } from 'zod'
import { isFaviconDataUrl } from '../favicon/favicon'
import { isAllowedNavigation } from '../url/navigation-policy'
import { idSchema, MAX_URL_LENGTH, persistedRootSchema } from '../model/persisted-schema'

const coord = z.number().int().min(-100_000).max(100_000)
const size = z.number().int().min(0).max(100_000)
const webUrl = z.string().max(MAX_URL_LENGTH).refine(isAllowedNavigation, 'URL not allowed')

export const layoutEntrySchema = z.strictObject({
  tabId: idSchema,
  x: coord,
  y: coord,
  w: size,
  h: size,
  visible: z.boolean()
})

export const layoutPayloadSchema = z.strictObject({ entries: z.array(layoutEntrySchema).max(256) })
export const tabIdPayloadSchema = z.strictObject({ tabId: idSchema })
export const navigatePayloadSchema = z.strictObject({ tabId: idSchema, url: webUrl })
export const wakePayloadSchema = z.strictObject({ tabId: idSchema, profileId: idSchema, url: webUrl })
export const savePayloadSchema = z.strictObject({ snapshot: persistedRootSchema })
export const openRequestSchema = z.strictObject({ openerTabId: idSchema, url: webUrl })

export const tabStateSchema = z.strictObject({
  tabId: idSchema,
  url: z.string().max(MAX_URL_LENGTH),
  title: z.string().max(512),
  // A data URL sets the icon, null clears it (a different site committed), absent leaves it as it is.
  favicon: z.string().refine(isFaviconDataUrl, 'favicon must be an image data URL').nullable().optional(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.strictObject({ code: z.number().int(), key: z.string().max(64) }).optional()
})

export type LayoutEntry = z.infer<typeof layoutEntrySchema>
export type LayoutPayload = z.infer<typeof layoutPayloadSchema>
export type TabState = z.infer<typeof tabStateSchema>
export type OpenRequest = z.infer<typeof openRequestSchema>
