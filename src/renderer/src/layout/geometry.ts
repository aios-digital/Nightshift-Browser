import type { LayoutEntry } from '@shared/ipc/schemas'

/** A card's content placeholder as measured in the ShellView, in CSS pixels relative to the window. */
export type Measured = {
  tabId: string
  left: number
  top: number
  width: number
  height: number
  awake: boolean
  error: boolean
}

const LIMIT = 100_000
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const px = (n: number, zoom: number) => (Number.isFinite(n) ? clamp(Math.round(n * zoom), -LIMIT, LIMIT) : 0)

/**
 * Converts measured placeholders into the integer DIP rects main expects.
 * Main never needs RTL logic: in RTL the DOM already puts card 0 at the right edge, so physical rects are mirrored.
 * `viewport` is in the same (DIP) units as the output.
 */
export function rectsToLayout(measured: readonly Measured[], viewport: { w: number; h: number }, zoom: number): LayoutEntry[] {
  return measured.map((m) => {
    const x = px(m.left, zoom)
    const y = px(m.top, zoom)
    const w = Math.max(0, px(m.width, zoom))
    const h = Math.max(0, px(m.height, zoom))
    const onScreen = w > 0 && h > 0 && x < viewport.w && x + w > 0 && y < viewport.h && y + h > 0
    return { tabId: m.tabId, x, y, w, h, visible: m.awake && !m.error && onScreen }
  })
}

export function layoutsEqual(a: readonly LayoutEntry[] | null, b: readonly LayoutEntry[] | null): boolean {
  if (a === null || b === null) return false
  if (a.length !== b.length) return false
  return a.every((e, i) => {
    const o = b[i]
    return !!o && e.tabId === o.tabId && e.x === o.x && e.y === o.y && e.w === o.w && e.h === o.h && e.visible === o.visible
  })
}

/** New card width after dragging its trailing edge by `dx` physical pixels. In RTL the trailing edge is on the left. */
export function applyResizeDelta(width: number, dx: number, dir: 'ltr' | 'rtl', min: number, max: number): number {
  const delta = dir === 'ltr' ? dx : -dx
  return clamp(Math.round(width + delta), min, max)
}
