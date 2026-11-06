// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isChromeTarget } from './card-chrome'

describe('isChromeTarget', () => {
  it('input, button, separator and card-body are not chrome; the bar is', () => {
    document.body.innerHTML = `
      <section>
        <div id="bar"><span id="label">x</span><button><svg id="icon"></svg></button><input id="omni" /></div>
        <div role="separator" id="sep"></div>
        <div data-testid="card-body"><p id="inside">page</p></div>
      </section>`
    const el = (id: string) => document.getElementById(id)
    expect(isChromeTarget(el('bar'))).toBe(true)
    expect(isChromeTarget(el('label'))).toBe(true)
    expect(isChromeTarget(el('icon'))).toBe(false)
    expect(isChromeTarget(el('omni'))).toBe(false)
    expect(isChromeTarget(el('sep'))).toBe(false)
    expect(isChromeTarget(el('inside'))).toBe(false)
  })

  it('non-elements are not chrome', () => {
    expect(isChromeTarget(null)).toBe(false)
    expect(isChromeTarget(document.createTextNode('x'))).toBe(false)
  })
})
