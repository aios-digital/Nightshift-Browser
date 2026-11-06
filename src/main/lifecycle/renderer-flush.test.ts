import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CH } from '@shared/ipc/channels'
import { createRendererFlush } from './renderer-flush'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createRendererFlush', () => {
  it('asks the renderer to flush and resolves on done()', async () => {
    const send = vi.fn()
    const flush = createRendererFlush(send, 500)
    const settled = vi.fn()
    void flush.request().then(settled)
    expect(send).toHaveBeenCalledWith(CH.flushRequest, null)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    flush.done()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
  })

  it('resolves after timeoutMs when the renderer never answers', async () => {
    const flush = createRendererFlush(vi.fn(), 500)
    const settled = vi.fn()
    void flush.request().then(settled)
    await vi.advanceTimersByTimeAsync(499)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('done() without a pending request is harmless', () => {
    expect(() => createRendererFlush(vi.fn(), 500).done()).not.toThrow()
  })
})
