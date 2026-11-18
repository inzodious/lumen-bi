import { DaxError } from "./errors.ts";
import type { ColumnRef, Model } from "./model.ts";
import { evaluate, type GridRow, type OutValue, type SlicerFilter } from "./query.ts";
import { sortCompare, toOutput } from "./values.ts";

export type MeasureInput = string | { measure: string } | { expression: string };

export interface SlicerAxis {
  column: ColumnRef;
  /** Members to try one at a time. Defaults to every member of the column, blank included. */
  members?: OutValue[];
  /** Extra multi-select states. Defaults to the first two members together. */
  multiSelect?: OutValue[][];
}

export interface ContextGridSpec {
  groupBy?: ColumnRef[];
  slicers?: SlicerAxis[];
}

export interface ContextGrid {
  groupBy: ColumnRef[];
  /** Each state is one combination of slicer selections; [] is "nothing selected". */
  states: SlicerFilter[][];
}

export interface Mismatch {
  filters: SlicerFilter[];
  keys: OutValue[];
  level: number;
  expected: OutValue;
  actual: OutValue;
  error?: string;
}

export interface CompareResult {
  equal: boolean;
  cellsCompared: number;
  mismatches: Mismatch[];
  /** A learner-facing sentence about the first mismatch. */
  summary: string;
}

/** All combinations of: no selection, each single member, and the multi-select sets, across every slicer. */
export function buildContextGrid(model: Model, spec: ContextGridSpec): ContextGrid {
  let states: SlicerFilter[][] = [[]];
  for (const s of spec.slicers ?? []) {
    const col = model.column(s.column);
    let members = s.members;
    if (!members) {
      model.prepare();
      const seen = new Map<string, OutValue>();
      for (let i = 0; i < col.table.fullCount; i++) {
        const v = toOutput(col.table.value(i, col.index));
        seen.set(JSON.stringify(v), v);
      }
      members = [...seen.values()].sort((a, b) => sortCompare(a, b));
    }
    const selections: OutValue[][] = [...members.map((m) => [m]), ...(s.multiSelect ?? (members.length > 2 ? [members.slice(0, 2)] : []))];
    const next: SlicerFilter[][] = [];
    for (const st of states) {
      next.push(st);
      for (const sel of selections) next.push([...st, { column: s.column, values: sel }]);
    }
    states = next;
  }
  return { groupBy: spec.groupBy ?? [], states };
}

function toSpec(m: MeasureInput): { measure?: string; expression?: string } {
  if (typeof m === "string") return { expression: m };
  return m;
}

function same(a: OutValue, b: OutValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

function describeCell(m: Mismatch): string {
  const where = m.filters.length === 0 ? "with no slicers" : `with ${m.filters.map((f) => `${typeof f.column === "string" ? f.column : `${f.column.table}[${f.column.column}]`} = ${JSON.stringify(f.values)}`).join(" and ")}`;
  const cell = m.level === 0 ? "the grand total" : `the row ${JSON.stringify(m.keys)}`;
  if (m.error) return `At ${cell} ${where}, your measure failed: ${m.error}`;
  return `At ${cell} ${where}, expected ${shown(m.expected)} but your measure returned ${shown(m.actual)}.`;
}

/**
 * Grades a candidate measure against a reference over a context grid: every slicer state, every group-by
 * combination, the subtotals and the grand total. A missing row counts as BLANK, like in a visual.
 */
export function compareMeasures(model: Model, candidate: MeasureInput, reference: MeasureInput, grid: ContextGrid | ContextGridSpec): CompareResult {
  const g: ContextGrid = "states" in grid ? grid : buildContextGrid(model, grid);
  const mismatches: Mismatch[] = [];
  let cells = 0;
  for (const filters of g.states) {
    const q = { groupBy: g.groupBy, filters, includeTotals: true };
    const expected = evaluate(model, { ...q, ...toSpec(reference) });
    let actual: GridRow[];
    try {
      actual = evaluate(model, { ...q, ...toSpec(candidate) }).rows;
    } catch (e) {
      if (!(e instanceof DaxError)) throw e;
      mismatches.push({ filters, keys: [], level: 0, expected: expected.rows.find((r) => r.level === 0)?.value ?? null, actual: null, error: e.message });
      continue;
    }
    const key = (r: GridRow) => `${r.level}|${JSON.stringify(r.keys)}`;
    const cand = new Map(actual.map((r) => [key(r), r]));
    const ref = new Map(expected.rows.map((r) => [key(r), r]));
    for (const k of new Set([...ref.keys(), ...cand.keys()])) {
      cells++;
      const e = ref.get(k);
      const a = cand.get(k);
      const row = (e ?? a)!;
      if (!same(e?.value ?? null, a?.value ?? null)) {
        mismatches.push({ filters, keys: row.keys, level: row.level, expected: e?.value ?? null, actual: a?.value ?? null });
      }
    }
  }
  return {
    equal: mismatches.length === 0,
    cellsCompared: cells,
    mismatches,
    summary: mismatches.length === 0 ? `All ${cells} cells match.` : describeCell(mismatches[0]!),
  };
}

/** A cell value in a message; JSON would print Infinity and NaN (a division by zero with `/`) as null. */
export function shown(v: unknown): string {
  if (v === null || v === undefined) return "(Blank)";
  if (typeof v === "number" && !Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
  return JSON.stringify(v);
}
