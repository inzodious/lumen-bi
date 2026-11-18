/** Test helper: build a SemanticModel + DataStore from compact table specs. Neutral names only. */
import type { ColumnDef, DataType, MeasureDef, RelationshipDef, SemanticModel, TableDef } from '../../../model/types.ts'
import { tableFromRows, type DataStore, type Scalar } from '../../../model/data.ts'

export interface TableSpec {
  columns: Record<string, DataType | { type: DataType; expression?: string; sortBy?: string; formatString?: string; extendedProperties?: Record<string, unknown>; sourceColumn?: string; isKey?: boolean; variations?: ColumnDef['variations'] }>
  rows?: Scalar[][]
  measures?: Record<string, string | { expression: string; formatString?: string; formatStringDefinition?: string }>
  /** calculated table expression */
  expression?: string
  dataCategory?: string
  calculationGroup?: { precedence?: number; items: Array<{ name: string; expression: string; formatStringDefinition?: string }> }
  hierarchies?: Array<{ name: string; levels: Array<{ name: string; column: string }> }>
}

export interface ModelSpec {
  tables: Record<string, TableSpec>
  relationships?: Array<Partial<RelationshipDef> & { from: string; to: string }>
}

export function d(y: number, m: number, day: number, hh = 0, mm = 0, ss = 0): Date {
  return new Date(Date.UTC(y, m - 1, day, hh, mm, ss))
}

export function build(spec: ModelSpec): { model: SemanticModel; data: DataStore } {
  const tables: TableDef[] = []
  const data: DataStore = { tables: new Map(), status: new Map() }
  for (const [name, t] of Object.entries(spec.tables)) {
    const columns: ColumnDef[] = Object.entries(t.columns).map(([cn, c]) => {
      const o = typeof c === 'string' ? { type: c } : c
      return {
        name: cn,
        dataType: o.type,
        kind: o.expression !== undefined ? 'calculated' : t.expression || t.calculationGroup ? 'calculatedTableColumn' : 'data',
        expression: o.expression,
        sortByColumn: o.sortBy,
        formatString: o.formatString,
        extendedProperties: o.extendedProperties,
        sourceColumn: o.sourceColumn ?? cn,
        isKey: o.isKey,
        variations: o.variations
      }
    })
    const measures: MeasureDef[] = Object.entries(t.measures ?? {}).map(([mn, m]) =>
      typeof m === 'string'
        ? { name: mn, expression: m }
        : { name: mn, expression: m.expression, formatString: m.formatString, formatStringDefinition: m.formatStringDefinition ? { expression: m.formatStringDefinition } : undefined }
    )
    tables.push({
      name,
      columns,
      measures,
      hierarchies: (t.hierarchies ?? []).map((h) => ({ name: h.name, levels: h.levels.map((l, i) => ({ name: l.name, column: l.column, ordinal: i })) })),
      partitions: t.expression ? [{ name, sourceType: 'calculated', expression: t.expression }] : t.calculationGroup ? [{ name, sourceType: 'calculationGroup' }] : [{ name, sourceType: 'm', expression: '' }],
      dataCategory: t.dataCategory,
      calculationGroup: t.calculationGroup ? { precedence: t.calculationGroup.precedence, items: t.calculationGroup.items.map((i, k) => ({ name: i.name, expression: i.expression, ordinal: k, formatStringDefinition: i.formatStringDefinition ? { expression: i.formatStringDefinition } : undefined })) } : undefined
    })
    if (t.rows && !t.expression && !t.calculationGroup) {
      const dataCols = columns.filter((c) => c.kind === 'data')
      data.tables.set(name, tableFromRows(dataCols.map((c) => c.name), dataCols.map((c) => c.dataType), t.rows))
    }
  }
  const relationships: RelationshipDef[] = (spec.relationships ?? []).map((r, i) => {
    const [ft, fc] = r.from.split('.')
    const [tt, tc] = r.to.split('.')
    return {
      name: r.name ?? `r${i}`,
      fromTable: ft,
      fromColumn: fc,
      toTable: tt,
      toColumn: tc,
      fromCardinality: r.fromCardinality ?? 'many',
      toCardinality: r.toCardinality ?? 'one',
      crossFilteringBehavior: r.crossFilteringBehavior ?? 'oneDirection',
      isActive: r.isActive ?? true,
      joinOnDateBehavior: r.joinOnDateBehavior
    }
  })
  return { model: { name: 'Test', culture: 'en-US', tables, relationships, expressions: [], roles: [] }, data }
}
