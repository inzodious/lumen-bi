import { describe, expect, it } from 'vitest'
import { columnExpr, measureExpr } from '@core/report/sq'
import { autoTitle, generatedTitle } from '../VisualContainer'

const proj = (field: any, queryRef: string, displayName?: string) => ({ field, queryRef, ...(displayName ? { displayName } : {}) })

describe('generated visual titles', () => {
  it('builds "<values> by <categories>" for charts', () => {
    const json = {
      name: 'v',
      visual: {
        visualType: 'clusteredColumnChart',
        query: { queryState: { Category: { projections: [proj(columnExpr('Sales', 'Region'), 'Sales.Region')] }, Y: { projections: [proj(measureExpr('Sales', 'Total'), 'Sales.Total', 'Total sales')] } } }
      }
    }
    expect(autoTitle(json, null)).toBe('Total sales by Region')
    expect(generatedTitle(json, null)).toBe('Total sales by Region')
  })

  it('displays no generated title on the card: the category label already names the value', () => {
    const json = {
      name: 'v',
      visual: { visualType: 'cardVisual', query: { queryState: { Data: { projections: [proj(measureExpr('Sales', 'Total'), 'Sales.Total', 'Total sales')] } } } }
    }
    expect(generatedTitle(json, null)).toBe('')
    // the visual keeps its name for export file names / the Performance analyzer
    expect(autoTitle(json, null)).toBe('Total sales')
  })
})
