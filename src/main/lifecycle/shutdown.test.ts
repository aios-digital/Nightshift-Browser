import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installShutdown } from './shutdown'

const event = () => ({ preventDefault: vi.fn() })

function setup(flushStore: () => Promise<void> = () => Promise.resolve()) {
  const order: string[] = []
  const app = Object.assign(new EventEmitter(), { quit: vi.fn(() => order.push('quit')) })
  const window = new EventEmitter()
  const handle = installShutdown({
    app,
    window,
    requestRendererFlush: async () => void order.push('renderer'),
    flushStore: async () => {
      order.push('store')
      return flushStore()
    },
    teardown: () => void order.push('teardown')
  })
  return { app, window, handle, order }
}

describe('installShutdown', () => {
  it('before-quit is prevented once, flushes renderer then store, tears down, then quits', async () => {
    const { app, handle, order } = setup()
    const e = event()
    app.emit('before-quit', e)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(handle.isShuttingDown()).toBe(true)
    await vi.waitFor(() => expect(order).toEqual(['renderer', 'store', 'teardown', 'quit']))
  })

  it('a second before-quit during shutdown passes through', () => {
    const { app } = setup()
    app.emit('before-quit', event())
    const second = event()
    app.emit('before-quit', second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('window close outside shutdown is prevented and calls app.quit', () => {
    const { window, app, handle } = setup()
    const e = event()
    window.emit('close', e)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(handle.isShuttingDown()).toBe(false)
  })

  it('window close during shutdown is let through', () => {
    const { window, app } = setup()
    app.emit('before-quit', event())
    const e = event()
    window.emit('close', e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('teardown and quit still run when the store flush rejects', async () => {
    const { app, order } = setup(() => Promise.reject(new Error('disk full')))
    app.emit('before-quit', event())
    await vi.waitFor(() => expect(order).toEqual(['renderer', 'store', 'teardown', 'quit']))
  })
})
