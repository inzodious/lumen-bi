/**
 * M generation for every Power Query Editor ribbon / context-menu action (pure).
 *
 * Each function returns a `StepSpec`: Power Query's default step name (numbered on repeat by the
 * caller via `uniqueStepName`) and the formula as a function of the previous step's reference.
 * Function choice, argument order, spacing and type ascriptions follow what Power BI Desktop's
 * Power Query Editor writes, so queries edited here read like queries edited in Power BI.
 */
import { fieldRef, mIdent, mNumber, mText, mTextList, nullableTypeM, pqTypeM, pqTypeOf, rowTypeField, type PqType } from './mtext'
import { parseCall, splitList, textLiteral } from './steps'

export interface StepSpec {
  /** default step name ("Removed Columns") */
  name: string
  formula(prev: string): string
}

export interface ColInfo {
  name: string
  /** preview type text ('text', 'nullable number', 'Int64.Type', …) */
  type: string
}

const spec = (name: string, formula: (prev: string) => string): StepSpec => ({ name, formula })

// ---------------------------------------------------------------------------------------------
// Columns

export const removeColumns = (cols: string[]): StepSpec => spec('Removed Columns', (p) => `Table.RemoveColumns(${p},${mTextList(cols)})`)

/** Choose Columns / Remove Other Columns */
export const removeOtherColumns = (cols: string[]): StepSpec => spec('Removed Other Columns', (p) => `Table.SelectColumns(${p},${mTextList(cols)})`)

export const changeType = (cols: Array<{ name: string; type: PqType }>): StepSpec =>
  spec('Changed Type', (p) => `Table.TransformColumnTypes(${p},{${cols.map((c) => `{${mText(c.name)}, ${pqTypeM(c.type)}}`).join(', ')}})`)

/**
 * "Replace current" of Power Query's Change Column Type prompt: rewrites an existing
 * `Table.TransformColumnTypes(prev, {{"A", type text}, …})` formula so the given columns get the new
 * type (replacing their entry, appending the others). Null when the formula isn't such a step.
 */
export function mergeChangeType(formula: string, cols: Array<{ name: string; type: PqType }>): string | null {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.TransformColumnTypes' || call.args.length < 2) return null
  const items = splitList(call.args[1]!)
  if (!items) return null
  const pairs: Array<[string, string]> = []
  for (const it of items) {
    const kv = splitList(it)
    const name = kv && kv.length === 2 ? textLiteral(kv[0]!) : null
    if (!kv || name === null) return null
    pairs.push([name, kv[1]!])
  }
  for (const c of cols) {
    const i = pairs.findIndex(([n]) => n === c.name)
    if (i >= 0) pairs[i] = [c.name, pqTypeM(c.type)]
    else pairs.push([c.name, pqTypeM(c.type)])
  }
  const rest = call.args.slice(2).map((a) => `, ${a}`).join('')
  return `Table.TransformColumnTypes(${call.args[0]},{${pairs.map(([n, t]) => `{${mText(n)}, ${t}}`).join(', ')}}${rest})`
}

/** Columns whose type an existing Changed Type formula sets (empty when it isn't one). */
export function changeTypeColumns(formula: string): string[] {
  const call = parseCall(formula)
  if (!call || call.callee !== 'Table.TransformColumnTypes' || call.args.length < 2) return []
  return (splitList(call.args[1]!) ?? []).map((it) => {
    const kv = splitList(it)
    return (kv && textLiteral(kv[0] ?? '')) ?? ''
  })
}

export const renameColumns = (pairs: Array<[string, string]>): StepSpec => spec('Renamed Columns', (p) => `Table.RenameColumns(${p},{${pairs.map(([a, b]) => `{${mText(a)}, ${mText(b)}}`).join(', ')}})`)

export const duplicateColumn = (col: string, existing: string[] = []): StepSpec => {
  let name = `${col} - Copy`
  for (let n = 1; existing.includes(name); n++) name = `${col} - Copy.${n}`
  return spec('Duplicated Column', (p) => `Table.DuplicateColumn(${p}, ${mText(col)}, ${mText(name)})`)
}

export const reorderColumns = (order: string[]): StepSpec => spec('Reordered Columns', (p) => `Table.ReorderColumns(${p},${mTextList(order)})`)

export type MoveKind = 'left' | 'right' | 'beginning' | 'end'

/** New column order after Transform ▸ Move (selected columns keep their relative order). */
export function movedOrder(all: string[], selected: string[], kind: MoveKind): string[] {
  const sel = all.filter((c) => selected.includes(c))
  const rest = all.filter((c) => !selected.includes(c))
  if (kind === 'beginning') return [...sel, ...rest]
  if (kind === 'end') return [...rest, ...sel]
  const out = [...all]
  if (kind === 'left') {
    for (let i = 1; i < out.length; i++) if (selected.includes(out[i]!) && !selected.includes(out[i - 1]!)) [out[i - 1], out[i]] = [out[i]!, out[i - 1]!]
  } else {
    for (let i = out.length - 2; i >= 0; i--) if (selected.includes(out[i]!) && !selected.includes(out[i + 1]!)) [out[i + 1], out[i]] = [out[i]!, out[i + 1]!]
  }
  return out
}

export const mergeColumns = (cols: string[], separator: string, newName = 'Merged'): StepSpec =>
  spec('Merged Columns', (p) => `Table.CombineColumns(${p},${mTextList(cols)},Combiner.CombineTextByDelimiter(${mText(separator)}, QuoteStyle.None),${mText(newName)})`)

export const insertMergedColumn = (cols: string[], separator: string, newName = 'Merged'): StepSpec =>
  spec('Inserted Merged Column', (p) => `Table.AddColumn(${p}, ${mText(newName)}, each Text.Combine({${cols.map(fieldRef).join(', ')}}, ${mText(separator)}), type text)`)

// ---------------------------------------------------------------------------------------------
// Rows

export const sortRows = (keys: Array<{ col: string; desc: boolean }>): StepSpec =>
  spec('Sorted Rows', (p) => `Table.Sort(${p},{${keys.map((k) => `{${mText(k.col)}, Order.${k.desc ? 'Descending' : 'Ascending'}}`).join(', ')}})`)

export const removeDuplicates = (cols: string[]): StepSpec => spec('Removed Duplicates', (p) => (cols.length ? `Table.Distinct(${p}, ${mTextList(cols)})` : `Table.Distinct(${p})`))

export const keepFirstRows = (n: number): StepSpec => spec('Kept First Rows', (p) => `Table.FirstN(${p},${n})`)
export const keepLastRows = (n: number): StepSpec => spec('Kept Last Rows', (p) => `Table.LastN(${p}, ${n})`)
/** `first` is the 1-based first row as typed in the dialog */
export const keepRange = (first: number, count: number): StepSpec => spec('Kept Range of Rows', (p) => `Table.Range(${p},${first - 1},${count})`)
export const removeTopRows = (n: number): StepSpec => spec('Removed Top Rows', (p) => `Table.Skip(${p},${n})`)
export const removeBottomRows = (n: number): StepSpec => spec('Removed Bottom Rows', (p) => `Table.RemoveLastN(${p},${n})`)
/** first row to remove (1-based), rows to remove, rows to keep */
export const removeAlternateRows = (first: number, remove: number, keep: number): StepSpec => spec('Removed Alternate Rows', (p) => `Table.AlternateRows(${p},${first - 1},${remove},${keep})`)

export const removeBlankRows = (): StepSpec => spec('Removed Blank Rows', (p) => `Table.SelectRows(${p}, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null})))`)

/** Keep Duplicates (as Power Query writes it: group, keep counts > 1, join back). */
export const keepDuplicates = (cols: string[]): StepSpec =>
  spec(
    'Kept Duplicates',
    (p) =>
      `let columnNames = ${mTextList(cols)}, addCount = Table.Group(${p}, columnNames, {{"Count", Table.RowCount, type number}}), selectDuplicates = Table.SelectRows(addCount, each [Count] > 1), removeCount = Table.RemoveColumns(selectDuplicates, "Count") in Table.Join(${p}, columnNames, removeCount, columnNames, JoinKind.Inner)`
  )

export const removeErrors = (cols: string[]): StepSpec => spec('Removed Errors', (p) => `Table.RemoveRowsWithErrors(${p}, ${mTextList(cols)})`)
export const keepErrors = (cols: string[]): StepSpec => spec('Kept Errors', (p) => `Table.SelectRowsWithErrors(${p}, ${mTextList(cols)})`)

export const replaceErrors = (cols: string[], value: string): StepSpec => spec('Replaced Errors', (p) => `Table.ReplaceErrorValues(${p}, {${cols.map((c) => `{${mText(c)}, ${value}}`).join(', ')}})`)

export const reverseRows = (): StepSpec => spec('Reversed Rows', (p) => `Table.ReverseRows(${p})`)
export const countRows = (): StepSpec => spec('Counted Rows', (p) => `Table.RowCount(${p})`)
export const transpose = (): StepSpec => spec('Transposed Table', (p) => `Table.Transpose(${p})`)
export const promoteHeaders = (): StepSpec => spec('Promoted Headers', (p) => `Table.PromoteHeaders(${p}, [PromoteAllScalars=true])`)
export const demoteHeaders = (): StepSpec => spec('Demoted Headers', (p) => `Table.DemoteHeaders(${p})`)
export const fillDown = (cols: string[]): StepSpec => spec('Filled Down', (p) => `Table.FillDown(${p},${mTextList(cols)})`)
export const fillUp = (cols: string[]): StepSpec => spec('Filled Up', (p) => `Table.FillUp(${p},${mTextList(cols)})`)

// ---------------------------------------------------------------------------------------------
// Replace values

/** The literal Replace Values writes for a value typed in the dialog, per column type. */
export function replaceLiteral(value: string, colType: string): string {
  const k = pqTypeOf(colType)
  const v = value.trim()
  if (k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage') {
    if (v === '') return 'null'
    const n = Number(v)
    return Number.isFinite(n) ? mNumber(n) : mText(value)
  }
  if (k === 'logical' && /^(true|false)$/i.test(v)) return v.toLowerCase()
  if (k === 'date' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
    const [m, d, y] = v.split('/').map(Number)
    return `#date(${y}, ${m}, ${d})`
  }
  if (v === 'null') return 'null'
  return mText(value)
}

/**
 * Replace Values: text columns replace substrings (`Replacer.ReplaceText`) unless "Match entire cell
 * contents" is checked; other columns replace whole values (`Replacer.ReplaceValue`).
 */
export function replaceValues(cols: ColInfo[], find: string, replace: string, matchEntire = false): StepSpec {
  const allText = cols.every((c) => pqTypeOf(c.type) === 'text' || pqTypeOf(c.type) === 'any')
  const type = cols[0]?.type ?? 'text'
  const findLit = allText ? mText(find) : replaceLiteral(find, type)
  const replLit = allText ? mText(replace) : replaceLiteral(replace, type)
  const replacer = allText && !matchEntire ? 'Replacer.ReplaceText' : 'Replacer.ReplaceValue'
  return spec('Replaced Value', (p) => `Table.ReplaceValue(${p},${findLit},${replLit},${replacer},${mTextList(cols.map((c) => c.name))})`)
}

// ---------------------------------------------------------------------------------------------
// Split column

export type SplitAt = 'each' | 'left' | 'right'

/** `Name.1`, `Name.2`, … */
export function splitColumnNames(col: string, count: number): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => `${col}.${i + 1}`)
}

export function splitByDelimiter(col: string, delimiter: string, at: SplitAt, count: number, quoteStyle: 'Csv' | 'None' = 'Csv'): StepSpec {
  const splitter =
    at === 'each'
      ? `Splitter.SplitTextByDelimiter(${mText(delimiter)}, QuoteStyle.${quoteStyle})`
      : `Splitter.SplitTextByEachDelimiter({${mText(delimiter)}}, QuoteStyle.${quoteStyle}, ${at === 'right' ? 'true' : 'false'})`
  const names = splitColumnNames(col, at === 'each' ? count : 2)
  return spec('Split Column by Delimiter', (p) => `Table.SplitColumn(${p}, ${mText(col)}, ${splitter}, ${mTextList(names)})`)
}

/** Number of columns a delimiter split produces on the preview values (PQ samples the preview). */
export function splitCount(values: unknown[], delimiter: string): number {
  let max = 1
  if (!delimiter) return 1
  for (const v of values) if (typeof v === 'string') max = Math.max(max, v.split(delimiter).length)
  return max
}

export function splitByPositions(col: string, length: number, count: number): StepSpec {
  const names = splitColumnNames(col, count)
  return spec('Split Column by Position', (p) => `Table.SplitColumn(${p}, ${mText(col)}, Splitter.SplitTextByRepeatedLengths(${length}), ${mTextList(names)})`)
}

// ---------------------------------------------------------------------------------------------
// Group By

export type GroupOp = 'count' | 'countDistinct' | 'sum' | 'average' | 'median' | 'min' | 'max' | 'all'

export const GROUP_OPS: Array<{ id: GroupOp; label: string; needsColumn: boolean }> = [
  { id: 'sum', label: 'Sum', needsColumn: true },
  { id: 'average', label: 'Average', needsColumn: true },
  { id: 'median', label: 'Median', needsColumn: true },
  { id: 'min', label: 'Min', needsColumn: true },
  { id: 'max', label: 'Max', needsColumn: true },
  { id: 'count', label: 'Count Rows', needsColumn: false },
  { id: 'countDistinct', label: 'Count Distinct Rows', needsColumn: false },
  { id: 'all', label: 'All Rows', needsColumn: false }
]

export interface GroupAgg {
  name: string
  op: GroupOp
  column?: string
}

/** One aggregation of a Group By step, as PQ writes it (`{"Total", each List.Sum([Amount]), type nullable number}`). */
export function groupAggregation(a: GroupAgg, columns: ColInfo[]): string {
  const col = columns.find((c) => c.name === a.column)
  const ref = a.column ? fieldRef(a.column) : ''
  switch (a.op) {
    case 'count':
      return `{${mText(a.name)}, each Table.RowCount(_), Int64.Type}`
    case 'countDistinct':
      return `{${mText(a.name)}, each Table.RowCount(Table.Distinct(_)), Int64.Type}`
    case 'sum':
      return `{${mText(a.name)}, each List.Sum(${ref}), ${numericAggType(col)}}`
    case 'average':
      return `{${mText(a.name)}, each List.Average(${ref}), type nullable number}`
    case 'median':
      return `{${mText(a.name)}, each List.Median(${ref}), ${numericAggType(col)}}`
    case 'min':
      return `{${mText(a.name)}, each List.Min(${ref}), ${col ? nullableTypeM(col.type).replace(/^Int64\.Type$/, 'type nullable number') : 'type any'}}`
    case 'max':
      return `{${mText(a.name)}, each List.Max(${ref}), ${col ? nullableTypeM(col.type).replace(/^Int64\.Type$/, 'type nullable number') : 'type any'}}`
    case 'all':
      return `{${mText(a.name)}, each _, type table [${columns.map((c) => rowTypeField(c.name, c.type)).join(', ')}]}`
  }
}

function numericAggType(col: ColInfo | undefined): string {
  const k = col ? pqTypeOf(col.type) : 'number'
  if (k === 'currency') return 'type nullable number'
  return 'type nullable number'
}

export const groupBy = (keys: string[], aggs: GroupAgg[], columns: ColInfo[]): StepSpec =>
  spec('Grouped Rows', (p) => `Table.Group(${p}, ${mTextList(keys)}, {${aggs.map((a) => groupAggregation(a, columns)).join(', ')}})`)

// ---------------------------------------------------------------------------------------------
// Combine

export type JoinKind = 'LeftOuter' | 'RightOuter' | 'FullOuter' | 'Inner' | 'LeftAnti' | 'RightAnti'

export const JOIN_KINDS: Array<{ id: JoinKind; label: string }> = [
  { id: 'LeftOuter', label: 'Left Outer (all from first, matching from second)' },
  { id: 'RightOuter', label: 'Right Outer (all from second, matching from first)' },
  { id: 'FullOuter', label: 'Full Outer (all rows from both)' },
  { id: 'Inner', label: 'Inner (only matching rows)' },
  { id: 'LeftAnti', label: 'Left Anti (rows only in first)' },
  { id: 'RightAnti', label: 'Right Anti (rows only in second)' }
]

/** Merge Queries: the new nested column is named after the second query (made unique). */
export function mergeQueries(leftKeys: string[], other: string, rightKeys: string[], kind: JoinKind, existing: string[] = []): StepSpec {
  let col = other
  for (let n = 1; existing.includes(col); n++) col = `${other}.${n}`
  return spec('Merged Queries', (p) => `Table.NestedJoin(${p}, ${mTextList(leftKeys)}, ${mIdent(other)}, ${mTextList(rightKeys)}, ${mText(col)}, JoinKind.${kind})`)
}

export const appendQueries = (others: string[]): StepSpec => spec('Appended Query', (p) => `Table.Combine({${[p, ...others.map(mIdent)].join(', ')}})`)

/** Expand a nested table / record column (header expand button). */
export function expandColumn(col: string, fields: string[], kind: 'table' | 'record', usePrefix = true): StepSpec {
  const fn = kind === 'record' ? 'Table.ExpandRecordColumn' : 'Table.ExpandTableColumn'
  const names = fields.map((f) => (usePrefix ? `${col}.${f}` : f))
  return spec(`Expanded ${col}`, (p) => `${fn}(${p}, ${mText(col)}, ${mTextList(fields)}, ${mTextList(names)})`)
}

/** List column ▸ Expand to New Rows (one row per list item; empty lists keep a row with null). */
export const expandListColumn = (col: string): StepSpec => spec(`Expanded ${col}`, (p) => `Table.ExpandListColumn(${p}, ${mText(col)})`)

/** List column ▸ Extract Values…: the items joined into text with a delimiter. */
export const extractListValues = (col: string, delimiter: string): StepSpec =>
  spec(`Extracted Values`, (p) => `Table.TransformColumns(${p}, {${mText(col)}, each Text.Combine(List.Transform(_, Text.From), ${mText(delimiter)}), type text})`)

// ---------------------------------------------------------------------------------------------
// Pivot / unpivot

export type PivotAgg = 'none' | 'count' | 'countDistinct' | 'sum' | 'average' | 'median' | 'min' | 'max'

const PIVOT_FN: Record<Exclude<PivotAgg, 'none'>, string> = {
  count: 'List.Count',
  countDistinct: 'each List.Count(List.Distinct(_))',
  sum: 'List.Sum',
  average: 'List.Average',
  median: 'List.Median',
  min: 'List.Min',
  max: 'List.Max'
}

export const pivotColumn = (attribute: string, value: string, agg: PivotAgg = 'sum'): StepSpec =>
  spec('Pivoted Column', (p) => `Table.Pivot(${p}, List.Distinct(${p}${fieldRef(attribute)}), ${mText(attribute)}, ${mText(value)}${agg === 'none' ? '' : `, ${PIVOT_FN[agg]}`})`)

/** Unpivot Columns (PQ writes it as UnpivotOtherColumns of the columns *not* selected). */
export const unpivotColumns = (selected: string[], all: string[]): StepSpec =>
  spec('Unpivoted Columns', (p) => `Table.UnpivotOtherColumns(${p}, ${mTextList(all.filter((c) => !selected.includes(c)))}, "Attribute", "Value")`)

export const unpivotOtherColumns = (selected: string[]): StepSpec => spec('Unpivoted Other Columns', (p) => `Table.UnpivotOtherColumns(${p}, ${mTextList(selected)}, "Attribute", "Value")`)

export const unpivotOnlySelected = (selected: string[]): StepSpec => spec('Unpivoted Only Selected Columns', (p) => `Table.Unpivot(${p}, ${mTextList(selected)}, "Attribute", "Value")`)

// ---------------------------------------------------------------------------------------------
// Add column

export const addCustomColumn = (name: string, body: string, type?: PqType): StepSpec =>
  spec('Added Custom', (p) => `Table.AddColumn(${p}, ${mText(name)}, each ${body.trim()}${type ? `, ${pqTypeM(type)}` : ''})`)

export type CondOperator = 'equals' | 'notEquals' | 'greater' | 'greaterOrEqual' | 'less' | 'lessOrEqual' | 'beginsWith' | 'notBeginsWith' | 'endsWith' | 'notEndsWith' | 'contains' | 'notContains'

export interface CondClause {
  column: string
  op: CondOperator
  /** literal M (already quoted) or a column reference `[Col]` */
  value: string
  output: string
}

export function condExpr(column: string, op: CondOperator, value: string): string {
  const c = fieldRef(column)
  switch (op) {
    case 'equals':
      return `${c} = ${value}`
    case 'notEquals':
      return `${c} <> ${value}`
    case 'greater':
      return `${c} > ${value}`
    case 'greaterOrEqual':
      return `${c} >= ${value}`
    case 'less':
      return `${c} < ${value}`
    case 'lessOrEqual':
      return `${c} <= ${value}`
    case 'beginsWith':
      return `Text.StartsWith(${c}, ${value})`
    case 'notBeginsWith':
      return `not Text.StartsWith(${c}, ${value})`
    case 'endsWith':
      return `Text.EndsWith(${c}, ${value})`
    case 'notEndsWith':
      return `not Text.EndsWith(${c}, ${value})`
    case 'contains':
      return `Text.Contains(${c}, ${value})`
    case 'notContains':
      return `not Text.Contains(${c}, ${value})`
  }
}

/** Conditional Column: `each if [A] = "x" then "y" else if … else null` */
export const addConditionalColumn = (name: string, clauses: CondClause[], otherwise: string): StepSpec =>
  spec('Added Conditional Column', (p) => {
    const body = clauses.map((c) => `if ${condExpr(c.column, c.op, c.value)} then ${c.output}`).join(' else ')
    return `Table.AddColumn(${p}, ${mText(name)}, each ${body} else ${otherwise || 'null'})`
  })

export const addIndexColumn = (start: number, increment = 1, name = 'Index'): StepSpec => spec('Added Index', (p) => `Table.AddIndexColumn(${p}, ${mText(name)}, ${start}, ${increment}, Int64.Type)`)

// ---------------------------------------------------------------------------------------------
// Text / number / date column operations (Transform = in place, Add Column = new column)

export type ColumnOp =
  // text format
  | 'lower'
  | 'upper'
  | 'proper'
  | 'trim'
  | 'clean'
  | 'prefix'
  | 'suffix'
  // text extract
  | 'length'
  | 'first'
  | 'last'
  | 'range'
  | 'beforeDelimiter'
  | 'afterDelimiter'
  | 'betweenDelimiters'
  // number standard
  | 'add'
  | 'multiply'
  | 'subtract'
  | 'divide'
  | 'integerDivide'
  | 'modulo'
  // number rounding / scientific / information
  | 'roundUp'
  | 'roundDown'
  | 'round'
  | 'abs'
  | 'sqrt'
  | 'power'
  | 'isEven'
  | 'isOdd'
  | 'sign'
  // date
  | 'dateOnly'
  | 'age'
  | 'year'
  | 'startOfYear'
  | 'endOfYear'
  | 'month'
  | 'startOfMonth'
  | 'endOfMonth'
  | 'daysInMonth'
  | 'monthName'
  | 'quarter'
  | 'startOfQuarter'
  | 'endOfQuarter'
  | 'weekOfYear'
  | 'weekOfMonth'
  | 'day'
  | 'dayOfWeek'
  | 'dayOfYear'
  | 'dayName'
  // time
  | 'timeOnly'
  | 'hour'
  | 'minute'
  | 'second'
  // duration
  | 'days'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'totalYears'
  | 'totalDays'
  | 'totalHours'

interface OpDef {
  /** in-place step name */
  transform: string
  /** add-column step name + default new column name */
  insert: string
  column: string
  /** a library function applied to the value (`Text.Upper`) … */
  named?: string
  /** … or an expression of the value `s` (`Text.Start(s, 3)`), written as `each …(_)` in place */
  fn?(s: string, arg: string, arg2: string): string
  /** result type ascription; null = keep the column's type */
  type: string | null
  /** prefers the `each … (_)` form inside TransformColumns (PQ writes a space after the step there) */
  spaced?: boolean
}

const OPS: Record<ColumnOp, OpDef> = {
  lower: { transform: 'Lowercased Text', insert: 'Inserted Lowercased Text', column: 'lowercase', named: 'Text.Lower', type: 'type text' },
  upper: { transform: 'Uppercased Text', insert: 'Inserted Uppercased Text', column: 'UPPERCASE', named: 'Text.Upper', type: 'type text' },
  proper: { transform: 'Capitalized Each Word', insert: 'Inserted Capitalized Each Word', column: 'Capitalize Each Word', named: 'Text.Proper', type: 'type text' },
  trim: { transform: 'Trimmed Text', insert: 'Inserted Trimmed Text', column: 'Trim', named: 'Text.Trim', type: 'type text' },
  clean: { transform: 'Cleaned Text', insert: 'Inserted Cleaned Text', column: 'Clean', named: 'Text.Clean', type: 'type text' },
  prefix: { transform: 'Added Prefix', insert: 'Inserted Prefix', column: 'Prefix', fn: (s, a) => `${mText(a)} & ${s}`, type: 'type text', spaced: true },
  suffix: { transform: 'Added Suffix', insert: 'Inserted Suffix', column: 'Suffix', fn: (s, a) => `${s} & ${mText(a)}`, type: 'type text', spaced: true },
  length: { transform: 'Calculated Text Length', insert: 'Inserted Text Length', column: 'Length', named: 'Text.Length', type: 'Int64.Type' },
  first: { transform: 'Extracted First Characters', insert: 'Inserted First Characters', column: 'First Characters', fn: (s, a) => `Text.Start(${s}, ${a})`, type: 'type text', spaced: true },
  last: { transform: 'Extracted Last Characters', insert: 'Inserted Last Characters', column: 'Last Characters', fn: (s, a) => `Text.End(${s}, ${a})`, type: 'type text', spaced: true },
  range: { transform: 'Extracted Text Range', insert: 'Inserted Text Range', column: 'Text Range', fn: (s, a, b) => `Text.Middle(${s}, ${a}, ${b})`, type: 'type text', spaced: true },
  beforeDelimiter: { transform: 'Extracted Text Before Delimiter', insert: 'Inserted Text Before Delimiter', column: 'Text Before Delimiter', fn: (s, a) => `Text.BeforeDelimiter(${s}, ${mText(a)})`, type: 'type text', spaced: true },
  afterDelimiter: { transform: 'Extracted Text After Delimiter', insert: 'Inserted Text After Delimiter', column: 'Text After Delimiter', fn: (s, a) => `Text.AfterDelimiter(${s}, ${mText(a)})`, type: 'type text', spaced: true },
  betweenDelimiters: { transform: 'Extracted Text Between Delimiters', insert: 'Inserted Text Between Delimiters', column: 'Text Between Delimiters', fn: (s, a, b) => `Text.BetweenDelimiters(${s}, ${mText(a)}, ${mText(b)})`, type: 'type text', spaced: true },
  add: { transform: 'Added to Column', insert: 'Inserted Addition', column: 'Addition', fn: (s, a) => `${s} + ${a}`, type: null, spaced: true },
  multiply: { transform: 'Multiplied Column', insert: 'Inserted Multiplication', column: 'Multiplication', fn: (s, a) => `${s} * ${a}`, type: null, spaced: true },
  subtract: { transform: 'Subtracted from Column', insert: 'Inserted Subtraction', column: 'Subtraction', fn: (s, a) => `${s} - ${a}`, type: null, spaced: true },
  divide: { transform: 'Divided Column', insert: 'Inserted Division', column: 'Division', fn: (s, a) => `${s} / ${a}`, type: 'type number', spaced: true },
  integerDivide: { transform: 'Integer-Divided Column', insert: 'Inserted Integer-Division', column: 'Integer-Division', fn: (s, a) => `Number.IntegerDivide(${s}, ${a})`, type: 'Int64.Type', spaced: true },
  modulo: { transform: 'Calculated Modulo', insert: 'Inserted Modulo', column: 'Modulo', fn: (s, a) => `Number.Mod(${s}, ${a})`, type: null, spaced: true },
  roundUp: { transform: 'Rounded Up', insert: 'Inserted Round Up', column: 'Round Up', named: 'Number.RoundUp', type: 'Int64.Type' },
  roundDown: { transform: 'Rounded Down', insert: 'Inserted Round Down', column: 'Round Down', named: 'Number.RoundDown', type: 'Int64.Type' },
  round: { transform: 'Rounded Off', insert: 'Inserted Rounding', column: 'Round', fn: (s, a) => `Number.Round(${s}, ${a})`, type: null },
  abs: { transform: 'Calculated Absolute Value', insert: 'Inserted Absolute Value', column: 'Absolute Value', named: 'Number.Abs', type: null },
  sqrt: { transform: 'Calculated Square Root', insert: 'Inserted Square Root', column: 'Square Root', named: 'Number.Sqrt', type: 'type number' },
  power: { transform: 'Calculated Power', insert: 'Inserted Power', column: 'Power', fn: (s, a) => `Number.Power(${s}, ${a})`, type: 'type number', spaced: true },
  isEven: { transform: 'Calculated Even', insert: 'Inserted Even', column: 'Is Even', named: 'Number.IsEven', type: 'type logical' },
  isOdd: { transform: 'Calculated Odd', insert: 'Inserted Odd', column: 'Is Odd', named: 'Number.IsOdd', type: 'type logical' },
  sign: { transform: 'Calculated Sign', insert: 'Inserted Sign', column: 'Sign', named: 'Number.Sign', type: 'Int64.Type' },
  dateOnly: { transform: 'Extracted Date', insert: 'Inserted Date', column: 'Date', named: 'DateTime.Date', type: 'type date' },
  age: { transform: 'Calculated Age', insert: 'Inserted Age', column: 'Age', fn: (s) => `Date.From(DateTime.LocalNow()) - ${s}`, type: 'type duration', spaced: true },
  year: { transform: 'Extracted Year', insert: 'Inserted Year', column: 'Year', named: 'Date.Year', type: 'Int64.Type' },
  startOfYear: { transform: 'Calculated Start of Year', insert: 'Inserted Start of Year', column: 'Start of Year', named: 'Date.StartOfYear', type: 'type date' },
  endOfYear: { transform: 'Calculated End of Year', insert: 'Inserted End of Year', column: 'End of Year', named: 'Date.EndOfYear', type: 'type date' },
  month: { transform: 'Extracted Month', insert: 'Inserted Month', column: 'Month', named: 'Date.Month', type: 'Int64.Type' },
  startOfMonth: { transform: 'Calculated Start of Month', insert: 'Inserted Start of Month', column: 'Start of Month', named: 'Date.StartOfMonth', type: 'type date' },
  endOfMonth: { transform: 'Calculated End of Month', insert: 'Inserted End of Month', column: 'End of Month', named: 'Date.EndOfMonth', type: 'type date' },
  daysInMonth: { transform: 'Calculated Days in Month', insert: 'Inserted Days in Month', column: 'Days in Month', named: 'Date.DaysInMonth', type: 'Int64.Type' },
  monthName: { transform: 'Extracted Month Name', insert: 'Inserted Month Name', column: 'Month Name', fn: (s) => `Date.MonthName(${s})`, type: 'type text', spaced: true },
  quarter: { transform: 'Calculated Quarter', insert: 'Inserted Quarter', column: 'Quarter', named: 'Date.QuarterOfYear', type: 'Int64.Type' },
  startOfQuarter: { transform: 'Calculated Start of Quarter', insert: 'Inserted Start of Quarter', column: 'Start of Quarter', named: 'Date.StartOfQuarter', type: 'type date' },
  endOfQuarter: { transform: 'Calculated End of Quarter', insert: 'Inserted End of Quarter', column: 'End of Quarter', named: 'Date.EndOfQuarter', type: 'type date' },
  weekOfYear: { transform: 'Calculated Week of Year', insert: 'Inserted Week of Year', column: 'Week of Year', named: 'Date.WeekOfYear', type: 'Int64.Type' },
  weekOfMonth: { transform: 'Calculated Week of Month', insert: 'Inserted Week of Month', column: 'Week of Month', named: 'Date.WeekOfMonth', type: 'Int64.Type' },
  day: { transform: 'Extracted Day', insert: 'Inserted Day', column: 'Day', named: 'Date.Day', type: 'Int64.Type' },
  dayOfWeek: { transform: 'Calculated Day of Week', insert: 'Inserted Day of Week', column: 'Day of Week', fn: (s) => `Date.DayOfWeek(${s})`, type: 'Int64.Type', spaced: true },
  dayOfYear: { transform: 'Calculated Day of Year', insert: 'Inserted Day of Year', column: 'Day of Year', named: 'Date.DayOfYear', type: 'Int64.Type' },
  dayName: { transform: 'Extracted Day Name', insert: 'Inserted Day Name', column: 'Day Name', fn: (s) => `Date.DayOfWeekName(${s})`, type: 'type text', spaced: true },
  timeOnly: { transform: 'Extracted Time', insert: 'Inserted Time', column: 'Time', named: 'DateTime.Time', type: 'type time' },
  hour: { transform: 'Extracted Hour', insert: 'Inserted Hour', column: 'Hour', named: 'Time.Hour', type: 'Int64.Type' },
  minute: { transform: 'Extracted Minute', insert: 'Inserted Minute', column: 'Minute', named: 'Time.Minute', type: 'Int64.Type' },
  second: { transform: 'Extracted Second', insert: 'Inserted Second', column: 'Second', named: 'Time.Second', type: 'type number' },
  days: { transform: 'Extracted Days', insert: 'Inserted Days', column: 'Days', named: 'Duration.Days', type: 'Int64.Type' },
  hours: { transform: 'Extracted Hours', insert: 'Inserted Hours', column: 'Hours', named: 'Duration.Hours', type: 'Int64.Type' },
  minutes: { transform: 'Extracted Minutes', insert: 'Inserted Minutes', column: 'Minutes', named: 'Duration.Minutes', type: 'Int64.Type' },
  seconds: { transform: 'Extracted Seconds', insert: 'Inserted Seconds', column: 'Seconds', named: 'Duration.Seconds', type: 'type number' },
  totalYears: { transform: 'Calculated Total Years', insert: 'Inserted Total Years', column: 'Total Years', fn: (s) => `Duration.TotalDays(${s}) / 365`, type: 'type number', spaced: true },
  totalDays: { transform: 'Calculated Total Days', insert: 'Inserted Total Days', column: 'Total Days', named: 'Duration.TotalDays', type: 'type number' },
  totalHours: { transform: 'Calculated Total Hours', insert: 'Inserted Total Hours', column: 'Total Hours', named: 'Duration.TotalHours', type: 'type number' }
}

export function columnOpInfo(op: ColumnOp): { transform: string; insert: string; column: string } {
  const d = OPS[op]
  return { transform: d.transform, insert: d.insert, column: d.column }
}

/** Transform ▸ (Format / Extract / Standard / Date …): replaces the column values in place. */
export function transformColumns(cols: ColInfo[], op: ColumnOp, arg = '', arg2 = ''): StepSpec {
  const d = OPS[op]
  const fn = d.named ?? `each ${d.fn!('_', arg, arg2)}`
  const items = cols.map((c) => `{${mText(c.name)}, ${fn}, ${d.type ?? keepType(c.type)}}`).join(', ')
  return spec(d.transform, (p) => `Table.TransformColumns(${p},${d.spaced ? ' ' : ''}{${items}})`)
}

/** Add Column ▸ (Format / Extract / Standard / Date …): adds a new column computed from one column. */
export function insertColumnOp(col: ColInfo, op: ColumnOp, arg = '', arg2 = '', existing: string[] = []): StepSpec {
  const d = OPS[op]
  const ref = fieldRef(col.name)
  const body = d.named ? `${d.named}(${ref})` : d.fn!(ref, arg, arg2)
  let name = d.column
  for (let n = 1; existing.includes(name); n++) name = `${d.column}.${n}`
  return spec(d.insert, (p) => `Table.AddColumn(${p}, ${mText(name)}, each ${body}, ${d.type ?? keepType(col.type)})`)
}

function keepType(typeText: string): string {
  const k = pqTypeOf(typeText)
  return k === 'any' ? 'type number' : pqTypeM(k)
}

// ---------------------------------------------------------------------------------------------
// Statistics (Transform ▸ Statistics: the step's value becomes a scalar)

export type StatOp = 'sum' | 'min' | 'max' | 'median' | 'average' | 'stddev' | 'count' | 'countDistinct'

const STATS: Record<StatOp, { name: string; m: (list: string) => string }> = {
  sum: { name: 'Calculated Sum', m: (l) => `List.Sum(${l})` },
  min: { name: 'Calculated Minimum', m: (l) => `List.Min(${l})` },
  max: { name: 'Calculated Maximum', m: (l) => `List.Max(${l})` },
  median: { name: 'Calculated Median', m: (l) => `List.Median(${l})` },
  average: { name: 'Calculated Average', m: (l) => `List.Average(${l})` },
  stddev: { name: 'Calculated Standard Deviation', m: (l) => `List.StandardDeviation(${l})` },
  count: { name: 'Calculated Count', m: (l) => `List.NonNullCount(${l})` },
  countDistinct: { name: 'Calculated Distinct Count', m: (l) => `List.NonNullCount(List.Distinct(${l}))` }
}

export const statistic = (col: string, op: StatOp): StepSpec => spec(STATS[op].name, (p) => STATS[op].m(`${p}${fieldRef(col)}`))

// ---------------------------------------------------------------------------------------------
// Drill down / navigation

/** Drill Down on a column: the column as a list (`#"Prev"[Col]`), step named after the column. */
export const drillDownColumn = (col: string): StepSpec => spec(col, (p) => `${p}${fieldRef(col)}`)

/** Click on a nested cell (Table/List/Record): `#"Prev"{row}[Col]`. */
export const drillDownCell = (col: string, row: number): StepSpec => spec(col, (p) => `${p}{${row}}${fieldRef(col)}`)

/** Click on a list item: `#"Prev"{index}`. */
export const drillDownItem = (index: number): StepSpec => spec('Navigation', (p) => `${p}{${index}}`)

/** Record field drill-down: `#"Prev"[Field]`. */
export const drillDownField = (field: string): StepSpec => spec(field, (p) => `${p}${fieldRef(field)}`)

/** List Tools ▸ To Table. */
export const listToTable = (): StepSpec => spec('Converted to Table', (p) => `Table.FromList(${p}, Splitter.SplitByNothing(), null, null, ExtraValues.Error)`)

/** Record Tools ▸ Into Table. */
export const recordToTable = (): StepSpec => spec('Converted to Table', (p) => `Record.ToTable(${p})`)

// ---------------------------------------------------------------------------------------------
// Detect data type

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/
const US_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/

/** The type PQ's type detection picks for a column from its (preview) values. */
export function detectType(values: readonly unknown[], current: string): PqType {
  const cur = pqTypeOf(current)
  const vals = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (!vals.length) return cur === 'any' ? 'text' : cur
  if (cur !== 'any' && cur !== 'text') return cur
  if (vals.every((v) => typeof v === 'boolean' || (typeof v === 'string' && /^(true|false)$/i.test(v)))) return 'logical'
  const nums = vals.map((v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v) ? Number(v) : NaN))
  if (nums.every((n) => Number.isFinite(n))) return nums.every((n) => Number.isInteger(n)) ? 'int64' : 'number'
  if (vals.every((v) => typeof v === 'string' && (ISO_DATE.test(v) || US_DATE.test(v)))) return 'date'
  if (vals.every((v) => typeof v === 'string' && ISO_DATETIME.test(v))) return 'datetime'
  if (vals.every((v) => typeof v === 'string' && TIME.test(v))) return 'time'
  return 'text'
}

/** Detect Data Type on the selected (or all) columns → one "Changed Type" step. */
export function detectTypes(cols: ColInfo[], columnValues: (name: string) => unknown[]): StepSpec {
  return changeType(cols.map((c) => ({ name: c.name, type: detectType(columnValues(c.name), c.type) })))
}
