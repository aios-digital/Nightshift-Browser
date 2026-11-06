import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRoot } from '@shared/model/defaults'
import { createRootStore } from './root-store'
import { startPersistence } from './persistence'

let n = 0
const env = { now: () => 5, newId: () => `i${++n}` }

describe('startPersistence', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces snapshot saves after model changes', () => {
    const store = createRootStore(createDefaultRoot(1, env.newId), env)
    const save = vi.fn()
    const stop = startPersistence(store, save, 300)
    expect(save).not.toHaveBeenCalled()
    store.setLocale('ar')
    store.setSearchEngine('https://duckduckgo.com/?q=%s')
    vi.advanceTimersByTime(299)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].ui.locale).toBe('ar')
    stop.dispose()
  })

  it('flush saves immediately when something is pending, and not otherwise', () => {
    const store = createRootStore(createDefaultRoot(1, env.newId), env)
    const save = vi.fn()
    const p = startPersistence(store, save, 300)
    p.flush()
    expect(save).not.toHaveBeenCalled()
    store.setLocale('ar')
    p.flush()
    expect(save).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
    p.dispose()
  })

  it('dispose stops saving', () => {
    const store = createRootStore(createDefaultRoot(1, env.newId), env)
    const save = vi.fn()
    const p = startPersistence(store, save, 300)
    p.dispose()
    store.setLocale('ar')
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
  })
})
