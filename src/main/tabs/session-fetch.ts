import { Readable } from 'node:stream'
import { net, type Session } from 'electron'
import type { FetchLike } from './favicon-fetcher'

const toHeaders = (raw: Record<string, string | string[]>): Headers =>
  new Headers(Object.entries(raw).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : [[k, v] as [string, string]])))

/**
 * A FetchLike over Electron's net.request in the given session, with manual redirects. (session.fetch cannot be
 * used for this: with redirect 'manual' it throws "Redirect was cancelled" instead of returning the redirect.)
 * A redirect is reported as a 3xx Response whose location header is the absolute target, and the request is
 * stopped, so the caller decides whether to follow it. Needs a running Electron app (covered by E2E).
 */
export function sessionFetch(ses: Session): FetchLike {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const req = net.request({ url, session: ses, redirect: 'manual', credentials: 'omit', useSessionCookies: false })
      const stop = () => {
        req.abort()
        reject(new Error('aborted'))
      }
      if (init.signal.aborted) return stop()
      init.signal.addEventListener('abort', stop, { once: true })
      req.on('redirect', (status, _method, redirectUrl) => {
        req.abort()
        resolve(new Response(null, { status, headers: { location: redirectUrl } }))
      })
      req.on('response', (res) => {
        const body = [204, 205, 304].includes(res.statusCode) ? null : (Readable.toWeb(res as unknown as Readable) as ReadableStream<Uint8Array>) // IncomingMessage is a Node Readable at runtime
        resolve(new Response(body, { status: res.statusCode, headers: toHeaders(res.headers) }))
      })
      req.on('error', reject)
      req.end()
    })
}
