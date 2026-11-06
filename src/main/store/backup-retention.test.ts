import { describe, expect, it } from 'vitest'
import { planBackupPrune } from './backup-retention'

describe('planBackupPrune', () => {
  it('keeps the newest 3 per timestamped kind, by the timestamp in the name', () => {
    const names = ['state.corrupt-5.json', 'state.corrupt-40.json', 'state.corrupt-3.json', 'state.corrupt-100.json', 'state.corrupt-7.json']
    expect(planBackupPrune(names).sort()).toEqual(['state.corrupt-3.json', 'state.corrupt-5.json'])
  })
  it('counts each kind separately', () => {
    const names = [1, 2, 3, 4].flatMap((t) => [`state.future-${t}.json`, `state.repaired-${t}.json`])
    expect(planBackupPrune(names).sort()).toEqual(['state.future-1.json', 'state.repaired-1.json'])
  })
  it('keeps the newest 2 pre-v files', () => {
    expect(planBackupPrune(['state.pre-v1.json', 'state.pre-v2.json', 'state.pre-v10.json'])).toEqual(['state.pre-v1.json'])
  })
  it('never lists state.json, the .bak, temp files or unknown names', () => {
    const names = ['state.json', 'state.json.bak', 'state.json.ab12cd34.tmp', 'notes.txt', 'state.corrupt-x.json', 'state.corrupt-1.json.exe', '../state.corrupt-1.json']
    expect(planBackupPrune([...names, ...names])).toEqual([])
  })
  it('the limits are configurable', () => {
    expect(planBackupPrune(['state.corrupt-1.json', 'state.corrupt-2.json'], { timestamped: 1, preVersion: 1 })).toEqual(['state.corrupt-1.json'])
  })
})
