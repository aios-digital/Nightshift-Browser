import { checkFaviconHeaders, FAVICON_LIMITS, isIconUrlAllowed, toFaviconDataUrl } from '@shared/favicon/favicon'

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; credentials: 'omit'; redirect: 'manual' }
) => Promise<Response>

/** Reads at most `maxBytes`. Returns null (and cancels the stream) as soon as the body is larger. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | null> {
  if (!body) return null
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0)
  return out
}

const isRedirect = (status: number) => status >= 300 && status < 400

/** The icon at `url` as a data URL, or null. Redirects are followed here, one hop at a time, each hop checked. */
async function fetchIcon(fetch: FetchLike, url: string, pageUrl: string, signal: AbortSignal, maxBytes: number) {
  let current = url
  for (let hop = 0; hop <= FAVICON_LIMITS.maxRedirects; hop++) {
    if (!isIconUrlAllowed(current, pageUrl)) return null
    const res = await fetch(current, { signal, credentials: 'omit', redirect: 'manual' })
    if (isRedirect(res.status)) {
      await res.body?.cancel().catch(() => undefined)
      const location = res.headers.get('location')
      if (!location) return null
      current = new URL(location, current).href
      continue
    }
    const h = res.headers
    const check = checkFaviconHeaders({ status: res.status, contentType: h.get('content-type'), contentLength: h.get('content-length') })
    if (!check.ok) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    const bytes = await readCapped(res.body, maxBytes)
    return bytes ? toFaviconDataUrl(bytes, h.get('content-type')) : null
  }
  return null
}

/**
 * Fetches one icon for a page and returns it as a data URL, or null. Never throws. The caller supplies `fetch`
 * bound to the tab's own session, so icons go through that profile's network stack (proxy, TLS checks, cache),
 * never the shell's. Credentials are omitted. Because main fetches outside the page's own protections, every URL
 * (and every redirect hop) must pass isIconUrlAllowed for the page: no local-network icons for public pages.
 */
export function createFaviconFetcher(deps: { fetch: FetchLike; timeoutMs?: number; maxBytes?: number }) {
  const timeoutMs = deps.timeoutMs ?? FAVICON_LIMITS.timeoutMs
  const maxBytes = deps.maxBytes ?? FAVICON_LIMITS.maxBytes
  return async (url: string, pageUrl: string, signal?: AbortSignal): Promise<string | null> => {
    if (signal?.aborted) return null
    const timeout = AbortSignal.timeout(timeoutMs)
    try {
      return await fetchIcon(deps.fetch, url, pageUrl, signal ? AbortSignal.any([signal, timeout]) : timeout, maxBytes)
    } catch {
      return null
    }
  }
}

/** Tries each candidate in order; returns the first icon that works, or null. Stops early when aborted. */
export async function fetchFirstFavicon(
  fetchOne: (url: string, signal: AbortSignal) => Promise<string | null>,
  candidates: readonly string[],
  signal: AbortSignal
): Promise<string | null> {
  for (const url of candidates) {
    if (signal.aborted) return null
    const icon = await fetchOne(url, signal)
    if (icon) return icon
  }
  return null
}
