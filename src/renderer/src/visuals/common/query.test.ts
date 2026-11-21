import { describe, expect, it } from 'vitest'
import { getProjections } from './query'

const col = (Entity: string, Property: string) => ({ Column: { Expression: { SourceRef: { Entity } }, Property } })
const msr = (Entity: string, Property: string) => ({ Measure: { Expression: { SourceRef: { Entity } }, Property } })

describe('getProjections', () => {
  it('puts a Desktop-saved field parameter back in its slot', () => {
    const visual = {
      visual: {
        query: {
          queryState: {
            Category: { projections: [{ field: col('dim_calendar', 'month'), queryRef: 'dim_calendar.month', active: true }] },
            Y: {
              projections: [
                { field: msr('m', 'a'), queryRef: 'm.a' },
                { field: msr('m', 'b'), queryRef: 'm.b' },
                { field: msr('m', 'c'), queryRef: 'm.c' }
              ],
              fieldParameters: [{ parameterExpr: col('param_metric', 'param_metric'), index: 1, length: 1 }]
            }
          }
        }
      }
    }
    const p = getProjections(visual)
    expect(p.Category.map((x) => x.queryRef)).toEqual(['dim_calendar.month'])
    expect(p.Y.map((x) => x.queryRef)).toEqual(['m.a', 'param_metric.param_metric', 'm.c'])
    expect(p.Y[1].info.kind).toBe('column')
    expect(p.Y[1].isMeasure).toBe(false)
  })

  it('handles several parameters and multi-field slots', () => {
    const visual = {
      visual: {
        query: {
          queryState: {
            Values: {
              projections: [
                { field: msr('m', 'a'), queryRef: 'm.a' },
                { field: msr('m', 'b'), queryRef: 'm.b' },
                { field: msr('m', 'c'), queryRef: 'm.c' }
              ],
              fieldParameters: [
                { parameterExpr: col('p1', 'p1'), index: 0, length: 2 },
                { parameterExpr: col('p2', 'p2'), index: 2, length: 1 }
              ]
            }
          }
        }
      }
    }
    expect(getProjections(visual).Values.map((x) => x.queryRef)).toEqual(['p1.p1', 'p2.p2'])
  })

  it('leaves wells without parameters unchanged', () => {
    const visual = { visual: { query: { queryState: { Values: { projections: [{ field: msr('m', 'a'), queryRef: 'm.a' }] } } } } }
    expect(getProjections(visual).Values.map((x) => x.queryRef)).toEqual(['m.a'])
  })
})
