import { describe, expect, it } from 'vitest'
import { planViews } from './view-sync'

const tab = (tabId: string, active: boolean) => ({ tabId, profileId: 'default', url: `https://${tabId}.com/`, active })

describe('planViews', () => {
  it('wakes active tabs that have no view yet', () => {
    const plan = planViews(new Set(), [tab('a', true), tab('b', false)])
    expect(plan.wake).toEqual([{ tabId: 'a', profileId: 'default', url: 'https://a.com/' }])
    expect(plan.close).toEqual([])
  })

  it('keeps views of background tabs once they exist, but does not create them', () => {
    const plan = planViews(new Set(['a', 'b']), [tab('a', false), tab('b', true), tab('c', false)])
    expect(plan.wake).toEqual([])
    expect(plan.close).toEqual([])
  })

  it('closes views whose tab is gone, deleted or in a sleeping card', () => {
    const plan = planViews(new Set(['a', 'gone']), [tab('a', true)])
    expect(plan.close).toEqual(['gone'])
  })

  it('wakes a tab with an empty URL as about:blank', () => {
    const plan = planViews(new Set(), [{ tabId: 'n', profileId: 'default', url: '', active: true }])
    expect(plan.wake[0]?.url).toBe('about:blank')
  })

  it('wakes a newly activated tab', () => {
    const plan = planViews(new Set(['a']), [tab('a', false), tab('b', true)])
    expect(plan.wake.map((w) => w.tabId)).toEqual(['b'])
  })
})
