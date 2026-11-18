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
  it('several active levels with collapsed levels in expansionStates: only the levels expanded by default count', () => {
    const levels = (collapsed: boolean[]) => [{ roles: ['Rows'], levels: collapsed.map((c, i) => ({ queryRefs: ['Date.L' + i], ...(c ? { isCollapsed: true } : {}) })), root: {} }]
    // single nodes expanded with +/-: the second level is active, yet nothing is expanded by default
    const single: any = vis('Rows', [true, true])
    single.visual.expansionStates = levels([true, true])
    expect(seedDrillState(single)).toBe(EMPTY_DRILL)
    // first level expanded, second collapsed, third active because of single nodes
    const mixed: any = vis('Rows', [true, true, true])
    mixed.visual.expansionStates = levels([false, true, true])
    expect(seedDrillState(mixed)).toEqual({ level: 0, path: [], expandedLevel: 1 })
    // entries that never mark a collapsed level keep the active-flag reading
    const legacy: any = vis('Rows', [true, true, true])
    legacy.visual.expansionStates = levels([false, false, false])
    expect(seedDrillState(legacy)).toEqual({ level: 0, path: [], expandedLevel: 2 })
    // Columns
    const cols: any = vis('Columns', [true, true])
    cols.visual.expansionStates = [{ roles: ['Columns'], levels: [{ queryRefs: ['Date.L0'], isCollapsed: true }, { queryRefs: ['Date.L1'], isCollapsed: true }], root: {} }]
    expect(seedDrillState(cols)).toBe(EMPTY_DRILL)
  })
})
