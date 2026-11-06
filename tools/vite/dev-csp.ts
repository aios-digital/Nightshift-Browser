import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

/** The Vite dev server's HMR websocket. Only ever added to the dev page, never to the built app. */
export const DEV_WS_ORIGINS: readonly string[] = ['ws://localhost:*', 'ws://127.0.0.1:*']

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i
const HEAD_OPEN = /<head\b[^>]*>/i
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi

/** A CSP hash source for exactly this script text. */
export function sha256Source(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
}

/**
 * The production policy plus what the dev server needs: one hash per inline script Vite injected (the React
 * refresh preamble) and the HMR websocket. Never 'unsafe-inline' or 'unsafe-eval' for scripts.
 */
export function buildDevCsp(prodCsp: string, inlineScripts: readonly string[], wsOrigins: readonly string[]): string {
  const extra: Record<string, readonly string[]> = {
    'script-src': inlineScripts.map(sha256Source),
    'connect-src': wsOrigins
  }
  return prodCsp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const add = extra[d.split(/\s+/, 1)[0] ?? ''] ?? []
      return add.length ? [d, ...add].join(' ') : d
    })
    .join('; ')
}

/**
 * Rewrites the page's CSP for the dev server and moves it to the top of <head>. A meta-tag policy only covers
 * what comes after it, and Vite injects its client and the React preamble at the start of <head>; moving the
 * policy up makes dev run under the same rules as the built app. Throws if the page has no CSP or no <head>.
 */
export function injectDevCsp(html: string, wsOrigins: readonly string[]): string {
  const meta = CSP_META.exec(html)
  if (!meta) throw new Error('ns-dev-csp: the page has no Content-Security-Policy meta tag')
  if (!HEAD_OPEN.test(html)) throw new Error('ns-dev-csp: the page has no <head>')
  const scripts = [...html.matchAll(INLINE_SCRIPT)].map((m) => m[1] ?? '').filter((s) => s.trim() !== '')
  const policy = `<meta http-equiv="Content-Security-Policy" content="${buildDevCsp(meta[1] ?? '', scripts, wsOrigins)}" />`
  return html.replace(CSP_META, '').replace(HEAD_OPEN, (head) => `${head}\n    ${policy}`)
}

/** Vite plugin: dev server only (`apply: 'serve'`), runs after other HTML transforms so it sees the injected scripts. */
export function devCspPlugin(): Plugin {
  return {
    name: 'ns-dev-csp',
    apply: 'serve',
    transformIndexHtml: { order: 'post', handler: (html) => injectDevCsp(html, DEV_WS_ORIGINS) }
  }
}
