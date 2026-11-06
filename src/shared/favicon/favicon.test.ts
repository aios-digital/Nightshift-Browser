import { describe, expect, it } from 'vitest'
import {
  checkFaviconHeaders, FAVICON_LIMITS, imageSize, isFaviconDataUrl, isIconUrlAllowed, normaliseMime,
  pickFaviconCandidates, sniffImageMime, toFaviconDataUrl
} from './favicon'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16le = (n: number) => [n & 255, (n >>> 8) & 255]
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const png = (w: number, h: number) => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0)
const ico = (w: number, h: number) => bytes(0, 0, 1, 0, 1, 0, w & 255, h & 255, ...new Array(14).fill(0))
const gif = (w: number, h: number) => bytes(...ascii('GIF89a'), ...u16le(w), ...u16le(h), 0, 0, 0)
const jpeg = (w: number, h: number) =>
  bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, (h >>> 8) & 255, h & 255, (w >>> 8) & 255, w & 255, 3)
const webp = (w: number, h: number) =>
  bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1))
const PNG = png(16, 16)
const ICO = ico(16, 16)
const JPEG = jpeg(16, 16)
const GIF = gif(16, 16)
const WEBP = webp(16, 16)

describe('pickFaviconCandidates', () => {
  it('keeps allowed http(s) icons only, drops duplicates and over-long URLs, and caps the count', () => {
    const long = `https://a.test/${'x'.repeat(9000)}.ico`
    const picked = pickFaviconCandidates([
      'data:image/png;base64,AAAA', 'file:///c:/x.ico', 'https://a.test/1.ico', 'https://a.test/1.ico', long,
      'http://192.168.1.1/x.png', 'https://a.test/2.png', 'https://a.test/3.png', 'https://a.test/4.png', 'https://u:p@a.test/5.png'
    ], 'https://a.test/page')
    expect(picked).toEqual(['https://a.test/1.ico', 'https://a.test/2.png', 'https://a.test/3.png'])
    expect(picked.length).toBeLessThanOrEqual(FAVICON_LIMITS.maxCandidates)
  })
})

describe('isIconUrlAllowed', () => {
  it('a public page may not point its icon at loopback, private, link-local or .local hosts', () => {
    const page = 'http://site.test/'
    for (const icon of [
      'http://127.0.0.1/x.png', 'http://localhost:8080/x.png', 'http://app.localhost/x.png', 'http://10.1.2.3/x.png',
      'http://172.16.0.1/x.png', 'http://192.168.1.1/x.png', 'http://169.254.169.254/x.png', 'http://100.64.0.1/x.png',
      'http://0.0.0.0/x.png', 'http://[::1]/x.png', 'http://[fd00::1]/x.png', 'http://[fe80::1]/x.png',
      'http://[::ffff:7f00:1]/x.png', 'http://printer.local/x.png', 'http://2130706433/x.png', 'http://0x7f.1/x.png'
    ]) expect(isIconUrlAllowed(icon, page), icon).toBe(false)
    expect(isIconUrlAllowed('http://cdn.test/x.png', page)).toBe(true)
    expect(isIconUrlAllowed('http://172.32.0.1/x.png', page)).toBe(true)
  })
  it('a page on the local network may use local icons', () => {
    expect(isIconUrlAllowed('http://127.0.0.1:5000/icon.png', 'http://127.0.0.1:5000/a')).toBe(true)
    expect(isIconUrlAllowed('http://192.168.1.1/icon.png', 'http://192.168.1.5/')).toBe(true)
  })
  it('an https page only gets https icons', () => {
    expect(isIconUrlAllowed('http://cdn.test/x.png', 'https://site.test/')).toBe(false)
    expect(isIconUrlAllowed('https://cdn.test/x.png', 'https://site.test/')).toBe(true)
  })
  it('refuses non-web icons and pages that are not web pages', () => {
    expect(isIconUrlAllowed('file:///c:/x.png', 'http://site.test/')).toBe(false)
    expect(isIconUrlAllowed('https://cdn.test/x.png', 'about:blank')).toBe(false)
    expect(isIconUrlAllowed('https://cdn.test/x.png', '')).toBe(false)
  })
})

describe('imageSize', () => {
  it('reads width and height from png, ico, gif, jpeg and webp headers', () => {
    expect(imageSize(png(32, 24))).toEqual({ width: 32, height: 24 })
    expect(imageSize(ico(48, 48))).toEqual({ width: 48, height: 48 })
    expect(imageSize(ico(0, 0))).toEqual({ width: 256, height: 256 })
    expect(imageSize(gif(16, 20))).toEqual({ width: 16, height: 20 })
    expect(imageSize(jpeg(64, 32))).toEqual({ width: 64, height: 32 })
    expect(imageSize(webp(16, 16))).toEqual({ width: 16, height: 16 })
  })
  it('gives null for truncated or unknown headers', () => {
    expect(imageSize(png(16, 16).subarray(0, 20))).toBeNull()
    expect(imageSize(bytes(0xff, 0xd8, 0xff))).toBeNull()
    expect(imageSize(ascii('hello'))).toBeNull()
  })
})

describe('normaliseMime', () => {
  it('lowercases and drops parameters', () => {
    expect(normaliseMime('Image/PNG; charset=binary')).toBe('image/png')
    expect(normaliseMime(null)).toBeNull()
    expect(normaliseMime('  ')).toBeNull()
  })
})

describe('sniffImageMime', () => {
  it('recognises png, ico, jpeg, gif and webp by their first bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(ICO)).toBe('image/x-icon')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(GIF)).toBe('image/gif')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
  })
  it('rejects html, svg and empty bodies', () => {
    expect(sniffImageMime(ascii('<!doctype html><p>hi'))).toBeNull()
    expect(sniffImageMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageMime(bytes())).toBeNull()
  })
})

describe('checkFaviconHeaders', () => {
  const ok = { status: 200, contentType: 'image/png', contentLength: '100' }
  it('accepts a small image response', () => {
    expect(checkFaviconHeaders(ok)).toEqual({ ok: true })
    expect(checkFaviconHeaders({ ...ok, contentType: null, contentLength: null })).toEqual({ ok: true })
    expect(checkFaviconHeaders({ ...ok, contentType: 'application/octet-stream' })).toEqual({ ok: true })
  })
  it('rejects non-2xx, types that are not images, svg, and a content-length over the cap', () => {
    expect(checkFaviconHeaders({ ...ok, status: 404 }).ok).toBe(false)
    expect(checkFaviconHeaders({ ...ok, contentType: 'text/html' }).ok).toBe(false)
    expect(checkFaviconHeaders({ ...ok, contentType: 'image/svg+xml' }).ok).toBe(false)
    expect(checkFaviconHeaders({ ...ok, contentLength: String(FAVICON_LIMITS.maxBytes + 1) }).ok).toBe(false)
  })
})

describe('toFaviconDataUrl', () => {
  it('encodes a sniffed image as a base64 data URL with the sniffed type', () => {
    expect(toFaviconDataUrl(PNG, 'image/png')).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
    expect(toFaviconDataUrl(ICO, 'application/octet-stream')).toMatch(/^data:image\/x-icon;base64,/)
    expect(toFaviconDataUrl(ICO, 'image/vnd.microsoft.icon')).toMatch(/^data:image\/x-icon;base64,/)
  })
  it('rejects images larger than 256 px on either side, which the shell would have to decode', () => {
    expect(toFaviconDataUrl(png(300, 16), 'image/png')).toBeNull()
    expect(toFaviconDataUrl(gif(16, 30000), 'image/gif')).toBeNull()
    expect(toFaviconDataUrl(png(256, 256), 'image/png')).not.toBeNull()
  })
  it('rejects bytes whose signature does not match the declared image type', () => {
    expect(toFaviconDataUrl(PNG, 'image/gif')).toBeNull()
    expect(toFaviconDataUrl(ascii('<html>'), 'image/png')).toBeNull()
    expect(toFaviconDataUrl(PNG, 'text/html')).toBeNull()
  })
  it('a body at the byte cap fits the data URL limit; one byte more is refused', () => {
    const atCap = new Uint8Array(FAVICON_LIMITS.maxBytes)
    atCap.set(PNG)
    const url = toFaviconDataUrl(atCap, 'image/png')!
    expect(url.length).toBeLessThanOrEqual(FAVICON_LIMITS.maxDataUrlLength)
    expect(isFaviconDataUrl(url)).toBe(true)
    const over = new Uint8Array(FAVICON_LIMITS.maxBytes + 1)
    over.set(PNG)
    expect(toFaviconDataUrl(over, 'image/png')).toBeNull()
  })
})

describe('isFaviconDataUrl', () => {
  it('accepts only small base64 data URLs of allowed image types', () => {
    expect(isFaviconDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isFaviconDataUrl('https://a.test/f.ico')).toBe(false)
    expect(isFaviconDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isFaviconDataUrl('data:image/png,rawtext')).toBe(false)
    expect(isFaviconDataUrl('data:image/png;base64,not base64!')).toBe(false)
    expect(isFaviconDataUrl(`data:image/png;base64,${'A'.repeat(FAVICON_LIMITS.maxDataUrlLength)}`)).toBe(false)
  })
})
