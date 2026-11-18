import { describe, expect, it } from 'vitest'
import { seedDrillState } from '../host'
import { EMPTY_DRILL } from '../../state/interaction'

const col = (c: string) => ({ Column: { Expression: { SourceRef: { Entity: 'Date' } }, Property: c } })
const vis = (role: string, active: boolean[]) => ({ visual: { visualType: 'pivotTable', query: { queryState: { [role]: { projections: active.map((a, i) => ({ field: col('L' + i), queryRef: 'Date.L' + i, ...(a ? { active: true } : {}) })) } } } } })

describe('drill state seeded from PBIR active flags', () => {
  it('no active flags → pristine', () => {
    expect(seedDrillState(vis('Rows', [false, false]))).toBe(EMPTY_DRILL)
  })
  it('several active → expanded to the last active level', () => {
    expect(seedDrillState(vis('Rows', [true, true, true]))).toEqual({ level: 0, path: [], expandedLevel: 2 })
  })
  it('single active at k>0 → drilled to k', () => {
    expect(seedDrillState(vis('Category', [false, true, false]))).toEqual({ level: 1, path: [] })
  })
  it('single active at 0 → pristine', () => {
    expect(seedDrillState(vis('Rows', [true, false]))).toBe(EMPTY_DRILL)
  })
  it('matrix Columns map to columnLevel / columnExpandedLevel', () => {
    expect(seedDrillState(vis('Columns', [true, true]))).toEqual({ level: 0, path: [], columnLevel: 0, columnExpandedLevel: 1 })
  })
})
