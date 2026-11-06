import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersister } from './persister'

describe('createPersister', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces rapid saves into one write of the latest value', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const p = createPersister<number>({ write, debounceMs: 500, onError: vi.fn() })
    p.schedule(1)
    p.schedule(2)
    p.schedule(3)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(3)
  })

  it('restarts the debounce window on each save', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const p = createPersister<number>({ write, debounceMs: 500, onError: vi.fn() })
    p.schedule(1)
    await vi.advanceTimersByTimeAsync(400)
    p.schedule(2)
    await vi.advanceTimersByTimeAsync(400)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(write).toHaveBeenCalledWith(2)
  })

  it('flush writes pending data immediately and cancels the timer', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const p = createPersister<number>({ write, debounceMs: 500, onError: vi.fn() })
    p.schedule(7)
    await p.flush()
    expect(write).toHaveBeenCalledWith(7)
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing pending does nothing', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const p = createPersister<number>({ write, debounceMs: 500, onError: vi.fn() })
    await p.flush()
    expect(write).not.toHaveBeenCalled()
  })

  it('reports write errors without throwing', async () => {
    const err = new Error('disk full')
    const onError = vi.fn()
    const p = createPersister<number>({ write: vi.fn().mockRejectedValue(err), debounceMs: 10, onError })
    p.schedule(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(onError).toHaveBeenCalledWith(err)
    await expect(p.flush()).resolves.toBeUndefined()
  })

  it('flush waits for a write started by a concurrent timer run', async () => {
    const releases: Array<() => void> = []
    const done: number[] = []
    const write = vi.fn(
      (v: number) =>
        new Promise<void>((r) =>
          releases.push(() => {
            done.push(v)
            r()
          })
        )
    )
    const p = createPersister<number>({ write, debounceMs: 10, onError: vi.fn() })
    p.schedule(1)
    await vi.advanceTimersByTimeAsync(10)
    p.schedule(2)
    await vi.advanceTimersByTimeAsync(10)
    let flushed = false
    const f = p.flush().then(() => {
      flushed = true
    })
    releases[0]!()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenLastCalledWith(2)
    expect(flushed).toBe(false)
    releases[1]!()
    await f
    expect(done).toEqual([1, 2])
  })

  it('does not lose data scheduled while a write is in flight', async () => {
    let release: () => void = () => {}
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue(undefined)
    const p = createPersister<number>({ write, debounceMs: 10, onError: vi.fn() })
    p.schedule(1)
    await vi.advanceTimersByTimeAsync(10)
    p.schedule(2)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(write).toHaveBeenLastCalledWith(2)
  })
})
