import { resolveTheme } from '@core/report/theme'
import { fieldKey, measureExpr, aggregationExpr, columnExpr } from '@core/report/sq'
import {
  collectColumnCF,
  compileColorRule,
  computeStats,
  dataBarGeometry,
  evalColorRule,
  gradientColor,
  scopeApplies,
  cfInputs,
  fullRangeStats,
  rangeInputs
} from './conditionalFormatting'
import { createSampleEngine, S } from './sampleData'
import { evalCondition, evalFilter } from './sqEval'
import { formatWithUnits, withDecimals, insertSuffix, formatDecimals } from './displayUnits'
import { cssFont, parseFontSize } from './textStyle'
import { memoryFormat } from './memoryEngine'

const theme = resolveTheme()
const lit = (v: string) => ({ Literal: { Value: v } })
const sales = aggregationExpr('Sales', 'Amount', 0)
const color = (c: string) => ({ solid: { color: { expr: lit(`'${c}'`) } } })
const getter = (vals: Record<string, any>) => (key: string) => vals[key]

describe('conditional formatting: compile + evaluate', () => {
  it('field value rule returns the measure value as the color', () => {
    const m = measureExpr('_m', 'Color')
    const rule = compileColorRule({ solid: { color: { expr: m } } }, theme)!
    expect(rule.kind).toBe('field')
    expect(evalColorRule(rule, getter({ [fieldKey(m)]: '#FF0000' }), {}, theme)).toBe('#FF0000')
    expect(evalColorRule(rule, getter({ [fieldKey(m)]: null }), {}, theme)).toBeUndefined()
    // theme tokens are accepted as values
    expect(evalColorRule(rule, getter({ [fieldKey(m)]: 'good' }), {}, theme)).toBe(theme.good)
  })

  it('linearGradient2 interpolates between data min and max', () => {
    const rule = compileColorRule(
      {
        solid: {
          color: {
            expr: {
              FillRule: {
                Input: sales,
                FillRule: { linearGradient2: { min: { color: lit("'#000000'") }, max: { color: lit("'#FFFFFF'") }, nullColoringStrategy: { strategy: lit("'asZero'") } } }
              }
            }
          }
        }
      },
      theme
    )!
    expect(rule.kind).toBe('gradient')
    const stats = computeStats([0, 50, 100, null, 'x'])
    expect(stats).toEqual({ min: 0, max: 100 })
    const k = fieldKey(sales)
    expect(evalColorRule(rule, getter({ [k]: 0 }), stats, theme)).toBe('#000000')
    expect(evalColorRule(rule, getter({ [k]: 100 }), stats, theme)).toBe('#FFFFFF')
    expect(evalColorRule(rule, getter({ [k]: 50 }), stats, theme)).toBe('#808080')
    // blank as zero
    expect(evalColorRule(rule, getter({ [k]: null }), stats, theme)).toBe('#000000')
  })

  it('linearGradient3 with explicit values and specific null color', () => {
    const rule = compileColorRule(
      {
        solid: {
          color: {
            expr: {
              FillRule: {
                Input: sales,
                FillRule: {
                  linearGradient3: {
                    min: { color: lit("'#FF0000'"), value: lit('0D') },
                    mid: { color: lit("'#FFFF00'"), value: lit('50D') },
                    max: { color: lit("'#00FF00'"), value: lit('200D') },
                    nullColoringStrategy: { strategy: lit("'specificColor'"), color: lit("'#123456'") }
                  }
                }
              }
            }
          }
        }
      },
      theme
    )!
    const k = fieldKey(sales)
    expect(evalColorRule(rule, getter({ [k]: 50 }), {}, theme)).toBe('#FFFF00')
    expect(evalColorRule(rule, getter({ [k]: 125 }), {}, theme)).toBe('#80FF00')
    expect(evalColorRule(rule, getter({ [k]: 999 }), {}, theme)).toBe('#00FF00')
    expect(evalColorRule(rule, getter({ [k]: null }), {}, theme)).toBe('#123456')
  })

  it('rules (Conditional cases) pick the first matching case, with theme colors', () => {
    const cmp = (kind: number, v: string) => ({ Comparison: { ComparisonKind: kind, Left: sales, Right: lit(v) } })
    const rule = compileColorRule(
      {
        solid: {
          color: {
            expr: {
              Conditional: {
                Cases: [
                  { Condition: { And: { Left: cmp(2, '0D'), Right: cmp(3, '100D') } }, Value: lit("'#AA0000'") },
                  { Condition: cmp(2, '100D'), Value: { ThemeDataColor: { ColorId: 2, Percent: 0 } } }
                ]
              }
            }
          }
        }
      },
      theme
    )!
    expect(rule.kind).toBe('rules')
    expect(cfInputs([{ backColor: { rule, scope: 'both' } }]).map((e) => fieldKey(e))).toEqual([fieldKey(sales)])
    const k = fieldKey(sales)
    expect(evalColorRule(rule, getter({ [k]: 10 }), {}, theme)).toBe('#AA0000')
    expect(evalColorRule(rule, getter({ [k]: 150 }), {}, theme)).toBe(theme.dataColors[0])
    expect(evalColorRule(rule, getter({ [k]: -5 }), {}, theme)).toBeUndefined()
  })

  it('collects per-column CF with scopes, icons, web URLs and data bars', () => {
    const json = {
      visual: {
        objects: {
          values: [
            { properties: { backColor: color('#111111') }, selector: { metadata: 'Sales.Amount', data: [{ dataViewWildcard: { matchingOption: 1 } }] } },
            { properties: { webURL: { expr: columnExpr('Sales', 'Url') } }, selector: { metadata: 'Sales.Product' } },
            {
              properties: {
                icon: {
                  kind: 'Icon',
                  layout: lit("'After'"),
                  verticalAlignment: lit("'Middle'"),
                  value: { Conditional: { Cases: [{ Condition: { Comparison: { ComparisonKind: 1, Left: sales, Right: lit('0D') } }, Value: lit("'ArrowUpGreen'") }] } }
                }
              },
              selector: { metadata: 'Sales.Margin' }
            }
          ],
          columnFormatting: [
            { properties: { dataBars: { positiveColor: color('#00AA00'), negativeColor: color('#AA0000'), axisColor: color('#000000'), reverseDirection: { expr: lit('false') } } }, selector: { metadata: 'Sales.Amount' } }
          ]
        }
      }
    }
    const cfs = collectColumnCF(json, theme)
    expect(cfs.get('Sales.Amount')!.backColor!.scope).toBe('instances')
    expect(scopeApplies('instances', true)).toBe(false)
    expect(scopeApplies('totals', true)).toBe(true)
    expect(cfs.get('Sales.Amount')!.dataBars!.spec.positiveColor).toBe('#00AA00')
    expect(cfs.get('Sales.Product')!.webURL).toBeDefined()
    const icon = cfs.get('Sales.Margin')!.icon!.rule
    expect(icon.layout).toBe('after')
    expect(icon.verticalAlignment).toBe('middle')
    expect(evalColorRule(icon.rule, getter({ [fieldKey(sales)]: 3 }), {}, theme)).toBe('ArrowUpGreen')
  })

  it('data bar geometry handles negatives with an axis', () => {
    const spec = { positiveColor: 'g', negativeColor: 'r', axisColor: 'k', reverse: false, hideText: false }
    expect(dataBarGeometry(50, spec, { min: 0, max: 100 })).toMatchObject({ start: 0, width: 0.5, negative: false })
    const neg = dataBarGeometry(-50, spec, { min: -100, max: 100 })
    expect(neg).toMatchObject({ start: 0.25, width: 0.25, axis: 0.5, negative: true })
  })

  it('gradient with a single value range returns the first stop', () => {
    expect(gradientColor([{ color: '#000000' }, { color: '#FFFFFF' }], 5, { min: 5, max: 5 })).toBe('#000000')
  })
})

describe('SQ condition evaluation', () => {
  const region = columnExpr('Sales', 'Region')
  const get = (vals: Record<string, any>) => (k: string) => vals[k]
  it('In / Not / Contains / Comparison / And / Or', () => {
    const k = fieldKey(region)
    const inCond = { In: { Expressions: [region], Values: [[lit("'Europe'")], [lit("'Asia'")]] } }
    expect(evalCondition(inCond, get({ [k]: 'europe' }))).toBe(true)
    expect(evalCondition({ Not: { Expression: inCond } }, get({ [k]: 'Europe' }))).toBe(false)
    expect(evalCondition({ Contains: { Left: region, Right: lit("'ROP'") } }, get({ [k]: 'Europe' }))).toBe(true)
    expect(evalCondition({ Comparison: { ComparisonKind: 0, Left: region, Right: lit('null') } }, get({ [k]: null }))).toBe(true)
    expect(evalCondition({ Or: { Left: inCond, Right: { Contains: { Left: region, Right: lit("'x'") } } } }, get({ [k]: 'Mexico' }))).toBe(true)
  })
  it('evalFilter resolves From aliases', () => {
    const f = {
      Version: 2,
      From: [{ Name: 's', Entity: 'Sales', Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Region' } }], Values: [[lit("'Asia'")]] } } }]
    }
    expect(evalFilter(f, get({ [fieldKey(region)]: 'Asia' }))).toBe(true)
    expect(evalFilter(f, get({ [fieldKey(region)]: 'Europe' }))).toBe(false)
  })
})

describe('display units', () => {
  it('rewrites decimals of format strings', () => {
    expect(withDecimals('\\$#,0.00;(\\$#,0.00)', 1)).toBe('\\$#,0.0;(\\$#,0.0)')
    expect(withDecimals(undefined, 2)).toBe('#,0.00')
    expect(formatDecimals('0.0%')).toBe(1)
    expect(insertSuffix('$1.23', 'M')).toBe('$1.23M')
    expect(insertSuffix('(1.2)', 'K')).toBe('(1.2K)')
  })
  it('auto / fixed units with precision', () => {
    expect(formatWithUnits(29358677.22, memoryFormat, { formatString: '\\$#,0.00', units: 0 })).toBe('$29.36M')
    expect(formatWithUnits(60000, memoryFormat, { formatString: '#,0', units: 0 })).toBe('60K')
    expect(formatWithUnits(1234, memoryFormat, { formatString: '#,0', units: 1e3, precision: 1 })).toBe('1.2K')
    expect(formatWithUnits(0.256, memoryFormat, { formatString: '0.0%', units: 0 })).toBe('25.6%')
    expect(formatWithUnits(950, memoryFormat, { formatString: '#,0', units: 0 })).toBe('950')
    expect(formatWithUnits(1234.5678, memoryFormat, { formatString: '#,0.00', units: 1, precision: 0 })).toBe('1,235')
  })
})

describe('text style helpers', () => {
  it('maps PBI font families to CSS', () => {
    expect(cssFont('Segoe UI Semibold')).toMatchObject({ fontWeight: 600 })
    expect(cssFont("'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif").fontWeight).toBe(600)
    // malformed double-quoted stacks seen in PBIR files
    expect(cssFont("''Segoe UI Semibold', wf_segoe-ui_semibold, helvetica").fontFamily.startsWith("'Segoe UI'")).toBe(true)
    expect(cssFont('Segoe UI Light').fontWeight).toBe(300)
    expect(parseFontSize('14pt')).toBeCloseTo(18.667, 2)
    expect(parseFontSize(10)).toBeCloseTo(13.333, 2)
    expect(parseFontSize('12px')).toBe(12)
  })
})

describe('full-range CF stats (windowed tables/matrices)', () => {
  it('rangeInputs: gradient inputs and data-bar columns only', () => {
    const grad = compileColorRule({ solid: { color: { expr: { FillRule: { Input: S.m('Orders'), FillRule: { linearGradient2: { min: { color: lit("'#FFFFFF'") }, max: { color: lit("'#000000'") } } } } } } } }, theme)!
    const field = compileColorRule({ solid: { color: { expr: S.m('Margin Color') } } }, theme)!
    const ins = rangeInputs([
      { cf: { backColor: { rule: grad, scope: 'both' } }, own: S.m('Total Sales') },
      { cf: { fontColor: { rule: field, scope: 'both' }, dataBars: { spec: { positiveColor: '#000', negativeColor: '#000', axisColor: '#000', reverse: false, hideText: false }, scope: 'both' } }, own: S.m('Units') },
      { cf: undefined, own: S.m('Total Cost') }
    ])
    expect(ins.map((e) => fieldKey(e))).toEqual([fieldKey(S.m('Orders')), fieldKey(S.m('Units'))])
  })
  it('fullRangeStats: min/max of each input over every group of the grain', () => {
    const engine = createSampleEngine()
    const st = fullRangeStats(engine, [S.col('Country')], [], [S.m('Orders')])
    const rows = engine.summarize({ groupBy: [{ kind: 'sq', expr: S.col('Country') }], values: [{ id: 'o', expr: { kind: 'sq', expr: S.m('Orders') } }] }).rows.map((r) => r[1] as number)
    expect(st.get(fieldKey(S.m('Orders')))).toEqual({ min: Math.min(...rows), max: Math.max(...rows) })
    expect(fullRangeStats(engine, [S.col('Country')], [], []).size).toBe(0)
  })
})
