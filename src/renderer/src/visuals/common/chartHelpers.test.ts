import { describe, expect, it } from 'vitest'
import { autoDisplayUnit, decimalsForStep, formatWithUnits, parseNumberFormat, resolveDisplayUnit, formatScalar } from './units'
import { bandLayout, computeValueAxis, continuousTicks, stackValues, valueToPx } from './scale'
import { contrastText, dataSelectorMatches, defaultFill, evalConditional, evalFillRule, mixColor, staticFill } from './color'
import { resolveTheme } from '@core/report/theme'
import { makePropContext } from '@core/report/props'
import { columnExpr } from '@core/report/sq'
import { ellipsize, wrapText, cssFontFamily, fontWeightOf } from './text'

const theme = resolveTheme()

describe('display units', () => {
  it('auto picks the largest unit with scaled value >= 1', () => {
    expect(autoDisplayUnit(999)).toBe(1)
    expect(autoDisplayUnit(1000)).toBe(1e3)
    expect(autoDisplayUnit(-2.5e6)).toBe(1e6)
    expect(autoDisplayUnit(7e9)).toBe(1e9)
    expect(autoDisplayUnit(3e12)).toBe(1e12)
  })
  it('resolves PBIR settings (0 = auto, 1 = none)', () => {
    expect(resolveDisplayUnit(0, 5e6)).toBe(1e6)
    expect(resolveDisplayUnit(undefined, 5e3)).toBe(1e3)
    expect(resolveDisplayUnit(1, 5e6)).toBe(1)
    expect(resolveDisplayUnit(1e3, 5e6)).toBe(1e3)
  })
  it('formats with PBI suffixes K / M / bn / T and keeps currency prefix', () => {
    expect(formatWithUnits(1234567, { unit: 1e6, formatString: '\\$#,0' })).toBe('$1.23M')
    expect(formatWithUnits(45000, { unit: 1e3 })).toBe('45K')
    expect(formatWithUnits(2.5e9, { unit: 1e9, decimals: 1 })).toBe('2.5bn')
    expect(formatWithUnits(-1500, { unit: 1e3, decimals: 1, formatString: '\\$#,0' })).toBe('-$1.5K')
    expect(formatWithUnits(4e12, { unit: 1e12, decimals: 0 })).toBe('4T')
  })
  it('never scales percentages', () => {
    expect(formatWithUnits(0.4567, { unit: 1e3, formatString: '0.0%' })).toBe('45.7%')
    expect(formatWithUnits(0.4567, { unit: 1, decimals: 2, formatString: '0%' })).toBe('45.67%')
  })
  it('uses explicit decimals without units', () => {
    expect(formatWithUnits(1234.5, { unit: 1, decimals: 2 })).toBe('1,234.50')
  })
  it('parses .NET numeric formats', () => {
    expect(parseNumberFormat('\\$#,0.00;(\\$#,0.00)')).toMatchObject({ prefix: '$', decimals: 2, grouping: true, numeric: true })
    expect(parseNumberFormat('0.0%')).toMatchObject({ percent: true, decimals: 1 })
    expect(parseNumberFormat('#,0" units"')).toMatchObject({ suffix: ' units', decimals: 0 })
    expect(parseNumberFormat('Percent')).toMatchObject({ percent: true, decimals: 2 })
    expect(parseNumberFormat('yyyy-MM-dd').numeric).toBe(false)
  })
  it('decimals for tick steps', () => {
    expect(decimalsForStep(2)).toBe(0)
    expect(decimalsForStep(0.5)).toBe(1)
    expect(decimalsForStep(0.25)).toBe(2)
  })
  it('formats dates with PBI default short date', () => {
    expect(formatScalar(new Date(Date.UTC(2024, 0, 31)), undefined, undefined)).toBe('1/31/2024')
    expect(formatScalar(null, undefined, undefined)).toBe('(Blank)')
  })
})

describe('value axis', () => {
  it('includes zero for bars and nices the domain', () => {
    const m = computeValueAxis({ dataMin: 120, dataMax: 830, includeZero: true, length: 250 })
    expect(m.domain[0]).toBe(0)
    expect(m.domain[1]).toBeGreaterThanOrEqual(830)
    expect(m.ticks[0]).toBe(0)
  })
  it('fits the data for lines', () => {
    const m = computeValueAxis({ dataMin: 120, dataMax: 180, includeZero: false, length: 250 })
    expect(m.domain[0]).toBeGreaterThan(0)
    expect(m.domain[0]).toBeLessThanOrEqual(120)
  })
  it('honours explicit start / end', () => {
    const m = computeValueAxis({ dataMin: 0, dataMax: 830, includeZero: true, start: 100, end: 900, length: 250 })
    expect(m.domain).toEqual([100, 900])
  })
  it('log scale ticks at powers of ten', () => {
    const m = computeValueAxis({ dataMin: 3, dataMax: 4500, includeZero: false, scale: 'log', length: 250 })
    expect(m.ticks).toEqual([1, 10, 100, 1000, 10000])
    const px = valueToPx(m, 100)
    expect(px(1)).toBeCloseTo(0)
    expect(px(10000)).toBeCloseTo(100)
  })
  it('band layout with PBI inner padding', () => {
    const b = bandLayout(4, 400, 0.2)
    expect(b.bandwidth).toBeCloseTo(b.step * 0.8)
    expect(b.pos(3) + b.bandwidth + b.offset).toBeCloseTo(400)
  })
  it('integer continuous ticks', () => {
    expect(continuousTicks(2023, 2024, 400, false, 60, true)).toEqual([2023, 2024])
  })
})

describe('stacking', () => {
  it('stacks positives up and negatives down', () => {
    const st = stackValues([
      [10, -5],
      [20, 15],
      [-3, null]
    ])
    expect(st[0][0]).toEqual([0, 10])
    expect(st[1][0]).toEqual([10, 30])
    expect(st[2][0]).toEqual([-3, 0])
    expect(st[0][1]).toEqual([-5, 0])
    expect(st[1][1]).toEqual([0, 15])
    expect(st[2][1]).toBeNull()
  })
  it('100% stacking normalises by the absolute total', () => {
    const st = stackValues(
      [
        [1, 0],
        [3, 2]
      ],
      true
    )
    expect(st[0][0]).toEqual([0, 0.25])
    expect(st[1][0]).toEqual([0.25, 1])
    expect(st[1][1]).toEqual([0, 1])
  })
})

describe('colors', () => {
  const scope = (col: string, v: string) => [{ scopeId: { Comparison: { ComparisonKind: 0, Left: columnExpr('Sales', col), Right: { Literal: { Value: `'${v}'` } } } } }]
  const lit = (hex: string) => ({ solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } })
  const visual = {
    visual: {
      visualType: 'clusteredColumnChart',
      objects: {
        dataPoint: [
          { properties: { fill: lit('#111111') }, selector: { metadata: 'Sales.Total Sales' } },
          { properties: { fill: lit('#222222') }, selector: { data: scope('Region', 'Europe') } },
          { properties: { fill: { solid: { color: { expr: { ThemeDataColor: { ColorId: 5, Percent: 0 } } } } } }, selector: { data: scope('Region', 'Pacific') } },
          { properties: { defaultColor: lit('#333333') } }
        ]
      }
    }
  }
  const pc = makePropContext(visual, theme)
  it('matches data selectors', () => {
    expect(dataSelectorMatches(scope('Region', 'Europe'), [{ expr: columnExpr('Sales', 'Region'), value: 'Europe' }])).toBe(true)
    expect(dataSelectorMatches(scope('Region', 'Europe'), [{ expr: columnExpr('Sales', 'Region'), value: 'Asia' }])).toBe(false)
    expect(dataSelectorMatches([{ dataViewWildcard: { matchingOption: 1 } }], [])).toBe(true)
  })
  it('resolves per-series fills from metadata / data selectors and theme colors', () => {
    expect(staticFill(pc, { metadata: 'Sales.Total Sales', index: 0 })).toBe('#111111')
    expect(staticFill(pc, { fields: [{ expr: columnExpr('Sales', 'Region'), value: 'Europe' }], index: 1 })).toBe('#222222')
    expect(staticFill(pc, { fields: [{ expr: columnExpr('Sales', 'Region'), value: 'Pacific' }], index: 1 })).toBe(theme.dataColors[3])
    expect(staticFill(pc, { metadata: 'Sales.Other', index: 2 })).toBe(theme.dataColors[2])
    expect(defaultFill(pc)).toBe('#333333')
  })
  it('evaluates gradient fill rules', () => {
    const rule = { linearGradient2: { min: { color: { Literal: { Value: "'#000000'" } } }, max: { color: { Literal: { Value: "'#FFFFFF'" } } } } }
    expect(evalFillRule(rule, 0, [0, 10], theme)).toBe('#000000')
    expect(evalFillRule(rule, 10, [0, 10], theme)).toBe('#FFFFFF')
    expect(evalFillRule(rule, 5, [0, 10], theme)).toBe('#808080')
    const r3 = { linearGradient3: { min: { color: { Literal: { Value: "'#FF0000'" } } }, mid: { color: { Literal: { Value: "'#00FF00'" } } }, max: { color: { Literal: { Value: "'#0000FF'" } } } } }
    expect(evalFillRule(r3, 5, [0, 10], theme)).toBe('#00FF00')
  })
  it('evaluates rule-based conditional colors', () => {
    const expr = {
      Conditional: {
        Cases: [
          { Condition: { Comparison: { ComparisonKind: 1, Left: {}, Right: { Literal: { Value: '100D' } } } }, Value: { Literal: { Value: "'#00AA00'" } } }
        ],
        DefaultValue: { Literal: { Value: "'#AA0000'" } }
      }
    }
    expect(evalConditional({ expr }, 150, [0, 0], theme)).toBe('#00AA00')
    expect(evalConditional({ expr }, 50, [0, 0], theme)).toBe('#AA0000')
    expect(evalConditional({ expr: { Measure: {} } }, '#123456', [0, 0], theme)).toBe('#123456')
  })
  it('contrast text and mixing', () => {
    expect(contrastText('#12239E')).toBe('#FFFFFF')
    expect(contrastText('#F3F2F1')).toBe('#252423')
    expect(mixColor('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  })
})

describe('text helpers', () => {
  const font = { size: 12, family: 'Segoe UI' }
  it('ellipsizes and wraps', () => {
    expect(ellipsize('Short', 500, font)).toBe('Short')
    const e = ellipsize('A very long category label indeed', 60, font)
    expect(e.endsWith('…')).toBe(true)
    const lines = wrapText('North America and Europe', 70, font, 2)
    expect(lines.length).toBeLessThanOrEqual(2)
  })
  it('maps PBI fonts', () => {
    expect(cssFontFamily('Segoe UI Semibold')).toContain('Segoe UI Semibold')
    expect(cssFontFamily('DIN')).toContain('DIN')
    expect(fontWeightOf('Segoe UI Semibold')).toBe(600)
    expect(fontWeightOf('Segoe UI', true)).toBe(700)
  })
})
