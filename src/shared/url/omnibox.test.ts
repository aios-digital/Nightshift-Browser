import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_TEMPLATE, resolveInput } from './omnibox'

const T = 'https://search.example/?q=%s'

describe('resolveInput', () => {
  it('returns null for empty or whitespace', () => {
    expect(resolveInput('', T)).toBeNull()
    expect(resolveInput('   ', T)).toBeNull()
  })

  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', 'http://example.com/'],
    ['about:blank', 'about:blank']
  ])('treats %s as a URL', (input, url) => {
    expect(resolveInput(input, T)).toEqual({ kind: 'url', url })
  })

  it.each([
    ['localhost', 'http://localhost/'],
    ['localhost:3000/x', 'http://localhost:3000/x'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['[::1]:8080/p', 'http://[::1]:8080/p'],
    ['example.com/x', 'https://example.com/x'],
    ['sub.example.co.uk', 'https://sub.example.co.uk/']
  ])('adds a scheme to %s', (input, url) => {
    expect(resolveInput(input, T)).toEqual({ kind: 'url', url })
  })

  it('treats internationalised domains as URLs', () => {
    const r = resolveInput('مثال.السعودية', T)
    expect(r?.kind).toBe('url')
    expect(r?.url.startsWith('https://')).toBe(true)
  })

  it.each(['hello world', 'cats', 'what is 1.5 times 2', '?example.com'])('searches for %s', (input) => {
    expect(resolveInput(input, T)?.kind).toBe('search')
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///c:/secret.txt',
    'data:text/html,<b>x</b>',
    'chrome://settings',
    'vbscript:x'
  ])('never navigates to %s', (input) => {
    const r = resolveInput(input, T)
    expect(r?.kind).toBe('search')
    expect(r?.url.startsWith('https://search.example/')).toBe(true)
  })

  it('encodes the query into the template', () => {
    expect(resolveInput('a b&c', T)).toEqual({ kind: 'search', url: 'https://search.example/?q=a%20b%26c' })
  })

  it('strips a leading ? and trims', () => {
    expect(resolveInput('  ? hi there ', T)).toEqual({ kind: 'search', url: 'https://search.example/?q=hi%20there' })
  })

  it('returns null for a bare ?', () => {
    expect(resolveInput('?', T)).toBeNull()
  })

  it('falls back to the default template when the template has no %s', () => {
    const r = resolveInput('cats', 'https://bad.example/')
    expect(r?.url).toBe(DEFAULT_SEARCH_TEMPLATE.replace('%s', 'cats'))
  })

  it('defaults to Google', () => {
    expect(DEFAULT_SEARCH_TEMPLATE).toContain('google.com')
  })
})
