import { describe, expect, it } from 'vitest'
import { makeDate } from '@core/model/data'
import { fallbackFormat } from './formatCell'
import { computeRowOrder, distinctWithCounts, valueKey } from './gridModel'

describe('fallbackFormat', () => {
  it('formats numbers, currency, percentages and dates like Power BI (en-US)', () => {
    expect(fallbackFormat(1234.5, 'double', '\\$#,0.00;(\\$#,0.00);\\$#,0.00')).toBe('$1,234.50')
    expect(fallbackFormat(-12, 'double', '\\$#,0.00;(\\$#,0.00);\\$#,0.00')).toBe('($12.00)')
    expect(fallbackFormat(0.1234, 'double', '0.0%')).toBe('12.3%')
    expect(fallbackFormat(1234567, 'int64', '#,0')).toBe('1,234,567')
    expect(fallbackFormat(42, 'int64')).toBe('42')
    expect(fallbackFormat(makeDate(2024, 3, 9), 'dateTime', 'Short Date')).toBe('3/9/2024')
    expect(fallbackFormat(makeDate(2024, 3, 9, 13, 5), 'dateTime')).toBe('3/9/2024 1:05:00 PM')
    expect(fallbackFormat(true, 'boolean')).toBe('True')
    expect(fallbackFormat(null, 'string')).toBe('')
  })
})

describe('grid model', () => {
  const vals: Record<string, Array<string | number | null>> = { a: ['b', 'a', null, 'c', 'a'], n: [3, 1, 2, null, 5] }
  const get = (c: string) => vals[c]
  const disp = (_c: string, v: unknown) => (v === null ? '' : String(v))
  it('sorts with blanks first and keeps ties stable', () => {
    expect(computeRowOrder(5, get, {}, { column: 'a', dir: 'asc' }, disp)).toEqual([2, 1, 4, 0, 3])
    expect(computeRowOrder(5, get, {}, { column: 'n', dir: 'desc' }, disp)).toEqual([4, 0, 2, 1, 3])
  })
  it('filters by value list and text', () => {
    expect(computeRowOrder(5, get, { a: { kind: 'values', values: new Set([valueKey('a')]) } }, null, disp)).toEqual([1, 4])
    expect(computeRowOrder(5, get, { a: { kind: 'text', op: 'isBlank', text: '' } }, null, disp)).toEqual([2])
    expect(computeRowOrder(5, get, { a: { kind: 'text', op: 'contains', text: 'C' } }, null, disp)).toEqual([3])
  })
  it('counts distinct values', () => {
    expect(distinctWithCounts(['x', 'y', 'x', null]).map((d) => [d.value, d.count])).toEqual([[null, 1], ['x', 2], ['y', 1]])
  })
})
