/**
 * Rename refactor for the report (PBIR): when a table / column / measure / hierarchy is renamed in
 * the model, update every field reference in report.json, pages, visuals, bookmarks and report-level
 * measures (reportExtensions) — like Power BI Desktop does.
 *
 * Handles SQ expressions (`Column`/`Measure`/`Hierarchy` with `SourceRef.Entity` or a `Source` alias
 * declared in a sibling `From` list), `queryRef` / `metadata` / `queryName` strings
 * ("Sales.Amount", "Sum(Sales.Amount)", "Sales.Calendar.Year"), `nativeQueryRef`, and DAX in
 * report-level measures. Mutates the report passed in (use inside `mutateReport`).
 */
import type { ReportDocument } from '@core/report/types'
import { renameInExpression } from './modelOps'

export type RenameTarget =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; name: string }
  | { kind: 'measure'; table: string; name: string }
  | { kind: 'hierarchy'; table: string; name: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const eq = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** Rewrite a queryRef-like string. */
export function renameQueryRef(s: string, target: RenameTarget, newName: string): string {
  if (target.kind === 'table') return s.replace(new RegExp(`(^|\\()${esc(target.table)}\\.`, 'gi'), `$1${newName}.`)
  return s.replace(new RegExp(`(^|\\()(${esc(target.table)})\\.${esc(target.name)}(?=\\)|$|\\.)`, 'gi'), `$1$2.${newName}`)
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

function entityOf(expr: unknown, aliases: Map<string, string>): string | undefined {
  if (!isObj(expr) || !isObj(expr['SourceRef'])) return undefined
  const sr = expr['SourceRef'] as Json
  if (typeof sr['Entity'] === 'string') return sr['Entity'] as string
  if (typeof sr['Source'] === 'string') return aliases.get(sr['Source'] as string)
  return undefined
}

function walk(node: unknown, target: RenameTarget, newName: string, aliases: Map<string, string>): number {
  let changes = 0
  if (Array.isArray(node)) {
    for (const x of node) changes += walk(x, target, newName, aliases)
    return changes
  }
  if (!isObj(node)) return 0
  let scope = aliases
  if (Array.isArray(node['From'])) {
    scope = new Map(aliases)
    for (const f of node['From'] as unknown[]) {
      if (!isObj(f) || typeof f['Name'] !== 'string' || typeof f['Entity'] !== 'string') continue
      scope.set(f['Name'] as string, f['Entity'] as string)
      if (target.kind === 'table' && eq(f['Entity'], target.table)) {
        f['Entity'] = newName
        changes++
      }
    }
  }
  if (target.kind === 'table' && isObj(node['SourceRef']) && eq((node['SourceRef'] as Json)['Entity'], target.table)) {
    ;(node['SourceRef'] as Json)['Entity'] = newName
    changes++
  }
  if (target.kind !== 'table') {
    const key = target.kind === 'column' ? 'Column' : target.kind === 'measure' ? 'Measure' : 'Hierarchy'
    const prop = target.kind === 'hierarchy' ? 'Hierarchy' : 'Property'
    const ref = node[key]
    if (isObj(ref) && eq(ref[prop], target.name) && eq(entityOf(ref['Expression'], scope), target.table)) {
      ref[prop] = newName
      changes++
    }
  }
  let renamedRef = false
  for (const k of ['queryRef', 'metadata', 'queryName']) {
    const v = node[k]
    if (typeof v !== 'string') continue
    const next = renameQueryRef(v, target, newName)
    if (next !== v) {
      node[k] = next
      changes++
      renamedRef = true
    }
  }
  if (renamedRef && target.kind !== 'table' && eq(node['nativeQueryRef'], target.name)) {
    node['nativeQueryRef'] = newName
    changes++
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'From' && (isObj(v) || Array.isArray(v))) changes += walk(v, target, newName, scope)
  return changes
}

/** Apply a rename to every part of the report. Returns the number of references changed. */
export function renameInReport(report: ReportDocument, target: RenameTarget, newName: string): number {
  let n = 0
  const empty = new Map<string, string>()
  n += walk(report.report, target, newName, empty)
  for (const p of report.pages) {
    n += walk(p.json, target, newName, empty)
    for (const v of p.visuals) {
      n += walk(v.json, target, newName, empty)
      if (v.mobile) n += walk(v.mobile, target, newName, empty)
    }
  }
  for (const b of report.bookmarks) n += walk(b.json, target, newName, empty)
  // report-level measures: entity names + DAX
  const ext = report.reportExtensions as { entities?: Array<{ name?: string; measures?: Array<{ name?: string; expression?: string }> }> } | undefined
  for (const e of ext?.entities ?? []) {
    if (target.kind === 'table' && eq(e.name, target.table)) {
      e.name = newName
      n++
    }
    for (const m of e.measures ?? []) {
      if (target.kind === 'measure' && eq(m.name, target.name) && eq(e.name, target.table)) {
        m.name = newName
        n++
      }
      if (typeof m.expression === 'string' && target.kind !== 'hierarchy') {
        const next = renameInExpression(m.expression, target.kind === 'table' ? { kind: 'table', table: target.table } : target, newName)
        if (next !== m.expression) {
          m.expression = next
          n++
        }
      }
    }
  }
  return n
}
