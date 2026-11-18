import type { Filter, FilterContext } from './filters.ts'
import type { CalcGroup, CalcItem, Measure, Tbl } from './model.ts'
import type { CallNode, FunctionDefinition, Node } from './parser.ts'
import type { TableValue } from './table.ts'
import type { Scalar } from './values.ts'
import type { Evaluator } from './evaluator.ts'

export type Val = Scalar | TableValue

export interface RowCtx {
  t: TableValue
  i: number
}

export interface Binding {
  node: Node
  env: Env
  value?: Val
  busy?: boolean
  /** position in its VAR block (see Scope.limit) */
  idx?: number
  /** declared scalar type (UDF parameter subtype hint), for ISINT64 / ISDOUBLE / ISDECIMAL */
  dataType?: import('../../model/types.ts').DataType
}

export interface Scope {
  vars: Map<string, Binding>
  parent: Scope | null
  /** only bindings declared before this index (Binding.idx) are visible: the declarations of one VAR block share
   * a single map, each declaration seeing the previous ones */
  limit?: number
}

/** The binding of `name` (lower case) visible in this scope level (not its parents). */
export function scopeGet(s: Scope, name: string): Binding | undefined {
  const b = s.vars.get(name)
  if (!b || s.limit === undefined) return b
  return (b.idx ?? -1) < s.limit ? b : undefined
}

export interface Env {
  ctx: FilterContext
  /** row contexts, innermost last */
  rows: RowCtx[]
  scope: Scope | null
  /** calculation items already applied in this evaluation chain (per group) */
  applied: ReadonlyMap<CalcGroup, CalcItem> | null
  /** the measure SELECTEDMEASURE() refers to */
  selMeasure: Measure | null
  /** row contexts before this index were already turned into filters by an enclosing CALCULATE */
  transitioned: number
  depth: number
  /** the measure whose format string expression is being evaluated (SELECTEDMEASUREFORMATSTRING) */
  formatOf?: Measure
  /** measure name stack for circular dependency messages */
  /** measures being evaluated (innermost first), for circular-dependency messages */
  stack?: { name: string; prev?: Env['stack'] }
  /** home table of the measure / calculated column being evaluated: bare [Name] column references resolve here first */
  home?: Tbl | null
  /**
   * Shadow filter contexts created by the iterators currently running (innermost last). ALLSELECTED restores, per
   * column, the last shadow filter context that filters that column (see Evaluator.allSelected). They survive context
   * transition and CALCULATE; SUMMARIZECOLUMNS starts a new list.
   */
  shadows?: ShadowFrame[]
  /** visual calculation context: the visual matrix and the current cell (visualcalc.ts) */
  visual?: import('./visualcalc.ts').VisualCtx
  /** calculation items applied in this evaluation chain, innermost first (recursion rules, Evaluator.evalMeasureIn) */
  cgTrail?: CalcItemTrail
  /** explicit measure references evaluated in this chain (SELECTEDMEASURE () does not count) */
  cgRefs?: number
  /** set by SELECTEDMEASURE () for the measure evaluation it starts */
  viaSelected?: boolean
}

export interface CalcItemTrail {
  group: CalcGroup
  item: CalcItem
  /** the filters on the calculation group's table when the item was applied (identity tells a re-selection) */
  filters: readonly Filter[]
  /** cgRefs when the item was applied */
  refs: number
  prev?: CalcItemTrail
}

/** The table an iterator iterates; its filter form is computed only when ALLSELECTED needs it. */
export interface ShadowFrame {
  t: TableValue
  filter?: Filter | null
  cols?: Set<number>
}

export interface EvalOptions {
  now?: () => Date
  userPrincipalName?: string
  userName?: string
  customData?: string
  /** DAX query parameters (@name) */
  params?: Record<string, Scalar>
  /** processCalculated: when an object fails to compute but has stored values, keep them (reported as a notice) */
  keepStoredOnError?: boolean
  /** user-defined functions of a DAX query (DEFINE FUNCTION), by lower-case name; model functions come from DaxModel */
  functions?: ReadonlyMap<string, FunctionDefinition>
  /** another model whose user-defined functions are callable (visual calculations call the semantic model's) */
  functionSource?: { userFunction(name: string): FunctionDefinition | undefined }
}

export type FnImpl = (ev: Evaluator, a: Node[], env: Env, node: CallNode) => Val

export interface FnMeta {
  /** returns a table */
  table?: boolean
  /** argument columns are not row-context references (aggregators, filter functions) */
  context?: boolean
  min?: number
  max?: number
}

export const FUNCTIONS = new Map<string, FnImpl>()
export const FN_META = new Map<string, FnMeta>()

export function defineFn(names: string | string[], impl: FnImpl, meta: FnMeta = {}): void {
  for (const n of Array.isArray(names) ? names : [names]) {
    FUNCTIONS.set(n.toUpperCase(), impl)
    FN_META.set(n.toUpperCase(), meta)
  }
}

export function isTableFunction(name: string): boolean {
  return FN_META.get(name.toUpperCase())?.table === true
}
