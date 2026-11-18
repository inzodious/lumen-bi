import { describe, expect, it } from 'vitest'
import { emptyReport } from '@core/report/types'
import { autoTooltipPage, tooltipIsAuto } from '../tooltipPages'

const col = (t: string, c: string) => ({ Column: { Expression: { SourceRef: { Entity: t } }, Property: c } })
const sum = (t: string, c: string) => ({ Aggregation: { Expression: col(t, c), Function: 0 } })

function tooltipPage(name: string, fields: any[]): any {
  return {
    name,
    json: {
      name,
      displayName: name,
      width: 320,
      height: 240,
      pageBinding: { name: 'b' + name, type: 'Tooltip', parameters: fields.map((_, i) => ({ name: 'p' + i, boundFilter: 'f' + i })) },
      filterConfig: { filters: fields.map((f, i) => ({ name: 'f' + i, field: f, type: 'Categorical' })) }
    },
    visuals: []
  }
}

function report(pages: any[]) {
  const r = emptyReport()
  r.pages = pages
  r.pagesMeta.pageOrder = pages.map((p) => p.name)
  return r
}

const visual = (fields: any[]) => ({ visual: { visualType: 'barChart', query: { queryState: { Category: { projections: fields.map((f) => ({ field: f, queryRef: 'x' })) } } } } })

describe('report-page tooltips: auto', () => {
  it('picks the tooltip page whose tooltip fields the visual uses (most matches wins)', () => {
    const r = report([tooltipPage('a', [col('Product', 'Color')]), tooltipPage('b', [col('Product', 'Color'), col('Sales', 'Amount')])])
    expect(autoTooltipPage(r, visual([col('Product', 'Color'), sum('Sales', 'Amount')]))?.name).toBe('b')
    expect(autoTooltipPage(r, visual([col('Product', 'Color')]))?.name).toBe('a')
    expect(autoTooltipPage(r, visual([col('Store', 'City')]))).toBeUndefined()
  })
  it('auto unless a page or the default tooltip is chosen explicitly', () => {
    expect(tooltipIsAuto({ visual: {} }, { type: 'Default' })).toBe(true)
    expect(tooltipIsAuto({ visual: { visualContainerObjects: { visualTooltip: [{ properties: { type: { expr: { Literal: { Value: "'Default'" } } } } }] } } }, { type: 'Default' })).toBe(false)
    expect(tooltipIsAuto({ visual: {} }, { type: 'Canvas' })).toBe(true)
    expect(tooltipIsAuto({ visual: {} }, { type: 'Canvas', section: 'p1' })).toBe(false)
  })
})
