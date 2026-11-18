import { describe, expect, it } from 'vitest'
import { applyExpansion, expansionPathKey, isExpanded, readExpansion, readToggledPaths, setAllExpanded, setLevelExpanded, setNodeExpanded } from './expansion'

const REFS = ['Geo.Region', 'Geo.Country', 'Geo.City']
const LEVELS = REFS.map((queryRef) => ({ queryRef, expr: { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: queryRef.split('.')[1] } } }))
const lit = (v: string) => ({ Literal: { Value: `'${v}'` } })

function visual(role: string, active: boolean[], expansionStates?: any[]): any {
  return { visual: { query: { queryState: { [role]: { projections: REFS.map((queryRef, i) => ({ queryRef, ...(active[i] ? { active: true } : {}) })) } } }, ...(expansionStates ? { expansionStates } : {}) } }
}
const collapsed = () => false

describe('expansion state (PBIR expansionStates)', () => {
  it('reads Power BI\'s shape: collapsed levels, nodes toggled with their own level value', () => {
    // levels collapsed by default, Europe expanded, and Germany inside it — `active` is set on the queried levels
    const json = visual('Rows', [true, true, true], [
      {
        roles: ['Rows'],
        levels: [
          { queryRefs: [REFS[0]], isCollapsed: true, identityKeys: [LEVELS[0].expr], isPinned: true },
          { queryRefs: [REFS[1]], isCollapsed: true, isPinned: true },
          { queryRefs: [REFS[2]], isCollapsed: true }
        ],
        root: { children: [{ identityValues: [lit('Europe')], isToggled: true, children: [{ identityValues: [lit('Germany')], isToggled: true }] }] }
      }
    ])
    // the fallback (here: "expanded") must not be used for levels the file describes
    const st = readExpansion(json, 'Rows', REFS, () => true)
    expect(st.levelExpanded).toEqual([false, false, false])
    expect(readToggledPaths(json, 'Rows')).toEqual([['Europe'], ['Europe', 'Germany']])
    expect(isExpanded(st, ['Europe'])).toBe(true)
    expect(isExpanded(st, ['Asia'])).toBe(false)
    expect(isExpanded(st, ['Europe', 'Germany'])).toBe(true)
    expect(isExpanded(st, ['Europe', 'France'])).toBe(false)
    // the last level has nothing below it
    expect(isExpanded(st, ['Europe', 'Germany', 'Berlin'])).toBe(false)
  })

  it('a level without isCollapsed is expanded when the file marks collapsed levels at all', () => {
    const json = visual('Rows', [true, true, false], [
      { roles: ['Rows'], levels: [{ queryRefs: [REFS[0]], isPinned: true }, { queryRefs: [REFS[1]], isCollapsed: true, isPinned: true }], root: { children: [{ identityValues: [lit('Asia')], isToggled: true }] } }
    ])
    const st = readExpansion(json, 'Rows', REFS, collapsed)
    expect(st.levelExpanded).toEqual([true, false, false])
    expect(isExpanded(st, ['Europe'])).toBe(true)
    expect(isExpanded(st, ['Asia'])).toBe(false) // toggled = the opposite of its level
  })

  it('entries without any isCollapsed (fully expanded, or written by earlier versions) use the fallback; whole-path identity values are read', () => {
    const json = visual('Rows', [true, false, false], [
      { roles: ['Rows'], levels: REFS.map((q) => ({ queryRefs: [q], isPinned: true })), root: { children: [{ identityValues: [lit('Europe')], isToggled: true, children: [{ identityValues: [lit('Europe'), lit('Germany')], isToggled: true }] }] } }
    ])
    const st = readExpansion(json, 'Rows', REFS, collapsed)
    expect(st.levelExpanded).toEqual([false, false, false])
    expect([...st.toggled]).toEqual([expansionPathKey(['Europe']), expansionPathKey(['Europe', 'Germany'])])
    expect(readExpansion(json, 'Rows', REFS, (i) => i < 1).levelExpanded).toEqual([true, false, false])
    // no entry for the role at all
    expect(readExpansion(visual('Columns', [true, true, true]), 'Columns', REFS, () => true).levelExpanded).toEqual([true, true, false])
  })

  it('Expand ▸ Selection writes Power BI\'s shape and activates the next level', () => {
    const json = visual('Values', [true, false, false])
    const state = readExpansion(json, 'Values', REFS, collapsed)
    applyExpansion(json, 'Values', LEVELS, state, (e) => setNodeExpanded(e, ['Europe'], true))
    expect(json.visual.expansionStates).toEqual([
      {
        roles: ['Values'],
        levels: [
          { queryRefs: [REFS[0]], isCollapsed: true, identityKeys: [LEVELS[0].expr], isPinned: true },
          { queryRefs: [REFS[1]], isCollapsed: true, identityKeys: [LEVELS[1].expr], isPinned: true },
          { queryRefs: [REFS[2]], isCollapsed: true, identityKeys: [LEVELS[2].expr], isPinned: true }
        ],
        root: { children: [{ identityValues: [lit('Europe')], isToggled: true }] }
      }
    ])
    expect(json.visual.query.queryState.Values.projections.map((p: any) => !!p.active)).toEqual([true, true, false])
    // a nested node holds its own value under its parent
    applyExpansion(json, 'Values', LEVELS, readExpansion(json, 'Values', REFS, collapsed), (e) => setNodeExpanded(e, ['Europe', 'Germany'], true))
    expect(json.visual.expansionStates[0].root).toEqual({ children: [{ identityValues: [lit('Europe')], isToggled: true, children: [{ identityValues: [lit('Germany')], isToggled: true }] }] })
    expect(json.visual.query.queryState.Values.projections.map((p: any) => !!p.active)).toEqual([true, true, true])
    // Collapse ▸ Selection of the parent keeps the child's own state for when it is expanded again
    applyExpansion(json, 'Values', LEVELS, readExpansion(json, 'Values', REFS, collapsed), (e) => setNodeExpanded(e, ['Europe'], false))
    const st = readExpansion(json, 'Values', REFS, collapsed)
    expect(isExpanded(st, ['Europe'])).toBe(false)
    expect(isExpanded(st, ['Europe', 'Germany'])).toBe(true)
    expect(json.visual.query.queryState.Values.projections.map((p: any) => !!p.active)).toEqual([true, false, false])
  })

  it('Entire level and All', () => {
    const json = visual('Rows', [true, false, false])
    const read = () => readExpansion(json, 'Rows', REFS, collapsed)
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setNodeExpanded(e, ['Europe'], true))
    // Expand ▸ Entire level on the first level: every region opens, the single toggle is dropped
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setLevelExpanded(e, 0, true))
    expect(read().levelExpanded).toEqual([true, false, false])
    expect(read().toggled.size).toBe(0)
    expect(json.visual.expansionStates[0].levels.map((l: any) => l.isCollapsed)).toEqual([undefined, true, true])
    expect(json.visual.query.queryState.Rows.projections.map((p: any) => !!p.active)).toEqual([true, true, false])
    // one region collapsed by hand, then the whole second level expanded
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setNodeExpanded(e, ['Asia'], false))
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setLevelExpanded(e, 1, true))
    let st = read()
    expect(st.levelExpanded).toEqual([true, true, false])
    expect(isExpanded(st, ['Asia'])).toBe(false)
    expect(isExpanded(st, ['Europe', 'France'])).toBe(true)
    // Collapse ▸ Entire level on the second level leaves the first as it is
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setLevelExpanded(e, 1, false))
    st = read()
    expect(st.levelExpanded).toEqual([true, false, false])
    expect(isExpanded(st, ['Asia'])).toBe(false)
    // All
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setAllExpanded(e, true))
    expect(read().levelExpanded).toEqual([true, true, false])
    expect(read().toggled.size).toBe(0)
    expect(json.visual.query.queryState.Rows.projections.map((p: any) => !!p.active)).toEqual([true, true, true])
    applyExpansion(json, 'Rows', LEVELS, read(), (e) => setAllExpanded(e, false))
    expect(read().levelExpanded).toEqual([false, false, false])
    expect(json.visual.expansionStates[0].root).toEqual({})
    expect(json.visual.query.queryState.Rows.projections.map((p: any) => !!p.active)).toEqual([true, false, false])
  })

  it('a command starts from the state the visual shows and keeps other roles and drilled-past levels', () => {
    const json = visual('Rows', [true, false, false], [{ roles: ['Columns'], levels: [{ queryRefs: ['T.Year'], isCollapsed: true }], root: {} }])
    // shown fully expanded at run time ("expand all down one level" twice); collapsing one node must keep the rest open
    const shown = { levelExpanded: [true, true, false], toggled: new Set<string>() }
    applyExpansion(json, 'Rows', LEVELS, shown, (e) => setNodeExpanded(e, ['Europe'], false))
    const st = readExpansion(json, 'Rows', REFS, collapsed)
    expect(st.levelExpanded).toEqual([true, true, false])
    expect(isExpanded(st, ['Europe'])).toBe(false)
    expect(isExpanded(st, ['Asia'])).toBe(true)
    expect(json.visual.expansionStates[0]).toEqual({ roles: ['Columns'], levels: [{ queryRefs: ['T.Year'], isCollapsed: true }], root: {} })
    // only the last two levels are visible (drilled to the second): the first level's entry and flag stay
    const drilled = visual('Rows', [false, true, false], [{ roles: ['Rows'], levels: [{ queryRefs: [REFS[0]], isCollapsed: true, isPinned: true }], root: {} }])
    applyExpansion(drilled, 'Rows', LEVELS.slice(1), { levelExpanded: [false, false], toggled: new Set() }, (e) => setLevelExpanded(e, 0, true))
    expect(drilled.visual.expansionStates[0].levels.map((l: any) => [l.queryRefs[0], l.isCollapsed === true])).toEqual([[REFS[0], true], [REFS[1], false], [REFS[2], true]])
    expect(drilled.visual.query.queryState.Rows.projections.map((p: any) => !!p.active)).toEqual([false, true, true])
  })
})
