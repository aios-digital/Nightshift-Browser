import { describe, expect, it, vi } from 'vitest'
import { focusExistingWindow } from './single-instance'

const win = (state: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}) => ({
  isDestroyed: () => state.destroyed ?? false,
  isMinimized: () => state.minimized ?? false,
  isVisible: () => state.visible ?? true,
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn()
})

describe('focusExistingWindow', () => {
  it('restores a minimized window, then focuses it', () => {
    const w = win({ minimized: true })
    focusExistingWindow(w)
    expect(w.restore).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })
  it('shows a hidden window, then focuses it', () => {
    const w = win({ visible: false })
    focusExistingWindow(w)
    expect(w.show).toHaveBeenCalled()
    expect(w.restore).not.toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })
  it('does nothing for a missing or destroyed window', () => {
    expect(() => focusExistingWindow(null)).not.toThrow()
    const dead = win({ destroyed: true })
    focusExistingWindow(dead)
    expect(dead.focus).not.toHaveBeenCalled()
  })
})
