import { DaxError } from "./errors.ts";
import { Evaluator, type Env, type EvalOptions, type Scope, type TableValue, type TCol } from "./evaluator.ts";
import { FilterContext } from "./filters.ts";
import { checkFunctions } from "./functions.ts";
import type { DataType, Model } from "./model.ts";
import { parseDaxQuery, type DaxQuery, type EvaluateStatement, type Node } from "./parser.ts";
import type { OutValue } from "./query.ts";
import { DaxDate, sortCompare, toOutput, type Scalar } from "./values.ts";

export interface DaxResultColumn {
  /** As Power BI shows it: table[column] for a model column, [name] for a column the query named. */
  name: string;
  dataType: DataType;
}

export interface DaxResultTable {
  columns: DaxResultColumn[];
  rows: OutValue[][];
  /** The EVALUATE has an ORDER BY, so the row order is meaningful. */
  ordered: boolean;
}

export interface DaxQueryResult {
  /** One result per EVALUATE, in order. */
  results: DaxResultTable[];
}

export function resultColumnName(c: TCol): string {
  return c.lineage && !c.alias ? `${c.lineage.table.name}[${c.lineage.name}]` : `[${c.name}]`;
}

function inferType(values: Scalar[]): DataType {
  const kinds = new Set<DataType>();
  for (const v of values) {
    if (v === null) continue;
    if (v instanceof DaxDate) kinds.add("date");
    else if (typeof v === "boolean") kinds.add("boolean");
    else if (typeof v === "string") kinds.add("string");
    else kinds.add(Number.isInteger(v) ? "int" : "double");
  }
  if (kinds.has("int") && kinds.has("double")) kinds.delete("int");
  if (kinds.size === 0) return "double";
  return kinds.size === 1 ? [...kinds][0]! : "string";
}

/** Every expression in the query, for function checks and lint. */
export function queryExpressions(q: DaxQuery): Node[] {
  return [...q.definitions.map((d) => d.expr), ...q.evaluates.flatMap((e) => [e.expr, ...e.orderBy.map((o) => o.expr), ...(e.startAt ?? [])])];
}

/** Sets up an evaluator with the query's DEFINE MEASURE and DEFINE VAR definitions. */
function prepare(model: Model, q: DaxQuery, options: EvalOptions): { ev: Evaluator; ctx: FilterContext } {
  for (const e of queryExpressions(q)) checkFunctions(e);
  const ev = new Evaluator(model, options);
  const ctx = new FilterContext(model);
  const scope: Scope = { vars: new Map(), parent: null };
  for (const d of q.definitions) {
    if (d.kind === "measure") {
      const t = model.findTable(d.table);
      if (!t) throw new DaxError("REF", `Cannot find table '${d.table}' for the query measure [${d.name}].`);
      if (t.column(d.name)) throw new DaxError("MODEL", `The name '${d.name}' is already used by a column of table '${t.name}', so it can't be a measure name.`);
      const key = d.name.toLowerCase();
      if (ev.queryMeasures.has(key)) throw new DaxError("QUERY", `The measure [${d.name}] is defined more than once in the query.`);
      const existing = model.measure(d.name);
      if (existing && existing.table.toLowerCase() !== t.name.toLowerCase()) {
        throw new DaxError("QUERY", `The measure [${d.name}] already exists in table '${existing.table}'. To override it in the query, define it as MEASURE '${existing.table}'[${existing.name}].`);
      }
      ev.queryMeasures.set(key, { name: existing?.name ?? d.name, table: t.name, expression: "", ast: d.expr, formatString: existing?.formatString });
      continue;
    }
    const key = d.name.toLowerCase();
    if (model.findTable(d.name)) throw new DaxError("QUERY", `The variable name '${d.name}' is already the name of a table in the model. Choose another name.`);
    if (scope.vars.has(key)) throw new DaxError("VAR", `The variable '${d.name}' is defined twice in the query.`);
    const env: Env = { ctx, rows: [], scope: { vars: new Map(scope.vars), parent: null }, calc: null, inIterator: false, stack: [] };
    scope.vars.set(key, { node: d.expr, env });
  }
  ev.queryScope = scope;
  return { ev, ctx };
}

function orderedRows(ev: Evaluator, ctx: FilterContext, t: TableValue, st: EvaluateStatement): number[] {
  const order = t.rows.map((_, i) => i);
  if (st.orderBy.length === 0) return order;
  const root = ev.rootEnv(ctx);
  // A bare [name] that names a result column sorts by that column, even when a measure has the same name.
  const getters = st.orderBy.map((o) => {
    const e = o.expr;
    if (e.kind === "column" && e.table === null) {
      const idx = t.columns.findIndex((c) => c.name.toLowerCase() === e.name.toLowerCase());
      if (idx >= 0) return (i: number) => t.rows[i]![idx]!;
    }
    return (i: number) => ev.scalar(e, { ...root, rows: [{ table: t, index: i }], inIterator: true });
  });
  const keys = order.map((i) => getters.map((g) => g(i)));
  const cmp = (a: Scalar[], b: Scalar[], n = a.length) => {
    for (let k = 0; k < n; k++) {
      const c = sortCompare(a[k]!, b[k]!);
      if (c !== 0) return st.orderBy[k]!.desc ? -c : c;
    }
    return 0;
  };
  order.sort((x, y) => cmp(keys[x]!, keys[y]!) || x - y);
  if (!st.startAt) return order;
  const start = st.startAt.map((n) => ev.scalar(n, root));
  const first = order.findIndex((i) => cmp(keys[i]!, start, start.length) >= 0);
  return first < 0 ? [] : order.slice(first);
}

/** The declared or statically known type, unless the values contradict it (a whole number type holding 2.5). */
function columnType(c: TCol, values: Scalar[]): DataType {
  const known = c.dataType ?? c.lineage?.dataType;
  const seen = inferType(values);
  if (!known || values.every((v) => v === null)) return known ?? seen;
  if (known === seen || (known === "double" && seen === "int")) return known;
  return known === "int" && seen === "double" ? "double" : seen;
}

function toResult(t: TableValue, order: number[], ordered: boolean): DaxResultTable {
  const rows = order.map((i) => t.rows[i]!);
  return {
    columns: t.columns.map((c, j) => ({ name: resultColumnName(c), dataType: columnType(c, rows.map((r) => r[j]!)) })),
    rows: rows.map((r) => r.map(toOutput)),
    ordered,
  };
}

/**
 * Runs a DAX query the way DAX query view, Performance analyzer's "Copy query" and semantic link's evaluate_dax do:
 * DEFINE ( MEASURE | VAR )*, then one or more EVALUATE <table> [ORDER BY ...] [START AT ...].
 */
export function runQuery(model: Model, query: string | DaxQuery, options: EvalOptions = {}): DaxQueryResult {
  const q = typeof query === "string" ? parseDaxQuery(query) : query;
  const { ev, ctx } = prepare(model, q, options);
  const results = q.evaluates.map((st) => {
    const v = ev.value(st.expr, ev.rootEnv(ctx));
    if (typeof v !== "object" || v === null || v instanceof DaxDate) {
      throw new DaxError(
        "QUERY",
        `The expression specified in the query at ${st.pos.line}:${st.pos.col} is not a valid table expression. To see a single value, wrap it in braces: EVALUATE { <expression> }.`,
      );
    }
    return toResult(v, orderedRows(ev, ctx, v, st), st.orderBy.length > 0);
  });
  return { results };
}
