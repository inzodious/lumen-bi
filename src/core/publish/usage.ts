/**
 * Which model columns a published dashboard needs.
 *
 * The rule errs toward keeping data: a column is left out only when nothing can reach it. A column is kept when
 *  - any string in the report JSON names it (visual projections, filters, sort definitions, bookmarks, field
 *    parameters, conditional formatting…), matched by name in every table, so aliases and query refs are covered;
 *  - any DAX text in the model names it in brackets (`'T'[Col]`, `T[Col]`, or a bare `[Col]` in row context, which
 *    keeps every column of that name);
 *  - any DAX text names its table without a column (`ALL(T)`, `DISTINCT(T)`, `COUNTROWS(T)`): the whole table stays,
 *    since removing columns would change the distinct rows of a table expression;
 *  - it joins a relationship, sorts a kept column, is a level of a kept hierarchy, or belongs to a calculation group,
 *    a field parameter or an auto date table.
 * Left-out columns keep their definition and every row, with blank values, so the schema the measures see is unchanged.
 */
import type { SemanticModel, TableDef } from '../model/types'
import type { ReportDocument } from '../report/types'

export interface ColumnUsage {
  /** lower-cased table name → lower-cased kept column names; a table missing here keeps all of its columns */
  kept: Map<string, Set<string>>
  /** tables kept whole (model names) */
  wholeTables: Set<string>
}

/** True when the published copy keeps the data of `table`[`column`]. */
export function isColumnKept(usage: ColumnUsage, table: string, column: string): boolean {
  const set = usage.kept.get(table.toLowerCase())
  return !set || set.has(column.toLowerCase())
}

/** Every DAX expression of the model (measures, calculated columns / tables, calc items, RLS, KPIs, functions). */
export function modelDaxTexts(model: SemanticModel): string[] {
  const out: string[] = []
  const add = (s: string | undefined) => {
    if (s && s.trim()) out.push(s)
  }
  for (const t of model.tables) {
    for (const m of t.measures) {
      add(m.expression)
      add(m.formatStringDefinition?.expression)
      add(m.detailRowsDefinition)
      add(m.kpi?.targetExpression)
      add(m.kpi?.statusExpression)
      add(m.kpi?.trendExpression)
    }
    for (const c of t.columns) if (c.kind === 'calculated') add(c.expression)
    for (const p of t.partitions) if (p.sourceType === 'calculated') add(p.expression)
    if (t.calculationGroup) {
      for (const i of t.calculationGroup.items) {
        add(i.expression)
        add(i.formatStringDefinition?.expression)
      }
      add(t.calculationGroup.noSelectionExpression)
      add(t.calculationGroup.multipleOrEmptySelectionExpression)
    }
  }
  for (const e of model.expressions) if (e.kind === 'dax') add(e.expression)
  for (const r of model.roles) for (const p of r.tablePermissions) add(p.filterExpression)
  for (const f of model.functions ?? []) add(f.expression)
  return out
}

/** Every string value in a JSON tree, plus the parts of dotted query refs (`Sales.Amount` → `Sales`, `Amount`). */
export function collectStrings(value: unknown, into = new Set<string>()): Set<string> {
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      into.add(v.toLowerCase())
      const dot = v.indexOf('.')
      if (dot > 0) {
        into.add(v.slice(0, dot).toLowerCase())
        into.add(v.slice(dot + 1).toLowerCase())
      }
      // DAX text inside visual calculations / field parameters
      if (v.includes('[')) for (const m of v.matchAll(/\[([^\]]+)\]/g)) into.add(m[1].toLowerCase())
    } else if (Array.isArray(v)) for (const x of v) walk(x)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      into.add(k.toLowerCase())
      walk(x)
    }
  }
  walk(value)
  return into
}

function reportStrings(report: ReportDocument | undefined): Set<string> {
  const out = new Set<string>()
  if (!report) return out
  collectStrings(report.report, out)
  collectStrings(report.pagesMeta, out)
  for (const p of report.pages) {
    collectStrings(p.json, out)
    for (const v of p.visuals) {
      collectStrings(v.json, out)
      collectStrings(v.mobile, out)
    }
  }
  for (const b of report.bookmarks) collectStrings(b.json, out)
  collectStrings(report.reportExtensions, out)
  return out
}

/** Report-level measures (reportExtensions.json) and visual calculations: every string that could be DAX. */
function reportDaxTexts(report: ReportDocument | undefined): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/[[(]/.test(v)) out.push(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(report?.reportExtensions)
  for (const p of report?.pages ?? []) for (const v of p.visuals) walk(v.json?.visual?.query)
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Bracketed names (`[Col]`) in DAX text, lower-cased; string literals and comments removed first. */
export function bracketNames(dax: string): Set<string> {
  const out = new Set<string>()
  for (const m of stripDaxNoise(dax).matchAll(/\[((?:[^\]]|\]\])+)\]/g)) out.add(m[1].replace(/\]\]/g, ']').toLowerCase())
  return out
}

/** DAX text without string literals and comments (table names inside them must not count). */
export function stripDaxNoise(dax: string): string {
  return dax
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"(?:[^"]|"")*"/g, '""')
}

/** True when `dax` names `table` as a table (not only as the prefix of a column reference). */
export function referencesWholeTable(dax: string, table: string): boolean {
  const text = stripDaxNoise(dax)
  const quoted = new RegExp(`'${escapeRe(table.replace(/'/g, "''"))}'(?!\\s*\\[)`, 'i')
  if (quoted.test(text)) return true
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return false
  // a bare name: not part of a longer identifier, not a function call, not a column prefix, not inside [..]
  const bare = new RegExp(`(?<![A-Za-z0-9_.'\\[])${escapeRe(table)}(?![A-Za-z0-9_])(?!\\s*[\\[(])`, 'i')
  const withoutBrackets = text.replace(/\[(?:[^\]]|\]\])+\]/g, '[]')
  return bare.test(withoutBrackets)
}

function isAlwaysWhole(t: TableDef): boolean {
  if (t.calculationGroup) return true
  if (/^(LocalDateTable_|DateTableTemplate_)/i.test(t.name)) return true
  // field parameters: a calculated table with NAMEOF references
  if (t.partitions.some((p) => p.sourceType === 'calculated' && /NAMEOF\s*\(/i.test(p.expression ?? ''))) return true
  if (t.columns.some((c) => c.extendedProperties && JSON.stringify(c.extendedProperties).includes('ParameterMetadata'))) return true
  return false
}

/** The columns a published copy of `report` over `model` needs (see the module comment for the rule). */
export function columnUsage(model: SemanticModel, report: ReportDocument | undefined): ColumnUsage {
  const strings = reportStrings(report)
  const dax = [...modelDaxTexts(model), ...reportDaxTexts(report)]
  const daxNames = new Set<string>()
  for (const d of dax) for (const n of bracketNames(d)) daxNames.add(n)
  const wholeTables = new Set<string>()
  const kept = new Map<string, Set<string>>()
  const keep = (table: string, column: string) => kept.get(table.toLowerCase())?.add(column.toLowerCase())
  for (const t of model.tables) {
    if (isAlwaysWhole(t) || dax.some((d) => referencesWholeTable(d, t.name))) {
      wholeTables.add(t.name)
      continue
    }
    const set = new Set<string>()
    kept.set(t.name.toLowerCase(), set)
    for (const c of t.columns) {
      const n = c.name.toLowerCase()
      if (strings.has(n) || daxNames.has(n) || c.isKey) set.add(n)
    }
    for (const h of t.hierarchies) {
      if (!strings.has(h.name.toLowerCase())) continue
      for (const l of h.levels) set.add(l.column.toLowerCase())
    }
  }
  for (const r of model.relationships) {
    keep(r.fromTable, r.fromColumn)
    keep(r.toTable, r.toColumn)
  }
  // sort-by columns of kept columns (a sorted axis reads them), repeated for chains
  for (let pass = 0; pass < 3; pass++)
    for (const t of model.tables) {
      const set = kept.get(t.name.toLowerCase())
      if (!set) continue
      for (const c of t.columns) if (set.has(c.name.toLowerCase()) && c.sortByColumn) set.add(c.sortByColumn.toLowerCase())
    }
  return { kept, wholeTables }
}
