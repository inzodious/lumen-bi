/**
 * Modeling ▸ New parameter — model objects shaped exactly like Power BI Desktop writes them.
 *
 * Numeric range ("what-if") parameter:
 *   table 'P'  (calculated partition `GENERATESERIES(min, max, increment)`)
 *     column 'P'      sourceColumn [Value], extendedProperty ParameterMetadata = {"version":0}
 *     measure 'P Value' = SELECTEDVALUE('P'[P], default)
 *
 * Fields parameter:
 *   table 'P'  (calculated partition `{ ("Label", NAMEOF('T'[Field]), 0), ... }`)
 *     column 'P'         sourceColumn [Value1], sortByColumn 'P Order', relatedColumnDetails groupByColumn 'P Fields'
 *     column 'P Fields'  isHidden, sourceColumn [Value2], sortByColumn 'P Order', extendedProperty ParameterMetadata = {"version":3,"kind":2}
 *     column 'P Order'   isHidden, formatString 0, summarizeBy sum, sourceColumn [Value3]
 *
 * `relatedColumnDetails` has no first-class field in ColumnDef; it is stored the way the TMDL reader keeps
 * unmodeled child objects (`extra['@children']` generic nodes), so the TMDL / TMSL writers emit it.
 */
import type { ColumnDef, MeasureDef, TableDef } from '@core/model/types'
import { quoteColumn, quoteTable } from '../../../editors/dax/tokenizer'
import { quoteName } from '@core/tmdl/names'

export interface NumericRangeParameterSpec {
  name: string
  dataType: 'int64' | 'double'
  min: number
  max: number
  increment: number
  defaultValue?: number
}

const daxNumber = (n: number): string => String(n)

export function validateNumericRange(spec: NumericRangeParameterSpec): string | null {
  if (!spec.name.trim()) return 'Enter a name for the parameter.'
  for (const [k, v] of [['Minimum', spec.min], ['Maximum', spec.max], ['Increment', spec.increment]] as const) {
    if (!Number.isFinite(v)) return `${k} must be a number.`
    if (spec.dataType === 'int64' && !Number.isInteger(v)) return `${k} must be a whole number.`
  }
  if (spec.min > spec.max) return 'Minimum must be less than or equal to Maximum.'
  if (spec.increment <= 0) return 'Increment must be greater than 0.'
  if ((spec.max - spec.min) / spec.increment > 1_000_000) return 'The parameter would generate more than 1,000,000 values.'
  if (spec.defaultValue !== undefined && (spec.defaultValue < spec.min || spec.defaultValue > spec.max)) return 'Default must be between Minimum and Maximum.'
  return null
}

export function buildNumericRangeParameter(spec: NumericRangeParameterSpec, uuid: () => string = () => crypto.randomUUID()): TableDef {
  const name = spec.name.trim()
  const ref = `${quoteTable(name)}${quoteColumn(name)}`
  const column: ColumnDef = {
    name,
    dataType: spec.dataType,
    kind: 'calculatedTableColumn',
    sourceColumn: '[Value]',
    formatString: spec.dataType === 'int64' ? '0' : undefined,
    lineageTag: uuid(),
    summarizeBy: 'none',
    extendedProperties: { ParameterMetadata: { version: 0 } },
    annotations: { SummarizationSetBy: 'User' }
  }
  if (column.formatString === undefined) delete column.formatString
  const measure: MeasureDef = {
    name: `${name} Value`,
    expression: `SELECTEDVALUE(${ref}${spec.defaultValue !== undefined ? `, ${daxNumber(spec.defaultValue)}` : ''})`,
    lineageTag: uuid(),
    ...(spec.dataType === 'int64' ? { formatString: '0' } : {})
  }
  return {
    name,
    lineageTag: uuid(),
    columns: [column],
    measures: [measure],
    hierarchies: [],
    partitions: [{ name, mode: 'import', sourceType: 'calculated', expression: `GENERATESERIES(${daxNumber(spec.min)}, ${daxNumber(spec.max)}, ${daxNumber(spec.increment)})` }]
  }
}

export interface FieldParameterItem {
  /** label shown in the slicer (defaults to the field name) */
  label: string
  /** '' for an unqualified measure reference `NAMEOF([Measure])` (hand-written parameters) */
  table: string
  field: string
}

export function fieldParameterExpression(items: FieldParameterItem[]): string {
  const rows = items.map((it, i) => `    ("${it.label.replace(/"/g, '""')}", NAMEOF(${it.table ? quoteTable(it.table) : ''}${quoteColumn(it.field)}), ${i})`)
  return `{\n${rows.join(',\n')}\n}`
}

export function buildFieldParameter(name0: string, items: FieldParameterItem[], uuid: () => string = () => crypto.randomUUID()): TableDef {
  const name = name0.trim()
  const fields = `${name} Fields`
  const order = `${name} Order`
  return {
    name,
    lineageTag: uuid(),
    columns: [
      {
        name,
        dataType: 'string',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value1]',
        sortByColumn: order,
        lineageTag: uuid(),
        summarizeBy: 'none',
        annotations: { SummarizationSetBy: 'Automatic' },
        extra: { '@children': [{ keyword: 'relatedColumnDetails', children: [{ keyword: 'groupByColumn', sep: ':', value: quoteName(fields) }] }] }
      },
      {
        name: fields,
        dataType: 'string',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value2]',
        sortByColumn: order,
        isHidden: true,
        lineageTag: uuid(),
        summarizeBy: 'none',
        extendedProperties: { ParameterMetadata: { version: 3, kind: 2 } },
        annotations: { SummarizationSetBy: 'Automatic' }
      },
      {
        name: order,
        dataType: 'int64',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value3]',
        isHidden: true,
        formatString: '0',
        lineageTag: uuid(),
        summarizeBy: 'sum',
        annotations: { SummarizationSetBy: 'Automatic' }
      }
    ],
    measures: [],
    hierarchies: [],
    partitions: [{ name, mode: 'import', sourceType: 'calculated', expression: fieldParameterExpression(items) }]
  }
}

/** Parse the items back out of a field-parameter partition expression (for editing). */
export function parseFieldParameterExpression(expr: string): FieldParameterItem[] {
  const out: FieldParameterItem[] = []
  const re = /\(\s*"((?:[^"]|"")*)"\s*,\s*NAMEOF\s*\(\s*('(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*)?\s*\[((?:[^\]]|]])*)]\s*\)\s*,\s*-?\d+\s*(?:,[^)]*)?\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expr))) {
    const table = m[2] === undefined ? '' : m[2].startsWith("'") ? m[2].slice(1, -1).replace(/''/g, "'") : m[2]
    out.push({ label: m[1].replace(/""/g, '"'), table, field: m[3].replace(/]]/g, ']') })
  }
  return out
}

export function isFieldParameterTable(t: TableDef): boolean {
  return t.columns.some((c) => {
    const md = c.extendedProperties?.['ParameterMetadata']
    const obj = typeof md === 'string' ? safeJson(md) : md
    return !!obj && typeof obj === 'object' && (obj as { kind?: number }).kind === 2
  })
}

export function isWhatIfParameterTable(t: TableDef): boolean {
  return t.columns.some((c) => {
    const md = c.extendedProperties?.['ParameterMetadata']
    const obj = typeof md === 'string' ? safeJson(md) : md
    return !!obj && typeof obj === 'object' && (obj as { version?: number; kind?: number }).kind === undefined
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
