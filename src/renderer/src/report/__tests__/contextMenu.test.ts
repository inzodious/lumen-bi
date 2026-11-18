import { beforeEach, describe, expect, it } from 'vitest'
import '../../visuals'
import { columnExpr } from '@core/report/sq'
import { useApp } from '../../state/store'
import { useInteraction, EMPTY_DRILL, type ContextMenuState } from '../../state/interaction'
import type { ContextMenuRequest, DrillState, VisualHostContext } from '../../visuals/contract'
import { buildVisualMenu, type MenuItem } from '../Overlays'
import { findPage, findVisual, parentOf } from '../pbir'
import { FIXTURE, fixtureProject } from '../dev/fixture'

const report = () => useApp.getState().project!.report!
const visual = (page: string, v: string) => findVisual(findPage(report(), page), v)!
const CATEGORY = columnExpr('Sales', 'Category')
const PRODUCT = columnExpr('Sales', 'Product')
const point = (expr: unknown, value: string) => ({ fields: [{ expr: expr as never, value }] })

function ctxFor(drill: DrillState = EMPTY_DRILL): VisualHostContext {
  const engine = useApp.getState().engine!
  return { engine, drill, filters: [], selection: [], mode: 'edit' } as unknown as VisualHostContext
}
function menu(v: string, req: Partial<ContextMenuRequest> = {}, opts: { editing?: boolean; drill?: DrillState; page?: string } = {}): MenuItem[] {
  const state: ContextMenuState = { page: opts.page ?? FIXTURE.overview, visual: v, req: { x: 0, y: 0, ...req } }
  return buildVisualMenu(state, ctxFor(opts.drill), { editing: opts.editing ?? true, title: 'T' })
}
const labels = (items: MenuItem[]) => items.map((i) => (i.separator ? '—' : i.label))
const item = (items: MenuItem[], ...path: string[]): MenuItem => {
  let cur: MenuItem | undefined
  let list = items
  for (const p of path) {
    cur = list.find((i) => i.label === p)
    if (!cur) throw new Error(`no menu entry ${path.join(' ▸ ')} in ${labels(list).join(' | ')}`)
    list = cur.items ?? []
  }
  return cur!
}

beforeEach(() => {
  useApp.getState().setProject(fixtureProject())
  useInteraction.getState().reset()
})

describe('visual context menu', () => {
  it('empty area of a chart with a hierarchy: no data-point entries, drill entries for the hierarchy', () => {
    const m = menu(FIXTURE.categoryChart)
    expect(labels(m)).toEqual(['Show as a table', '—', 'Drill down', 'Drill up', 'Show next level', 'Expand to next level', '—', 'Copy', 'Sort axis', 'Group', 'Export data', '—', 'Spotlight', 'Remove'])
    // nothing to drill into without a data point, and nothing above the first level
    expect(item(m, 'Drill down').disabled).toBe(true)
    expect(item(m, 'Drill up').disabled).toBe(true)
    expect(item(m, 'Copy', 'Copy value').disabled).toBe(true)
    item(m, 'Show next level').onClick!()
    expect(useInteraction.getState().getDrill(FIXTURE.overview, FIXTURE.categoryChart)).toMatchObject({ level: 1 })
  })

  it('data point: Show data point as a table, Include / Exclude, Drill down into the point, Copy value', () => {
    const id = point(CATEGORY, 'Bikes')
    const m = menu(FIXTURE.categoryChart, { identity: id, value: 'Bikes' })
    expect(labels(m).slice(0, 5)).toEqual(['Show as a table', 'Show data point as a table', '—', 'Include', 'Exclude'])
    item(m, 'Show data point as a table').onClick!()
    expect(useInteraction.getState().focus).toEqual({ page: FIXTURE.overview, visual: FIXTURE.categoryChart, mode: 'table', point: id })
    expect(item(m, 'Drill down').disabled).toBe(false)
    item(m, 'Drill down').onClick!()
    expect(useInteraction.getState().getDrill(FIXTURE.overview, FIXTURE.categoryChart)).toEqual({ level: 1, path: [id], expandedLevel: undefined })
    // Exclude adds a visual-level filter card (undoable)
    const before = visual(FIXTURE.overview, FIXTURE.categoryChart).json.filterConfig?.filters?.length ?? 0
    item(m, 'Exclude').onClick!()
    expect(visual(FIXTURE.overview, FIXTURE.categoryChart).json.filterConfig.filters.length).toBe(before + 1)
  })

  it('drilled to the last level: Drill up is offered, deeper drilling is not', () => {
    const id = point(PRODUCT, 'Road-150')
    const drill: DrillState = { level: 1, path: [point(CATEGORY, 'Bikes')] }
    const m = menu(FIXTURE.categoryChart, { identity: id }, { drill })
    expect(item(m, 'Drill down').disabled).toBe(true)
    expect(item(m, 'Show next level').disabled).toBe(true)
    expect(item(m, 'Expand to next level').disabled).toBe(true)
    expect(item(m, 'Drill up').disabled).toBe(false)
    item(m, 'Drill up').onClick!()
    expect(useInteraction.getState().drill).toEqual({})
  })

  it('a visual without a hierarchy has no drill entries; a table sorts "by"', () => {
    const m = menu(FIXTURE.productTable, { identity: point(PRODUCT, 'Road-150'), value: 'Road-150' })
    expect(labels(m)).not.toContain('Drill down')
    expect(labels(m)).toContain('Sort by')
    expect(labels(m)).not.toContain('Sort axis')
    expect(labels(menu(FIXTURE.regionChart))).not.toContain('Drill up')
  })

  it("the visual's own entries come after Include / Exclude; header targets have no data-point entries", () => {
    let ran = 0
    const entries = [{ label: 'Expand', items: [{ label: 'Selection', onClick: () => ran++ }] }, { label: 'Collapse', items: [{ label: 'All' }] }]
    const m = menu(FIXTURE.productTable, { target: 'header', value: 'Product', entries })
    expect(labels(m).slice(0, 5)).toEqual(['Show as a table', '—', 'Expand', 'Collapse', '—'])
    item(m, 'Expand', 'Selection').onClick!()
    expect(ran).toBe(1)
    expect(item(m, 'Copy', 'Copy value').disabled).toBe(false)
    const withPoint = menu(FIXTURE.productTable, { identity: point(PRODUCT, 'Road-150'), entries })
    expect(labels(withPoint).slice(0, 8)).toEqual(['Show as a table', 'Show data point as a table', '—', 'Include', 'Exclude', '—', 'Expand', 'Collapse'])
  })

  it('slicer: no Include / Exclude; Sort axis sorts the slicer field; its own Search / Clear selections entries', () => {
    const entries = [{ label: 'Search', checked: false }, { label: 'Clear selections' }]
    const m = menu(FIXTURE.regionSlicer, { identity: point(columnExpr('Sales', 'Region'), 'North'), value: 'North', entries })
    expect(labels(m)).toEqual(['Show as a table', '—', 'Search', 'Clear selections', '—', 'Copy', 'Sort axis', 'Group', 'Export data', '—', 'Spotlight', 'Remove'])
    expect(item(m, 'Sort axis', 'Sort ascending').checked).toBe(true)
    item(m, 'Sort axis', 'Sort descending').onClick!()
    expect(visual(FIXTURE.overview, FIXTURE.regionSlicer).json.visual.query.sortDefinition.sort).toEqual([{ field: columnExpr('Sales', 'Region'), direction: 'Descending' }])
    expect(item(menu(FIXTURE.regionSlicer), 'Sort axis', 'Sort descending').checked).toBe(true)
  })

  it('reading view: no editing entries (Copy visual, Group, Remove)', () => {
    const m = menu(FIXTURE.categoryChart, {}, { editing: false })
    expect(labels(m)).toEqual(['Show as a table', '—', 'Drill down', 'Drill up', 'Show next level', 'Expand to next level', '—', 'Copy', 'Sort axis', 'Export data', '—', 'Spotlight'])
    expect((item(m, 'Copy').items ?? []).map((i) => i.label)).toEqual(['Copy value', 'Copy selection'])
    expect((item(menu(FIXTURE.categoryChart), 'Copy').items ?? []).map((i) => i.label)).toEqual(['Copy value', 'Copy selection', 'Copy visual'])
  })

  it('Group ▸ Group / Ungroup act on the selected visuals', () => {
    // one visual: nothing to group; not in a group: nothing to ungroup
    let m = menu(FIXTURE.card)
    expect(item(m, 'Group', 'Group').disabled).toBe(true)
    expect(item(m, 'Group', 'Ungroup').disabled).toBe(true)
    useApp.getState().selectVisuals([FIXTURE.card, FIXTURE.regionChart])
    m = menu(FIXTURE.card)
    expect(item(m, 'Group', 'Group').disabled).toBe(false)
    item(m, 'Group', 'Group').onClick!()
    const group = parentOf(visual(FIXTURE.overview, FIXTURE.card))
    expect(group).toBeTruthy()
    expect(parentOf(visual(FIXTURE.overview, FIXTURE.regionChart))).toBe(group)
    // a grouped visual can be ungrouped from its menu
    useApp.getState().selectVisuals([FIXTURE.card])
    m = menu(FIXTURE.card)
    expect(item(m, 'Group', 'Ungroup').disabled).toBe(false)
    item(m, 'Group', 'Ungroup').onClick!()
    expect(parentOf(visual(FIXTURE.overview, FIXTURE.card))).toBeUndefined()
  })

  it('Spotlight toggles; Remove deletes the visual', () => {
    const m = menu(FIXTURE.card)
    item(m, 'Spotlight').onClick!()
    expect(useInteraction.getState().spotlight).toEqual({ page: FIXTURE.overview, visual: FIXTURE.card })
    expect(item(menu(FIXTURE.card), 'Spotlight').checked).toBe(true)
    item(m, 'Remove').onClick!()
    expect(findVisual(findPage(report(), FIXTURE.overview), FIXTURE.card)).toBeUndefined()
  })
})
