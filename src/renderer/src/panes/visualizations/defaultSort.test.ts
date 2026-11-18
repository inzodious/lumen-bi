import { describe, expect, it } from 'vitest'
import { columnExpr, measureExpr } from '@core/report/sq'
import { addProjection, applyDefaultSort, moveProjection, removeProjection } from './wells'

const v = (visualType: string) => ({ visual: { visualType } }) as any

describe('default sort (PBI isDefaultSort)', () => {
  it('bar/column charts sort by the first value descending once category + value exist', () => {
    const j = v('clusteredColumnChart')
    addProjection(j, 'Category', columnExpr('Product', 'Color'))
    expect(j.visual.query.sortDefinition).toBeUndefined()
    addProjection(j, 'Y', measureExpr('Sales', 'Total'))
    expect(j.visual.query.sortDefinition).toEqual({ sort: [{ field: measureExpr('Sales', 'Total'), direction: 'Descending' }], isDefaultSort: true })
  })

  it('follows the first measure while it is the default sort', () => {
    const j = v('barChart')
    addProjection(j, 'Category', columnExpr('Product', 'Color'))
    addProjection(j, 'Y', measureExpr('Sales', 'Total'))
    addProjection(j, 'Y', measureExpr('Sales', 'Margin'), { index: 0 })
    expect(j.visual.query.sortDefinition.sort[0].field).toEqual(measureExpr('Sales', 'Margin'))
    moveProjection(j, 'Y', 1, 'Y', 0)
    expect(j.visual.query.sortDefinition.sort[0].field).toEqual(measureExpr('Sales', 'Total'))
    removeProjection(j, 'Category', 0)
    expect(j.visual.query.sortDefinition).toBeUndefined()
  })

  it('keeps a user sort', () => {
    const j = v('pieChart')
    j.visual.query = { sortDefinition: { sort: [{ field: columnExpr('Product', 'Color'), direction: 'Ascending' }] } }
    addProjection(j, 'Category', columnExpr('Product', 'Color'))
    addProjection(j, 'Y', measureExpr('Sales', 'Total'))
    expect(j.visual.query.sortDefinition).toEqual({ sort: [{ field: columnExpr('Product', 'Color'), direction: 'Ascending' }] })
  })

  it('line / area charts sort by category ascending', () => {
    const j = v('lineChart')
    addProjection(j, 'Category', columnExpr('Date', 'Month'))
    addProjection(j, 'Y', measureExpr('Sales', 'Total'))
    expect(j.visual.query.sortDefinition).toEqual({ sort: [{ field: columnExpr('Date', 'Month'), direction: 'Ascending' }], isDefaultSort: true })
  })

  it('ignores tables and other visuals', () => {
    const j = v('tableEx')
    addProjection(j, 'Values', columnExpr('Product', 'Color'))
    addProjection(j, 'Values', measureExpr('Sales', 'Total'))
    applyDefaultSort(j)
    expect(j.visual.query.sortDefinition).toBeUndefined()
  })
})
