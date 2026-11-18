import type { Workspace } from "@parity/lakehouse";
import { evaluate, type Model, type OutValue, type SlicerFilter } from "../index.ts";
import { CG_ITEMS, REF, SEL_METRIC } from "./fixture.ts";

// An independent SQL implementation of the golden measures. It applies filters, relationship propagation and
// time-intelligence date sets explicitly, one SQL query per grid cell.

export type Cell = Map<string, OutValue[]>;

export interface OracleCtx {
  cell: Cell;
  slicers: Cell;
  grouped: Set<string>;
}

export type Oracle = (o: OracleCtx) => string;

export const tableOf = (key: string) => key.slice(0, key.indexOf("["));
const colOf = (key: string) => key.slice(key.indexOf("[") + 1, -1);
const ALIAS: Record<string, string> = { fact_transmissions: "f", dim_accounts: "a", dim_products: "p", dim_calendar: "c" };
const DATE_COLS = new Set(["dim_calendar[date]", "dim_calendar[month_end]", "fact_transmissions[opened_date]", "fact_transmissions[resolved_date]"]);
export const isCal = (k: string) => tableOf(k) === "dim_calendar";
export const isAcc = (k: string) => tableOf(k) === "dim_accounts";
export const isProd = (k: string) => tableOf(k) === "dim_products";
export const isFact = (k: string) => tableOf(k) === "fact_transmissions";

function lit(key: string, v: OutValue): string {
  if (v === null) return "NULL";
  if (DATE_COLS.has(key)) return `DATE '${String(v)}'`;
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function cond(key: string, vals: OutValue[], alias = ALIAS[tableOf(key)]!): string {
  const col = `${alias}.${colOf(key)}`;
  const nonNull = vals.filter((v) => v !== null);
  const parts: string[] = [];
  if (nonNull.length > 0) parts.push(`${col} IN (${nonNull.map((v) => lit(key, v)).join(", ")})`);
  if (vals.includes(null)) parts.push(`${col} IS NULL`);
  return parts.length > 0 ? `(${parts.join(" OR ")})` : "FALSE";
}

export function from(dateCol = "opened_date"): string {
  return `FROM ${REF.fact} f LEFT JOIN ${REF.acc} a ON a.account_id = f.account_id LEFT JOIN ${REF.prod} p ON p.product_id = f.product_id LEFT JOIN ${REF.cal} c ON c.date = f.${dateCol}`;
}

const MODEL_TABLES = new Set(["fact_transmissions", "dim_accounts", "dim_products", "dim_calendar"]);

export function where(cell: Cell, opts: { skip?: (k: string) => boolean; extra?: string[] } = {}): string {
  const parts: string[] = [];
  for (const [k, v] of cell) if (MODEL_TABLES.has(tableOf(k)) && !opts.skip?.(k)) parts.push(cond(k, v));
  parts.push(...(opts.extra ?? []));
  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

export function tableWhere(cell: Cell, pred: (k: string) => boolean): string {
  const parts = [...cell].filter(([k]) => pred(k)).map(([k, v]) => cond(k, v));
  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

export function count(cell: Cell, opts: { skip?: (k: string) => boolean; extra?: string[] } = {}, dateCol = "opened_date"): string {
  return `SELECT NULLIF(count(*), 0) ${from(dateCol)} WHERE ${where(cell, opts)}`;
}

export function divide(n: string, d: string): string {
  return `SELECT CASE WHEN d IS NULL OR d = 0 OR n IS NULL THEN NULL ELSE n::DOUBLE / d END FROM (SELECT (${n}) AS n, (${d}) AS d)`;
}

/** Dates of the calendar visible under the cell's calendar filters (the blank row has no date). */
export function visibleDates(cell: Cell): string {
  return `SELECT c.date FROM ${REF.cal} c WHERE ${tableWhere(cell, isCal)}`;
}

export function toDateSet(vis: string, period: "year" | "quarter" | "month"): string {
  const mx = `(SELECT max(date) FROM (${vis}))`;
  return `SELECT c2.date FROM ${REF.cal} c2 WHERE c2.date BETWEEN date_trunc('${period}', ${mx})::DATE AND ${mx}`;
}

export function shiftMonths(vis: string, n: number): string {
  const s = `(v.date + to_months(${n}))::DATE`;
  return `SELECT c2.date FROM ${REF.cal} c2 JOIN (${vis}) v ON c2.date BETWEEN ${s} AND CASE WHEN v.date = last_day(v.date) THEN last_day(${s}) ELSE ${s} END`;
}

export function shiftDays(vis: string, n: number): string {
  return `SELECT c2.date FROM ${REF.cal} c2 JOIN (${vis}) v ON c2.date = v.date + ${n}`;
}

/** Base aggregate over fact rows restricted to a date set; calendar filters are replaced by the set. */
export function inDates(agg: string, cell: Cell, set: string): string {
  return `SELECT ${agg} ${from()} WHERE ${where(cell, { skip: isCal, extra: [`f.opened_date IN (${set})`] })}`;
}

export function descendants(cell: Cell): string {
  const ctxIds = `SELECT a.account_id FROM ${REF.acc} a WHERE ${tableWhere(cell, isAcc)}`;
  return `SELECT account_id FROM (${ctxIds}) UNION SELECT a2.account_id FROM ${REF.acc} a2 WHERE a2.parent_id IN (${ctxIds}) OR a2.grandparent_id IN (${ctxIds})`;
}

export interface Grid {
  groupBy: string[];
  states: SlicerFilter[][];
}

function slicerCell(state: SlicerFilter[]): Cell {
  return new Map(state.map((s) => [String(s.column), s.values]));
}

/** Distinct group-by tuples of one table visible under the slicers, as SUMMARIZECOLUMNS would enumerate them. */
function axisTuples(ws: Workspace, table: string, cols: string[], slicers: Cell): OutValue[][] {
  const q = (sql: string) => ws.query(sql).rows as OutValue[][];
  const list = cols.map((k) => `${ALIAS[table] ?? "x"}.${colOf(k)}`).join(", ");
  switch (table) {
    case "fact_transmissions":
      return q(`SELECT DISTINCT ${list} ${from()} WHERE ${where(slicers)}`);
    case "dim_accounts":
      return q(`SELECT DISTINCT ${list} FROM ${REF.acc} a WHERE ${tableWhere(slicers, isAcc)}`);
    case "dim_products": {
      const others = [...slicers.keys()].some((k) => isFact(k) || isAcc(k) || isCal(k));
      const bidi = others ? `p.product_id IN (SELECT f.product_id ${from()} WHERE ${where(slicers, { skip: isProd })})` : "TRUE";
      return q(`SELECT DISTINCT ${list} FROM ${REF.prod} p WHERE ${tableWhere(slicers, isProd)} AND ${bidi}`);
    }
    case "dim_calendar": {
      const rows = q(`SELECT DISTINCT ${list} FROM ${REF.cal} c WHERE ${tableWhere(slicers, isCal)}`);
      if (![...slicers.keys()].some(isCal)) rows.push(cols.map(() => null));
      return rows;
    }
    case "sel_metric": {
      const allowed = slicers.get("sel_metric[metric_order]");
      return SEL_METRIC.filter((r) => !allowed || allowed.includes(r[0]!)).map((r) => cols.map((k) => (colOf(k) === "metric_order" ? r[0]! : r[1]!)));
    }
    case "cg_time_intelligence": {
      const allowed = slicers.get("cg_time_intelligence[time_calculation]");
      return CG_ITEMS.filter((i) => !allowed || allowed.includes(i)).map((i) => [i]);
    }
  }
  throw new Error(`no axis rule for ${table}`);
}

export interface CellMismatch {
  state: SlicerFilter[];
  keys: OutValue[];
  expected: OutValue;
  actual: OutValue;
}

function same(a: OutValue, b: OutValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}

/** Runs the DAX grid and the SQL oracle over every cell (details, subtotals, grand total) of every slicer state. */
export function checkAgainstOracle(
  ws: Workspace,
  model: Model,
  measure: string,
  oracle: Oracle,
  grid: Grid,
  checkFormat?: (o: OracleCtx) => string | null,
): { cells: number; mismatches: CellMismatch[] } {
  const mismatches: CellMismatch[] = [];
  let cells = 0;
  for (const state of grid.states) {
    const slicers = slicerCell(state);
    const result = evaluate(model, { measure, groupBy: grid.groupBy, filters: state, includeTotals: true });
    const byKey = new Map(result.rows.map((r) => [`${r.level}|${JSON.stringify(r.keys)}`, r]));
    const byTable = new Map<string, string[]>();
    for (const k of grid.groupBy) byTable.set(tableOf(k), [...(byTable.get(tableOf(k)) ?? []), k]);
    let combos: Map<string, OutValue>[] = [new Map()];
    for (const [table, cols] of byTable) {
      const tuples = axisTuples(ws, table, cols, slicers);
      combos = combos.flatMap((c) => tuples.map((t) => new Map([...c, ...cols.map((k, i) => [k, t[i]!] as [string, OutValue])])));
    }
    const expectedRows = new Set<string>();
    for (let level = grid.groupBy.length; level >= 0; level--) {
      const cols = grid.groupBy.slice(0, level);
      const seen = new Set<string>();
      for (const combo of combos) {
        const keys = cols.map((k) => combo.get(k)!);
        const id = `${level}|${JSON.stringify(keys)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const cell: Cell = new Map(slicers);
        cols.forEach((k, i) => cell.set(k, [keys[i]!]));
        const ctx: OracleCtx = { cell, slicers, grouped: new Set(cols) };
        const expected = (ws.query(oracle(ctx)).rows[0]?.[0] ?? null) as OutValue;
        const row = byKey.get(id);
        const actual = row?.value ?? null;
        cells++;
        if (expected !== null) expectedRows.add(id);
        if (!same(expected, actual)) mismatches.push({ state, keys, expected, actual });
        if (row && checkFormat) {
          const fmt = checkFormat(ctx);
          if (fmt !== row.formatString) mismatches.push({ state, keys, expected: `format ${fmt}`, actual: `format ${row.formatString}` });
        }
      }
    }
    for (const id of byKey.keys()) if (!expectedRows.has(id)) mismatches.push({ state, keys: JSON.parse(id.split("|").slice(1).join("|")), expected: "no row", actual: byKey.get(id)!.value });
  }
  return { cells, mismatches };
}
