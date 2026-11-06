import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenRequest, TabState } from '@shared/ipc/schemas'
import { createTabViewManager, type ManagedView, type ViewFactory } from './tab-view-manager'

function fakeView() {
  const listeners = new Set<(s: object) => void>()
  const view = {
    loadURL: vi.fn().mockResolvedValue(undefined),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    onEvent: vi.fn((cb: (s: object) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    emit: (s: object) => listeners.forEach((l) => l(s))
  }
  return view
}

let views: Map<string, ReturnType<typeof fakeView>>
let factory: ViewFactory
let onState: ReturnType<typeof vi.fn<(s: TabState) => void>>
let onOpen: ReturnType<typeof vi.fn<(r: OpenRequest) => void>>
let onFocus: ReturnType<typeof vi.fn<(id: string) => void>>

beforeEach(() => {
  views = new Map()
  factory = {
    create: vi.fn(({ tabId }) => {
      const v = fakeView()
      views.set(tabId, v)
      return v as unknown as ManagedView
    })
  }
  onState = vi.fn<(s: TabState) => void>()
  onOpen = vi.fn<(r: OpenRequest) => void>()
  onFocus = vi.fn<(id: string) => void>()
})
const mgr = () => createTabViewManager({ factory, onState, onOpenRequest: onOpen, onFocus })

describe('tab view manager', () => {
  it('wakes a tab in the profile partition and loads the URL', () => {
    const m = mgr()
    m.wake({ tabId: 't1', profileId: 'work', url: 'https://a.com/' })
    expect(factory.create).toHaveBeenCalledWith({ tabId: 't1', partition: 'persist:profile-work' })
    expect(views.get('t1')!.loadURL).toHaveBeenCalledWith('https://a.com/')
  })

  it('wake is idempotent', () => {
    const m = mgr()
    m.wake({ tabId: 't1', profileId: 'work', url: 'https://a.com/' })
    m.wake({ tabId: 't1', profileId: 'work', url: 'https://a.com/' })
    expect(factory.create).toHaveBeenCalledTimes(1)
    expect(views.get('t1')!.loadURL).toHaveBeenCalledTimes(1)
  })

  it('refuses disallowed URLs', () => {
    const m = mgr()
    m.wake({ tabId: 't1', profileId: 'work', url: 'file:///x' })
    expect(factory.create).not.toHaveBeenCalled()
    m.wake({ tabId: 't2', profileId: 'work', url: 'https://a.com/' })
    m.navigate('t2', 'javascript:alert(1)')
    expect(views.get('t2')!.loadURL).toHaveBeenCalledTimes(1)
  })

  it('applies layout only to known tabs and hides views missing from the payload', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    m.wake({ tabId: 'b', profileId: 'p', url: 'about:blank' })
    m.applyLayout([
      { tabId: 'a', x: 1, y: 2, w: 3, h: 4, visible: true },
      { tabId: 'ghost', x: 0, y: 0, w: 1, h: 1, visible: true }
    ])
    expect(views.get('a')!.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
    expect(views.get('a')!.setVisible).toHaveBeenCalledWith(true)
    expect(views.get('b')!.setVisible).toHaveBeenCalledWith(false)
    expect(views.has('ghost')).toBe(false)
  })

  it('setBounds gets the exact integer DIPs from the payload, never rescaled', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    m.applyLayout([{ tabId: 'a', x: 301, y: 77, w: 1199, h: 653, visible: false }])
    expect(views.get('a')!.setBounds).toHaveBeenCalledWith({ x: 301, y: 77, width: 1199, height: 653 })
    expect(views.get('a')!.setVisible).toHaveBeenCalledWith(false)
  })
})

describe('tab view manager: lifecycle and commands', () => {
  it('sleep and close destroy the view and forget it', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    m.sleep('a')
    expect(views.get('a')!.destroy).toHaveBeenCalledTimes(1)
    expect(m.has('a')).toBe(false)
    m.close('a')
    expect(views.get('a')!.destroy).toHaveBeenCalledTimes(1)
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    expect(factory.create).toHaveBeenCalledTimes(2)
  })

  it('routes navigation commands', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    m.back('a'); m.forward('a'); m.reload('a'); m.stop('a')
    const v = views.get('a')!
    expect(v.goBack).toHaveBeenCalled()
    expect(v.goForward).toHaveBeenCalled()
    expect(v.reload).toHaveBeenCalled()
    expect(v.stop).toHaveBeenCalled()
    m.navigate('a', 'https://b.com/')
    expect(v.loadURL).toHaveBeenLastCalledWith('https://b.com/')
    expect(() => m.back('nope')).not.toThrow()
  })
})

describe('tab view manager: events from pages', () => {
  it('forwards state and open requests tagged with the tab id', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    const state = { url: 'https://x/', title: 'X', loading: false, canGoBack: true, canGoForward: false }
    views.get('a')!.emit({ type: 'state', state })
    expect(onState).toHaveBeenCalledWith({ tabId: 'a', ...state })
    views.get('a')!.emit({ type: 'open-request', url: 'https://y/' })
    expect(onOpen).toHaveBeenCalledWith({ openerTabId: 'a', url: 'https://y/' })
    views.get('a')!.emit({ type: 'open-request', url: 'javascript:1' })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('drops an oversized or credential-bearing pop-up URL before it reaches the shell', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    views.get('a')!.emit({ type: 'open-request', url: `https://y.test/?${'a'.repeat(9000)}` })
    views.get('a')!.emit({ type: 'open-request', url: 'https://u:p@y.test/' })
    expect(onOpen).not.toHaveBeenCalled()
    views.get('a')!.emit({ type: 'open-request', url: 'https://y.test/ok' })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('reports focus with the tab id', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    views.get('a')!.emit({ type: 'focus' })
    expect(onFocus).toHaveBeenCalledWith('a')
  })

  it('wake reports whether a view exists afterwards', () => {
    const m = mgr()
    expect(m.wake({ tabId: 'a', profileId: 'p', url: 'https://a.com/' })).toBe(true)
    expect(m.wake({ tabId: 'a', profileId: 'p', url: 'https://a.com/' })).toBe(true)
    expect(m.wake({ tabId: 'b', profileId: 'p', url: 'file:///x' })).toBe(false)
  })

  it('rate-limits pop-ups from one page', () => {
    let t = 0
    const m = createTabViewManager({ factory, onState, onOpenRequest: onOpen, onFocus, now: () => t })
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    for (let i = 0; i < 20; i++) views.get('a')!.emit({ type: 'open-request', url: `https://y/${i}` })
    expect(onOpen).toHaveBeenCalledTimes(5)
    t = 10_001
    views.get('a')!.emit({ type: 'open-request', url: 'https://y/later' })
    expect(onOpen).toHaveBeenCalledTimes(6)
  })

  it('destroyAll cleans up every view', () => {
    const m = mgr()
    m.wake({ tabId: 'a', profileId: 'p', url: 'about:blank' })
    m.wake({ tabId: 'b', profileId: 'p', url: 'about:blank' })
    m.destroyAll()
    expect(views.get('a')!.destroy).toHaveBeenCalled()
    expect(views.get('b')!.destroy).toHaveBeenCalled()
  })
})
