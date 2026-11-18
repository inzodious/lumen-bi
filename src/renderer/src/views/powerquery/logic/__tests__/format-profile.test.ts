import { describe, expect, it } from 'vitest'
import { cellKey, clockTime, formatCell, formatNumber, statusCounts, typeIcon, usDate, usDateTime, usTime } from '../format'
import { columnDistribution, columnQuality, columnStats, percentText } from '../profile'

describe('cell display', () => {
  it('formats dates and times like en-US Power Query', () => {
    expect(usDate('2024-03-01')).toBe('3/1/2024')
    expect(usDateTime('2024-03-01T10:00:00')).toBe('3/1/2024 10:00:00 AM')
    expect(usDateTime('2024-03-01T00:05:09')).toBe('3/1/2024 12:05:09 AM')
    expect(usDateTime('2024-12-31T23:59:59+02:00')).toBe('12/31/2024 11:59:59 PM +02:00')
    expect(usTime('13:30:00')).toBe('1:30:00 PM')
    expect(formatCell('2024-03-01', 'date').text).toBe('3/1/2024')
    expect(formatCell('2024-03-01T10:00:00', 'nullable datetime').text).toBe('3/1/2024 10:00:00 AM')
    // untyped column: left as is (documented approximation)
    expect(formatCell('2024-03-01', 'any').text).toBe('2024-03-01')
  })

  it('formats scalars, nulls, errors and nested values', () => {
    expect(formatCell(null)).toEqual({ text: 'null', cls: 'null' })
    expect(formatCell(true).text).toBe('TRUE')
    expect(formatCell(false).text).toBe('FALSE')
    expect(formatCell(1234567, 'Int64.Type').text).toBe('1234567')
    expect(formatCell(0.125, 'Percentage.Type').text).toBe('12.5%')
    expect(formatCell(0.1 + 0.2, 'number').text).toBe('0.3')
    expect(formatCell({ $kind: 'Table' })).toMatchObject({ text: 'Table', cls: 'nested', nested: 'Table' })
    expect(formatCell({ $error: { reason: 'Expression.Error', message: 'x' } })).toMatchObject({ text: 'Error', cls: 'error' })
    expect(formatNumber(1e21)).toBe('1E+21')
  })

  it('maps column types to header icons', () => {
    expect(typeIcon('nullable text')).toBe('text')
    expect(typeIcon('Int64.Type')).toBe('whole')
    expect(typeIcon('number')).toBe('decimal')
    expect(typeIcon('Currency.Type')).toBe('currency')
    expect(typeIcon('table [a = text]')).toBe('table')
    expect(typeIcon('any')).toBe('any')
  })

  it('writes status texts', () => {
    expect(statusCounts(8, 1000, true)).toBe('8 COLUMNS, 999+ ROWS')
    expect(statusCounts(1, 1, false)).toBe('1 COLUMN, 1 ROW')
    expect(clockTime(new Date(2024, 0, 1, 15, 41))).toBe('3:41 PM')
    expect(cellKey(1)).not.toBe(cellKey('1'))
  })
})

describe('column profile', () => {
  const err = { $error: { reason: 'Expression.Error', message: 'bad' } }
  const values = [1, 2, 2, null, err, 0, 3]

  it('computes quality', () => {
    expect(columnQuality(values)).toEqual({ total: 7, valid: 5, error: 1, empty: 1 })
    expect(columnQuality(['a', '', null])).toEqual({ total: 3, valid: 1, error: 0, empty: 2 })
    expect(percentText(5, 7)).toBe('71%')
    expect(percentText(1, 1000)).toBe('< 1%')
    expect(percentText(999, 1000)).toBe('> 99%')
    expect(percentText(0, 10)).toBe('0%')
  })

  it('computes distinct / unique and the value distribution', () => {
    const d = columnDistribution(values)
    expect(d.distinct).toBe(5) // 1, 2, null, 0, 3
    expect(d.unique).toBe(4)
    expect(d.values[0]).toEqual({ value: 2, count: 2 })
  })

  it('computes numeric statistics', () => {
    const s = columnStats(values, 'Int64.Type')
    expect(s.min).toBe(0)
    expect(s.max).toBe(3)
    expect(s.average).toBeCloseTo(1.6)
    expect(s.stdDev).toBeCloseTo(Math.sqrt(((1 - 1.6) ** 2 + 2 * (2 - 1.6) ** 2 + 1.6 ** 2 + (3 - 1.6) ** 2) / 4))
    expect(s.zero).toBe(1)
    expect(s.even).toBe(3)
    expect(s.odd).toBe(2)
  })

  it('computes text statistics', () => {
    const s = columnStats(['b', 'a', '', null, 'c'], 'text')
    expect(s.min).toBe('')
    expect(s.max).toBe('c')
    expect(s.emptyString).toBe(1)
    expect(s.average).toBeUndefined()
  })
})
