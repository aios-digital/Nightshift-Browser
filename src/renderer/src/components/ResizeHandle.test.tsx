// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from './ResizeHandle'

afterEach(cleanup)

function drag(dir: 'ltr' | 'rtl', dx: number, width = 600) {
  cleanup()
  const onResize = vi.fn()
  render(<ResizeHandle width={width} dir={dir} min={300} max={2000} label="Resize" onResize={onResize} />)
  const h = screen.getByRole('separator')
  fireEvent.pointerDown(h, { clientX: 500, pointerId: 1 })
  fireEvent.pointerMove(h, { clientX: 500 + dx, pointerId: 1 })
  fireEvent.pointerUp(h, { clientX: 500 + dx, pointerId: 1 })
  return onResize
}

describe('ResizeHandle', () => {
  it('grows when dragged toward the end in LTR', () => {
    expect(drag('ltr', 100).mock.lastCall?.[0]).toBe(700)
  })
  it('is mirrored in RTL: dragging right shrinks the card', () => {
    expect(drag('rtl', 100).mock.lastCall?.[0]).toBe(500)
    expect(drag('rtl', -100).mock.lastCall?.[0]).toBe(700)
  })
  it('respects the 300 px minimum', () => {
    expect(drag('ltr', -900).mock.lastCall?.[0]).toBe(300)
  })
  it('does not resize without a pointer press', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={600} dir="ltr" min={300} max={2000} label="Resize" onResize={onResize} />)
    fireEvent.pointerMove(screen.getByRole('separator'), { clientX: 900, pointerId: 1 })
    expect(onResize).not.toHaveBeenCalled()
  })
  it('resizes from the keyboard', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={600} dir="ltr" min={300} max={2000} label="Resize" onResize={onResize} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(640)
  })
})
