import { describe, expect, it, vi } from 'vitest'
import { createApi } from './api'
import { CH } from '@shared/ipc/channels'

function fakeIpc() {
  return {
    invoke: vi.fn().mockResolvedValue('r'),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
}

describe('preload api', () => {
  it('maps calls onto the right channels', async () => {
    const ipc = fakeIpc()
    const api = createApi(ipc)
    await api.store.load()
    api.views.setLayout({ entries: [] })
    api.tabs.navigate({ tabId: 't', url: 'https://a.com' })
    api.tabs.back('t')
    await api.tabs.wake({ tabId: 't', profileId: 'default', url: 'about:blank' })
    expect(ipc.invoke).toHaveBeenCalledWith(CH.storeLoad)
    expect(ipc.send).toHaveBeenCalledWith(CH.setLayout, { entries: [] })
    expect(ipc.send).toHaveBeenCalledWith(CH.tabNavigate, { tabId: 't', url: 'https://a.com' })
    expect(ipc.send).toHaveBeenCalledWith(CH.tabBack, { tabId: 't' })
    expect(ipc.invoke).toHaveBeenCalledWith(CH.tabWake, { tabId: 't', profileId: 'default', url: 'about:blank' })
  })

  it('subscriptions return disposers that call off with the same listener', () => {
    const ipc = fakeIpc()
    const api = createApi(ipc)
    const cb = vi.fn()
    const dispose = api.tabs.onState(cb)
    const listener = ipc.on.mock.calls[0]![1]
    expect(ipc.on.mock.calls[0]![0]).toBe(CH.tabState)
    listener({}, { tabId: 't' })
    expect(cb).toHaveBeenCalledWith({ tabId: 't' })
    dispose()
    expect(ipc.off).toHaveBeenCalledWith(CH.tabState, listener)

    const dispose2 = api.tabs.onOpenRequest(cb)
    const l2 = ipc.on.mock.calls[1]![1]
    dispose2()
    expect(ipc.off).toHaveBeenCalledWith(CH.tabOpenRequest, l2)

    const dispose3 = api.tabs.onFocus(cb)
    const l3 = ipc.on.mock.calls[2]![1]
    expect(ipc.on.mock.calls[2]![0]).toBe(CH.tabFocus)
    dispose3()
    expect(ipc.off).toHaveBeenCalledWith(CH.tabFocus, l3)
  })

  it('supports the flush-on-close handshake', () => {
    const ipc = fakeIpc()
    const api = createApi(ipc)
    const cb = vi.fn()
    const dispose = api.shell.onFlushRequest(cb)
    const listener = ipc.on.mock.calls[0]![1]
    expect(ipc.on.mock.calls[0]![0]).toBe(CH.flushRequest)
    listener({}, null)
    expect(cb).toHaveBeenCalled()
    api.shell.flushDone()
    expect(ipc.send).toHaveBeenCalledWith(CH.flushDone)
    dispose()
    expect(ipc.off).toHaveBeenCalledWith(CH.flushRequest, listener)
  })

  it('exposes only functions and namespaces, never ipcRenderer', () => {
    const api = createApi(fakeIpc())
    expect(Object.keys(api).sort()).toEqual(['shell', 'store', 'tabs', 'views'])
    expect(JSON.stringify(Object.keys(api.tabs))).not.toContain('ipcRenderer')
  })
})
