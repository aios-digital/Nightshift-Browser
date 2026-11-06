import { describe, expect, it } from 'vitest'
import { describeLoadError } from './load-errors'

describe('describeLoadError', () => {
  it.each([
    [-105, 'errors.dns'],
    [-102, 'errors.refused'],
    [-7, 'errors.timeout'],
    [-118, 'errors.timeout'],
    [-106, 'errors.offline'],
    [-109, 'errors.offline'],
    [-200, 'errors.cert'],
    [-201, 'errors.cert'],
    [-299, 'errors.cert'],
    [-2, 'errors.generic'],
    [-999, 'errors.generic']
  ])('maps %i to %s', (code, key) => {
    expect(describeLoadError(code)).toBe(key)
  })
  it('ignores aborted loads', () => {
    expect(describeLoadError(-3)).toBeNull()
  })
})
