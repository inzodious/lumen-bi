import { describe, expect, it } from 'vitest'
import { readGrid } from './CartesianChart'
import { FormatReader } from '../../common/fmtProps'
import { resolveTheme } from '@core/report/theme'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const reader = (objects: Record<string, Record<string, unknown>>) =>
  new FormatReader({ name: 'v', visual: { visualType: 'clusteredBarChart', objects: Object.fromEntries(Object.entries(objects).map(([k, p]) => [k, [{ properties: p }]])) } }, resolveTheme(undefined))

describe('gridlines', () => {
  it('value gridlines are on by default and dotted', () => {
    expect(readGrid(reader({}), 'valueAxis', true)).toMatchObject({ style: 'dotted', width: 1 })
  })
  it('an axis switched off draws no gridlines, even with gridlineShow on', () => {
    expect(readGrid(reader({ valueAxis: { show: lit('false') } }), 'valueAxis', true)).toBeUndefined()
    expect(readGrid(reader({ valueAxis: { show: lit('false'), gridlineShow: lit('true') } }), 'valueAxis', true)).toBeUndefined()
    expect(readGrid(reader({ categoryAxis: { show: lit('false'), gridlineShow: lit('true') } }), 'categoryAxis', false)).toBeUndefined()
    expect(readGrid(reader({ categoryAxis: { gridlineShow: lit('true') } }), 'categoryAxis', false)).toBeDefined()
  })
})
