/**
 * QueryEngine — the contract between the analytics engine (DAX, owned by src/core/dax +
 * src/core/engine) and everything that consumes data (visuals, data view, DAX query view,
 * model view, exports).
 *
 * Implementation: `createEngine(model, data)` in ./engine.ts adapts the vendored DAX engine
 * (src/core/dax) to our SemanticModel + DataStore. All calls are synchronous and pure; the
 * renderer may run the engine on a Web Worker later, so keep inputs/outputs structured-clonable.
 *
 * Filters everywhere are PBIR SQ filters (see ../report/sq.ts), so report/page/visual filters,
 * slicer selections, cross-filter selections and drill-through filters all share one language.
 */
import type { DataType, SemanticModel } from '../model/types'
import type { DataStore, Scalar } from '../model/data'
import type { SQExpr, SQFilter } from '../report/sq'

export interface ColumnRef {
  table: string
  column: string
}

export type AggregateFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'countNonNull' | 'distinctCount' | 'median' | 'stdev' | 'var'

/** A value to compute per group. */
export type ValueExpr =
  | { kind: 'measure'; table: string; measure: string }
  | { kind: 'aggregate'; table: string; column: string; fn: AggregateFn }
  /** Any DAX scalar expression evaluated in the group's filter context (used for visual-level calcs, conditional formatting, tooltips). */
  | { kind: 'dax'; expression: string }
  /** A raw SQ field expression (Measure / Aggregation / Column) — engine translates it. */
  | { kind: 'sq'; expr: SQExpr }

export type GroupExpr = ColumnRef | { kind: 'sq'; expr: SQExpr }

export interface SortSpec {
  /** index into groupBy, or id of a value */
  target: { group: number } | { value: string }
  direction: 'asc' | 'desc'
}

export interface SummarizeRequest {
  /** Group-by columns (SUMMARIZECOLUMNS semantics: auto-exist across tables via relationships). */
  groupBy: GroupExpr[]
  values: Array<{ id: string; expr: ValueExpr }>
  /** Filters applied as CALCULATE-style filter context (report + page + visual + slicers + cross-filters + drill). */
  filters?: SQFilter[]
  /** "Show items with no data": include group combinations even when all values are blank. */
  showItemsWithNoData?: boolean
  /** Keep rows where every value is blank (SUMMARIZECOLUMNS drops them by default). */
  keepBlankRows?: boolean
  orderBy?: SortSpec[]
  /** Return only the first N rows after sorting. */
  limit?: number
  /** When set, also compute values under `highlightFilters` (cross-highlighting) → result.highlights. */
  highlightFilters?: SQFilter[]
}

export interface ResultColumn {
  /** group column: `${table}.${column}`; value: the request id */
  id: string
  kind: 'group' | 'value'
  dataType: DataType
  /** static format string of the column/measure (model formatString) */
  formatString?: string
  /** For groups: sort-by-column order key is applied already; this is the display name. */
  name: string
}

export interface SummarizeResult {
  columns: ResultColumn[]
  /** Each row: group values (in groupBy order) followed by values (in request order). */
  rows: Scalar[][]
  /** Dynamic format strings (formatStringDefinition / calc group format) per row per value column, when they differ from static. */
  formats?: Array<Array<string | undefined>>
  /** Same shape as rows' value part, computed under highlightFilters (null where not highlighted). */
  highlights?: Scalar[][]
  truncated?: boolean
  /** Non-fatal problems (e.g. unsupported function in one measure) */
  warnings?: string[]
}

export interface DistinctValuesRequest {
  column: GroupExpr
  filters?: SQFilter[]
  /** text search (contains, case-insensitive) */
  search?: string
  limit?: number
  /** also return the count of rows/measure per value? */
  withMeasure?: ValueExpr
}

export interface DaxQueryResultTable {
  columns: Array<{ name: string; dataType: DataType; formatString?: string }>
  rows: Scalar[][]
}

export interface DaxQueryResult {
  tables: DaxQueryResultTable[]
  /** milliseconds */
  durationMs: number
}

export interface ExpressionDiagnostic {
  message: string
  /** 0-based offsets into the expression text */
  start?: number
  end?: number
  severity: 'error' | 'warning'
}

export interface QueryEngine {
  readonly model: SemanticModel
  readonly data: DataStore

  /** Group + aggregate (the workhorse for visuals). */
  summarize(req: SummarizeRequest): SummarizeResult
  /** Distinct values for slicers / filter pane. Respects sort-by-column ordering. */
  distinctValues(req: DistinctValuesRequest): { values: Scalar[]; measures?: Scalar[]; dataType: DataType }
  /** Evaluate a DAX scalar expression under filters. */
  evaluateScalar(expression: string, filters?: SQFilter[]): { value: Scalar; formatString?: string }
  /** Run a DAX query (DEFINE ... EVALUATE ... ORDER BY ...), possibly multiple EVALUATEs. */
  runDaxQuery(query: string): DaxQueryResult
  /** Syntax/semantic check for the formula bar. */
  validateExpression(expression: string, context: { kind: 'measure' | 'calculatedColumn' | 'calculatedTable'; table?: string }): ExpressionDiagnostic[]
  /** Format a value with a .NET/DAX format string (FORMAT semantics, culture en-US by default). */
  format(value: Scalar, formatString?: string, dataType?: DataType): string

  /**
   * (Re)compute calculated columns and calculated tables (incl. field parameters, DATATABLE,
   * calendar tables) in dependency order. Called after data load and after model edits.
   * Returns per-object errors instead of throwing.
   */
  processCalculated(): Array<{ table: string; column?: string; error: string }>
  /** Called after model edits (measures added/changed, relationships changed...). Cheap; invalidates caches. */
  invalidate(): void

  /** Metadata for a SQ field expression (column / measure / aggregation / hierarchy level). undefined if it doesn't resolve. */
  describeField(expr: SQExpr): FieldDescription | undefined
  /**
   * Field parameters: if `expr` is a field-parameter column (extendedProperty ParameterMetadata),
   * return the fields currently selected under `filters` (all fields if none selected), in parameter order.
   * Returns null for ordinary fields.
   */
  resolveFieldParameter(expr: SQExpr, filters?: SQFilter[]): Array<{ expr: SQExpr; displayName: string }> | null

  /**
   * Row-level security "View as" (Modeling ▸ View as). Restrict every subsequent query to what the
   * union of these roles may see: each role's `tablePermissions[].filterExpression` is a DAX boolean
   * row filter on its table, propagated through relationships like PBI RLS. `null`/`[]` = no RLS.
   * Optional (added by the modeling-views workstream): when absent, the UI warns that View as is not applied.
   */
  setViewAsRoles?(roles: string[] | null): void

  /**
   * The DAX query equivalent to a visual query (Performance analyzer ▸ Copy query): SUMMARIZECOLUMNS with the
   * request's filters as filter tables, ORDER BY and TOPN windowing, in Power BI's layout. Runs with runDaxQuery.
   */
  toDaxQuery?(req: SummarizeRequest): string
  /** The DAX query of a visual with visual calculations (TABLE ... WITH VISUAL SHAPE), like Power BI's Performance analyzer. Runs with runDaxQuery. */
  toVisualCalcDaxQuery?(req: VisualCalcRequest): string

  /**
   * Visual calculations (PBIR NativeVisualCalculation projections) over the visual matrix of a query: the base
   * summarize result with one value column per calculation appended (id = calc id), plus every cell of the matrix
   * (totals and subtotals included) for visuals that show totals.
   */
  evaluateVisualCalculations?(req: VisualCalcRequest): VisualCalcResult
}

export interface VisualCalcRequest {
  /** the visual's query: groupBy = ROWS-axis fields then COLUMNS-axis fields; values = the visual's model fields */
  base: SummarizeRequest
  /** number of leading groupBy entries on the ROWS axis (the others are on the COLUMNS axis) */
  rowFields: number
  /** names visual calculations use for the groupBy entries, then for the values (the visual's display names) */
  names: string[]
  /** in evaluation order (a calculation can use the ones before it) */
  calcs: Array<{ id: string; name: string; expression: string }>
}

export interface VisualCalcResult {
  /** summarize(base) with the calculation values appended to each row (and their columns) */
  result: SummarizeResult
  /** every cell of the visual matrix: levels (0 = total) of each axis, group keys (null above the level), values, calculations */
  cells: Array<{ rowLevel: number; colLevel: number; keys: Scalar[]; values: Scalar[]; calcs: Scalar[] }>
  /** per calculation: the first evaluation error, or null */
  errors: Array<string | null>
}

export interface FieldDescription {
  kind: 'column' | 'measure' | 'aggregation' | 'hierarchyLevel'
  table: string
  name: string
  /** what PBI shows by default: column/measure name, or e.g. "Sum of Amount" */
  displayName: string
  dataType: DataType
  formatString?: string
  isMeasure: boolean
  /** column used for ordering (sortByColumn) */
  sortBy?: ColumnRef
  /** resolved underlying column for hierarchy levels / aggregations */
  column?: ColumnRef
  dataCategory?: string
  isFieldParameter?: boolean
  /** KPI hidden measures (_<measure> Goal / Status / Trend): the KPI's base measure and which part this is */
  kpi?: { measure: string; part: 'goal' | 'status' | 'trend'; statusGraphic?: string; /** TOM trendGraphic (e.g. "Standard Arrow"), on the trend part */ trendGraphic?: string }
}

/** Format-string helper exported for UI code that formats without an engine instance. */
export type ValueFormatter = (value: Scalar, formatString?: string, dataType?: DataType) => string
