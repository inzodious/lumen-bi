/**
 * Applied Steps "Edit Settings" (gear icon): which dialog edits a step, and parsers that read a
 * step formula back into the dialog's fields. Only formulas the dialogs themselves write (the
 * shapes Power Query generates) are recognised; anything else has no gear and is edited in the
 * formula bar, like Power Query does for hand-written steps.
 */
import { tokenize, type Token } from '@core/m/lexer.ts'
import type { PqDialog, RowsDialogKind } from '../pqDialogs'
import { PQ_TYPES, type PqType } from './mtext'
import { eachBody, parseCall, splitList, stepRef, textListLiteral, textLiteral } from './steps'
import { isEnterData } from './enterData'
import type { CondClause, CondOperator, GroupAgg, GroupOp, JoinKind, PivotAgg } from './transforms'
import type { FilterCondition, FilterOp } from './filters'

// ---------------------------------------------------------------------------------------------
// Small readers

/** `[Name]` / `[#"Na""me"]` → field name, or null. */
export function fieldName(text: string): string | null {
  const t = text.trim()
  const q = /^\[#"((?:[^"]|"")*)"\]$/.exec(t)
  if (q) return q[1]!.replace(/""/g, '"')
  const p = /^\[([^\]#"]+)\]$/.exec(t)
  return p ? p[1]!.trim() : null
}

/** Identifier text (`Sales` / `#"Sales (2)"`) → name, or null. */
export function identName(text: string): string | null {
  let tokens: Token[]
  try {
    tokens = tokenize(text.trim())
  } catch {
    return null
  }
  if (tokens.length !== 2) return null
  const t = tokens[0]!
  return t.kind === 'ident' || t.kind === 'quoted' ? t.value : null
}

/** Display text of a simple literal as typed in a dialog (`"a""b"` → `a"b`, `#date(2024,1,5)` → `1/5/2024`). */
export function literalText(text: string): string {
  const t = text.trim()
  const s = textLiteral(t)
  if (s !== null) return s
  const d = /^#date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t)
  if (d) return `${+d[2]!}/${+d[3]!}/${+d[1]!}`
  const dt = /^#datetime\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t)
  if (dt) return `${dt[1]}-${dt[2]!.padStart(2, '0')}-${dt[3]!.padStart(2, '0')} ${dt[4]!.padStart(2, '0')}:${dt[5]!.padStart(2, '0')}:${dt[6]!.padStart(2, '0')}`
  return t
}

/** `type text` / `Int64.Type` … → Data Type menu id. */
export function typeIdOf(text: string | undefined): PqType | undefined {
  if (!text) return undefined
  const t = text.trim().replace(/\s+/g, ' ')
  return PQ_TYPES.find((x) => x.m === t)?.id ?? (t === 'type any' ? 'any' : undefined)
}

function num(text: string | undefined): number | null {
  if (text === undefined) return null
  const n = Number(text.trim())
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------------------------
// Conditions (Filter Rows / Conditional Column)

const COMPARE: Record<string, CondOperator> = { '=': 'equals', '<>': 'notEquals', '>': 'greater', '>=': 'greaterOrEqual', '<': 'less', '<=': 'lessOrEqual' }
const TEXT_FNS: Record<string, CondOperator> = { 'Text.StartsWith': 'beginsWith', 'Text.EndsWith': 'endsWith', 'Text.Contains': 'contains' }
const NEGATED: Partial<Record<CondOperator, CondOperator>> = { beginsWith: 'notBeginsWith', endsWith: 'notEndsWith', contains: 'notContains' }

export interface ParsedCondition {
  column: string
  op: CondOperator
  /** M literal text of the value */
  value: string
}

/** Reads one condition written by `condExpr` / `conditionExpr`. */
export function parseCondition(text: string): ParsedCondition | null {
  let t = text.trim()
  while (t.startsWith('(') && t.endsWith(')') && balanced(t.slice(1, -1))) t = t.slice(1, -1).trim()
  let negate = false
  if (/^not\s+/.test(t)) {
    negate = true
    t = t.replace(/^not\s+/, '')
  }
  const call = parseCall(t)
  if (call && TEXT_FNS[call.callee] && call.args.length === 2) {
    const column = fieldName(call.args[0]!)
    if (!column) return null
    const op = TEXT_FNS[call.callee]!
    return { column, op: negate ? NEGATED[op]! : op, value: call.args[1]! }
  }
  if (negate) return null
  const m = /^(\[(?:#"(?:[^"]|"")*"|[^\]]*)\])\s*(<>|>=|<=|=|>|<)\s*([\s\S]+)$/.exec(t)
  if (!m) return null
  const column = fieldName(m[1]!)
  if (!column) return null
  return { column, op: COMPARE[m[2]!]!, value: m[3]!.trim() }
}

function balanced(s: string): boolean {
  let d = 0
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '"') inStr = !inStr
    if (inStr) continue
    if (c === '(') d++
    else if (c === ')' && --d < 0) return false
  }
  return d === 0
}

/** Splits `a and b` / `a or b` at top level (outside parentheses / strings). */
function splitTopLevel(text: string, word: 'and' | 'or'): string[] {
  const parts: string[] = []
  let d = 0
  let inStr = false
  let start = 0
  const re = new RegExp(`^\\s${word}\\s`)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') inStr = !inStr
    if (inStr) continue
    if (c === '(' || c === '[' || c === '{') d++
    else if (c === ')' || c === ']' || c === '}') d--
    else if (d === 0 && re.test(text.slice(i, i + word.length + 2))) {
      parts.push(text.slice(start, i).trim())
      i += word.length + 1
      start = i
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

const FILTER_OP: Record<CondOperator, FilterOp> = {
  equals: 'equals',
  notEquals: 'notEquals',
  greater: 'greater',
  greaterOrEqual: 'greaterOrEqual',
  less: 'less',
  lessOrEqual: 'lessOrEqual',
  beginsWith: 'beginsWith',
  notBeginsWith: 'notBeginsWith',
  endsWith: 'endsWith',
  notEndsWith: 'notEndsWith',
  contains: 'contains',
  notContains: 'notContains'
}

export interface ParsedFilterRows {
  column: string
  first: FilterCondition
  join?: 'and' | 'or'
  second?: FilterCondition
}

/** Filter Rows (basic): one or two conditions on one column. Values come back as dialog text. */
export function parseFilterRows(formula: string): ParsedFilterRows | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.SelectRows' || call.args.length !== 2) return null
  let body = eachBody(call.args[1]!)
  if (body === null) return null
  while (body.startsWith('(') && body.endsWith(')') && balanced(body.slice(1, -1))) body = body.slice(1, -1).trim()
  for (const join of ['and', 'or'] as const) {
    const parts = splitTopLevel(body, join)
    if (parts.length > 2) return null
    if (parts.length === 2) {
      const a = parseCondition(parts[0]!)
      const b = parseCondition(parts[1]!)
      if (!a || !b || a.column !== b.column) return null
      return { column: a.column, first: { op: FILTER_OP[a.op], value: literalText(a.value) }, join, second: { op: FILTER_OP[b.op], value: literalText(b.value) } }
    }
  }
  const c = parseCondition(body)
  if (!c) return null
  return { column: c.column, first: { op: FILTER_OP[c.op], value: literalText(c.value) } }
}

// ---------------------------------------------------------------------------------------------
// Add Column

export interface ParsedCustomColumn {
  name: string
  body: string
  type?: PqType
}

export function parseCustomColumn(formula: string): ParsedCustomColumn | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.AddColumn' || call.args.length < 3) return null
  const name = textLiteral(call.args[1]!)
  const body = eachBody(call.args[2]!)
  if (name === null || body === null) return null
  return { name, body, type: typeIdOf(call.args[3]) }
}

export interface ParsedConditional {
  name: string
  clauses: CondClause[]
  otherwise: string
}

/** `each if C1 then O1 else if C2 then O2 else E` with conditions written by `condExpr`. */
export function parseConditionalColumn(formula: string): ParsedConditional | null {
  const cc = parseCustomColumn(formula)
  if (!cc) return null
  let tokens: Token[]
  try {
    tokens = tokenize(cc.body)
  } catch {
    return null
  }
  if (tokens[0]?.kind !== 'keyword' || tokens[0].value !== 'if') return null
  // split at top-level if / then / else keywords
  const parts: Array<{ kw: string; text: string }> = []
  let depth = 0
  let kw = ''
  let start = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'op' && (t.value === '(' || t.value === '[' || t.value === '{')) depth++
    else if (t.kind === 'op' && (t.value === ')' || t.value === ']' || t.value === '}')) depth--
    else if ((t.kind === 'keyword' && depth === 0 && (t.value === 'if' || t.value === 'then' || t.value === 'else')) || t.kind === 'eof') {
      if (kw) parts.push({ kw, text: cc.body.slice(start, t.start).trim() })
      if (t.kind === 'eof') break
      // nested `if` inside a condition / output would be at depth 0 too: only accept the chain shape
      kw = t.value
      start = t.end
    }
  }
  const clauses: CondClause[] = []
  let otherwise = 'null'
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.kw === 'if') {
      const then = parts[i + 1]
      if (!then || then.kw !== 'then') return null
      const c = parseCondition(p.text)
      if (!c) return null
      clauses.push({ column: c.column, op: c.op, value: c.value, output: then.text })
      i++
    } else if (p.kw === 'else') {
      if (p.text === '' && parts[i + 1]?.kw === 'if') continue
      otherwise = p.text || 'null'
      if (i !== parts.length - 1) return null
    } else return null
  }
  return clauses.length ? { name: cc.name, clauses, otherwise } : null
}

export interface ParsedIndex {
  name: string
  start: number
  increment: number
}

export function parseIndexColumn(formula: string): ParsedIndex | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.AddIndexColumn') return null
  const name = textLiteral(call.args[1] ?? '') ?? 'Index'
  return { name, start: num(call.args[2]) ?? 0, increment: num(call.args[3]) ?? 1 }
}

// ---------------------------------------------------------------------------------------------
// Group By

const AGG_FN: Record<string, GroupOp> = { 'List.Sum': 'sum', 'List.Average': 'average', 'List.Median': 'median', 'List.Min': 'min', 'List.Max': 'max' }

export interface ParsedGroupBy {
  keys: string[]
  aggs: GroupAgg[]
}

export function parseGroupBy(formula: string): ParsedGroupBy | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.Group' || call.args.length < 3) return null
  const keys = textListLiteral(call.args[1]!) ?? (textLiteral(call.args[1]!) !== null ? [textLiteral(call.args[1]!)!] : null)
  const items = splitList(call.args[2]!)
  if (!keys || !items) return null
  // a single aggregation may be written without the outer list: {"Count", each …, type}
  const list = items.length && textLiteral(items[0]!) !== null ? [call.args[2]!] : items
  const aggs: GroupAgg[] = []
  for (const it of list) {
    const parts = splitList(it)
    if (!parts || parts.length < 2) return null
    const name = textLiteral(parts[0]!)
    const body = eachBody(parts[1]!)
    if (name === null || body === null) return null
    const b = body.replace(/\s+/g, '')
    if (b === 'Table.RowCount(_)') aggs.push({ name, op: 'count' })
    else if (b === 'Table.RowCount(Table.Distinct(_))') aggs.push({ name, op: 'countDistinct' })
    else if (b === '_') aggs.push({ name, op: 'all' })
    else {
      const c = parseCall(body)
      const op = c ? AGG_FN[c.callee] : undefined
      const column = c?.args.length === 1 ? fieldName(c.args[0]!) : null
      if (!op || !column) return null
      aggs.push({ name, op, column })
    }
  }
  return { keys, aggs }
}

// ---------------------------------------------------------------------------------------------
// Combine

export interface ParsedMerge {
  leftKeys: string[]
  other: string
  rightKeys: string[]
  newColumn: string
  kind: JoinKind
}

export function parseMerge(formula: string): ParsedMerge | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.NestedJoin' || call.args.length < 5) return null
  const leftKeys = textListLiteral(call.args[1]!) ?? (textLiteral(call.args[1]!) !== null ? [textLiteral(call.args[1]!)!] : null)
  const other = identName(call.args[2]!)
  const rightKeys = textListLiteral(call.args[3]!) ?? (textLiteral(call.args[3]!) !== null ? [textLiteral(call.args[3]!)!] : null)
  const newColumn = textLiteral(call.args[4]!)
  const kind = (/^JoinKind\.(\w+)$/.exec((call.args[5] ?? 'JoinKind.LeftOuter').trim())?.[1] ?? 'LeftOuter') as JoinKind
  if (!leftKeys || !other || !rightKeys || newColumn === null) return null
  return { leftKeys, other, rightKeys, newColumn, kind }
}

/** Table.Combine({Prev, Q1, Q2}) → ['Q1', 'Q2'] (the first item is the step's input). */
export function parseAppend(formula: string): string[] | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.Combine' || call.args.length !== 1) return null
  const items = splitList(call.args[0]!)
  if (!items || items.length < 2) return null
  const names = items.slice(1).map(identName)
  return names.every((n): n is string => n !== null) ? names : null
}

// ---------------------------------------------------------------------------------------------
// Split / Replace / Pivot / Rows

export type ParsedSplit =
  | { mode: 'delimiter'; column: string; delimiter: string; at: 'each' | 'left' | 'right'; count: number; quoteStyle: 'Csv' | 'None' }
  | { mode: 'positions'; column: string; length: number; repeat: 'left' | 'right' | 'repeat'; count: number }

export function parseSplit(formula: string): ParsedSplit | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.SplitColumn' || call.args.length < 3) return null
  const column = textLiteral(call.args[1]!)
  const splitter = parseCall(call.args[2]!)
  if (column === null || !splitter) return null
  const names = call.args[3] ? textListLiteral(call.args[3]) : null
  const count = names?.length ?? num(call.args[3]) ?? 2
  const quote = (a: string | undefined): 'Csv' | 'None' => (/QuoteStyle\.None/.test(a ?? '') ? 'None' : 'Csv')
  switch (splitter.callee) {
    case 'Splitter.SplitTextByDelimiter': {
      const d = textLiteral(splitter.args[0] ?? '')
      return d === null ? null : { mode: 'delimiter', column, delimiter: d, at: 'each', count, quoteStyle: quote(splitter.args[1]) }
    }
    case 'Splitter.SplitTextByEachDelimiter': {
      const ds = textListLiteral(splitter.args[0] ?? '')
      if (!ds?.length) return null
      return { mode: 'delimiter', column, delimiter: ds[0]!, at: splitter.args[2]?.trim() === 'true' ? 'right' : 'left', count: 2, quoteStyle: quote(splitter.args[1]) }
    }
    case 'Splitter.SplitTextByRepeatedLengths': {
      const n = num(splitter.args[0])
      return n === null ? null : { mode: 'positions', column, length: n, repeat: 'repeat', count }
    }
    case 'Splitter.SplitTextByPositions': {
      const pos = splitList(splitter.args[0] ?? '')
      const n = pos && pos.length === 2 ? num(pos[1]) : null
      return n === null ? null : { mode: 'positions', column, length: n, repeat: splitter.args[1]?.trim() === 'true' ? 'right' : 'left', count: 2 }
    }
  }
  return null
}

export interface ParsedReplace {
  columns: string[]
  find: string
  replace: string
  matchEntire: boolean
}

export function parseReplace(formula: string): ParsedReplace | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.ReplaceValue' || call.args.length < 5) return null
  const columns = textListLiteral(call.args[4]!)
  if (!columns) return null
  return { columns, find: literalText(call.args[1]!), replace: literalText(call.args[2]!), matchEntire: call.args[3]!.trim() === 'Replacer.ReplaceValue' && textLiteral(call.args[1]!) !== null }
}

export interface ParsedReplaceErrors {
  columns: string[]
  value: string
}

export function parseReplaceErrors(formula: string): ParsedReplaceErrors | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.ReplaceErrorValues' || call.args.length < 2) return null
  const items = splitList(call.args[1]!)
  if (!items?.length) return null
  const columns: string[] = []
  let value = ''
  for (const it of items) {
    const p = splitList(it)
    const c = p?.[0] !== undefined ? textLiteral(p[0]) : null
    if (!p || p.length !== 2 || c === null) return null
    columns.push(c)
    value = literalText(p[1]!)
  }
  return { columns, value }
}

const PIVOT_AGG: Record<string, PivotAgg> = {
  'List.Count': 'count',
  'eachList.Count(List.Distinct(_))': 'countDistinct',
  'List.Sum': 'sum',
  'List.Average': 'average',
  'List.Median': 'median',
  'List.Min': 'min',
  'List.Max': 'max'
}

export interface ParsedPivot {
  attribute: string
  value: string
  agg: PivotAgg
}

export function parsePivot(formula: string): ParsedPivot | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.Pivot' || call.args.length < 4) return null
  const attribute = textLiteral(call.args[2]!)
  const value = textLiteral(call.args[3]!)
  if (attribute === null || value === null) return null
  const agg = call.args[4] ? PIVOT_AGG[call.args[4].replace(/\s+/g, '')] : 'none'
  return agg ? { attribute, value, agg } : null
}

export interface ParsedRows {
  kind: RowsDialogKind
  /** dialog numbers in field order (1-based "first row" values like the dialogs show) */
  values: number[]
}

export function parseRows(formula: string): ParsedRows | null {
  const call = parseCall(formula)
  if (!call) return null
  const n = call.args.slice(1).map(num)
  if (n.some((x) => x === null)) return null
  const v = n as number[]
  switch (call.callee) {
    case 'Table.FirstN':
      return v.length === 1 ? { kind: 'keepTop', values: v } : null
    case 'Table.LastN':
      return v.length === 1 ? { kind: 'keepBottom', values: v } : null
    case 'Table.Range':
      return v.length === 2 ? { kind: 'keepRange', values: [v[0]! + 1, v[1]!] } : null
    case 'Table.Skip':
      return v.length === 1 ? { kind: 'removeTop', values: v } : null
    case 'Table.RemoveLastN':
      return v.length === 1 ? { kind: 'removeBottom', values: v } : null
    case 'Table.AlternateRows':
      return v.length === 3 ? { kind: 'removeAlternate', values: [v[0]! + 1, v[1]!, v[2]!] } : null
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Dialog choice

/** The settings dialog that edits a step (null = no gear; edit in the formula bar). */
export function stepSettingsDialog(step: string, formula: string): PqDialog | null {
  const f = formula.trim()
  if (isEnterData(f)) return { id: 'enterData', step }
  const call = parseCall(f)
  if (!call) return null
  switch (call.callee) {
    case 'Table.SelectRows': {
      const p = parseFilterRows(f)
      return p ? { id: 'filterRows', column: p.column, step } : null
    }
    case 'Table.Group':
      return parseGroupBy(f) ? { id: 'groupBy', step } : null
    case 'Table.AddColumn':
      if (parseConditionalColumn(f)) return { id: 'conditionalColumn', step }
      return parseCustomColumn(f) ? { id: 'customColumn', step } : null
    case 'Table.NestedJoin':
      return parseMerge(f) ? { id: 'merge', step } : null
    case 'Table.Combine':
      return parseAppend(f) ? { id: 'append', step } : null
    case 'Table.SplitColumn': {
      const p = parseSplit(f)
      return p ? { id: 'split', mode: p.mode, column: p.column, step } : null
    }
    case 'Table.ReplaceValue': {
      const p = parseReplace(f)
      return p ? { id: 'replace', columns: p.columns, step } : null
    }
    case 'Table.ReplaceErrorValues': {
      const p = parseReplaceErrors(f)
      return p ? { id: 'replace', columns: p.columns, errors: true, step } : null
    }
    case 'Table.Pivot': {
      const p = parsePivot(f)
      return p ? { id: 'pivot', column: p.attribute, step } : null
    }
    case 'Table.FirstN':
    case 'Table.LastN':
    case 'Table.Range':
    case 'Table.Skip':
    case 'Table.RemoveLastN':
    case 'Table.AlternateRows': {
      const p = parseRows(f)
      return p ? { id: 'rows', kind: p.kind, step } : null
    }
    case 'Table.AddIndexColumn':
      return parseIndexColumn(f) ? { id: 'indexColumn', step } : null
  }
  return null
}

/** Does the step get a gear icon in Applied Steps? */
export function hasStepSettings(formula: string): boolean {
  return stepSettingsDialog('', formula) !== null
}

// ---------------------------------------------------------------------------------------------
// Step descriptions (Step Properties): Power Query keeps them as `//` comment lines right above
// the step's binding in the query text.

function bindingLine(lines: string[], step: string): number {
  const ref = stepRef(step).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*${ref}\\s*=`)
  // bindings live after the first `let`
  const start = lines.findIndex((l) => /^\s*let\b/.test(l))
  for (let i = Math.max(0, start); i < lines.length; i++) if (re.test(start === i ? lines[i]!.replace(/^\s*let\b/, '') : lines[i]!)) return i
  return -1
}

/** The description of a step (the `//` comment lines directly above it), or ''. */
export function readStepDescription(source: string, step: string): string {
  const lines = source.split('\n')
  const at = bindingLine(lines, step)
  if (at < 0) return ''
  const out: string[] = []
  for (let i = at - 1; i >= 0 && /^\s*\/\/(.*)$/.test(lines[i]!); i--) out.unshift(/^\s*\/\/\s?(.*)$/.exec(lines[i]!)![1]!)
  return out.join('\n')
}

/** Replaces a step's description comment (empty removes it). Null when the step isn't found. */
export function writeStepDescription(source: string, step: string, description: string): string | null {
  const lines = source.split('\n')
  const at = bindingLine(lines, step)
  if (at < 0) return null
  let from = at
  while (from > 0 && /^\s*\/\/.*$/.test(lines[from - 1]!)) from--
  const indent = /^(\s*)/.exec(lines[at]!)![1]!
  const comment = description.trim() ? description.trim().split(/\r?\n/).map((l) => `${indent}// ${l}`.trimEnd()) : []
  return [...lines.slice(0, from), ...comment, ...lines.slice(at)].join('\n')
}
