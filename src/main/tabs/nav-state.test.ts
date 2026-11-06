import { describe, expect, it } from 'vitest'
import { MAX_TITLE_LENGTH } from '@shared/model/persisted-schema'
import { iconChange, INITIAL_NAV, normalUrl, reduceNav, toTabState, type NavEvent, type NavState } from './nav-state'

const run = (events: readonly NavEvent[], from: NavState = INITIAL_NAV) => events.reduce(reduceNav, from)
const page = { title: 'Page', loading: false, canGoBack: false, canGoForward: false }
const start = (url: string, extra: Partial<{ isMainFrame: boolean; isSameDocument: boolean }> = {}): NavEvent => ({
  type: 'start-navigation', url, isMainFrame: true, isSameDocument: false, ...extra
})

describe('normalUrl', () => {
  it('normalises parseable URLs and leaves the rest alone', () => {
    expect(normalUrl('https://Example.com')).toBe('https://example.com/')
    expect(normalUrl('not a url')).toBe('not a url')
  })
})

describe('reduceNav: the stale-commit guard', () => {
  it('ignores the initial about:blank commit that arrives after loadURL(x)', () => {
    const s = run([{ type: 'load-requested', url: 'https://a.test/' }, { type: 'did-navigate', url: 'about:blank' }])
    expect(toTabState(s, page).url).toBe('https://a.test/')
    expect(s.committed).toBe('')
  })

  it('reports the intended URL until navigation to x starts (normalised)', () => {
    const requested = run([{ type: 'load-requested', url: 'https://A.test' }])
    expect(requested.intended).toBe('https://a.test/')
    const started = reduceNav(requested, start('https://a.test/'))
    expect(started.intended).toBeNull()
    const committed = reduceNav(started, { type: 'did-navigate', url: 'https://a.test/' })
    expect(toTabState(committed, page).url).toBe('https://a.test/')
  })

  it('a start for a different URL keeps the intended URL', () => {
    const s = run([{ type: 'load-requested', url: 'https://a.test/' }, start('about:blank')])
    expect(s.intended).toBe('https://a.test/')
  })

  it('load-settled clears intended only when it matches', () => {
    const s = run([{ type: 'load-requested', url: 'https://a.test/' }])
    expect(reduceNav(s, { type: 'load-settled', url: 'https://b.test/' }).intended).toBe('https://a.test/')
    expect(reduceNav(s, { type: 'load-settled', url: 'https://a.test' }).intended).toBeNull()
  })
})

describe('reduceNav: navigation events', () => {
  it('sub-frame and same-document start-navigation leave state unchanged', () => {
    const s = run([{ type: 'crash' }])
    expect(reduceNav(s, start('https://a.test/', { isMainFrame: false }))).toBe(s)
    expect(reduceNav(s, start('https://a.test/', { isSameDocument: true }))).toBe(s)
  })

  it('a main-frame start clears the error', () => {
    const s = run([{ type: 'crash' }, start('https://a.test/')])
    expect(s.error).toBeUndefined()
  })

  it('in-page commits only count for the main frame', () => {
    expect(reduceNav(INITIAL_NAV, { type: 'in-page', url: 'https://a.test/#x', isMainFrame: false })).toBe(INITIAL_NAV)
    expect(reduceNav(INITIAL_NAV, { type: 'in-page', url: 'https://a.test/#x', isMainFrame: true }).committed).toBe('https://a.test/#x')
  })

  it('disallowed URLs are never committed', () => {
    for (const url of ['file:///c:/x', 'javascript:alert(1)', 'chrome://settings', 'https://u:p@a.test/']) {
      expect(reduceNav(INITIAL_NAV, { type: 'did-navigate', url }).committed).toBe('')
    }
  })

  it('a failure sets the error, clears intended and commits the failed URL', () => {
    const s = run([
      { type: 'load-requested', url: 'https://a.test/' },
      { type: 'fail', code: -102, url: 'https://a.test/', isMainFrame: true }
    ])
    expect(s).toEqual({ intended: null, committed: 'https://a.test/', error: { code: -102, key: 'errors.refused' } })
  })

  it('aborted (-3) and sub-frame failures return the same state reference', () => {
    expect(reduceNav(INITIAL_NAV, { type: 'fail', code: -3, url: 'https://a.test/', isMainFrame: true })).toBe(INITIAL_NAV)
    expect(reduceNav(INITIAL_NAV, { type: 'fail', code: -102, url: 'https://a.test/', isMainFrame: false })).toBe(INITIAL_NAV)
  })

  it('crash sets errors.generic', () => {
    expect(reduceNav(INITIAL_NAV, { type: 'crash' }).error).toEqual({ code: -1, key: 'errors.generic' })
  })

  it('never mutates the previous state', () => {
    const before = Object.freeze({ intended: 'https://a.test/', committed: '' })
    expect(() => run([start('https://a.test/'), { type: 'did-navigate', url: 'https://a.test/' }, { type: 'crash' }], before)).not.toThrow()
    expect(before).toEqual({ intended: 'https://a.test/', committed: '' })
  })
})

describe('iconChange', () => {
  const at = (url: string) => run([{ type: 'did-navigate', url }])
  it('a committed new document aborts the old icon fetch; a new origin also clears the icon', () => {
    const prev = at('https://a.test/1')
    const sameOrigin = { type: 'did-navigate', url: 'https://a.test/2' } as const
    expect(iconChange(prev, reduceNav(prev, sameOrigin), sameOrigin)).toEqual({ abort: true, clear: false })
    const otherOrigin = { type: 'did-navigate', url: 'https://b.test/' } as const
    expect(iconChange(prev, reduceNav(prev, otherOrigin), otherOrigin)).toEqual({ abort: true, clear: true })
  })
  it('a navigation that only starts (and may be cancelled) changes nothing', () => {
    const prev = at('https://a.test/1')
    const e = start('https://b.test/')
    expect(iconChange(prev, reduceNav(prev, e), e)).toEqual({ abort: false, clear: false })
  })
  it('a failed load on another origin clears the icon', () => {
    const prev = at('https://a.test/1')
    const e: NavEvent = { type: 'fail', code: -105, url: 'https://b.test/', isMainFrame: true }
    expect(iconChange(prev, reduceNav(prev, e), e).clear).toBe(true)
  })
})

describe('toTabState', () => {
  const committed = (url: string) => run([{ type: 'did-navigate', url }])

  it('copies page facts and the error', () => {
    const s = run([{ type: 'fail', code: -105, url: 'https://a.test/', isMainFrame: true }])
    expect(toTabState(s, { ...page, loading: true, canGoBack: true })).toEqual({
      url: 'https://a.test/', title: '', loading: true, canGoBack: true, canGoForward: false,
      error: { code: -105, key: 'errors.dns' }
    })
  })

  it('the title is empty while erroring or on about:blank, and truncated to MAX_TITLE_LENGTH', () => {
    expect(toTabState(committed('about:blank'), page).title).toBe('')
    const long = 'x'.repeat(MAX_TITLE_LENGTH + 10)
    expect(toTabState(committed('https://a.test/'), { ...page, title: long }).title).toHaveLength(MAX_TITLE_LENGTH)
  })

  it('has no error key when there is no error', () => {
    expect('error' in toTabState(committed('https://a.test/'), page)).toBe(false)
  })
})
