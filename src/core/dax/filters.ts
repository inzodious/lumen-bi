import { DaxError, unsupported } from "./errors.ts";
import type { ColumnInfo, Model, Relationship, TableData } from "./model.ts";
import { tupleKey, type Scalar } from "./values.ts";

/** A filter is a set of allowed tuples over one or more columns. A single-column filter is the common case. */
export interface Filter {
  cols: ColumnInfo[];
  tuples: Scalar[][];
  keys: Set<string>;
  projections?: Map<string, Set<string>>;
  masks?: Map<string, Uint8Array>;
}

export function makeFilter(cols: ColumnInfo[], tuples: Scalar[][]): Filter {
  const keys = new Set<string>();
  const unique: Scalar[][] = [];
  for (const t of tuples) {
    const k = tupleKey(t);
    if (!keys.has(k)) {
      keys.add(k);
      unique.push(t);
    }
  }
  return { cols, tuples: unique, keys };
}

function project(f: Filter, positions: number[]): Filter {
  return makeFilter(
    positions.map((p) => f.cols[p]!),
    f.tuples.map((t) => positions.map((p) => t[p]!)),
  );
}

function projectedKeys(f: Filter, positions: number[]): Set<string> {
  const id = positions.join(",");
  f.projections ??= new Map();
  let s = f.projections.get(id);
  if (!s) {
    s = new Set(f.tuples.map((t) => tupleKey(positions.map((p) => t[p]!))));
    f.projections.set(id, s);
  }
  return s;
}

export type RelMode = "none" | "single" | "both";

export interface RelOverride {
  active?: boolean;
  mode?: RelMode;
}

export interface EffectiveRel {
  rel: Relationship;
  mode: "single" | "both";
}

interface Step {
  table: TableData;
  /** Index of the step this one hangs off, and the relationship used; -1 for the root. */
  parent: number;
  rel: Relationship | null;
}

export interface Expansion {
  steps: Step[];
  colPos: Map<number, { step: number; index: number }>;
  stepRows?: Int32Array[];
}

const relatedCache = new WeakMap<Relationship, { from: number; to: number; rows: Int32Array }>();

/** The one-side row of every many-side row (blank row where the key has no match), cached per relationship. */
function relatedRows(rel: Relationship): Int32Array {
  const from = rel.from.table.fullCount;
  const to = rel.to.table.fullCount;
  const hit = relatedCache.get(rel);
  if (hit && hit.from === from && hit.to === to) return hit.rows;
  const idx = rel.to.table.keyIndex(rel.to.index);
  const blank = rel.to.table.blankIndex;
  const rows = new Int32Array(from);
  for (let r = 0; r < from; r++) {
    const fk = rel.from.table.value(r, rel.from.index);
    rows[r] = (fk === null ? undefined : idx.get(tupleKey([fk]))) ?? blank;
  }
  relatedCache.set(rel, { from, to, rows });
  return rows;
}

function relatedRow(rel: Relationship, fromRow: number): number {
  return relatedRows(rel)[fromRow] ?? rel.to.table.blankIndex;
}

/** For each step of the expansion, the step table's row for every row of the root table (-1: none). */
function stepRowArrays(exp: Expansion): Int32Array[] {
  if (exp.stepRows) return exp.stepRows;
  const n = exp.steps[0]!.table.fullCount;
  const out: Int32Array[] = [];
  exp.steps.forEach((step, s) => {
    if (s === 0) {
      const all = new Int32Array(n);
      for (let i = 0; i < n; i++) all[i] = i;
      out.push(all);
      return;
    }
    const parent = out[step.parent]!;
    const rel = relatedRows(step.rel!);
    const rows = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const p = parent[i]!;
      rows[i] = p < 0 ? -1 : (rel[p] ?? -1);
    }
    out.push(rows);
  });
  exp.stepRows = out;
  return out;
}

export function rowsForSteps(exp: Expansion, row: number): number[] {
  return stepRowArrays(exp).map((a) => a[row]!);
}

/** Which rows of one table a filter allows, for filters whose columns all sit on that table. */
function filterMask(f: Filter, table: TableData, positions: number[], getters: { index: number }[]): Uint8Array {
  const id = `${table.name}|${table.fullCount}|${positions.join(",")}`;
  f.masks ??= new Map();
  let m = f.masks.get(id);
  if (!m) {
    const keys = positions.length === f.cols.length ? f.keys : projectedKeys(f, positions);
    m = new Uint8Array(table.fullCount);
    for (let r = 0; r < table.fullCount; r++) m[r] = keys.has(tupleKey(getters.map((g) => table.value(r, g.index)))) ? 1 : 0;
    f.masks.set(id, m);
  }
  return m;
}

export class FilterContext {
  private readonly visibleCache = new Map<TableData, Int32Array>();
  private readonly expansionCache = new Map<TableData, Expansion>();
  private readonly bidiCache = new Map<string, Set<number> | null>();
  private relsCache: EffectiveRel[] | null = null;

  constructor(
    readonly model: Model,
    readonly filters: readonly Filter[] = [],
    readonly relOverrides: ReadonlyMap<string, RelOverride> = new Map(),
    /** Query-level (slicer) filters that ALLSELECTED restores. */
    readonly shadow: readonly Filter[] | null = null,
    /** Group-by columns in scope, for ISINSCOPE. */
    readonly scope: ReadonlySet<number> = new Set(),
  ) {}

  with(changes: { filters?: readonly Filter[]; relOverrides?: ReadonlyMap<string, RelOverride>; shadow?: readonly Filter[] | null; scope?: ReadonlySet<number> }): FilterContext {
    return new FilterContext(
      this.model,
      changes.filters ?? this.filters,
      changes.relOverrides ?? this.relOverrides,
      changes.shadow !== undefined ? changes.shadow : this.shadow,
      changes.scope ?? this.scope,
    );
  }

  relState(rel: Relationship): { active: boolean; mode: RelMode } {
    const o = this.relOverrides.get(rel.id);
    return { active: o?.active ?? rel.isActive, mode: o?.mode ?? rel.crossFilteringBehavior };
  }

  effectiveRels(): EffectiveRel[] {
    if (!this.relsCache) {
      this.relsCache = [];
      for (const rel of this.model.relationships) {
        const s = this.relState(rel);
        if (s.active && s.mode !== "none") this.relsCache.push({ rel, mode: s.mode });
      }
    }
    return this.relsCache;
  }

  useRelationship(rel: Relationship): FilterContext {
    const next = new Map(this.relOverrides);
    for (const other of this.model.relationships) {
      if (other === rel) continue;
      const sameTables =
        (other.from.table === rel.from.table && other.to.table === rel.to.table) || (other.from.table === rel.to.table && other.to.table === rel.from.table);
      if (sameTables && this.relState(other).active) next.set(other.id, { ...next.get(other.id), active: false });
    }
    next.set(rel.id, { ...next.get(rel.id), active: true });
    return this.with({ relOverrides: next });
  }

  crossFilter(rel: Relationship, mode: RelMode): FilterContext {
    if (!this.relState(rel).active) {
      throw unsupported(`CROSSFILTER on the inactive relationship between '${rel.from.table.name}'[${rel.from.name}] and '${rel.to.table.name}'[${rel.to.name}] `, "Activate it with USERELATIONSHIP in the same CALCULATE first.");
    }
    const next = new Map(this.relOverrides);
    next.set(rel.id, { ...next.get(rel.id), mode });
    return this.with({ relOverrides: next });
  }

  /** The expanded table: the table plus every table reachable from its many side over active relationships. */
  expansion(table: TableData): Expansion {
    let exp = this.expansionCache.get(table);
    if (exp) return exp;
    const steps: Step[] = [{ table, parent: -1, rel: null }];
    const seen = new Set<TableData>([table]);
    for (let s = 0; s < steps.length; s++) {
      const cur = steps[s]!.table;
      for (const { rel } of this.effectiveRels()) {
        if (rel.from.table !== cur) continue;
        if (seen.has(rel.to.table)) {
          throw new DaxError(
            "AMBIGUOUS",
            `There are ambiguous paths from '${table.name}' to '${rel.to.table.name}'. Make one of the relationships inactive.`,
          );
        }
        seen.add(rel.to.table);
        steps.push({ table: rel.to.table, parent: s, rel });
      }
    }
    const colPos = new Map<number, { step: number; index: number }>();
    steps.forEach((st, step) => st.table.columns.forEach((c) => colPos.set(c.id, { step, index: c.index })));
    exp = { steps, colPos };
    this.expansionCache.set(table, exp);
    return exp;
  }

  expandedColumns(table: TableData): ColumnInfo[] {
    return this.expansion(table).steps.flatMap((s) => s.table.columns);
  }

  /** Row indices of `table` visible in this filter context; may include the blank row (index rowCount). */
  visible(table: TableData): Int32Array {
    const cached = this.visibleCache.get(table);
    if (cached) return cached;
    const exp = this.expansion(table);
    const masks: { rows: Int32Array; mask: Uint8Array }[] = [];
    const checks: { getters: { step: number; index: number }[]; keys: Set<string> }[] = [];
    for (const f of this.filters) {
      const positions: number[] = [];
      const getters: { step: number; index: number }[] = [];
      f.cols.forEach((c, p) => {
        const g = exp.colPos.get(c.id);
        if (g) {
          positions.push(p);
          getters.push(g);
        }
      });
      if (positions.length === 0) continue;
      const step = getters[0]!.step;
      if (getters.every((g) => g.step === step)) masks.push({ rows: stepRowArrays(exp)[step]!, mask: filterMask(f, exp.steps[step]!.table, positions, getters) });
      else checks.push({ getters, keys: positions.length === f.cols.length ? f.keys : projectedKeys(f, positions) });
    }
    const bidi: { rows: Int32Array; allowed: Set<number> }[] = [];
    exp.steps.forEach((s, step) => {
      const allowed = this.bidiAllowed(s.table, s.parent === 0 ? s.rel : null);
      if (allowed) bidi.push({ rows: stepRowArrays(exp)[step]!, allowed });
    });
    const out: number[] = [];
    const n = table.fullCount;
    if (masks.length === 0 && checks.length === 0 && bidi.length === 0) {
      const all = new Int32Array(n);
      for (let i = 0; i < n; i++) all[i] = i;
      this.visibleCache.set(table, all);
      return all;
    }
    const stepRows = checks.length ? stepRowArrays(exp) : [];
    rows: for (let i = 0; i < n; i++) {
      for (const m of masks) {
        const r = m.rows[i]!;
        if (r < 0 || !m.mask[r]) continue rows;
      }
      for (const c of checks) {
        const vals = c.getters.map((g) => exp.steps[g.step]!.table.value(stepRows[g.step]![i]!, g.index));
        if (!c.keys.has(tupleKey(vals))) continue rows;
      }
      for (const b of bidi) if (!b.allowed.has(b.rows[i]!)) continue rows;
      out.push(i);
    }
    const arr = Int32Array.from(out);
    this.visibleCache.set(table, arr);
    return arr;
  }

  isUnfiltered(table: TableData): boolean {
    return this.visible(table).length === table.fullCount;
  }

  /**
   * Rows of a one-side table allowed by bidirectional relationships. The many side is evaluated with the
   * filters that come from outside this table (filters on its own expanded columns do not bounce back).
   * `redundant` is the relationship the caller reached this table through from its many side; that many
   * side is already filtered by the same filters, so the check would be a no-op.
   */
  private bidiAllowed(table: TableData, redundant: Relationship | null): Set<number> | null {
    const cacheKey = `${table.name}|${redundant?.id ?? ""}`;
    if (this.bidiCache.has(cacheKey)) return this.bidiCache.get(cacheKey)!;
    let allowed: Set<number> | null = null;
    for (const { rel, mode } of this.effectiveRels()) {
      if (mode !== "both" || rel.to.table !== table || rel === redundant) continue;
      const own = new Set(this.expandedColumns(table).map((c) => c.id));
      const filters = removeColumnsFromFilters(this.filters, own);
      const overrides = new Map(this.relOverrides);
      overrides.set(rel.id, { ...overrides.get(rel.id), mode: "single" });
      const ctx = this.with({ filters, relOverrides: overrides });
      const many = rel.from.table;
      const vis = ctx.visible(many);
      if (vis.length === many.fullCount) continue;
      const s = new Set<number>();
      for (const r of vis) s.add(relatedRow(rel, r));
      allowed = intersect(allowed, s);
    }
    this.bidiCache.set(cacheKey, allowed);
    return allowed;
  }

  removeColumns(ids: ReadonlySet<number>, dropScope = false): FilterContext {
    const scope = dropScope ? new Set([...this.scope].filter((id) => !ids.has(id))) : this.scope;
    return this.with({ filters: removeColumnsFromFilters(this.filters, ids), scope });
  }

  addFilter(f: Filter, keep: boolean): FilterContext {
    if (keep) return this.with({ filters: [...this.filters, f] });
    const ids = new Set(f.cols.map((c) => c.id));
    return this.with({ filters: [...removeColumnsFromFilters(this.filters, ids), f] });
  }

  isFiltered(col: ColumnInfo): boolean {
    return this.filters.some((f) => f.cols.some((c) => c.id === col.id));
  }
}

export function removeColumnsFromFilters(filters: readonly Filter[], ids: ReadonlySet<number>): Filter[] {
  const out: Filter[] = [];
  for (const f of filters) {
    const keep: number[] = [];
    f.cols.forEach((c, p) => {
      if (!ids.has(c.id)) keep.push(p);
    });
    if (keep.length === f.cols.length) out.push(f);
    else if (keep.length > 0) out.push(project(f, keep));
  }
  return out;
}

function intersect(a: Set<number> | null, b: Set<number>): Set<number> {
  if (!a) return b;
  const out = new Set<number>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
