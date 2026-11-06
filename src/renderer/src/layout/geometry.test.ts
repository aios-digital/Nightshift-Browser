import { describe, expect, it } from 'vitest'
import { applyResizeDelta, layoutsEqual, rectsToLayout, type Measured } from './geometry'

const vp = { w: 1000, h: 700 }
const m = (over: Partial<Measured> = {}): Measured => ({
  tabId: 't1', left: 10, top: 34, width: 400, height: 600, awake: true, error: false, ...over
})

describe('rectsToLayout', () => {
  it('rounds to integer DIPs using the zoom factor', () => {
    const [e] = rectsToLayout([m({ left: 10.4, top: 34.6, width: 400.5, height: 600.2 })], vp, 1)
    expect(e).toEqual({ tabId: 't1', x: 10, y: 35, w: 401, h: 600, visible: true })
    const [z] = rectsToLayout([m({ left: 100, top: 40, width: 200, height: 300 })], { w: 2000, h: 1400 }, 1.5)
    expect(z).toMatchObject({ x: 150, y: 60, w: 300, h: 450 })
  })

  it('keeps negative x for cards scrolled off to the start side', () => {
    const [e] = rectsToLayout([m({ left: -250, width: 400 })], vp, 1)
    expect(e?.x).toBe(-250)
    expect(e?.visible).toBe(true)
  })

  it('hides cards fully outside the viewport', () => {
    expect(rectsToLayout([m({ left: 1000, width: 300 })], vp, 1)[0]?.visible).toBe(false)
    expect(rectsToLayout([m({ left: -400, width: 400 })], vp, 1)[0]?.visible).toBe(false)
    expect(rectsToLayout([m({ top: 700 })], vp, 1)[0]?.visible).toBe(false)
  })

  it('hides sleeping, errored and empty-sized tabs', () => {
    expect(rectsToLayout([m({ awake: false })], vp, 1)[0]?.visible).toBe(false)
    expect(rectsToLayout([m({ error: true })], vp, 1)[0]?.visible).toBe(false)
    expect(rectsToLayout([m({ width: 0 })], vp, 1)[0]?.visible).toBe(false)
  })

  it('never emits negative sizes or non-finite numbers', () => {
    const [e] = rectsToLayout([m({ width: -5, height: Number.NaN, left: Number.POSITIVE_INFINITY })], vp, 1)
    expect(e).toMatchObject({ w: 0, h: 0, x: 0, visible: false })
  })

  it('mirrors correctly in RTL because it only reads physical rects', () => {
    // Card 0 sits at the right edge in RTL: left = 600 for a 400px card in a 1000px viewport.
    const [e] = rectsToLayout([m({ left: 600, width: 400 })], vp, 1)
    expect(e).toMatchObject({ x: 600, w: 400, visible: true })
  })
})

describe('layoutsEqual', () => {
  const a = rectsToLayout([m()], vp, 1)
  it('detects equality and differences', () => {
    expect(layoutsEqual(a, rectsToLayout([m()], vp, 1))).toBe(true)
    expect(layoutsEqual(a, rectsToLayout([m({ left: 11 })], vp, 1))).toBe(false)
    expect(layoutsEqual(a, [])).toBe(false)
    expect(layoutsEqual(null, a)).toBe(false)
  })
})

describe('applyResizeDelta', () => {
  it('grows to the right in LTR', () => {
    expect(applyResizeDelta(500, 100, 'ltr', 300, 2000)).toBe(600)
  })
  it('inverts the delta in RTL (trailing edge is on the left)', () => {
    expect(applyResizeDelta(500, 100, 'rtl', 300, 2000)).toBe(400)
    expect(applyResizeDelta(500, -100, 'rtl', 300, 2000)).toBe(600)
  })
  it('clamps to min and max and rounds', () => {
    expect(applyResizeDelta(500, -900, 'ltr', 300, 2000)).toBe(300)
    expect(applyResizeDelta(500, 9000, 'ltr', 300, 2000)).toBe(2000)
    expect(applyResizeDelta(500, 0.4, 'ltr', 300, 2000)).toBe(500)
  })
})
