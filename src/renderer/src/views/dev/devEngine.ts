/**
 * DEV ONLY — minimal QueryEngine over the vendored DAX engine (src/core/dax) so the #/modeling-test
 * harness can exercise the DAX query view / formula bar validation while the real adapter
 * (src/core/engine/engine.ts, DAX workstream) is in progress. Not used by the app itself.
 */
import type { QueryEngine, DaxQueryResultTable, ExpressionDiagnostic } from '@core/engine/api'
import type { DataType, SemanticModel } from '@core/model/types'
import type { DataStore, Scalar } from '@core/model/data'
import { Model, runQuery, parseDax, DaxDate, DaxError, DaxSyntaxError, type DataType as DDataType } from '@core/dax'
import { fallbackFormat } from '../data/formatCell'

const toD = (t: DataType): DDataType => (t === 'int64' ? 'int' : t === 'double' || t === 'decimal' ? 'double' : t === 'dateTime' ? 'date' : t === 'boolean' ? 'boolean' : 'string')
const fromD = (t: DDataType): DataType => (t === 'int' ? 'int64' : t === 'double' ? 'double' : t === 'date' ? 'dateTime' : t === 'boolean' ? 'boolean' : 'string')

function offsetOf(text: string, line: number, col: number): number {
  const lines = text.split('\n')
  let off = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1
  return off + col - 1
}

export function createDevEngine(model: SemanticModel, data: DataStore): QueryEngine {
  const dm = new Model()
  const errors: Array<{ table: string; column?: string; error: string }> = []
  for (const t of model.tables) {
    const td = data.tables.get(t.name)
    const cols = t.columns.filter((c) => c.kind !== 'calculated' && c.kind !== 'rowNumber')
    const present = cols.filter((c) => td?.columns.some((x) => x.name === c.name))
    const rows: unknown[][] = []
    for (let r = 0; r < (td?.rowCount ?? 0); r++) rows.push(present.map((c) => {
      const v = td!.columns.find((x) => x.name === c.name)!.values[r]
      return v instanceof Date ? new Date(v.getTime()) : v
    }))
    try {
      dm.addTable(t.name, present.map((c) => ({ name: c.name, dataType: toD(c.dataType), formatString: c.formatString, isHidden: c.isHidden })), rows)
    } catch (e) {
      errors.push({ table: t.name, error: String(e) })
    }
  }
  for (const r of model.relationships) {
    if (r.toCardinality === 'many') continue
    try {
      dm.addRelationship({ id: r.name, fromColumn: { table: r.fromTable, column: r.fromColumn }, toColumn: { table: r.toTable, column: r.toColumn }, isActive: r.isActive, crossFilteringBehavior: r.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single', cardinality: r.fromCardinality === 'one' ? 'oneToOne' : 'manyToOne' })
    } catch (e) {
      errors.push({ table: r.fromTable, error: String(e) })
    }
  }
  for (const t of model.tables)
    for (const c of t.columns)
      if (c.kind === 'calculated' && c.expression?.trim())
        try {
          dm.addCalculatedColumn({ table: t.name, name: c.name, expression: c.expression })
        } catch (e) {
          errors.push({ table: t.name, column: c.name, error: String(e) })
        }
  for (const t of model.tables)
    for (const m of t.measures)
      if (m.expression.trim())
        try {
          dm.addMeasure({ name: m.name, table: t.name, expression: m.expression, formatString: m.formatString })
        } catch (e) {
          errors.push({ table: t.name, error: `${m.name}: ${String(e)}` })
        }
  const dt = model.tables.find((t) => t.dataCategory === 'Time')
  const key = dt?.columns.find((c) => c.isKey)
  if (dt && key)
    try {
      dm.markAsDateTable(dt.name, key.name)
    } catch {
      /* ignore */
    }

  const toScalar = (v: unknown): Scalar => {
    if (v instanceof DaxDate) return new Date(v.days * 86_400_000)
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return new Date(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v.endsWith('Z') ? v : `${v}Z`))
    return (v ?? null) as Scalar
  }

  const engine: QueryEngine = {
    model,
    data,
    summarize: () => ({ columns: [], rows: [], warnings: ['dev engine: summarize not implemented'] }),
    distinctValues: () => ({ values: [], dataType: 'unknown' }),
    evaluateScalar: (expression) => {
      const res = runQuery(dm, `EVALUATE { ${expression} }`)
      return { value: toScalar(res.results[0]?.rows[0]?.[0]) }
    },
    runDaxQuery(query) {
      const t0 = performance.now()
      const res = runQuery(dm, query)
      const tables: DaxQueryResultTable[] = res.results.map((rt) => ({
        columns: rt.columns.map((c) => ({ name: c.name, dataType: fromD(c.dataType) })),
        rows: rt.rows.map((row) => row.map((v, i) => (rt.columns[i].dataType === 'date' ? toScalar(v) : (v as Scalar))))
      }))
      return { tables, durationMs: performance.now() - t0 }
    },
    validateExpression(expression) {
      const out: ExpressionDiagnostic[] = []
      try {
        parseDax(expression)
      } catch (e) {
        if (e instanceof DaxSyntaxError) {
          const start = offsetOf(expression, e.line, e.col)
          out.push({ message: e.message.replace(/^Syntax error at \d+:\d+: /, ''), start, end: start + 1, severity: 'error' })
        } else if (e instanceof DaxError) out.push({ message: e.message, severity: 'error' })
      }
      return out
    },
    format: (v, fmt, type) => fallbackFormat(v, type, fmt),
    processCalculated: () => errors,
    invalidate: () => undefined,
    describeField: () => undefined,
    resolveFieldParameter: () => null
  }
  return engine
}
