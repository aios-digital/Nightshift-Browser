import { describe, expect, it, vi } from 'vitest'
import { createFrameBatcher } from './frame-batcher'

function fakeRaf() {
  let next = 1
  const queue = new Map<number, () => void>()
  return {
    raf: (cb: () => void) => {
      const id = next++
      queue.set(id, cb)
      return id
    },
    caf: (id: number) => void queue.delete(id),
    frame: () => {
      const cbs = [...queue.values()]
      queue.clear()
      cbs.forEach((cb) => cb())
    },
    pending: () => queue.size
  }
}

describe('createFrameBatcher', () => {
  it('measures and sends once per frame no matter how often it is scheduled', () => {
    const f = fakeRaf()
    const send = vi.fn()
    let v = 0
    const measure = vi.fn(() => ++v)
    const b = createFrameBatcher({ measure, send, equals: Object.is, raf: f.raf, caf: f.caf })
    b.schedule(); b.schedule(); b.schedule()
    expect(f.pending()).toBe(1)
    expect(measure).not.toHaveBeenCalled()
    f.frame()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(1)
  })

  it('skips sending when the measurement did not change', () => {
    const f = fakeRaf()
    const send = vi.fn()
    const b = createFrameBatcher({ measure: () => 5, send, equals: Object.is, raf: f.raf, caf: f.caf })
    b.schedule(); f.frame()
    b.schedule(); f.frame()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('force=true resends even when unchanged', () => {
    const f = fakeRaf()
    const send = vi.fn()
    const b = createFrameBatcher({ measure: () => 5, send, equals: Object.is, raf: f.raf, caf: f.caf })
    b.schedule(); f.frame()
    b.schedule(true); f.frame()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('dispose cancels a pending frame', () => {
    const f = fakeRaf()
    const send = vi.fn()
    const b = createFrameBatcher({ measure: () => 1, send, equals: Object.is, raf: f.raf, caf: f.caf })
    b.schedule()
    b.dispose()
    f.frame()
    expect(send).not.toHaveBeenCalled()
    b.schedule()
    expect(f.pending()).toBe(0)
  })

  it('schedules again after a frame ran', () => {
    const f = fakeRaf()
    const send = vi.fn()
    let v = 0
    const b = createFrameBatcher({ measure: () => ++v, send, equals: Object.is, raf: f.raf, caf: f.caf })
    b.schedule(); f.frame()
    b.schedule(); f.frame()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
