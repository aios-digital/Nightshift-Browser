import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from './navigation-policy'

describe('isAllowedNavigation', () => {
  it.each(['http://a.com', 'https://a.com/x?y#z', 'about:blank'])('allows %s', (u) => {
    expect(isAllowedNavigation(u)).toBe(true)
  })
  it.each([
    'javascript:alert(1)', 'file:///c:/x', 'data:text/html,x', 'chrome://gpu',
    'devtools://devtools', 'https://bank.com@evil.example/', 'https://user:pw@a.com/', 'ftp://a.com', 'about:srcdoc', 'not a url', '', 'blob:https://a.com/1'
  ])('blocks %s', (u) => {
    expect(isAllowedNavigation(u)).toBe(false)
  })
})
