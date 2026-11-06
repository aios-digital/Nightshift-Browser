import { describe, expect, it, vi } from 'vitest'
import { FAVICON_LIMITS } from '@shared/favicon/favicon'
import { createFaviconFetcher, fetchFirstFavicon, readCapped, type FetchLike } from './favicon-fetcher'

// A 16x16 PNG header (signature + IHDR), enough for the type and size checks.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0])
const PAGE = 'https://a.test/page'
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } })
const png = (headers: Record<string, string> = { 'content-type': 'image/png' }) => new Response(PNG, { headers })

function streamOf(chunks: number, size: number) {
  const cancel = vi.fn()
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ < chunks) c.enqueue(new Uint8Array(size))
      else c.close()
    },
    cancel
  })
  return { body, cancel }
}

describe('readCapped', () => {
  it('returns the bytes when they fit', async () => {
    expect((await readCapped(streamOf(2, 10).body, 100))?.length).toBe(20)
  })
  it('gives null and cancels the stream once the cap is passed', async () => {
    const s = streamOf(100, 1024)
    expect(await readCapped(s.body, 4096)).toBeNull()
    expect(s.cancel).toHaveBeenCalled()
  })
  it('a missing body gives null', async () => {
    expect(await readCapped(null, 10)).toBeNull()
  })
})

describe('createFaviconFetcher', () => {
  it('a small png gives a data URL, fetched without credentials', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(png())
    const url = await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE)
    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'manual' })
  })
  it('a body over the cap without content-length gives null', async () => {
    const big = new Uint8Array(FAVICON_LIMITS.maxBytes + 10)
    big.set(PNG)
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(big, { headers: { 'content-type': 'image/png' } }))
    expect(await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE)).toBeNull()
  })
  it('non-image responses give null', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    expect(await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE)).toBeNull()
  })
  it('follows a redirect itself, checking each hop', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValueOnce(redirect('/real.png')).mockResolvedValueOnce(png())
    expect(await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE)).toMatch(/^data:image\/png/)
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://a.test/f.png', 'https://a.test/real.png'])
  })
  it('a redirect to a URL we would not fetch is never requested', async () => {
    for (const target of ['file:///c:/secret.png', 'http://192.168.1.1/x.png', 'http://a.test/downgrade.png']) {
      const fetch = vi.fn<FetchLike>().mockResolvedValueOnce(redirect(target)).mockResolvedValue(png())
      expect(await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE), target).toBeNull()
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
  it('gives up after two redirects, and on a redirect without a location', async () => {
    const loop = vi.fn<FetchLike>().mockImplementation(async () => redirect('/again.png'))
    expect(await createFaviconFetcher({ fetch: loop })('https://a.test/f.png', PAGE)).toBeNull()
    expect(loop).toHaveBeenCalledTimes(3)
    const bare = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 301 }))
    expect(await createFaviconFetcher({ fetch: bare })('https://a.test/f.png', PAGE)).toBeNull()
  })
  it('an icon URL the page may not use is never requested', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(png())
    expect(await createFaviconFetcher({ fetch })('http://127.0.0.1/x.png', PAGE)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('network errors give null, never a throw', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new Error('ECONNRESET'))
    await expect(createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE)).resolves.toBeNull()
  })
  it('a slow server times out and gives null', async () => {
    const fetch: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    await expect(createFaviconFetcher({ fetch, timeoutMs: 20 })('https://a.test/f.png', PAGE)).resolves.toBeNull()
  })
  it('an already aborted signal gives null without fetching', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(png())
    const ctl = new AbortController()
    ctl.abort()
    expect(await createFaviconFetcher({ fetch })('https://a.test/f.png', PAGE, ctl.signal)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('fetchFirstFavicon', () => {
  it('tries candidates in order and stops at the first success', async () => {
    const one = vi.fn(async (u: string) => (u.endsWith('2.png') ? 'data:image/png;base64,AAAA' : null))
    const got = await fetchFirstFavicon(one, ['https://a.test/1.png', 'https://a.test/2.png', 'https://a.test/3.png'], new AbortController().signal)
    expect(got).toBe('data:image/png;base64,AAAA')
    expect(one).toHaveBeenCalledTimes(2)
  })
  it('stops when the signal is aborted', async () => {
    const ctl = new AbortController()
    const one = vi.fn(async () => {
      ctl.abort()
      return null
    })
    expect(await fetchFirstFavicon(one, ['https://a.test/1.png', 'https://a.test/2.png'], ctl.signal)).toBeNull()
    expect(one).toHaveBeenCalledTimes(1)
  })
})
