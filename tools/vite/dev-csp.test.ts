import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDevCsp, devCspPlugin, DEV_WS_ORIGINS, injectDevCsp, sha256Source } from './dev-csp'

const PROD = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'"
const page = (scripts: string) => `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${PROD}" />
${scripts}</head><body><script type="module" src="/src/main.tsx"></script></body></html>`
const cspOf = (html: string) => /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1]
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))

describe('sha256Source', () => {
  it('equals node:crypto sha256 of the exact script text, as a CSP source', () => {
    const text = '\nimport x from "/@react-refresh"\n'
    const digest = createHash('sha256').update(text, 'utf8').digest('base64')
    expect(sha256Source(text)).toBe(`'sha256-${digest}'`)
  })
})

describe('buildDevCsp', () => {
  it('adds one sha256 source per inline script to script-src', () => {
    const csp = buildDevCsp(PROD, ['a()', 'b()'], [])
    expect(directive(csp, 'script-src')).toBe(`script-src 'self' ${sha256Source('a()')} ${sha256Source('b()')}`)
  })
  it('no inline scripts and no origins leaves the policy unchanged', () => {
    expect(buildDevCsp(PROD, [], [])).toBe(PROD)
  })
  it('adds the HMR websocket origins to connect-src', () => {
    expect(directive(buildDevCsp(PROD, [], DEV_WS_ORIGINS), 'connect-src')).toBe(`connect-src 'self' ${DEV_WS_ORIGINS.join(' ')}`)
  })
  it('never adds unsafe-inline or unsafe-eval, and every other directive is identical', () => {
    const csp = buildDevCsp(PROD, ['a()'], DEV_WS_ORIGINS)
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
    for (const d of ["default-src 'none'", "style-src 'self' 'unsafe-inline'", "base-uri 'none'"]) expect(csp).toContain(d)
  })
})

describe('injectDevCsp', () => {
  it('hashes the inline scripts in the page and ignores external ones', () => {
    const preamble = 'import { injectIntoGlobalHook } from "/@react-refresh";'
    const html = injectDevCsp(page(`<script type="module">${preamble}</script>`), DEV_WS_ORIGINS)
    const csp = cspOf(html)!
    expect(directive(csp, 'script-src')).toBe(`script-src 'self' ${sha256Source(preamble)}`)
    expect(html).toContain(preamble)
  })
  it('moves the policy to the top of <head>, so it also covers the scripts Vite injects before it', () => {
    const html = injectDevCsp(
      `<!doctype html><html><head>\n<script type="module">pre()</script>\n<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${PROD}" />\n</head></html>`,
      []
    )
    const metaAt = html.indexOf('http-equiv="Content-Security-Policy"')
    expect(metaAt).toBeGreaterThan(-1)
    expect(metaAt).toBeLessThan(html.indexOf('<script'))
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(directive(cspOf(html)!, 'script-src')).toBe(`script-src 'self' ${sha256Source('pre()')}`)
  })
  it('throws when the CSP meta is missing, so a dev page never runs without a policy', () => {
    expect(() => injectDevCsp('<html><head></head></html>', [])).toThrow(/Content-Security-Policy/)
  })
})

describe('devCspPlugin', () => {
  it('applies only to the dev server, after other HTML transforms', () => {
    const plugin = devCspPlugin()
    expect(plugin.apply).toBe('serve')
    expect(plugin.transformIndexHtml).toMatchObject({ order: 'post' })
  })
  it('the production page itself still has the strict policy (no hashes, no websockets)', () => {
    const csp = cspOf(readFileSync(resolve('src/renderer/index.html'), 'utf8'))!
    expect(directive(csp, 'script-src')).toBe("script-src 'self'")
    expect(csp).not.toMatch(/sha256|ws:/)
  })
})
