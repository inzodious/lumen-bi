/**
 * Smart narrative text boxes in Power BI's own PBIR shape.
 *
 * Power BI Desktop saves a smart narrative as a `textbox` whose paragraphs hold switches over a
 * `TemplateIdColumnRole` value, one case per template id (e.g. 10001 = "At [V1], [V2] had the highest …"), and
 * whose `objects.values` hold one entry per referenced output: `Aggregation(Min, Column(Subquery{ Transform }),
 * Property = V1…)`. The transform input is the summarized field pair (PrimarySeriesColumnRole = category,
 * PrimaryValueColumnRole = measure). `smartNarrativeVisualJson` builds that structure for a category and up to
 * three measures, using the template texts of the shared insight engine (insights.ts), so the result renders
 * through exactly the same path as a smart narrative saved by Power BI (Textbox → narrativeQuery → insights).
 */
import type { SQExpr } from '@core/report/sq'
import { templateSentence } from '../charts/misc/narrative/insights'

interface FromEntry {
  Name: string
  Entity: string
  Type: 0
}

/** Replace `SourceRef.Entity` by query aliases (`SourceRef.Source`), collecting the From list. */
function aliasify(e: any, from: FromEntry[]): any {
  if (Array.isArray(e)) return e.map((x) => aliasify(x, from))
  if (!e || typeof e !== 'object') return e
  if (e.SourceRef?.Entity) {
    const entity = String(e.SourceRef.Entity)
    let f = from.find((x) => x.Entity === entity)
    if (!f) {
      const base = entity.replace(/[^A-Za-z]/g, '').charAt(0).toLowerCase() || 't'
      let name = base
      for (let i = 1; from.some((x) => x.Name === name); i++) name = base + i
      f = { Name: name, Entity: entity, Type: 0 }
      from.push(f)
    }
    return { SourceRef: { Source: f.Name } }
  }
  const out: any = {}
  for (const [k, v] of Object.entries(e)) out[k] = aliasify(v, from)
  return out
}

const lit = (v: string) => ({ Literal: { Value: v } })
const ref = (id: string) => ({ propertyIdentifier: { objectName: 'values', propertyName: 'expr' }, selector: { id } })

interface Algo {
  name: string
  algorithm: 'HighPointLowPointSummary' | 'AggregateSummary' | 'KPISummary'
  initial: number
  outputs: string[]
  /** template ids to write cases for */
  templates: number[]
  params?: Array<[string, string]>
  /** output roles holding measure values (formatted with the measure's format string) */
  valueRoles: string[]
  percentRoles?: string[]
  countRoles?: string[]
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

function algos(measures: number): Algo[] {
  const kpiOut = ['V1', 'V3', 'V8', 'V9', 'V12', 'V13', 'V16', 'V17', 'V18', 'V5', 'V10', 'V14', 'V19', 'V20', 'V7', 'V11', 'V15', 'V21', 'V22']
  return [
    { name: 'HighAndLowPoint', algorithm: 'HighPointLowPointSummary', initial: 10000, outputs: ['V1', 'V2', 'V3', 'V4', 'V5'], templates: [10001], valueRoles: ['V1', 'V3'], percentRoles: ['V5'] },
    {
      name: 'Aggregate',
      algorithm: 'AggregateSummary',
      initial: 43000,
      outputs: ['V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V11', 'V15', 'V16', 'V17'],
      templates: [...range(43001, 43013), 43015, 43016, 43018, 43020, 43021, 43022],
      params: [
        ['aggregateType', "'Sum'"],
        ['timeGranularity', "''"]
      ],
      valueRoles: ['V5', 'V7', 'V9', 'V16'],
      countRoles: ['V17']
    },
    {
      name: 'KPI',
      algorithm: 'KPISummary',
      initial: 56000,
      outputs: kpiOut,
      templates: range(56001 + (measures - 1) * 4, 56004 + (measures - 1) * 4),
      params: [
        ['minValue', "''"],
        ['targetValue', "''"],
        ['maxValue', "''"]
      ],
      valueRoles: ['V3', 'V9', 'V13', 'V17', 'V18', 'V5', 'V10', 'V14', 'V19', 'V20', 'V7', 'V11', 'V15', 'V21', 'V22'],
      countRoles: ['V16']
    }
  ]
}

export interface SmartNarrativeSpec {
  /** category field (Column / HierarchyLevel with `SourceRef.Entity`) */
  category: SQExpr
  categoryName: string
  /** 1–3 measures (`SourceRef.Entity`); HighPointLowPoint / Aggregate summaries use the first */
  measures: SQExpr[]
  measureNames: string[]
  /** format strings of the measures (written on value outputs, like Power BI) */
  formatStrings?: Array<string | undefined>
}

/** A `textbox` visual.json holding a Power BI smart narrative over one category and 1–3 measures. */
export function smartNarrativeVisualJson(name: string, spec: SmartNarrativeSpec): any {
  const measures = spec.measures.slice(0, 3)
  const values: any[] = []
  const paragraphs: any[] = []
  const used = new Set<string>()
  const uniqueId = (role: string) => {
    let id = role
    for (let i = 1; used.has(id); i++) id = `${role} (${i})`
    used.add(id)
    return id
  }
  for (const a of algos(measures.length)) {
    const from: FromEntry[] = []
    const inputCols = [
      { Expression: { ...aliasify(spec.category, from), Name: 'd0' }, Role: 'PrimarySeriesColumnRole' },
      ...(a.algorithm === 'KPISummary' ? measures : measures.slice(0, 1)).map((m, i) => ({ Expression: { ...aliasify(m, from), Name: `d${i + 1}` }, Role: i === 0 ? 'PrimaryValueColumnRole' : 'SecondaryValueColumnRole' }))
    ]
    const out = `${a.name}Output`
    const roles = [...a.outputs, 'TemplateIdColumnRole']
    const query = {
      Version: 2,
      From: from,
      Select: roles.map((r) => ({ Column: { Expression: { TransformTableRef: { Source: out } }, Property: r }, Name: r })),
      Transform: [
        {
          Name: a.name,
          Algorithm: a.algorithm,
          Input: {
            Parameters: [{ Literal: { Value: `${a.initial}L` }, Name: 'initialTemplateId' }, ...(a.params ?? []).map(([n, v]) => ({ Literal: { Value: v }, Name: n }))],
            Table: { Name: `${a.name}Input`, Columns: inputCols }
          },
          Output: { Table: { Name: out, Columns: roles.map((r) => ({ Expression: { TransformOutputRoleRef: { Role: r }, Name: r }, Role: r })) } }
        }
      ]
    }
    const ids: Record<string, string> = {}
    for (const role of roles) {
      ids[role] = uniqueId(role)
      const properties: any = { expr: { expr: { Aggregation: { Expression: { Column: { Expression: { Subquery: { Query: query } }, Property: role } }, Function: 3 } } } }
      const measureIdx = a.valueRoles.includes(role) ? (a.algorithm === 'KPISummary' ? kpiMeasureOf(role) : 0) : -1
      const fs = measureIdx >= 0 ? spec.formatStrings?.[measureIdx] : a.percentRoles?.includes(role) ? '#,##0.00%;-#,##0.00%;0.00%' : a.countRoles?.includes(role) ? '#,###;-#,###;0' : undefined
      if (fs) properties.formatString = { expr: lit(`'${fs.replace(/'/g, "''")}'`) }
      values.push({ properties, selector: { id: ids[role] } })
    }
    const MARK = '\u0001'
    const cases = a.templates
      .map((id) => {
        const s = templateSentence(id, { measures: spec.measureNames.slice(0, measures.length), category: spec.categoryName }, (role) => MARK + role)
        if (!s) return null
        const textRuns = s.map((r) => (r.text.startsWith(MARK) ? { value: ref(ids[r.text.slice(1)] ?? r.text.slice(1)) } : { value: r.text }))
        return { pattern: { expr: lit(`${id}L`) }, textRuns }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    // a blank line between summaries, as in the text boxes Power BI writes
    if (paragraphs.length) paragraphs.push({ textRuns: [{ value: '' }] })
    paragraphs.push({ textRuns: [{ cases, defaultCase: { textRuns: [] }, expression: ref(ids.TemplateIdColumnRole) }] })
  }
  return {
    name,
    position: { x: 0, y: 0, z: 0, width: 360, height: 240 },
    visual: { visualType: 'textbox', objects: { general: [{ properties: { paragraphs } }], values }, drillFilterOtherVisuals: true }
  }
}

function kpiMeasureOf(role: string): number {
  if (['V3', 'V9', 'V13', 'V17', 'V18'].includes(role)) return 0
  if (['V5', 'V10', 'V14', 'V19', 'V20'].includes(role)) return 1
  return 2
}
