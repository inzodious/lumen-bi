import { describe, expect, it } from 'vitest'
import { aggregationExpr, columnExpr, measureExpr, SQ_AGG } from '@core/report/sq'
import { addProjection, getShowAll, getShowValueAs, moveProjection, nativeName, removeProjection, renameProjection, roleProjections, setAggregation, setShowAll, setShowValueAs } from './wells'
import { findEntry, getRaw, nextEntryId, removeEntriesById, setRaw, themeColorRaw, wrapValue } from './objects'

const visual = () => ({ visual: { visualType: 'clusteredColumnChart' } }) as any

describe('wells', () => {
  it('adds projections with PBI queryRef / nativeQueryRef', () => {
    const v = visual()
    expect(addProjection(v, 'Category', columnExpr('Product', 'Color'))).toBe(true)
    expect(addProjection(v, 'Y', aggregationExpr('Sales', 'Amount', SQ_AGG.Sum))).toBe(true)
    expect(addProjection(v, 'Y', measureExpr('Sales', 'Total'))).toBe(true)
    const y = roleProjections(v, 'Y')
    expect(y[0].queryRef).toBe('Sum(Sales.Amount)')
    expect(y[0].nativeQueryRef).toBe('Sum of Amount')
    expect(y[1].queryRef).toBe('Sales.Total')
    expect(roleProjections(v, 'Category')[0].nativeQueryRef).toBe('Color')
  })

  it('rejects duplicates and respects max (single-field wells replace)', () => {
    const v = visual()
    addProjection(v, 'Category', columnExpr('Product', 'Color'))
    expect(addProjection(v, 'Category', columnExpr('Product', 'Color'))).toBe(false)
    expect(addProjection(v, 'Series', columnExpr('Product', 'Size'), { max: 1 })).toBe(true)
    expect(addProjection(v, 'Series', columnExpr('Product', 'Brand'), { max: 1 })).toBe(true)
    expect(roleProjections(v, 'Series').map((p) => p.nativeQueryRef)).toEqual(['Brand'])
    addProjection(v, 'Y', measureExpr('Sales', 'A'), { max: 2 })
    addProjection(v, 'Y', measureExpr('Sales', 'B'), { max: 2 })
    expect(addProjection(v, 'Y', measureExpr('Sales', 'C'), { max: 2 })).toBe(false)
  })

  it('removes projections, empty roles and sorts on removed fields', () => {
    const v = visual()
    addProjection(v, 'Category', columnExpr('Product', 'Color'))
    addProjection(v, 'Y', measureExpr('Sales', 'Total'))
    v.visual.query.sortDefinition = { sort: [{ field: measureExpr('Sales', 'Total'), direction: 'Descending' }] }
    removeProjection(v, 'Y', 0)
    expect(v.visual.query.queryState.Y).toBeUndefined()
    expect(v.visual.query.sortDefinition).toBeUndefined()
    expect(roleProjections(v, 'Category')).toHaveLength(1)
  })

  it('moves within and across roles', () => {
    const v = visual()
    addProjection(v, 'Y', measureExpr('S', 'A'))
    addProjection(v, 'Y', measureExpr('S', 'B'))
    addProjection(v, 'Y', measureExpr('S', 'C'))
    moveProjection(v, 'Y', 0, 'Y', 3)
    expect(roleProjections(v, 'Y').map((p) => p.queryRef)).toEqual(['S.B', 'S.C', 'S.A'])
    expect(moveProjection(v, 'Y', 2, 'Tooltips', 0)).toBe(true)
    expect(roleProjections(v, 'Tooltips').map((p) => p.queryRef)).toEqual(['S.A'])
    expect(roleProjections(v, 'Y')).toHaveLength(2)
  })

  it('changes aggregation, keeps renames, updates sorts', () => {
    const v = visual()
    addProjection(v, 'Y', aggregationExpr('Sales', 'Amount', SQ_AGG.Sum))
    v.visual.query.sortDefinition = { sort: [{ field: aggregationExpr('Sales', 'Amount', SQ_AGG.Sum), direction: 'Ascending' }] }
    setAggregation(v, 'Y', 0, SQ_AGG.Count)
    const p = roleProjections(v, 'Y')[0]
    expect(p.field.Aggregation.Function).toBe(SQ_AGG.Count)
    expect(p.queryRef).toBe('Count(Sales.Amount)')
    expect(p.nativeQueryRef).toBe('Count of Amount (Distinct)')
    expect(v.visual.query.sortDefinition.sort[0].field.Aggregation.Function).toBe(SQ_AGG.Count)
    renameProjection(v, 'Y', 0, 'Orders')
    setAggregation(v, 'Y', 0, SQ_AGG.Avg)
    expect(roleProjections(v, 'Y')[0].displayName).toBe('Orders')
    setAggregation(v, 'Y', 0, null)
    expect(roleProjections(v, 'Y')[0].field.Column.Property).toBe('Amount')
    renameProjection(v, 'Y', 0, '')
    expect(roleProjections(v, 'Y')[0].displayName).toBeUndefined()
  })

  it('show items with no data is bucket-level showAll', () => {
    const v = visual()
    addProjection(v, 'Category', columnExpr('Product', 'Color'))
    setShowAll(v, 'Category', true)
    expect(v.visual.query.queryState.Category.showAll).toBe(true)
    expect(getShowAll(v, 'Category')).toBe(true)
    setShowAll(v, 'Category', false)
    expect(getShowAll(v, 'Category')).toBe(false)
  })

  it('show value as percent of grand total round-trips', () => {
    const v = visual()
    addProjection(v, 'Y', aggregationExpr('Sales', 'Amount', SQ_AGG.Sum))
    setShowValueAs(v, 'Y', 0, 'percentOfGrandTotal')
    const p = roleProjections(v, 'Y')[0]
    expect(getShowValueAs(p)).toBe('percentOfGrandTotal')
    expect(p.field.Arithmetic.Right.ScopedEval.Scope).toEqual([])
    expect(p.nativeQueryRef).toBe('%GT Sum of Amount')
    setShowValueAs(v, 'Y', 0, 'none')
    expect(roleProjections(v, 'Y')[0].field.Aggregation).toBeTruthy()
    expect(nativeName(measureExpr('T', 'M'))).toBe('M')
  })
})

describe('objects bag helpers', () => {
  it('sets, reads and clears raw properties', () => {
    const bag: any = {}
    setRaw(bag, 'title', 'show', wrapValue(true))
    setRaw(bag, 'dataPoint', 'fill', themeColorRaw(3, 0.2), { metadata: 'Sum(S.A)' })
    expect(getRaw(bag, 'title', 'show')).toEqual({ expr: { Literal: { Value: 'true' } } })
    expect(getRaw(bag, 'dataPoint', 'fill', { metadata: 'Sum(S.A)' }).solid.color.expr.ThemeDataColor.ColorId).toBe(3)
    expect(getRaw(bag, 'dataPoint', 'fill')).toBeUndefined()
    setRaw(bag, 'title', 'show', undefined)
    expect(bag.title).toBeUndefined()
    expect(findEntry(bag, 'dataPoint', { metadata: 'Sum(S.A)' })).toBeTruthy()
  })

  it('numbers multi-instance entries', () => {
    const bag: any = {}
    expect(nextEntryId(bag, 'y1AxisReferenceLine')).toBe('1')
    setRaw(bag, 'y1AxisReferenceLine', 'show', wrapValue(true), { id: '1' })
    setRaw(bag, 'y1AxisReferenceLine', 'show', wrapValue(true), { id: '2' })
    expect(nextEntryId(bag, 'y1AxisReferenceLine')).toBe('3')
    removeEntriesById(bag, 'y1AxisReferenceLine', '1')
    expect(bag.y1AxisReferenceLine).toHaveLength(1)
  })
})
