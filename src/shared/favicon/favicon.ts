import { isAllowedNavigation } from '../url/navigation-policy'

/**
 * Favicon rules. Main fetches icons through the tab's own session and hands the shell a small `data:` URL, so the
 * shell never makes a network request and its CSP can stay `img-src 'self' data:`. SVG is never accepted (it can
 * carry script and is not needed for 16 px icons).
 */
export const FAVICON_LIMITS = {
  maxBytes: 32 * 1024,
  /** Largest width or height accepted; the shell decodes the image, so a tiny file must not claim a huge size. */
  maxPixels: 256,
  /** Redirect hops followed, each one checked like the first URL. */
  maxRedirects: 2,
  /** base64 of maxBytes (43,692 chars) plus the longest prefix, rounded up. */
  maxDataUrlLength: 44_000,
  timeoutMs: 5_000,
  maxCandidates: 3,
  maxUrlLength: 8_192
} as const

export type FaviconMime = 'image/png' | 'image/x-icon' | 'image/gif' | 'image/jpeg' | 'image/webp'

/** Declared types we accept; the bytes decide the final type. Servers often send icons as octet-stream. */
const DECLARED_OK = new Set([
  'image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/gif', 'image/jpeg', 'image/webp', 'application/octet-stream'
])
/** Which declared types each sniffed type may come with (octet-stream and no header go with any). */
const SAME_FAMILY: Record<FaviconMime, readonly string[]> = {
  'image/png': ['image/png'],
  'image/x-icon': ['image/x-icon', 'image/vnd.microsoft.icon'],
  'image/gif': ['image/gif'],
  'image/jpeg': ['image/jpeg'],
  'image/webp': ['image/webp']
}
const DATA_URL = /^data:image\/(png|x-icon|gif|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

const inV4 = (host: string, base: string, bits: number) => {
  const toNum = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0)
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  const size = 2 ** (32 - bits)
  return Math.floor(toNum(host) / size) === Math.floor(toNum(base) / size)
}
const LOCAL_V4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]
]

/**
 * Whether a host is on this machine or the local network: loopback, private, link-local, CGNAT or unique-local
 * addresses, and localhost / .local names. Uses the URL parser's canonical host, so decimal, hex and
 * IPv4-mapped IPv6 spellings are covered. (A public name that resolves to a local address is not caught here.)
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host.startsWith('[')) return /^\[(::1?|f[cd][0-9a-f]*:.*|fe[89ab][0-9a-f]*:.*|::ffff:.*)\]$/.test(host)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  return LOCAL_V4.some(([base, bits]) => inV4(host, base, bits))
}

const parse = (url: string) => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Whether main may fetch this icon for this page. Main fetches outside the page's own protections, so: web URLs
 * only; an https page only gets https icons; and a public page may not point its icon at a local or private host
 * (that would let any site make the browser send requests into the user's network).
 */
export function isIconUrlAllowed(iconUrl: string, pageUrl: string): boolean {
  const icon = parse(iconUrl)
  const page = parse(pageUrl)
  if (!icon || !page || !/^https?:$/.test(icon.protocol) || !/^https?:$/.test(page.protocol)) return false
  if (iconUrl.length > FAVICON_LIMITS.maxUrlLength || !isAllowedNavigation(iconUrl)) return false
  if (page.protocol === 'https:' && icon.protocol !== 'https:') return false
  return !isLocalHost(icon.hostname) || isLocalHost(page.hostname)
}

export function pickFaviconCandidates(urls: readonly string[], pageUrl: string): string[] {
  const allowed = urls.filter((u) => isIconUrlAllowed(u, pageUrl))
  return [...new Set(allowed)].slice(0, FAVICON_LIMITS.maxCandidates)
}

export function normaliseMime(header: string | null): string | null {
  const mime = header?.split(';', 1)[0]?.trim().toLowerCase()
  return mime ? mime : null
}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/** The image type from the file's first bytes, or null if it is not one of the allowed formats. */
export function sniffImageMime(b: Uint8Array): FaviconMime | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(b, [0, 0, 1, 0])) return 'image/x-icon'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))) return 'image/gif'
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const le24 = (b: Uint8Array, i: number) => le16(b, i) | ((b[i + 2] ?? 0) << 16)
const be32 = (b: Uint8Array, i: number) => be16(b, i) * 65536 + be16(b, i + 2)
type Size = { width: number; height: number }

function jpegSize(b: Uint8Array): Size | null {
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] ?? 0
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) return { width: be16(b, i + 7), height: be16(b, i + 5) }
    i += 2 + be16(b, i + 2)
  }
  return null
}

function webpSize(b: Uint8Array): Size | null {
  const kind = String.fromCharCode(...b.subarray(12, 16))
  if (kind === 'VP8X' && b.length >= 30) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) }
  if (kind === 'VP8 ' && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  if (kind !== 'VP8L' || b.length < 25) return null
  const [b1, b2, b3, b4] = [b[21] ?? 0, b[22] ?? 0, b[23] ?? 0, b[24] ?? 0]
  return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) }
}

/** Width and height read from the file header only (nothing is decoded), or null if the header is incomplete. */
export function imageSize(b: Uint8Array): Size | null {
  switch (sniffImageMime(b)) {
    case 'image/png':
      return b.length >= 24 ? { width: be32(b, 16), height: be32(b, 20) } : null
    case 'image/gif':
      return b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : null
    case 'image/x-icon': {
      const count = le16(b, 4)
      if (count === 0 || b.length < 6 + 16 * count) return null
      const sides = Array.from({ length: count }, (_, k) => [b[6 + 16 * k] || 256, b[7 + 16 * k] || 256])
      return { width: Math.max(...sides.map((s) => s[0]!)), height: Math.max(...sides.map((s) => s[1]!)) }
    }
    case 'image/jpeg':
      return jpegSize(b)
    case 'image/webp':
      return webpSize(b)
    default:
      return null
  }
}

export function checkFaviconHeaders(h: { status: number; contentType: string | null; contentLength: string | null }):
  { ok: true } | { ok: false; reason: string } {
  if (h.status < 200 || h.status > 299) return { ok: false, reason: `status ${h.status}` }
  const mime = normaliseMime(h.contentType)
  if (mime !== null && !DECLARED_OK.has(mime)) return { ok: false, reason: `type ${mime}` }
  const length = h.contentLength === null ? null : Number(h.contentLength)
  if (length !== null && (!Number.isFinite(length) || length > FAVICON_LIMITS.maxBytes)) return { ok: false, reason: 'too large' }
  return { ok: true }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** A data URL for the icon, or null when the bytes are empty, too large, not an allowed image, or not what was declared. */
export function toFaviconDataUrl(bytes: Uint8Array, declared: string | null): string | null {
  if (bytes.length === 0 || bytes.length > FAVICON_LIMITS.maxBytes) return null
  const sniffed = sniffImageMime(bytes)
  const mime = normaliseMime(declared)
  if (!sniffed || (mime !== null && !DECLARED_OK.has(mime))) return null
  if (mime !== null && mime !== 'application/octet-stream' && !SAME_FAMILY[sniffed].includes(mime)) return null
  const size = imageSize(bytes)
  if (!size || size.width < 1 || size.height < 1) return null
  if (size.width > FAVICON_LIMITS.maxPixels || size.height > FAVICON_LIMITS.maxPixels) return null
  return `data:${sniffed};base64,${toBase64(bytes)}`
}

export function isFaviconDataUrl(value: string): boolean {
  return value.length <= FAVICON_LIMITS.maxDataUrlLength && DATA_URL.test(value)
}
