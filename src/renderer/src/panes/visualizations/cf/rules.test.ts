import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTheme } from '@core/report/theme'
import { compileColorRule, evalColorRule, collectColumnCF } from '../../../visuals/common/conditionalFormatting'
import {
  applyToOf,
  cfSelector,
  defaultDataBars,
  defaultGradient,
  defaultIconRules,
  describeModel,
  inputFromExpr,
  inputToExpr,
  parseCF,
  parseDataBars,
  parseIcons,
  reverseRuleValues,
  sameTargetSelector,
  serializeCF,
  serializeDataBars,
  serializeIcons,
  stableKey,
  type GradientModel,
  type RulesModel
} from './rules'

const measure = (p: string) => ({ Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: p } })
const column = (p: string) => ({ Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: p } })
const lit = (v: string) => ({ Literal: { Value: v } })
const cmp = (k: number, left: any, right: string) => ({ Comparison: { ComparisonKind: k, Left: left, Right: lit(right) } })

const gradient3 = {
  solid: {
    color: {
      expr: {
        FillRule: {
          Input: measure('Margin'),
          FillRule: {
            linearGradient3: {
              min: { color: lit("'#F94477'"), value: lit('1D') },
              mid: { color: lit("'#FCBA17'"), value: lit('2D') },
              max: { color: lit("'#A691E4'"), value: lit('3D') },
              nullColoringStrategy: { strategy: lit("'asZero'") }
            }
          }
        }
      }
    }
  }
}

const gradient2Tokens = {
  solid: {
    color: {
      expr: {
        FillRule: {
          Input: { Aggregation: { Expression: column('Units'), Function: 0 } },
          FillRule: {
            linearGradient2: {
              min: { color: lit("'minColor'") },
              max: { color: lit("'maxColor'") },
              nullColoringStrategy: { strategy: lit("'specificColor'"), color: lit("'#CCCCCC'") }
            }
          }
        }
      }
    }
  }
}

const rules = {
  solid: {
    color: {
      expr: {
        Conditional: {
          Cases: [
            { Condition: cmp(2, measure('Var %'), '0D'), Value: lit("'#3BB44A'") },
            { Condition: cmp(3, measure('Var %'), '0D'), Value: lit("'#E81123'") }
          ]
        }
      }
    }
  }
}

const iconRules = {
  kind: 'Icon',
  layout: { expr: lit("'After'") },
  verticalAlignment: { expr: lit("'Top'") },
  value: {
    expr: {
      Conditional: {
        Cases: [
          { Condition: cmp(2, measure('Forecast %'), '1D'), Value: lit("'CircleGreen'") },
          { Condition: { And: { Left: cmp(2, measure('Forecast %'), '0.75D'), Right: cmp(3, measure('Forecast %'), '1D') } }, Value: lit("'TriangleYellow'") },
          { Condition: { And: { Left: cmp(2, measure('Forecast %'), '0D'), Right: cmp(3, measure('Forecast %'), '0.75D') } }, Value: lit("'DiamondRed'") }
        ]
      }
    }
  }
}

const dataBars = {
  minValue: { expr: lit('0D') },
  maxValue: { expr: lit('1D') },
  positiveColor: { solid: { color: { expr: lit("'#F2BB13'") } } },
  negativeColor: { solid: { color: { expr: lit("'minColor'") } } },
  axisColor: { solid: { color: { expr: lit("'foreground'") } } },
  reverseDirection: { expr: lit('false') },
  hideText: { expr: lit('false') },
  totalMatchingOption: { expr: lit('1L') }
}

describe('cf rules: parse ⇄ serialize', () => {
  it('round-trips a 3-stop gradient with explicit numbers', () => {
    const p = parseCF(gradient3)!
    expect(p.wrap).toBe('solid')
    const m = p.model as GradientModel
    expect(m.style).toBe('gradient')
    expect(m.min).toMatchObject({ kind: 'number', value: 1, color: '#F94477' })
    expect(m.mid).toMatchObject({ kind: 'number', value: 2 })
    expect(m.max).toMatchObject({ kind: 'number', value: 3 })
    expect(serializeCF(p)).toEqual(gradient3)
  })

  it('round-trips a 2-stop gradient on an aggregated column with a specific empty color', () => {
    const p = parseCF(gradient2Tokens)!
    const m = p.model as GradientModel
    expect(m.input).toEqual({ field: column('Units'), aggregation: 0 })
    expect(m.min.kind).toBe('lowest')
    expect(m.max.kind).toBe('highest')
    expect(m.nullStrategy).toBe('specificColor')
    expect(m.nullColor).toBe('#CCCCCC')
    expect(serializeCF(p)).toEqual(gradient2Tokens)
  })

  it('round-trips rules and describes them', () => {
    const p = parseCF(rules)!
    const m = p.model as RulesModel
    expect(m.style).toBe('rules')
    expect(m.rules).toHaveLength(2)
    expect(m.rules[0].first).toMatchObject({ op: 'ge', value: 0 })
    expect(m.rules[1].value).toBe('#E81123')
    expect(serializeCF(p)).toEqual(rules)
    expect(describeModel(m)).toBe('Rules · Var %')
  })

  it('round-trips field value (color and text wraps)', () => {
    const color = { solid: { color: { expr: measure('Status Color') } } }
    const text = { expr: { Aggregation: { Expression: column('Name'), Function: 3 } } }
    expect(serializeCF(parseCF(color)!)).toEqual(color)
    const pt = parseCF(text)!
    expect(pt.wrap).toBe('expr')
    expect(pt.model).toEqual({ style: 'fieldValue', input: { field: column('Name'), aggregation: 3 } })
    expect(serializeCF(pt)).toEqual(text)
  })

  it('returns undefined for static values and keeps unknown shapes raw', () => {
    expect(parseCF({ solid: { color: { expr: lit("'#FF0000'") } } })).toBeUndefined()
    expect(parseCF({ expr: lit("'Title'") })).toBeUndefined()
    const odd = { solid: { color: { expr: { FillRule: { Input: measure('X'), FillRule: { somethingNew: {} } } } } } }
    const p = parseCF(odd)!
    expect(p.model.style).toBe('raw')
    expect(serializeCF(p)).toBe(odd)
  })

  it('builds rules with blanks, negations and text operators', () => {
    const m: RulesModel = {
      style: 'rules',
      input: { field: column('Category'), aggregation: 3 },
      rules: [
        { first: { op: 'blank' }, value: '#999999' },
        { first: { op: 'notContains', value: 'Bike' }, value: '#118DFF' },
        { first: { op: 'ne', value: 'Road' }, value: { theme: { ColorId: 2, Percent: 0 } } }
      ]
    }
    const raw = serializeCF({ wrap: 'solid', model: m })
    const cases = raw.solid.color.expr.Conditional.Cases
    const left = { Aggregation: { Expression: column('Category'), Function: 3 } }
    expect(cases[0].Condition).toEqual({ Comparison: { ComparisonKind: 0, Left: left, Right: lit('null') } })
    expect(cases[1].Condition).toEqual({ Not: { Expression: { Contains: { Left: left, Right: lit("'Bike'") } } } })
    expect(cases[2].Value).toEqual({ ThemeDataColor: { ColorId: 2, Percent: 0 } })
    const back = parseCF(raw)!.model as RulesModel
    expect(back.rules.map((r) => r.first.op)).toEqual(['blank', 'notContains', 'ne'])
    expect(serializeCF({ wrap: 'solid', model: back })).toEqual(raw)
  })

  it('rejects rules mixing different inputs (kept raw)', () => {
    const mixed = { solid: { color: { expr: { Conditional: { Cases: [{ Condition: cmp(1, measure('A'), '1D'), Value: lit("'#000000'") }, { Condition: cmp(1, measure('B'), '1D'), Value: lit("'#FFFFFF'") }] } } } } }
    expect(parseCF(mixed)!.model.style).toBe('raw')
  })

  it('reverse order swaps values, keeps conditions', () => {
    const m = parseCF(rules)!.model as RulesModel
    const r = reverseRuleValues(m.rules)
    expect(r.map((x) => x.value)).toEqual(['#E81123', '#3BB44A'])
    expect(r[0].first).toEqual(m.rules[0].first)
  })

  it('round-trips icons', () => {
    const m = parseIcons(iconRules)!
    expect(m.layout).toBe('After')
    expect(m.rule.style).toBe('rules')
    expect((m.rule as RulesModel).rules.map((r) => r.value)).toEqual(['CircleGreen', 'TriangleYellow', 'DiamondRed'])
    expect(serializeIcons(m)).toEqual(iconRules)
  })

  it('round-trips data bars and builds defaults', () => {
    const m = parseDataBars(dataBars)!
    expect(m.min?.value).toBe(0)
    expect(m.totalMatchingOption).toBe(1)
    expect(serializeDataBars(m)).toEqual(dataBars)
    const d = serializeDataBars(defaultDataBars('#118DFF'))
    expect(d.positiveColor).toEqual({ solid: { color: { expr: lit("'#118DFF'") } } })
    expect(d.minValue).toBeUndefined()
    expect(d.reverseDirection).toEqual({ expr: lit('false') })
  })

  it('scope selectors', () => {
    const s = cfSelector({ metadata: 'Sales.Amount' }, 'values')
    expect(s).toEqual({ data: [{ dataViewWildcard: { matchingOption: 1 } }], metadata: 'Sales.Amount' })
    expect(applyToOf(s)).toBe('values')
    expect(applyToOf(cfSelector(undefined, 'valuesAndTotals'))).toBe('valuesAndTotals')
    expect(sameTargetSelector(cfSelector({ metadata: 'a' }, 'totals'), { metadata: 'a' })).toBe(true)
    expect(sameTargetSelector(cfSelector({ metadata: 'a' }, 'totals'), { metadata: 'b' })).toBe(false)
    expect(stableKey({ b: 1, a: [{ d: 2, c: 1 }] })).toBe(stableKey({ a: [{ c: 1, d: 2 }], b: 1 }))
  })

  it('input helpers', () => {
    const agg = { Aggregation: { Expression: column('Units'), Function: 1 } }
    expect(inputToExpr(inputFromExpr(agg))).toEqual(agg)
    expect(inputFromExpr(measure('X'))).toEqual({ field: measure('X') })
  })
})

describe('cf rules: written shapes render through the shared CF evaluator', () => {
  const theme = resolveTheme()
  it('default gradient interpolates between theme min/max colors', () => {
    const raw = serializeCF({ wrap: 'solid', model: defaultGradient({ field: measure('Amount') }) })
    const rule = compileColorRule(raw, theme)!
    expect(rule.kind).toBe('gradient')
    const get = (_k: string) => 50
    const c = evalColorRule(rule, get, { min: 0, max: 100 }, theme)
    expect(c).toMatch(/^#[0-9A-F]{6}$/i)
    expect(c).not.toBe(theme.minimum)
  })

  it('icon rules evaluate to the band icon', () => {
    const m = { layout: 'Before', verticalAlignment: 'Middle', kind: 'Icon', rule: defaultIconRules({ field: measure('Score') }, ['CircleGreen', 'CircleYellow', 'CircleRed']) }
    const visual = { visual: { objects: { values: [{ properties: { icon: serializeIcons(m) }, selector: cfSelector({ metadata: 'Sales.Score' }) }] } } }
    const cf = collectColumnCF(visual, theme).get('Sales.Score')!
    expect(cf.icon?.rule.layout).toBe('before')
    expect(cf.icon?.rule.verticalAlignment).toBe('middle')
    expect(cf.icon?.scope).toBe('instances')
    const at = (v: number) => evalColorRule(cf.icon!.rule.rule, () => v, {}, theme)
    expect(at(90)).toBe('CircleGreen')
    expect(at(50)).toBe('CircleYellow')
    expect(at(10)).toBe('CircleRed')
  })
})

// ---------------------------------------------------------------------------------------------
// Corpus round-trip (generic assertions only; content never leaves the corpus)
// ---------------------------------------------------------------------------------------------

const CORPUS = process.env.LUMEN_CORPUS_DIR

function* visualFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === '.pbi' || name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* visualFiles(p)
    else if (name === 'visual.json') yield p
  }
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('cf rules: corpus round-trip', () => {
  it('every data-bound formatting value parses and re-serializes deep-equal', () => {
    let bound = 0
    let modelled = 0
    let bars = 0
    let icons = 0
    for (const f of visualFiles(CORPUS!)) {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const v = j.visual ?? j.visualGroup
      for (const bagName of ['objects', 'visualContainerObjects']) {
        for (const entries of Object.values<any[]>(v?.[bagName] ?? {})) {
          for (const e of entries ?? []) {
            for (const [prop, raw] of Object.entries<any>(e.properties ?? {})) {
              if (prop === 'dataBars') {
                const m = parseDataBars(raw)
                expect(m).toBeDefined()
                expect(serializeDataBars(m!)).toEqual(raw)
                bars++
                continue
              }
              if (prop === 'icon' && raw?.value) {
                const m = parseIcons(raw)
                if (m) {
                  expect(serializeIcons(m)).toEqual(raw)
                  icons++
                }
                continue
              }
              const p = parseCF(raw)
              if (!p) continue
              bound++
              if (p.model.style !== 'raw') modelled++
              expect(serializeCF(p)).toEqual(raw)
            }
          }
        }
      }
    }
    expect(bound + bars + icons).toBeGreaterThan(0)
    // every data-bound value of the corpus is understood by the editor (none fall back to raw)
    expect(modelled).toBe(bound)
  })
})

// Public Microsoft sample PBIX files (legacy Layout JSON uses the same expression shapes).
const SAMPLES = process.env.LUMEN_PBIX_SAMPLES

describe.skipIf(!SAMPLES || !existsSync(SAMPLES))('cf rules: sample PBIX round-trip', () => {
  it('gradients / rules / icons / field values in sample layouts round-trip', async () => {
    const { unzipSync } = await import('fflate')
    let n = 0
    let modelled = 0
    for (const name of readdirSync(SAMPLES!).filter((x) => x.toLowerCase().endsWith('.pbix'))) {
      const files = unzipSync(new Uint8Array(readFileSync(join(SAMPLES!, name))), { filter: (f) => f.name === 'Report/Layout' })
      const bytes = files['Report/Layout']
      if (!bytes) continue
      const layout = JSON.parse(new TextDecoder('utf-16le').decode(bytes).replace(/^﻿/, ''))
      for (const s of layout.sections ?? []) {
        for (const vc of s.visualContainers ?? []) {
          const sv = JSON.parse(vc.config ?? '{}').singleVisual ?? {}
          for (const bag of [sv.objects, sv.vcObjects]) {
            for (const entries of Object.values<any[]>(bag ?? {})) {
              for (const e of entries ?? []) {
                for (const [prop, raw] of Object.entries<any>(e.properties ?? {})) {
                  if (prop === 'icon' && raw?.value) {
                    const m = parseIcons(raw)
                    expect(m).toBeDefined()
                    expect(serializeIcons(m!)).toEqual(raw)
                    n++
                    modelled++
                    continue
                  }
                  const p = parseCF(raw)
                  if (!p) continue
                  n++
                  if (p.model.style !== 'raw') modelled++
                  expect(serializeCF(p)).toEqual(raw)
                }
              }
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(0)
    expect(modelled).toBe(n)
  })
})
