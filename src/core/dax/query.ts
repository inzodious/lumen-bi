import { DaxError } from "./errors.ts";
import { Evaluator, type EvalOptions } from "./evaluator.ts";
import { FilterContext, makeFilter, type Filter } from "./filters.ts";
import { checkFunctions } from "./functions.ts";
import { displayValue } from "./format.ts";
import type { ColumnInfo, ColumnRef, Measure, Model } from "./model.ts";
import { parse } from "./parser.ts";
import { DaxDate, keyOf, sortCompare, toOutput, tupleKey, type Scalar } from "./values.ts";

export type OutValue = null | number | string | boolean;

export interface SlicerFilter {
  column: ColumnRef;
  /** Selected members. Dates as 'YYYY-MM-DD'; null selects the blank member. */
  values: OutValue[];
}

export interface QuerySpec extends EvalOptions {
  measure?: string;
  /** An ad-hoc measure expression, evaluated like a query-scoped measure. */
  expression?: string;
  formatString?: string;
  groupBy?: ColumnRef[];
  filters?: SlicerFilter[];
  includeTotals?: boolean;
}

export interface GridRow {
  /** Group-by values in scope for this row, in groupBy order (shorter for subtotals, empty for the grand total). */
  keys: OutValue[];
  level: number;
  isGrandTotal: boolean;
  isSubtotal: boolean;
  value: OutValue;
  formatted: string;
  formatString: string | null;
}

export interface QueryGrid {
  groupBy: string[];
  rows: GridRow[];
}

export function columnLabel(c: ColumnInfo): string {
  return `${c.table.name}[${c.name}]`;
}

function coerce(v: OutValue, col: ColumnInfo): Scalar {
  if (v === null) return null;
  if (col.dataType === "date") {
    if (typeof v !== "string") throw new DaxError("TYPE", `Slicer values for date column ${columnLabel(col)} must be 'YYYY-MM-DD' strings.`);
    return DaxDate.fromIso(v);
  }
  return v;
}

export function slicerFilters(model: Model, filters: SlicerFilter[] = []): Filter[] {
  return filters.map((f) => {
    const col = model.column(f.column);
    return makeFilter(
      [col],
      f.values.map((v) => [coerce(v, col)]),
    );
  });
}

function queryMeasure(model: Model, spec: QuerySpec): Measure {
  if (spec.measure && spec.expression) throw new DaxError("QUERY", "Pass either a measure name or an expression, not both.");
  if (spec.measure) {
    const m = model.measure(spec.measure);
    if (!m) throw new DaxError("REF", `The measure '${spec.measure}' cannot be found in the model.`);
    return m;
  }
  if (!spec.expression) throw new DaxError("QUERY", "A query needs a measure name or an expression.");
  const ast = parse(spec.expression);
  checkFunctions(ast);
  return { name: "__query__", table: "_measures_kpi", expression: spec.expression, ast, formatString: spec.formatString };
}

/**
 * Evaluates a measure over a grid with SUMMARIZECOLUMNS-like semantics: combinations of existing group-by values
 * (auto-exist within a table, cross join across tables), rows whose measure is blank dropped, and subtotals/grand
 * total evaluated with the group-by filters removed rather than summed.
 */
export function evaluate(model: Model, spec: QuerySpec): QueryGrid {
  const ev = new Evaluator(model, spec);
  const measure = queryMeasure(model, spec);
  const groupBy = (spec.groupBy ?? []).map((c) => model.column(c));
  const slicers = slicerFilters(model, spec.filters);
  const base = new FilterContext(model, slicers, new Map(), slicers);

  const byTable = new Map<string, ColumnInfo[]>();
  for (const c of groupBy) {
    const list = byTable.get(c.table.name) ?? [];
    if (list.includes(c)) throw new DaxError("QUERY", `${columnLabel(c)} appears twice in groupBy.`);
    list.push(c);
    byTable.set(c.table.name, list);
  }
  let combos: Map<number, Scalar>[] = [new Map()];
  for (const cols of byTable.values()) {
    const t = cols[0]!.table;
    const seen = new Set<string>();
    const tuples: Scalar[][] = [];
    for (const i of base.visible(t)) {
      const tuple = cols.map((c) => t.value(i, c.index));
      const k = tupleKey(tuple);
      if (!seen.has(k)) {
        seen.add(k);
        tuples.push(tuple);
      }
    }
    const next: Map<number, Scalar>[] = [];
    for (const combo of combos) {
      for (const tuple of tuples) {
        const m = new Map(combo);
        cols.forEach((c, i) => m.set(c.id, tuple[i]!));
        next.push(m);
      }
    }
    combos = next;
  }

  const levels = spec.includeTotals ? Array.from({ length: groupBy.length + 1 }, (_, k) => groupBy.length - k) : [groupBy.length];
  const rows: { keys: Scalar[]; row: GridRow }[] = [];
  for (const level of levels) {
    const cols = groupBy.slice(0, level);
    const seen = new Set<string>();
    for (const combo of combos) {
      const keys = cols.map((c) => combo.get(c.id)!);
      const k = tupleKey(keys);
      if (seen.has(k)) continue;
      seen.add(k);
      let ctx = base;
      cols.forEach((c, i) => {
        ctx = ctx.addFilter(makeFilter([c], [[keys[i]!]]), false);
      });
      ctx = ctx.with({ scope: new Set(cols.map((c) => c.id)) });
      const value = ev.measureValue(measure, ctx);
      if (value === null) continue;
      const fmt = ev.formatStringFor(measure, ctx);
      rows.push({
        keys,
        row: {
          keys: keys.map(toOutput),
          level,
          isGrandTotal: level === 0,
          isSubtotal: level > 0 && level < groupBy.length,
          value: toOutput(value),
          formatted: displayValue(value, fmt),
          formatString: fmt,
        },
      });
    }
  }
  // Sort by column: order a group-by column's values by the column it sorts by.
  const sortKeys = groupBy.map((c) => {
    if (!c.sortBy) return null;
    const m = new Map<string, Scalar>();
    for (const row of c.table.rows) m.set(keyOf(row[c.index] ?? null), row[c.sortBy.index] ?? null);
    return m;
  });
  const sortValue = (i: number, v: Scalar): Scalar => sortKeys[i]?.get(keyOf(v)) ?? v;
  rows.sort((a, b) => {
    for (let i = 0; i < groupBy.length; i++) {
      const ha = i < a.keys.length;
      const hb = i < b.keys.length;
      if (!ha || !hb) return ha === hb ? 0 : ha ? -1 : 1;
      const c = sortCompare(sortValue(i, a.keys[i]!), sortValue(i, b.keys[i]!)) || sortCompare(a.keys[i]!, b.keys[i]!);
      if (c !== 0) return c;
    }
    return 0;
  });
  return { groupBy: groupBy.map(columnLabel), rows: rows.map((r) => r.row) };
}

/** Evaluates one expression in the context of slicer filters (no grouping). Returns BLANK as null. */
export function evaluateScalar(model: Model, expression: string, filters: SlicerFilter[] = [], options: EvalOptions = {}): OutValue {
  const grid = evaluate(model, { ...options, expression, filters, includeTotals: true });
  return grid.rows[0]?.value ?? null;
}
