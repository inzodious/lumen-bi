/** Legacy `table` visuals keep column widths and the totals toggle in `general`. */
import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { readTableFormat } from './tableFormat'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

describe('legacy table general.* properties', () => {
  const json = {
    visual: {
      visualType: 'table',
      objects: {
        general: [
          { properties: { totals: lit('false') } },
          { properties: { columnWidth: lit('88D') }, selector: { metadata: 'select1' } },
          { properties: { columnWidth: lit('76D') }, selector: { metadata: 'select2' } }
        ]
      }
    }
  }
  const f = readTableFormat(json, resolveTheme())
  it('reads per-column widths from general.columnWidth', () => {
    expect(f.widthByRef.get('select1')).toBe(88)
    expect(f.widthByRef.get('select2')).toBe(76)
  })
  it('general.totals = false hides the total row', () => {
    expect(f.total.show).toBe(false)
  })
  it('defaults: totals on, no explicit widths', () => {
    const d = readTableFormat({ visual: { visualType: 'tableEx', objects: {} } }, resolveTheme())
    expect(d.total.show).toBe(true)
    expect(d.widthByRef.size).toBe(0)
  })
})
