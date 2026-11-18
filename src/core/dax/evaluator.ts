import { DaxError, unsupported, unsupportedFunction } from "./errors.ts";
import { FilterContext, makeFilter, rowsForSteps, type Filter, type RelMode } from "./filters.ts";
import { formatValue } from "./format.ts";
import type { CalculationGroup, CalculationItem, ColumnInfo, DataType, Measure, Model, Relationship, TableData } from "./model.ts";
import type { Node } from "./parser.ts";
import { dateAdd, datesInPeriod, datesToDate, parallelPeriod, parseInterval, previousPeriod } from "./timeintel.ts";
import { arithmetic, compare, DaxDate, keyOf, sortCompare, toBool, toNumber, toText, tupleKey, type Scalar } from "./values.ts";

export interface TCol {
  name: string;
  lineage: ColumnInfo | null;
  /** Named by the query (ADDCOLUMNS, SELECTCOLUMNS, ROW ...): shown as [name] rather than table[column]. */
  alias?: boolean;
  /** Declared type (DATATABLE); otherwise the lineage column's type or the values' type. */
  dataType?: DataType;
}

export interface TableValue {
  kind: "table";
  columns: TCol[];
  rows: Scalar[][];
  /** Set when the rows are rows of a model table (table reference, FILTER over it, ALL ( table )). */
  base?: { table: TableData; ids: number[] };
}

export type Val = Scalar | TableValue;

interface RowCtx {
  table: TableValue;
  index: number;
}

export interface Binding {
  node: Node;
  env: Env;
  value?: Val;
  busy?: boolean;
}

export interface Scope {
  vars: Map<string, Binding>;
  parent: Scope | null;
}

interface CalcState {
  measure: Measure;
  item: CalculationItem;
}

export interface Env {
  ctx: FilterContext;
  rows: RowCtx[];
  scope: Scope | null;
  calc: CalcState | null;
  /** Evaluating inside an iterator, or a measure called from one: ALLSELECTED shadow contexts are not modeled there. */
  inIterator: boolean;
  /** Row contexts before this index were already turned into filters by an enclosing CALCULATE. */
  transitioned?: number;
  stack: string[];
  /** The measure whose formatStringDefinition is being evaluated, for SELECTEDMEASUREFORMATSTRING. */
  formatOf?: Measure;
}

export interface EvalOptions {
  now?: () => Date;
  /** What USERPRINCIPALNAME () and USERNAME () return: the signed-in user, or the one picked in View as. */
  userPrincipalName?: string;
}

function isTable(v: Val): v is TableValue {
  return typeof v === "object" && v !== null && !(v instanceof DaxDate);
}

/** Table functions mostly written in DAX queries (EVALUATE), usable in measures too. */
const QUERY_TABLE_FUNCTIONS = ["SUMMARIZECOLUMNS", "ADDCOLUMNS", "SELECTCOLUMNS", "TOPN", "ROW", "DATATABLE", "SUMMARIZE", "GENERATE", "CROSSJOIN", "EXCEPT", "INTERSECT"];

const CONTEXT_FUNCTIONS = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTROWS",
  "DISTINCTCOUNT",
  "SUMX",
  "AVERAGEX",
  "CALCULATE",
  "CALCULATETABLE",
  "FILTER",
  "ALL",
  "ALLSELECTED",
  "VALUES",
  "DISTINCT",
  "SELECTEDVALUE",
  "HASONEVALUE",
  "ISINSCOPE",
  "LOOKUPVALUE",
  "TREATAS",
  "UNION",
  "DATESYTD",
  "DATESMTD",
  "DATESQTD",
  "SAMEPERIODLASTYEAR",
  "DATEADD",
  "SELECTEDMEASURE",
  "RELATEDTABLE",
  "COUNTA",
  "COUNTBLANK",
  "COUNTX",
  "MINX",
  "MAXX",
  "ISFILTERED",
  "ISCROSSFILTERED",
  "TOTALYTD",
  "TOTALQTD",
  "TOTALMTD",
  "DATESBETWEEN",
  "DATESINPERIOD",
  "PREVIOUSMONTH",
  "PREVIOUSQUARTER",
  "PREVIOUSYEAR",
  "PARALLELPERIOD",
  ...QUERY_TABLE_FUNCTIONS,
]);

const TABLE_FUNCTIONS = new Set([
  "FILTER",
  "ALL",
  "ALLSELECTED",
  "VALUES",
  "DISTINCT",
  "CALCULATETABLE",
  "TREATAS",
  "UNION",
  "DATESYTD",
  "DATESMTD",
  "DATESQTD",
  "SAMEPERIODLASTYEAR",
  "DATEADD",
  "RELATEDTABLE",
  "DATESBETWEEN",
  "DATESINPERIOD",
  "PREVIOUSMONTH",
  "PREVIOUSQUARTER",
  "PREVIOUSYEAR",
  "PARALLELPERIOD",
  ...QUERY_TABLE_FUNCTIONS,
]);

function singleValueError(col: ColumnInfo): DaxError {
  return new DaxError(
    "SINGLE_VALUE",
    `A single value for column '${col.name}' in table '${col.table.name}' cannot be determined. This can happen when a measure formula refers to a column that contains many values without specifying an aggregation such as min, max, count, or sum to get a single result.`,
  );
}

function blankRowAmbiguity(table: TableData, what: string): DaxError {
  return unsupported(
    `${what} while its blank row is visible (some relationship has keys with no match in '${table.name}')`,
    "Parity cannot yet reproduce exactly how Power BI treats that blank row here. Use VALUES or DISTINCT on a column instead, or fix the orphaned keys.",
  );
}

export class Evaluator {
  /** DEFINE MEASURE definitions of a DAX query: they add to the model's measures or replace them, everywhere in the query. */
  readonly queryMeasures = new Map<string, Measure>();
  /** DEFINE VAR definitions of a DAX query, visible to its EVALUATE statements and query measures. */
  queryScope: Scope | null = null;

  constructor(
    readonly model: Model,
    readonly options: EvalOptions = {},
  ) {
    model.prepare();
  }

  rootEnv(ctx: FilterContext): Env {
    return { ctx, rows: [], scope: this.queryScope, calc: null, inIterator: false, stack: [] };
  }

  lookupMeasure(name: string): Measure | undefined {
    return this.queryMeasures.get(name.toLowerCase()) ?? this.model.measure(name);
  }


  measureValue(measure: Measure, ctx: FilterContext): Scalar {
    return this.evalMeasure(measure, this.rootEnv(ctx));
  }

  expressionValue(ast: Node, ctx: FilterContext): Scalar {
    return this.scalar(ast, this.rootEnv(ctx));
  }

  /** A calculated column: the expression in the row context of each real row, with no filters. */
  rowValues(table: TableData, ast: Node, ctx: FilterContext): Scalar[] {
    const t = this.baseTable(table, Array.from({ length: table.rowCount }, (_, i) => i));
    return t.rows.map((_, index) => this.scalar(ast, { ...this.rootEnv(ctx), rows: [{ table: t, index }] }));
  }

  /** The format string a visual would use for this measure in this context. */
  formatStringFor(measure: Measure, ctx: FilterContext): string | null {
    const cg = this.activeCalcItem(ctx);
    const env: Env = { ...this.rootEnv(ctx), formatOf: measure };
    if (cg?.item.formatAst) {
      const v = this.scalar(cg.item.formatAst, { ...env, calc: { measure, item: cg.item } });
      return v === null ? (measure.formatString ?? null) : toText(v);
    }
    if (measure.formatAst) {
      const v = this.scalar(measure.formatAst, env);
      return v === null ? (measure.formatString ?? null) : toText(v);
    }
    return measure.formatString ?? null;
  }


  value(node: Node, env: Env): Val {
    switch (node.kind) {
      case "number":
        return node.value;
      case "string":
        return node.value;
      case "bool":
        return node.value;
      case "column":
        return this.columnOrMeasure(node, env);
      case "ident":
        return this.identValue(node.name, env);
      case "call":
        return this.call(node, env);
      case "binary":
        return this.binary(node, env);
      case "unary": {
        const v = this.scalar(node.operand, env);
        if (node.op === "NOT") return !toBool(v);
        if (v === null) return null;
        return node.op === "-" ? -toNumber(v) : v;
      }
      case "var": {
        const scope: Scope = { vars: new Map(), parent: env.scope };
        const inner: Env = { ...env, scope };
        for (const d of node.decls) {
          const key = d.name.toLowerCase();
          if (scope.vars.has(key)) throw new DaxError("VAR", `The variable '${d.name}' is defined twice in the same VAR block.`);
          scope.vars.set(key, { node: d.expr, env: { ...inner, scope: { vars: new Map(scope.vars), parent: env.scope } } });
        }
        return this.value(node.body, inner);
      }
      case "tableCtor":
        return this.tableCtor(node, env);
      case "tuple":
        throw new DaxError("SYNTAX", `A row tuple ( ... ) at ${node.pos.line}:${node.pos.col} can only be used inside a table constructor { } or on the left of IN.`);
    }
  }

  scalar(node: Node, env: Env): Scalar {
    const v = this.value(node, env);
    return isTable(v) ? this.tableToScalar(v) : v;
  }

  table(node: Node, env: Env, fn = "This function"): TableValue {
    const v = this.value(node, env);
    if (!isTable(v)) throw new DaxError("TYPE", `${fn} needs a table expression, but the argument at ${node.pos.line}:${node.pos.col} returns a single value.`);
    return v;
  }

  tableToScalar(t: TableValue): Scalar {
    if (t.columns.length > 1) throw new DaxError("TYPE", "The expression refers to multiple columns. Multiple columns cannot be converted to a scalar value.");
    if (t.rows.length === 0) return null;
    if (t.rows.length > 1) throw new DaxError("TYPE", "A table of multiple values was supplied where a single value was expected.");
    return t.rows[0]![0]!;
  }

  private identValue(name: string, env: Env): Val {
    for (let s = env.scope; s; s = s.parent) {
      const b = s.vars.get(name.toLowerCase());
      if (b) {
        if (b.value === undefined) {
          if (b.busy) throw new DaxError("VAR", `The variable '${name}' refers to itself.`);
          b.busy = true;
          b.value = this.value(b.node, b.env);
          b.busy = false;
        }
        return b.value;
      }
    }
    const t = this.model.findTable(name);
    if (t) return this.tableRef(t, env);
    throw new DaxError("NAME", `Failed to resolve name '${name}'. It is not a valid table, variable, or function name.`);
  }


  private measureFor(node: Extract<Node, { kind: "column" }>): Measure | null {
    const m = this.lookupMeasure(node.name);
    if (!m) return null;
    if (node.table === null) return m;
    const t = this.model.findTable(node.table);
    if (t && !t.column(node.name) && m.table.toLowerCase() === t.name.toLowerCase()) return m;
    return null;
  }

  resolveColumn(node: Node, fn: string): ColumnInfo {
    if (node.kind !== "column") throw new DaxError("TYPE", `${fn} expects a column reference such as table[column] at ${node.pos.line}:${node.pos.col}.`);
    if (node.table === null) {
      if (this.lookupMeasure(node.name)) throw new DaxError("TYPE", `${fn} expects a column reference, but [${node.name}] is a measure.`);
      throw new DaxError("REF", `Write the column [${node.name}] with its table name, as table[${node.name}], in ${fn}.`);
    }
    const t = this.model.findTable(node.table);
    if (!t) throw new DaxError("REF", `Cannot find table '${node.table}'.`);
    const c = t.column(node.name);
    if (!c) {
      if (this.measureFor(node)) throw new DaxError("TYPE", `${fn} expects a column reference, but '${node.table}'[${node.name}] is a measure.`);
      throw new DaxError("REF", `Column '${node.name}' in table '${node.table}' cannot be found or may not be used in this expression.`);
    }
    return c;
  }

  private columnOrMeasure(node: Extract<Node, { kind: "column" }>, env: Env): Val {
    const m = this.measureFor(node);
    if (m) return this.evalMeasure(m, env);
    if (node.table === null) {
      for (let i = env.rows.length - 1; i >= 0; i--) {
        const rc = env.rows[i]!;
        const idx = rc.table.columns.findIndex((c) => c.name.toLowerCase() === node.name.toLowerCase());
        if (idx >= 0) return rc.table.rows[rc.index]![idx]!;
      }
      throw new DaxError("REF", `The value for '${node.name}' cannot be determined. Either the column doesn't exist, or there is no current row for this column.`);
    }
    const col = this.resolveColumn(node, "This expression");
    return this.rowValue(col, env);
  }

  private rowValue(col: ColumnInfo, env: Env): Scalar {
    for (let i = env.rows.length - 1; i >= 0; i--) {
      const rc = env.rows[i]!;
      const idx = rc.table.columns.findIndex((c) => c.lineage === col);
      if (idx >= 0) return rc.table.rows[rc.index]![idx]!;
    }
    throw singleValueError(col);
  }

  private tableRef(t: TableData, env: Env): TableValue {
    const vis = env.ctx.visible(t);
    if (t.hasBlankRow && vis.length > 0 && vis[vis.length - 1] === t.blankIndex) throw blankRowAmbiguity(t, `Referencing table '${t.name}' directly`);
    return this.baseTable(t, [...vis]);
  }

  private baseTable(t: TableData, ids: number[]): TableValue {
    return {
      kind: "table",
      columns: t.columns.map((c) => ({ name: c.name, lineage: c })),
      rows: ids.map((i) => t.columns.map((c) => t.value(i, c.index))),
      base: { table: t, ids },
    };
  }


  private activeCalcItem(ctx: FilterContext): { group: CalculationGroup; item: CalculationItem } | null {
    let found: { group: CalculationGroup; item: CalculationItem } | null = null;
    for (const g of this.model.calculationGroups) {
      if (!g.table.columns.some((c) => ctx.isFiltered(c))) continue;
      const vis = ctx.visible(g.table);
      if (vis.length === g.table.fullCount) continue;
      if (vis.length !== 1) {
        throw unsupported(
          `Filtering calculation group '${g.table.name}' to ${vis.length === 0 ? "no items" : `${vis.length} items at once`}`,
          "Select exactly one calculation item, or none.",
        );
      }
      const name = g.table.value(vis[0]!, g.column.index);
      const item = g.items.find((it) => it.name === name)!;
      if (found) throw unsupported("Applying items from two calculation groups at once");
      found = { group: g, item };
    }
    return found;
  }

  evalMeasure(m: Measure, env: Env): Scalar {
    if (env.stack.includes(m.name)) {
      const path = [...env.stack, m.name].filter((x) => !x.startsWith("__"));
      throw new DaxError("CIRCULAR", `A circular dependency was detected: ${path.join(" -> ")}.`);
    }
    const ctx = this.transition(env);
    const stack = [...env.stack, m.name];
    const cg = this.model.calculationGroups.length > 0 ? this.activeCalcItem(ctx) : null;
    if (cg) {
      if (env.calc) {
        throw unsupported(
          `Applying calculation item '${cg.item.name}' to [${m.name}], which is referenced from inside [${env.calc.measure.name}]`,
          "Parity applies calculation items only to measures that do not reference other measures (a calculation item over a measure that references other measures).",
        );
      }
      return this.scalar(cg.item.ast, { ctx, rows: [], scope: this.queryScope, calc: { measure: m, item: cg.item }, inIterator: env.inIterator, stack });
    }
    return this.scalar(m.ast, { ctx, rows: [], scope: this.queryScope, calc: env.calc, inIterator: env.inIterator, stack, formatOf: env.formatOf });
  }

  /** Turns every row context into filters on the lineage columns of its row (context transition). */
  transition(env: Env): FilterContext {
    const pending = env.rows.slice(env.transitioned ?? 0);
    if (pending.length === 0) return env.ctx;
    const ids = new Set<number>();
    const added: Filter[] = [];
    for (const rc of pending) {
      const t = rc.table;
      if (t.base) {
        const id = t.base.ids[rc.index]!;
        const vis = env.ctx.visible(t.base.table);
        if (!vis.includes(id)) {
          const own = new Set(t.base.table.columns.map((c) => c.id));
          const outside = env.ctx.filters.some((f) => f.cols.some((c) => !own.has(c.id) && env.ctx.expansion(t.base!.table).colPos.has(c.id)));
          if (outside) {
            throw unsupported(
              `Context transition over a row of '${t.base.table.name}' that the current filters on its related tables exclude`,
              `This happens when iterating ALL ( ${t.base.table.name} ) under a slicer; iterate VALUES of a column instead.`,
            );
          }
        }
      }
      t.columns.forEach((c, i) => {
        if (!c.lineage) return;
        ids.add(c.lineage.id);
        added.push(makeFilter([c.lineage], [[t.rows[rc.index]![i]!]]));
      });
    }
    const base = env.ctx.removeColumns(ids);
    const replaced = new Set<number>();
    const filters = [...base.filters];
    for (let i = added.length - 1; i >= 0; i--) {
      const f = added[i]!;
      if (replaced.has(f.cols[0]!.id)) continue;
      replaced.add(f.cols[0]!.id);
      filters.push(f);
    }
    return base.with({ filters });
  }


  private relationshipFor(a: ColumnInfo, b: ColumnInfo, fn: string): Relationship {
    const rel = this.model.relationships.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
    if (!rel) {
      throw new DaxError(
        "REF",
        `${fn} needs the two columns of an existing relationship, but there is no relationship between '${a.table.name}'[${a.name}] and '${b.table.name}'[${b.name}].`,
      );
    }
    return rel;
  }

  private collectFilterColumns(node: Node, out: ColumnInfo[]): void {
    switch (node.kind) {
      case "column": {
        if (this.measureFor(node)) return;
        if (node.table === null) throw new DaxError("REF", `Write [${node.name}] with its table name in a CALCULATE filter, as table[${node.name}].`);
        const c = this.resolveColumn(node, "A CALCULATE filter");
        if (!out.includes(c)) out.push(c);
        return;
      }
      case "call":
        if (CONTEXT_FUNCTIONS.has(node.name.toUpperCase())) return;
        node.args.forEach((a) => this.collectFilterColumns(a, out));
        return;
      case "binary":
        this.collectFilterColumns(node.left, out);
        this.collectFilterColumns(node.right, out);
        return;
      case "unary":
        this.collectFilterColumns(node.operand, out);
        return;
      case "tuple":
        node.items.forEach((a) => this.collectFilterColumns(a, out));
        return;
      case "var":
        node.decls.forEach((d) => this.collectFilterColumns(d.expr, out));
        this.collectFilterColumns(node.body, out);
        return;
      default:
        return;
    }
  }

  private allValues(cols: ColumnInfo[]): TableValue {
    const t = cols[0]!.table;
    if (cols.some((c) => c.table !== t)) throw new DaxError("ARG", "All column arguments of ALL must come from the same table.");
    return this.distinctTuples(t, cols, allRows(t));
  }

  private distinctTuples(t: TableData, cols: ColumnInfo[], ids: Iterable<number>): TableValue {
    const seen = new Set<string>();
    const rows: Scalar[][] = [];
    for (const i of ids) {
      const r = cols.map((c) => t.value(i, c.index));
      const k = tupleKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
    return { kind: "table", columns: cols.map((c) => ({ name: c.name, lineage: c })), rows };
  }

  /** Converts an evaluated table into a filter. Rows of a model table filter its whole expanded table. */
  private tableToFilter(t: TableValue, ctx: FilterContext, where: string): Filter {
    if (t.base) {
      const exp = ctx.expansion(t.base.table);
      const cols = exp.steps.flatMap((s) => s.table.columns);
      const tuples = t.base.ids.map((id) => {
        const stepRows = rowsForSteps(exp, id);
        return exp.steps.flatMap((s, i) => s.table.columns.map((c) => s.table.value(stepRows[i]!, c.index)));
      });
      return makeFilter(cols, tuples);
    }
    const missing = t.columns.find((c) => !c.lineage);
    if (missing) throw unsupported(`Using a table whose column '${missing.name}' is not a model column as a filter in ${where}`);
    return makeFilter(
      t.columns.map((c) => c.lineage!),
      t.rows,
    );
  }

  private booleanFilter(node: Node, env: Env): Filter {
    const cols: ColumnInfo[] = [];
    this.collectFilterColumns(node, cols);
    if (cols.length === 0) {
      throw new DaxError(
        "FILTER",
        `The True/False expression at ${node.pos.line}:${node.pos.col} does not specify a column. Each True/False expression used as a table filter expression must refer to exactly one column.`,
      );
    }
    if (cols.some((c) => c.table !== cols[0]!.table)) {
      throw new DaxError(
        "FILTER",
        `The True/False expression at ${node.pos.line}:${node.pos.col} uses columns from more than one table. A True/False filter can only use columns from a single table; use FILTER over a table instead.`,
      );
    }
    const all = this.allValues(cols);
    const kept = all.rows.filter((_, index) => toBool(this.scalar(node, { ...env, rows: [...env.rows, { table: all, index }], inIterator: true })));
    return makeFilter(cols, kept);
  }

  private calculateContext(args: Node[], env: Env): FilterContext {
    type Op =
      | { k: "filter"; f: Filter; keep: boolean }
      | { k: "remove"; target: "all" | TableData | ColumnInfo[] }
      | { k: "allselected"; target: "all" | TableData | ColumnInfo[] }
      | { k: "userel"; rel: Relationship }
      | { k: "cross"; rel: Relationship; mode: RelMode };

    const target = (a: Node[], fn: string): "all" | TableData | ColumnInfo[] => {
      if (a.length === 0) return "all";
      if (a.length === 1 && a[0]!.kind === "ident") {
        const t = this.model.findTable(a[0]!.name);
        if (!t) throw new DaxError("REF", `${fn} expects a table or column reference, and '${a[0]!.name}' is not a table.`);
        return t;
      }
      return a.map((x) => this.resolveColumn(x, fn));
    };

    const classify = (node: Node, keep: boolean): Op => {
      if (node.kind === "call") {
        const fn = node.name.toUpperCase();
        switch (fn) {
          case "REMOVEFILTERS":
          case "ALL":
            if (keep) throw unsupported(`KEEPFILTERS around ${fn}`);
            return { k: "remove", target: target(node.args, fn) };
          case "ALLEXCEPT": {
            if (keep) throw unsupported("KEEPFILTERS around ALLEXCEPT");
            if (node.args.length < 2 || node.args[0]!.kind !== "ident") throw new DaxError("ARG", "ALLEXCEPT takes a table and at least one column of that table (or of a table it relates to).");
            const t = this.model.findTable((node.args[0] as { name: string }).name);
            if (!t) throw new DaxError("REF", `ALLEXCEPT expects a table as its first argument, and '${(node.args[0] as { name: string }).name}' is not a table.`);
            const kept = new Set(node.args.slice(1).map((x) => this.resolveColumn(x, fn).id));
            return { k: "remove", target: env.ctx.expandedColumns(t).filter((c) => !kept.has(c.id)) };
          }
          case "ALLSELECTED":
            if (keep) throw unsupported("KEEPFILTERS around ALLSELECTED");
            return { k: "allselected", target: target(node.args, fn) };
          case "USERELATIONSHIP": {
            if (node.args.length !== 2) throw new DaxError("ARG", "USERELATIONSHIP takes exactly two column references.");
            return { k: "userel", rel: this.relationshipFor(this.resolveColumn(node.args[0]!, fn), this.resolveColumn(node.args[1]!, fn), fn) };
          }
          case "CROSSFILTER": {
            if (node.args.length !== 3) throw new DaxError("ARG", "CROSSFILTER takes two column references and a direction (NONE, BOTH or ONEWAY).");
            const rel = this.relationshipFor(this.resolveColumn(node.args[0]!, fn), this.resolveColumn(node.args[1]!, fn), fn);
            const dir = node.args[2]!;
            const d = dir.kind === "ident" ? dir.name.toUpperCase() : "";
            const mode: RelMode | null = d === "NONE" ? "none" : d === "BOTH" ? "both" : d === "ONEWAY" ? "single" : null;
            if (!mode) {
              if (d.startsWith("ONEWAY_")) throw unsupported(`CROSSFILTER direction ${d}`);
              throw new DaxError("ARG", "The third argument of CROSSFILTER must be NONE, BOTH or ONEWAY.");
            }
            return { k: "cross", rel, mode };
          }
          case "KEEPFILTERS":
            if (node.args.length !== 1) throw new DaxError("ARG", "KEEPFILTERS takes exactly one argument.");
            return classify(node.args[0]!, true);
        }
        if (TABLE_FUNCTIONS.has(fn)) return { k: "filter", f: this.tableToFilter(this.table(node, env), env.ctx, "CALCULATE"), keep };
        return { k: "filter", f: this.booleanFilter(node, env), keep };
      }
      if (node.kind === "tableCtor") throw unsupported("Using a table constructor as a CALCULATE filter", "Wrap it as TREATAS ( { ... }, table[column] ).");
      if (node.kind === "ident") {
        const v = this.value(node, env);
        if (!isTable(v)) throw new DaxError("FILTER", `The variable '${node.name}' holds a single value, so it cannot be a CALCULATE filter.`);
        return { k: "filter", f: this.tableToFilter(v, env.ctx, "CALCULATE"), keep };
      }
      if (node.kind === "var") {
        const v = this.value(node, env);
        if (isTable(v)) return { k: "filter", f: this.tableToFilter(v, env.ctx, "CALCULATE"), keep };
      }
      return { k: "filter", f: this.booleanFilter(node, env), keep };
    };

    const ops = args.map((a) => classify(a, false));
    let ctx = this.transition(env);
    for (const op of ops) if (op.k === "userel") ctx = ctx.useRelationship(op.rel);
    for (const op of ops) if (op.k === "cross") ctx = ctx.crossFilter(op.rel, op.mode);
    for (const op of ops) {
      if (op.k === "remove") ctx = this.removeFilters(ctx, op.target);
      else if (op.k === "allselected") ctx = this.allSelected(ctx, op.target, env);
    }
    // A filter on the date table's key replaces every filter on that table. DAX does the same for a date-typed
    // column on the one side of a relationship, even when the table isn't marked as a date table (SQLBI).
    for (const op of ops) {
      if (op.k !== "filter") continue;
      const key = op.f.cols.find((c) => this.clearsDateTable(c));
      if (key) ctx = ctx.removeColumns(new Set(key.table.columns.map((c) => c.id)));
    }
    // Each filter argument overrides the outer filters on its columns, and the arguments intersect with each other:
    // CALCULATE ( [m], T[d] >= a, T[d] <= b ) keeps the dates between a and b.
    const overridden = new Set<number>();
    for (const op of ops) if (op.k === "filter" && !op.keep) for (const c of op.f.cols) overridden.add(c.id);
    if (overridden.size) ctx = ctx.removeColumns(overridden);
    for (const op of ops) if (op.k === "filter") ctx = ctx.addFilter(op.f, true);
    return ctx;
  }

  private clearsDateTable(c: ColumnInfo): boolean {
    if (this.model.dateTable?.column === c) return true;
    return c.dataType === "date" && this.model.relationships.some((r) => r.to === c);
  }

  private targetIds(ctx: FilterContext, target: TableData | ColumnInfo[]): Set<number> {
    return new Set((Array.isArray(target) ? target : ctx.expandedColumns(target)).map((c) => c.id));
  }

  private removeFilters(ctx: FilterContext, target: "all" | TableData | ColumnInfo[]): FilterContext {
    if (target === "all") return ctx.with({ filters: [], scope: new Set() });
    return ctx.removeColumns(this.targetIds(ctx, target), true);
  }

  private allSelected(ctx: FilterContext, target: "all" | TableData | ColumnInfo[], env: Env): FilterContext {
    if (env.inIterator) {
      throw unsupported(
        "ALLSELECTED inside an iterator (SUMX, AVERAGEX, FILTER) or inside a measure called from one",
        "Power BI uses the iterator's shadow filter context there; compute the ALLSELECTED total in a VAR outside the iterator.",
      );
    }
    const shadow = ctx.shadow ?? [];
    if (target === "all") return ctx.with({ filters: [...shadow], scope: new Set() });
    const ids = this.targetIds(ctx, target);
    const cleared = ctx.removeColumns(ids, true);
    const restored: Filter[] = [];
    for (const f of shadow) {
      const keep = f.cols.map((c, p) => (ids.has(c.id) ? p : -1)).filter((p) => p >= 0);
      if (keep.length === 0) continue;
      restored.push(
        keep.length === f.cols.length
          ? f
          : makeFilter(
              keep.map((p) => f.cols[p]!),
              f.tuples.map((t) => keep.map((p) => t[p]!)),
            ),
      );
    }
    return cleared.with({ filters: [...cleared.filters, ...restored] });
  }


  private binary(node: Extract<Node, { kind: "binary" }>, env: Env): Scalar {
    const op = node.op;
    if (op === "IN") return this.inOperator(node, env);
    const a = this.scalar(node.left, env);
    const b = this.scalar(node.right, env);
    switch (op) {
      case "&&":
        if (a === null && b === null) return null;
        return toBool(a) && toBool(b);
      case "||":
        if (a === null && b === null) return null;
        return toBool(a) || toBool(b);
      case "=":
        return compare(a, b) === 0;
      case "==":
        if (a === null || b === null) return a === null && b === null;
        return compare(a, b) === 0;
      case "<>":
        return compare(a, b) !== 0;
      case "<":
        return compare(a, b) < 0;
      case ">":
        return compare(a, b) > 0;
      case "<=":
        return compare(a, b) <= 0;
      case ">=":
        return compare(a, b) >= 0;
      case "&":
        return toText(a) + toText(b);
      default:
        return arithmetic(op, a, b);
    }
  }

  private inOperator(node: Extract<Node, { kind: "binary" }>, env: Env): boolean {
    const left = node.left.kind === "tuple" ? node.left.items.map((i) => this.scalar(i, env)) : [this.scalar(node.left, env)];
    const t = this.table(node.right, env, "IN");
    if (t.columns.length !== left.length) {
      throw new DaxError("ARG", `The IN operator compares ${left.length} value(s) with a table of ${t.columns.length} column(s); they must match.`);
    }
    const k = tupleKey(left);
    return t.rows.some((r) => tupleKey(r) === k);
  }

  private tableCtor(node: Extract<Node, { kind: "tableCtor" }>, env: Env): TableValue {
    const width = node.rows[0]?.length ?? 1;
    const columns: TCol[] = width === 1 ? [{ name: "Value", lineage: null }] : Array.from({ length: width }, (_, i) => ({ name: `Value${i + 1}`, lineage: null }));
    return { kind: "table", columns, rows: node.rows.map((r) => r.map((c) => this.scalar(c, env))) };
  }


  private each(t: TableValue, env: Env, fn: (rowEnv: Env, index: number) => void): void {
    for (let index = 0; index < t.rows.length; index++) fn({ ...env, rows: [...env.rows, { table: t, index }], inIterator: true }, index);
  }

  private columnValues(col: ColumnInfo, env: Env): Scalar[] {
    const t = col.table;
    const out: Scalar[] = [];
    for (const i of env.ctx.visible(t)) if (i < t.rowCount) out.push(t.rows[i]![col.index]!);
    return out;
  }

  private valuesOf(col: ColumnInfo, ctx: FilterContext, includeBlankRow: boolean): TableValue {
    const t = col.table;
    const ids = [...ctx.visible(t)].filter((i) => includeBlankRow || i < t.rowCount);
    return this.distinctTuples(t, [col], ids);
  }

  private visibleDates(col: ColumnInfo, env: Env): number[] {
    if (col.dataType !== "date") throw new DaxError("TYPE", `Time intelligence functions need a date column, but '${col.table.name}'[${col.name}] has type ${col.dataType}.`);
    return this.valuesOf(col, env.ctx, false)
      .rows.map((r) => r[0])
      .filter((v): v is DaxDate => v instanceof DaxDate)
      .map((d) => d.days);
  }

  private datesArg(node: Node, env: Env, fn: string): { col: ColumnInfo; days: number[] } {
    if (node.kind === "column") {
      const col = this.resolveColumn(node, fn);
      return { col, days: this.visibleDates(col, env) };
    }
    const t = this.table(node, env, fn);
    const col = t.columns.length === 1 ? t.columns[0]!.lineage : null;
    if (!col || col.dataType !== "date") throw new DaxError("ARG", `${fn} needs a date column, or a one-column table of dates from the date table.`);
    return { col, days: t.rows.map((r) => r[0]).filter((v): v is DaxDate => v instanceof DaxDate).map((d) => d.days) };
  }

  private dateTableValue(col: ColumnInfo, days: number[]): TableValue {
    return { kind: "table", columns: [{ name: col.name, lineage: col }], rows: days.map((d) => [new DaxDate(d)]) };
  }

  private allDays(col: ColumnInfo): number[] {
    return col.table.rows
      .map((r) => r[col.index])
      .filter((v): v is DaxDate => v instanceof DaxDate)
      .map((d) => d.days)
      .sort((a, b) => a - b);
  }

  private arity(name: string, args: Node[], min: number, max = min): void {
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
      throw new DaxError("ARG", `Too ${args.length < min ? "few" : "many"} arguments were passed to the ${name} function. It takes ${want} argument(s); you passed ${args.length}.`);
    }
  }


  private call(node: Extract<Node, { kind: "call" }>, env: Env): Val {
    const fn = node.name.toUpperCase();
    const a = node.args;
    switch (fn) {
      case "BLANK":
        this.arity(fn, a, 0);
        return null;
      case "IF": {
        this.arity(fn, a, 2, 3);
        if (toBool(this.scalar(a[0]!, env))) return this.value(a[1]!, env);
        return a[2] ? this.value(a[2], env) : null;
      }
      case "SWITCH": {
        this.arity(fn, a, 3, Infinity);
        const v = this.scalar(a[0]!, env);
        let i = 1;
        for (; i + 1 < a.length; i += 2) if (compare(v, this.scalar(a[i]!, env)) === 0) return this.value(a[i + 1]!, env);
        return i < a.length ? this.value(a[i]!, env) : null;
      }
      case "COALESCE": {
        this.arity(fn, a, 2, Infinity);
        for (const x of a) {
          const v = this.scalar(x, env);
          if (v !== null) return v;
        }
        return null;
      }
      case "ISBLANK":
        this.arity(fn, a, 1);
        return this.scalar(a[0]!, env) === null;
      case "AND":
      case "OR": {
        this.arity(fn, a, 2);
        return this.binary({ kind: "binary", op: fn === "AND" ? "&&" : "||", left: a[0]!, right: a[1]!, pos: node.pos }, env);
      }
      case "NOT":
        this.arity(fn, a, 1);
        return !toBool(this.scalar(a[0]!, env));
      case "DIVIDE": {
        this.arity(fn, a, 2, 3);
        const d = this.scalar(a[1]!, env);
        if (d === null || toNumber(d) === 0) return a[2] ? this.scalar(a[2], env) : null;
        const n = this.scalar(a[0]!, env);
        if (n === null) return null;
        return toNumber(n) / toNumber(d);
      }
      case "FORMAT": {
        this.arity(fn, a, 2, 3);
        if (a[2]) {
          const loc = this.scalar(a[2], env);
          if (typeof loc !== "string" || loc.toLowerCase() !== "en-us") throw unsupported(`FORMAT with the locale ${JSON.stringify(loc)}`, 'Only "en-US" is available.');
        }
        const fmt = this.scalar(a[1]!, env);
        return formatValue(this.scalar(a[0]!, env), toText(fmt));
      }
      case "CONCATENATE":
        this.arity(fn, a, 2);
        return toText(this.scalar(a[0]!, env)) + toText(this.scalar(a[1]!, env));
      case "UNICHAR": {
        this.arity(fn, a, 1);
        const n = this.scalar(a[0]!, env);
        return n === null ? null : String.fromCodePoint(Math.trunc(toNumber(n)));
      }
      case "DATE": {
        this.arity(fn, a, 3);
        const [y, m, d] = a.map((x) => Math.trunc(toNumber(this.scalar(x, env))));
        return DaxDate.fromParts(y!, m!, d!);
      }
      case "EOMONTH": {
        this.arity(fn, a, 2);
        const d = this.toDate(this.scalar(a[0]!, env));
        if (d === null) return null;
        const n = Math.trunc(toNumber(this.scalar(a[1]!, env)));
        return DaxDate.fromParts(d.year, d.month + n + 1, 0);
      }
      case "YEAR":
      case "MONTH": {
        this.arity(fn, a, 1);
        const d = this.toDate(this.scalar(a[0]!, env)) ?? DaxDate.fromSerial(0);
        return fn === "YEAR" ? d.year : d.month;
      }
      case "USERPRINCIPALNAME":
      case "USERNAME":
        this.arity(fn, a, 0);
        return this.options.userPrincipalName ?? "pilot@starlane.mock";
      case "TODAY": {
        this.arity(fn, a, 0);
        const now = (this.options.now ?? (() => new Date()))();
        return DaxDate.fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
      }
      case "SUM":
      case "AVERAGE":
      case "COUNT":
      case "DISTINCTCOUNT":
        this.arity(fn, a, 1);
        return this.aggregate(fn, this.resolveColumn(a[0]!, fn), env);
      case "MIN":
      case "MAX": {
        this.arity(fn, a, 1, 2);
        if (a.length === 2) {
          const x = this.scalar(a[0]!, env) ?? 0;
          const y = this.scalar(a[1]!, env) ?? 0;
          const c = compare(x, y);
          return fn === "MIN" ? (c <= 0 ? x : y) : c >= 0 ? x : y;
        }
        return this.aggregate(fn, this.resolveColumn(a[0]!, fn), env);
      }
      case "COUNTROWS": {
        if (a.length === 0) throw unsupported("COUNTROWS without a table argument");
        this.arity(fn, a, 1);
        const n = this.table(a[0]!, env, fn).rows.length;
        return n === 0 ? null : n;
      }
      case "SUMX":
      case "AVERAGEX": {
        this.arity(fn, a, 2);
        const t = this.table(a[0]!, env, fn);
        let sum = 0;
        let count = 0;
        this.each(t, env, (rowEnv) => {
          const v = this.scalar(a[1]!, rowEnv);
          if (v === null) return;
          if (typeof v === "string") throw new DaxError("TYPE", `The function ${fn} cannot work with values of type String.`);
          sum += toNumber(v);
          count++;
        });
        if (count === 0) return null;
        return fn === "SUMX" ? sum : sum / count;
      }
      case "CALCULATE": {
        this.arity(fn, a, 1, Infinity);
        const ctx = this.calculateContext(a.slice(1), env);
        return this.scalar(a[0]!, { ...env, ctx, transitioned: env.rows.length });
      }
      case "CALCULATETABLE": {
        this.arity(fn, a, 1, Infinity);
        const ctx = this.calculateContext(a.slice(1), env);
        return this.table(a[0]!, { ...env, ctx, transitioned: env.rows.length }, fn);
      }
      case "FILTER": {
        this.arity(fn, a, 2);
        const t = this.table(a[0]!, env, fn);
        const keep: number[] = [];
        this.each(t, env, (rowEnv, i) => {
          if (toBool(this.scalar(a[1]!, rowEnv))) keep.push(i);
        });
        return {
          kind: "table",
          columns: t.columns,
          rows: keep.map((i) => t.rows[i]!),
          base: t.base ? { table: t.base.table, ids: keep.map((i) => t.base!.ids[i]!) } : undefined,
        };
      }
      case "ALL": {
        if (a.length === 0) throw new DaxError("ARG", "ALL ( ) with no arguments can only be used as a CALCULATE filter argument. Use REMOVEFILTERS ( ) there.");
        if (a.length === 1 && a[0]!.kind === "ident") {
          const t = this.model.findTable(a[0]!.name);
          if (!t) throw new DaxError("REF", `ALL expects a table or column reference, and '${a[0]!.name}' is not a table.`);
          return this.baseTable(t, allRows(t));
        }
        return this.allValues(a.map((x) => this.resolveColumn(x, fn)));
      }
      case "ALLSELECTED":
        throw unsupported("ALLSELECTED used as a table expression", "Use it as a CALCULATE filter modifier, for example CALCULATE ( [measure], ALLSELECTED ( table[column] ) ).");
      case "REMOVEFILTERS":
      case "USERELATIONSHIP":
      case "CROSSFILTER":
        throw new DaxError("ARG", `${fn} can only be used as a filter argument of CALCULATE or CALCULATETABLE.`);
      case "KEEPFILTERS":
        throw unsupported("KEEPFILTERS outside a CALCULATE filter argument");
      case "VALUES":
      case "DISTINCT": {
        this.arity(fn, a, 1);
        const arg = a[0]!;
        if (arg.kind === "column" && !this.measureFor(arg)) return this.valuesOf(this.resolveColumn(arg, fn), env.ctx, fn === "VALUES");
        if (fn === "VALUES") {
          const t = arg.kind === "ident" ? this.model.findTable(arg.name) : undefined;
          if (!t) throw new DaxError("ARG", "The VALUES function expects a column reference or a table reference as its argument.");
          return this.baseTable(t, [...env.ctx.visible(t)]);
        }
        if (arg.kind === "ident" && this.model.findTable(arg.name)) {
          const t = this.model.findTable(arg.name)!;
          return this.baseTable(
            t,
            [...env.ctx.visible(t)].filter((i) => i < t.rowCount),
          );
        }
        const t = this.table(arg, env, fn);
        const seen = new Set<string>();
        const keep: number[] = [];
        t.rows.forEach((r, i) => {
          const k = tupleKey(r);
          if (!seen.has(k)) {
            seen.add(k);
            keep.push(i);
          }
        });
        return {
          kind: "table",
          columns: t.columns,
          rows: keep.map((i) => t.rows[i]!),
          base: t.base ? { table: t.base.table, ids: keep.map((i) => t.base!.ids[i]!) } : undefined,
        };
      }
      case "SELECTEDVALUE": {
        this.arity(fn, a, 1, 2);
        const vals = this.valuesOf(this.resolveColumn(a[0]!, fn), env.ctx, true);
        if (vals.rows.length === 1) return vals.rows[0]![0]!;
        return a[1] ? this.scalar(a[1], env) : null;
      }
      case "HASONEVALUE":
        this.arity(fn, a, 1);
        return this.valuesOf(this.resolveColumn(a[0]!, fn), env.ctx, true).rows.length === 1;
      case "ISINSCOPE": {
        this.arity(fn, a, 1);
        const col = this.resolveColumn(a[0]!, fn);
        return env.ctx.scope.has(col.id) && env.ctx.isFiltered(col);
      }
      case "TREATAS": {
        this.arity(fn, a, 2, Infinity);
        const t = this.table(a[0]!, env, fn);
        const cols = a.slice(1).map((x) => this.resolveColumn(x, fn));
        if (t.columns.length !== cols.length) {
          throw new DaxError("ARG", `The table passed to TREATAS has ${t.columns.length} column(s), but ${cols.length} target column(s) were given; they must match.`);
        }
        return { kind: "table", columns: cols.map((c) => ({ name: c.name, lineage: c })), rows: t.rows };
      }
      case "UNION": {
        this.arity(fn, a, 2, Infinity);
        const ts = a.map((x) => this.table(x, env, fn));
        const width = ts[0]!.columns.length;
        if (ts.some((t) => t.columns.length !== width)) throw new DaxError("ARG", "Each table argument of UNION must have the same number of columns.");
        const columns = ts[0]!.columns.map((c, i) => ({ name: c.name, lineage: ts.every((t) => t.columns[i]!.lineage === c.lineage) ? c.lineage : null }));
        return { kind: "table", columns, rows: ts.flatMap((t) => t.rows) };
      }
      case "DATESYTD":
      case "DATESQTD":
      case "DATESMTD": {
        if (a.length === 2) throw unsupported(`${fn} with a year-end date argument`);
        this.arity(fn, a, 1);
        const { col, days } = this.datesArg(a[0]!, env, fn);
        const period = fn === "DATESYTD" ? "YEAR" : fn === "DATESQTD" ? "QUARTER" : "MONTH";
        return this.dateTableValue(col, datesToDate(days, this.allDays(col), period));
      }
      case "SAMEPERIODLASTYEAR": {
        this.arity(fn, a, 1);
        const { col, days } = this.datesArg(a[0]!, env, fn);
        return this.dateTableValue(col, dateAdd(days, -1, "YEAR", this.allDays(col), fn));
      }
      case "DATEADD": {
        this.arity(fn, a, 3);
        const { col, days } = this.datesArg(a[0]!, env, fn);
        const n = this.scalar(a[1]!, env);
        const iv = a[2]!;
        if (iv.kind !== "ident") throw new DaxError("ARG", "The third argument of DATEADD must be DAY, MONTH, QUARTER or YEAR.");
        return this.dateTableValue(col, dateAdd(days, Math.trunc(toNumber(n)), parseInterval(iv.name), this.allDays(col), fn));
      }
      case "LOOKUPVALUE":
        return this.lookupValue(a, env);
      case "NAMEOF": {
        this.arity(fn, a, 1);
        const arg = a[0]!;
        if (arg.kind === "column") {
          const m = this.measureFor(arg);
          if (m) return `'${m.table}'[${m.name}]`;
          const c = this.resolveColumn(arg, fn);
          return `'${c.table.name}'[${c.name}]`;
        }
        throw new DaxError("ARG", "NAMEOF expects a column or measure reference.");
      }
      case "SELECTEDMEASURE": {
        this.arity(fn, a, 0);
        if (!env.calc) throw new DaxError("CALC", "SELECTEDMEASURE can only be used in the expression of a calculation item.");
        const ctx = this.transition(env);
        // Sideways recursion: the item filtered its own group to another item, which then applies to the measure.
        const other = this.activeCalcItem(ctx);
        if (other && other.item !== env.calc.item) {
          const key = `__item:${other.group.table.name}[${other.item.name}]`;
          if (env.stack.includes(key)) {
            throw new DaxError("CIRCULAR", `Calculation item '${other.item.name}' calls itself through SELECTEDMEASURE (recursion). An item can apply another item, but not itself.`);
          }
          const calc = { measure: env.calc.measure, item: other.item };
          return this.scalar(other.item.ast, { ctx, rows: [], scope: this.queryScope, calc, inIterator: env.inIterator, stack: [...env.stack, `__item:${other.group.table.name}[${env.calc.item.name}]`, key] });
        }
        return this.scalar(env.calc.measure.ast, { ...env, ctx, rows: [], transitioned: 0, scope: this.queryScope, stack: [...env.stack, env.calc.measure.name] });
      }
      case "SELECTEDMEASUREFORMATSTRING": {
        this.arity(fn, a, 0);
        const m = env.calc?.measure ?? env.formatOf;
        if (!m) throw new DaxError("CALC", "SELECTEDMEASUREFORMATSTRING can only be used in a calculation item or a format string expression.");
        return m.formatString ?? null;
      }
      case "RELATED":
        this.arity(fn, a, 1);
        return this.related(this.resolveColumn(a[0]!, fn), env);
      case "TRUE":
      case "FALSE":
        this.arity(fn, a, 0);
        return fn === "TRUE";
      case "ALLEXCEPT":
        throw unsupported("ALLEXCEPT used as a table expression", "Use it as a CALCULATE filter modifier, for example CALCULATE ( [measure], ALLEXCEPT ( table, table[column] ) ).");
      case "RELATEDTABLE":
        this.arity(fn, a, 1);
        if (a[0]!.kind !== "ident" || !this.model.findTable(a[0]!.name)) throw new DaxError("ARG", "RELATEDTABLE expects a table reference.");
        return this.call({ kind: "call", name: "CALCULATETABLE", args: [a[0]!], pos: node.pos }, env);
      case "COUNTA":
      case "COUNTBLANK": {
        this.arity(fn, a, 1);
        const col = this.resolveColumn(a[0]!, fn);
        const t = col.table;
        const vis = env.ctx.visible(t);
        if (fn === "COUNTBLANK" && t.hasBlankRow && vis.length > 0 && vis[vis.length - 1] === t.blankIndex) throw blankRowAmbiguity(t, `COUNTBLANK over '${t.name}'[${col.name}]`);
        let n = 0;
        for (const i of vis) if (i < t.rowCount && (t.rows[i]![col.index] === null) === (fn === "COUNTBLANK")) n++;
        return n === 0 ? null : n;
      }
      case "COUNTX":
      case "MINX":
      case "MAXX": {
        this.arity(fn, a, 2);
        const t = this.table(a[0]!, env, fn);
        let n = 0;
        let best: Scalar = null;
        this.each(t, env, (rowEnv) => {
          const v = this.scalar(a[1]!, rowEnv);
          if (v === null) return;
          if (typeof v === "boolean") {
            if (fn === "COUNTX") return;
            throw new DaxError("TYPE", `The function ${fn} cannot work with values of type Boolean.`);
          }
          n++;
          if (best === null || (fn === "MINX" ? compare(v, best) < 0 : compare(v, best) > 0)) best = v;
        });
        if (fn === "COUNTX") return n === 0 ? null : n;
        return best;
      }
      case "ISFILTERED":
      case "ISCROSSFILTERED": {
        this.arity(fn, a, 1);
        const arg = a[0]!;
        const t = arg.kind === "ident" ? this.model.findTable(arg.name) : undefined;
        if (arg.kind === "ident" && !t) throw new DaxError("REF", `${fn} expects a table or column reference, and '${arg.name}' is not a table.`);
        const cols = t ? t.columns : [this.resolveColumn(arg, fn)];
        const table = t ?? cols[0]!.table;
        if (fn === "ISFILTERED") return cols.some((c) => env.ctx.isFiltered(c));
        const expanded = new Set(env.ctx.expandedColumns(table).map((c) => c.id));
        return env.ctx.filters.some((f) => f.cols.some((c) => expanded.has(c.id))) || env.ctx.visible(table).length < table.fullCount;
      }
      case "TOTALYTD":
      case "TOTALQTD":
      case "TOTALMTD": {
        this.arity(fn, a, 2, 3);
        if (a[2]?.kind === "string") throw unsupported(`${fn} with a year-end date argument`);
        const dates = { kind: "call" as const, name: `DATES${fn.slice(5)}`, args: [a[1]!], pos: node.pos };
        return this.call({ kind: "call", name: "CALCULATE", args: [a[0]!, dates, ...a.slice(2)], pos: node.pos }, env);
      }
      case "DATESBETWEEN": {
        this.arity(fn, a, 3);
        const col = this.resolveColumn(a[0]!, fn);
        this.visibleDates(col, env);
        const all = this.allDays(col);
        const from = this.toDate(this.scalar(a[1]!, env))?.days ?? all[0] ?? 0;
        const to = this.toDate(this.scalar(a[2]!, env))?.days ?? all[all.length - 1] ?? 0;
        return this.dateTableValue(col, all.filter((d) => d >= from && d <= to));
      }
      case "DATESINPERIOD": {
        this.arity(fn, a, 4);
        const col = this.resolveColumn(a[0]!, fn);
        this.visibleDates(col, env);
        const start = this.toDate(this.scalar(a[1]!, env));
        const n = Math.trunc(toNumber(this.scalar(a[2]!, env)));
        const iv = a[3]!;
        if (iv.kind !== "ident") throw new DaxError("ARG", "The fourth argument of DATESINPERIOD must be DAY, MONTH, QUARTER or YEAR.");
        const interval = parseInterval(iv.name, fn);
        return this.dateTableValue(col, start === null ? [] : datesInPeriod(this.allDays(col), start.days, n, interval));
      }
      case "PREVIOUSMONTH":
      case "PREVIOUSQUARTER":
      case "PREVIOUSYEAR": {
        if (a.length === 2) throw unsupported(`${fn} with a year-end date argument`);
        this.arity(fn, a, 1);
        const { col, days } = this.datesArg(a[0]!, env, fn);
        return this.dateTableValue(col, previousPeriod(days, this.allDays(col), fn === "PREVIOUSMONTH" ? "MONTH" : fn === "PREVIOUSQUARTER" ? "QUARTER" : "YEAR"));
      }
      case "PARALLELPERIOD": {
        this.arity(fn, a, 3);
        const { col, days } = this.datesArg(a[0]!, env, fn);
        const iv = a[2]!;
        if (iv.kind !== "ident") throw new DaxError("ARG", "The third argument of PARALLELPERIOD must be MONTH, QUARTER or YEAR.");
        return this.dateTableValue(col, parallelPeriod(days, this.allDays(col), Math.trunc(toNumber(this.scalar(a[1]!, env))), parseInterval(iv.name, fn)));
      }
      case "ROUND": {
        this.arity(fn, a, 2);
        const v = this.scalar(a[0]!, env);
        if (v === null) return null;
        const digits = Math.trunc(toNumber(this.scalar(a[1]!, env)));
        const x = toNumber(v);
        const f = Math.pow(10, digits);
        return (Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f;
      }
      case "ABS":
      case "INT": {
        this.arity(fn, a, 1);
        const v = this.scalar(a[0]!, env);
        if (v === null) return null;
        return fn === "ABS" ? Math.abs(toNumber(v)) : Math.floor(toNumber(v));
      }
      case "DAY": {
        this.arity(fn, a, 1);
        return (this.toDate(this.scalar(a[0]!, env)) ?? DaxDate.fromSerial(0)).day;
      }
      case "DATEDIFF": {
        this.arity(fn, a, 3);
        const d1 = this.toDate(this.scalar(a[0]!, env));
        const d2 = this.toDate(this.scalar(a[1]!, env));
        const iv = a[2]!;
        if (iv.kind !== "ident") throw new DaxError("ARG", "The third argument of DATEDIFF must be an interval such as DAY, MONTH, QUARTER or YEAR.");
        if (d1 === null || d2 === null) return null;
        const u = iv.name.toUpperCase();
        const days = d2.days - d1.days;
        switch (u) {
          case "SECOND":
            return days * 86400;
          case "MINUTE":
            return days * 1440;
          case "HOUR":
            return days * 24;
          case "DAY":
            return days;
          case "MONTH":
            return (d2.year - d1.year) * 12 + d2.month - d1.month;
          case "QUARTER":
            return (d2.year - d1.year) * 4 + Math.floor((d2.month - 1) / 3) - Math.floor((d1.month - 1) / 3);
          case "YEAR":
            return d2.year - d1.year;
        }
        throw unsupported(`The DATEDIFF interval ${iv.name}`);
      }
      case "UPPER":
      case "LOWER":
      case "LEN": {
        this.arity(fn, a, 1);
        const t = toText(this.scalar(a[0]!, env));
        return fn === "UPPER" ? t.toUpperCase() : fn === "LOWER" ? t.toLowerCase() : t.length;
      }
      case "LEFT":
      case "RIGHT": {
        this.arity(fn, a, 1, 2);
        const t = toText(this.scalar(a[0]!, env));
        const n = a[1] ? Math.trunc(toNumber(this.scalar(a[1], env))) : 1;
        if (n < 0) throw new DaxError("ARG", `The second argument of ${fn} must be zero or a positive number.`);
        return fn === "LEFT" ? t.slice(0, n) : n === 0 ? "" : t.slice(-n);
      }
      case "SUMMARIZECOLUMNS":
        return this.summarizeColumns(a, env);
      case "ADDCOLUMNS":
        return this.addColumns(a, env);
      case "SELECTCOLUMNS":
        return this.selectColumns(a, env);
      case "ROW": {
        if (a.length === 0 || a.length % 2 !== 0) throw new DaxError("ARG", "ROW takes pairs of a column name in double quotes and an expression: ROW ( \"name\", <expression>, ... ).");
        const pairs = this.namedPairs(fn, a, 0, []);
        return { kind: "table", columns: pairs.map((p) => p.col), rows: [pairs.map((p) => this.scalar(p.expr, env))] };
      }
      case "TOPN":
        return this.topN(a, env);
      case "SUMMARIZE":
        return this.summarize(a, env);
      case "DATATABLE":
        return this.dataTable(a, env);
      case "CROSSJOIN": {
        this.arity(fn, a, 2, Infinity);
        const ts = a.map((x) => this.table(x, env, fn));
        let rows: Scalar[][] = [[]];
        for (const t of ts) rows = rows.flatMap((r) => t.rows.map((x) => [...r, ...x]));
        return { kind: "table", columns: this.joinColumns(fn, ts), rows };
      }
      case "GENERATE": {
        this.arity(fn, a, 2);
        const t = this.table(a[0]!, env, fn);
        let inner: TCol[] | null = null;
        const rows: Scalar[][] = [];
        this.each(t, env, (rowEnv, index) => {
          const x = this.table(a[1]!, rowEnv, fn);
          inner ??= x.columns;
          for (const r of x.rows) rows.push([...t.rows[index]!, ...r]);
        });
        return { kind: "table", columns: this.joinColumns(fn, [t, { kind: "table", columns: inner ?? [], rows: [] }]), rows };
      }
      case "EXCEPT":
      case "INTERSECT": {
        this.arity(fn, a, 2);
        const [x, y] = a.map((n) => this.table(n, env, fn)) as [TableValue, TableValue];
        if (x.columns.length !== y.columns.length) throw new DaxError("ARG", `Each table argument of '${fn}' must have the same number of columns.`);
        const other = new Set(y.rows.map(tupleKey));
        const keep = x.rows.map((r, i) => [r, i] as const).filter(([r]) => other.has(tupleKey(r)) === (fn === "INTERSECT"));
        return {
          kind: "table",
          columns: x.columns,
          rows: keep.map(([r]) => r),
          base: x.base ? { table: x.base.table, ids: keep.map(([, i]) => x.base!.ids[i]!) } : undefined,
        };
      }
    }
    throw unsupportedFunction(fn);
  }

  /** The type an expression returns when its shape says so (DIVIDE is Double, COUNTROWS Int64); null when only the values can tell. */
  exprType(node: Node, depth = 0): DataType | null {
    if (depth > 20) return null;
    const t = (n: Node | undefined) => (n ? this.exprType(n, depth + 1) : null);
    switch (node.kind) {
      case "number":
        return Number.isInteger(node.value) ? "int" : "double";
      case "string":
        return "string";
      case "bool":
        return "boolean";
      case "column": {
        const m = this.measureFor(node);
        if (m) return t(m.ast);
        if (node.table === null) return null;
        return this.model.findTable(node.table)?.column(node.name)?.dataType ?? null;
      }
      case "unary":
        return node.op === "NOT" ? "boolean" : t(node.operand);
      case "var":
        return t(node.body);
      case "binary": {
        if (["=", "==", "<>", "<", ">", "<=", ">=", "IN", "&&", "||"].includes(node.op)) return "boolean";
        if (node.op === "&") return "string";
        if (node.op === "/" || node.op === "^") return "double";
        const [l, r] = [t(node.left), t(node.right)];
        if (l === "double" || r === "double") return "double";
        return l === "int" && r === "int" ? "int" : null;
      }
      case "call": {
        const fn = node.name.toUpperCase();
        const a = node.args;
        if (["DIVIDE", "AVERAGE", "AVERAGEX"].includes(fn)) return "double";
        if (["COUNTROWS", "COUNT", "COUNTA", "COUNTX", "COUNTBLANK", "DISTINCTCOUNT", "YEAR", "MONTH", "DAY", "DATEDIFF", "LEN"].includes(fn)) return "int";
        if (["FORMAT", "CONCATENATE", "UPPER", "LOWER", "LEFT", "RIGHT", "UNICHAR", "NAMEOF", "USERPRINCIPALNAME", "USERNAME"].includes(fn)) return "string";
        if (["ISBLANK", "AND", "OR", "NOT", "HASONEVALUE", "ISINSCOPE", "ISFILTERED", "ISCROSSFILTERED", "TRUE", "FALSE"].includes(fn)) return "boolean";
        if (["DATE", "EOMONTH", "TODAY"].includes(fn)) return "date";
        if (["SUM", "MIN", "MAX", "SUMX", "MINX", "MAXX", "SELECTEDVALUE", "CALCULATE", "TOTALYTD", "TOTALQTD", "TOTALMTD", "ABS"].includes(fn)) {
          const arg = fn.endsWith("X") ? a[1] : a[0];
          const x = t(arg);
          return fn === "SUMX" && x === "boolean" ? null : x;
        }
        if (fn === "IF" || fn === "COALESCE") {
          const branches = (fn === "IF" ? a.slice(1) : a).map((b) => (b.kind === "call" && b.name.toUpperCase() === "BLANK" ? "blank" : t(b)));
          const known = branches.filter((b) => b !== "blank");
          return known.length > 0 && known.every((b) => b === known[0]) ? known[0]! : null;
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** `"name", expression` pairs from `start`; a name must be a text literal and new in the table. */
  private namedPairs(fn: string, a: Node[], start: number, existing: TCol[]): { col: TCol; expr: Node }[] {
    const out: { col: TCol; expr: Node }[] = [];
    for (let i = start; i < a.length; i += 2) {
      const n = a[i]!;
      if (n.kind !== "string") throw new DaxError("ARG", `Function '${fn}' expects a column name in double quotes as argument number ${i + 1}.`);
      if (!n.value.trim()) throw new DaxError("ARG", `The column name in argument number ${i + 1} of '${fn}' is empty.`);
      const expr = a[i + 1];
      if (!expr) throw new DaxError("ARG", `Function '${fn}' needs an expression after the column name "${n.value}".`);
      this.checkNewName(fn, n.value, [...existing, ...out.map((o) => o.col)]);
      const lineage = expr.kind === "column" && expr.table !== null && !this.measureFor(expr) ? this.resolveColumn(expr, fn) : null;
      const dataType = lineage ? null : this.exprType(expr);
      out.push({ col: { name: n.value, lineage, alias: true, ...(dataType ? { dataType } : {}) }, expr });
    }
    return out;
  }

  private checkNewName(fn: string, name: string, cols: TCol[]): void {
    const clash = cols.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!clash) return;
    if (clash.alias) throw new DaxError("ARG", `Function '${fn}' cannot add column [${name}] since it already exists.`);
    throw unsupported(
      `Naming a new column '${name}' in ${fn} when the table already has the column ${clash.lineage ? `${clash.lineage.table.name}[${clash.lineage.name}]` : `[${clash.name}]`}`,
      "Give the new column a different name.",
    );
  }

  private joinColumns(fn: string, ts: TableValue[]): TCol[] {
    const out: TCol[] = [];
    for (const t of ts) {
      for (const c of t.columns) {
        const clash = out.find((o) => o.name.toLowerCase() === c.name.toLowerCase() && (o.lineage === c.lineage || o.alias || c.alias || !o.lineage || !c.lineage || o.lineage.table === c.lineage.table));
        if (clash) throw new DaxError("ARG", `Function '${fn}' does not allow two columns with the same name '${c.name}'. Rename one with SELECTCOLUMNS first.`);
        out.push(c);
      }
    }
    return out;
  }

  private addColumns(a: Node[], env: Env): TableValue {
    if (a.length < 3 || a.length % 2 === 0) throw new DaxError("ARG", "ADDCOLUMNS takes a table, then pairs of a column name in double quotes and an expression: ADDCOLUMNS ( <table>, \"name\", <expression>, ... ).");
    const t = this.table(a[0]!, env, "ADDCOLUMNS");
    const pairs = this.namedPairs("ADDCOLUMNS", a, 1, t.columns);
    const rows: Scalar[][] = [];
    this.each(t, env, (rowEnv, index) => rows.push([...t.rows[index]!, ...pairs.map((p) => this.scalar(p.expr, rowEnv))]));
    return { kind: "table", columns: [...t.columns, ...pairs.map((p) => p.col)], rows, base: t.base };
  }

  private selectColumns(a: Node[], env: Env): TableValue {
    this.arity("SELECTCOLUMNS", a, 2, Infinity);
    const t = this.table(a[0]!, env, "SELECTCOLUMNS");
    const cols: { col: TCol; expr: Node }[] = [];
    for (let i = 1; i < a.length; ) {
      const n = a[i]!;
      if (n.kind === "column" && n.table !== null && !this.measureFor(n)) {
        const c = this.resolveColumn(n, "SELECTCOLUMNS");
        this.checkNewName("SELECTCOLUMNS", c.name, cols.map((x) => x.col));
        cols.push({ col: { name: c.name, lineage: c }, expr: n });
        i += 1;
        continue;
      }
      const [p] = this.namedPairs("SELECTCOLUMNS", a.slice(0, i + 2), i, cols.map((x) => x.col));
      cols.push(p!);
      i += 2;
    }
    const rows: Scalar[][] = [];
    this.each(t, env, (rowEnv) => rows.push(cols.map((c) => this.scalar(c.expr, rowEnv))));
    return { kind: "table", columns: cols.map((c) => c.col), rows };
  }

  /**
   * SUMMARIZECOLUMNS ( group-by columns, filter tables, "name", expression, ... ): the existing combinations of the
   * group-by columns (auto-exist within a table, cross join across tables) under the filter tables, dropping rows where
   * every expression is blank. The same as a visual's grid without totals.
   */
  private summarizeColumns(a: Node[], env: Env): TableValue {
    const fn = "SUMMARIZECOLUMNS";
    if (env.rows.length > 0 || env.stack.length > 0) {
      throw unsupported(
        "SUMMARIZECOLUMNS inside a measure, an iterator or a calculated column",
        "Use it at the top of a query (EVALUATE SUMMARIZECOLUMNS ( ... )); inside a measure, use ADDCOLUMNS ( SUMMARIZE ( ... ), ... ) or ADDCOLUMNS ( VALUES ( ... ), ... ).",
      );
    }
    let i = 0;
    const groupBy: ColumnInfo[] = [];
    for (; i < a.length; i++) {
      const n = a[i]!;
      if (n.kind !== "column" || this.measureFor(n)) break;
      const c = this.resolveColumn(n, fn);
      if (groupBy.includes(c)) throw new DaxError("ARG", `The column ${c.table.name}[${c.name}] is specified more than once in ${fn}.`);
      groupBy.push(c);
    }
    const filters: Node[] = [];
    for (; i < a.length && a[i]!.kind !== "string"; i++) {
      const n = a[i]!;
      if (n.kind === "column") {
        if (this.measureFor(n)) throw new DaxError("ARG", `Give [${n.name}] a column name in ${fn}: write "${n.name}", [${n.name}].`);
        throw new DaxError("ARG", `Group-by columns come first in ${fn}, before the filter tables. Move ${n.table ?? ""}[${n.name}] to the start.`);
      }
      const isTableArg =
        n.kind === "ident" || n.kind === "var" || (n.kind === "call" && (TABLE_FUNCTIONS.has(n.name.toUpperCase()) || n.name.toUpperCase() === "KEEPFILTERS"));
      if (!isTableArg) {
        throw unsupported(
          `A True/False filter argument in ${fn} (at ${n.pos.line}:${n.pos.col})`,
          'Pass a table instead, such as TREATAS ( { "voice" }, fact_transmissions[channel] ) or FILTER ( ALL ( table[column] ), <condition> ).',
        );
      }
      filters.push(n);
    }
    if (a.length - i === 0 && groupBy.length === 0) throw new DaxError("ARG", `${fn} needs at least one group-by column or one "name", expression pair.`);
    if ((a.length - i) % 2 !== 0) throw new DaxError("ARG", `The expressions in ${fn} come in pairs: a column name in double quotes, then an expression.`);
    const exts = this.namedPairs(fn, a, i, groupBy.map((c) => ({ name: c.name, lineage: c })));

    const filtered = filters.length ? this.calculateContext(filters, env) : env.ctx;
    const base = filtered.with({ shadow: filtered.filters });
    const byTable = new Map<TableData, ColumnInfo[]>();
    for (const c of groupBy) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
    let combos: Map<number, Scalar>[] = [new Map()];
    for (const [t, cols] of byTable) {
      const seen = new Set<string>();
      const tuples: Scalar[][] = [];
      for (const r of base.visible(t)) {
        const tuple = cols.map((c) => t.value(r, c.index));
        const k = tupleKey(tuple);
        if (!seen.has(k)) {
          seen.add(k);
          tuples.push(tuple);
        }
      }
      combos = combos.flatMap((combo) => tuples.map((tuple) => new Map([...combo, ...cols.map((c, j) => [c.id, tuple[j]!] as const)])));
    }
    const scope = new Set(groupBy.map((c) => c.id));
    const rows: Scalar[][] = [];
    for (const combo of combos) {
      const keys = groupBy.map((c) => combo.get(c.id)!);
      let ctx = base;
      groupBy.forEach((c, j) => {
        ctx = ctx.addFilter(makeFilter([c], [[keys[j]!]]), true);
      });
      ctx = ctx.with({ scope });
      const values = exts.map((e) => this.scalar(e.expr, { ...env, ctx, inIterator: false }));
      if (exts.length > 0 && values.every((v) => v === null)) continue;
      rows.push([...keys, ...values]);
    }
    rows.sort((x, y) => {
      for (let j = 0; j < groupBy.length; j++) {
        const c = sortCompare(x[j]!, y[j]!);
        if (c !== 0) return c;
      }
      return 0;
    });
    return { kind: "table", columns: [...groupBy.map((c) => ({ name: c.name, lineage: c })), ...exts.map((e) => ({ ...e.col, lineage: null }))], rows };
  }

  /** TOPN ( n, table, orderBy [, ASC | DESC], ... ): ties at the cut are all kept, as in DAX. */
  private topN(a: Node[], env: Env): TableValue {
    const fn = "TOPN";
    this.arity(fn, a, 2, Infinity);
    if (a.length === 2) throw unsupported("TOPN without an order-by expression", "Add the expression to rank by, for example TOPN ( 5, VALUES ( table[column] ), [measure] ).");
    const nv = this.scalar(a[0]!, env);
    if (nv === null) throw new DaxError("ARG", "The first argument of TOPN (the number of rows) is blank.");
    const n = Math.trunc(toNumber(nv));
    const t = this.table(a[1]!, env, fn);
    const keys: { expr: Node; desc: boolean }[] = [];
    for (let i = 2; i < a.length; ) {
      const expr = a[i]!;
      const next = a[i + 1];
      let desc = true;
      let step = 1;
      if (next && next.kind === "ident" && ["ASC", "DESC"].includes(next.name.toUpperCase())) {
        desc = next.name.toUpperCase() === "DESC";
        step = 2;
      } else if (next && (next.kind === "number" || next.kind === "bool")) {
        desc = !toBool(next.value);
        step = 2;
      }
      keys.push({ expr, desc });
      i += step;
    }
    if (n <= 0 || t.rows.length === 0) return { ...t, rows: [], base: t.base ? { table: t.base.table, ids: [] } : undefined };
    const values: Scalar[][] = [];
    this.each(t, env, (rowEnv) => values.push(keys.map((k) => this.scalar(k.expr, rowEnv))));
    const cmp = (x: number, y: number) => {
      for (let k = 0; k < keys.length; k++) {
        const c = sortCompare(values[x]![k]!, values[y]![k]!);
        if (c !== 0) return keys[k]!.desc ? -c : c;
      }
      return 0;
    };
    const order = t.rows.map((_, i) => i).sort((x, y) => cmp(x, y) || x - y);
    let end = Math.min(n, order.length);
    while (end < order.length && cmp(order[end - 1]!, order[end]!) === 0) end++;
    const keep = order.slice(0, end);
    return { kind: "table", columns: t.columns, rows: keep.map((i) => t.rows[i]!), base: t.base ? { table: t.base.table, ids: keep.map((i) => t.base!.ids[i]!) } : undefined };
  }

  /** SUMMARIZE ( table, group-by columns ): the distinct combinations that exist in the table, related columns included. */
  private summarize(a: Node[], env: Env): TableValue {
    const fn = "SUMMARIZE";
    this.arity(fn, a, 2, Infinity);
    const ext = a.findIndex((x, i) => i > 0 && x.kind !== "column");
    if (ext >= 0) {
      const x = a[ext]!;
      if (x.kind === "string") {
        throw unsupported(
          "SUMMARIZE with extension columns (a \"name\", expression pair)",
          "Compute the new columns with ADDCOLUMNS ( SUMMARIZE ( <table>, <group-by columns> ), \"name\", <expression> ), or use SUMMARIZECOLUMNS, as SQLBI recommends: SUMMARIZE's extension columns evaluate in a confusing filter context.",
        );
      }
      throw new DaxError("ARG", `SUMMARIZE expects group-by columns written as table[column] after the table; argument ${ext + 1} isn't a column reference.`);
    }
    const t = this.table(a[0]!, env, fn);
    const cols = a.slice(1).map((x) => this.resolveColumn(x, fn));
    const exp = t.base ? env.ctx.expansion(t.base.table) : null;
    const getters = cols.map((c) => {
      const own = t.columns.findIndex((x) => x.lineage === c);
      if (own >= 0) return (i: number) => t.rows[i]![own]!;
      const pos = exp?.colPos.get(c.id);
      if (!pos) throw new DaxError("REF", `The column '${c.name}' specified in the 'SUMMARIZE' function was not found in the input table.`);
      return (i: number) => c.table.value(rowsForSteps(exp!, t.base!.ids[i]!)[pos.step]!, c.index);
    });
    const seen = new Set<string>();
    const rows: Scalar[][] = [];
    for (let i = 0; i < t.rows.length; i++) {
      const r = getters.map((g) => g(i));
      const k = tupleKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
    return { kind: "table", columns: cols.map((c) => ({ name: c.name, lineage: c })), rows };
  }

  /** DATATABLE ( "name", TYPE, ..., { { v1, v2 }, ... } ). */
  private dataTable(a: Node[], env: Env): TableValue {
    const fn = "DATATABLE";
    const usage = 'DATATABLE takes pairs of a column name and a type, then the rows: DATATABLE ( "Name", STRING, "Qty", INTEGER, { { "a", 1 }, { "b", 2 } } ).';
    if (a.length < 3 || a.length % 2 === 0) throw new DaxError("ARG", usage);
    const data = a[a.length - 1]!;
    if (data.kind !== "tableCtor") throw new DaxError("ARG", usage);
    const TYPES: Record<string, DataType> = { INTEGER: "int", DOUBLE: "double", CURRENCY: "double", STRING: "string", BOOLEAN: "boolean", DATETIME: "date" };
    const columns: TCol[] = [];
    for (let i = 0; i + 1 < a.length - 1; i += 2) {
      const n = a[i]!;
      const ty = a[i + 1]!;
      if (n.kind !== "string" || ty.kind !== "ident") throw new DaxError("ARG", usage);
      const dt = TYPES[ty.name.toUpperCase()];
      if (!dt) throw new DaxError("ARG", `DATATABLE column type '${ty.name}' isn't valid. Use INTEGER, DOUBLE, CURRENCY, STRING, BOOLEAN or DATETIME.`);
      this.checkNewName(fn, n.value, columns);
      columns.push({ name: n.value, lineage: null, alias: true, dataType: dt });
    }
    const rows = data.rows.map((r, k) => {
      const cells = r.length === 1 && r[0]!.kind === "tableCtor" ? r[0].rows.map((x) => x[0]!) : r;
      if (cells.length !== columns.length) throw new DaxError("ARG", `Row ${k + 1} of DATATABLE has ${cells.length} values, but ${columns.length} columns are declared.`);
      return cells.map((c, j) => {
        const v = this.scalar(c, env);
        const dt = columns[j]!.dataType!;
        if (v === null) return null;
        const bad = () => new DaxError("TYPE", `The value ${typeof v === "string" ? `"${v}"` : String(v)} in row ${k + 1} of DATATABLE can't be converted to the type of column '${columns[j]!.name}'.`);
        switch (dt) {
          case "int":
            if (typeof v !== "number" || !Number.isInteger(v)) throw bad();
            return v;
          case "double":
            if (typeof v !== "number") throw bad();
            return v;
          case "string":
            if (typeof v !== "string") throw bad();
            return v;
          case "boolean":
            if (typeof v !== "boolean") throw bad();
            return v;
          case "date":
            if (v instanceof DaxDate) return v;
            if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[ T]00:00(?::00)?)?$/.test(v)) {
              if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[ T]/.test(v)) throw unsupported("A DATATABLE date with a time of day", 'Write dates as "yyyy-mm-dd".');
              throw bad();
            }
            return DaxDate.fromIso(v);
        }
        return v;
      });
    });
    return { kind: "table", columns, rows };
  }

  private toDate(v: Scalar): DaxDate | null {
    if (v === null) return null;
    if (v instanceof DaxDate) return v;
    if (typeof v === "string") return DaxDate.fromIso(v);
    if (typeof v === "number") return DaxDate.fromSerial(Math.floor(v));
    throw new DaxError("TYPE", "Cannot convert value of type True/False to type Date.");
  }

  private aggregate(fn: string, col: ColumnInfo, env: Env): Scalar {
    if (fn === "DISTINCTCOUNT") {
      const t = col.table;
      const vis = env.ctx.visible(t);
      if (t.hasBlankRow && vis.length > 0 && vis[vis.length - 1] === t.blankIndex) throw blankRowAmbiguity(t, `DISTINCTCOUNT over '${t.name}'[${col.name}]`);
      if (vis.length === 0) return null;
      const keys = new Set<string>();
      for (const i of vis) keys.add(keyOf(t.rows[i]![col.index]!));
      return keys.size;
    }
    const vals = this.columnValues(col, env).filter((v) => v !== null);
    if (fn === "COUNT") return vals.length === 0 ? null : vals.length;
    if (vals.length === 0) return null;
    if (fn === "MIN" || fn === "MAX") {
      let best = vals[0]!;
      for (const v of vals) if (fn === "MIN" ? compare(v, best) < 0 : compare(v, best) > 0) best = v;
      return best;
    }
    if (col.dataType !== "int" && col.dataType !== "double") {
      throw new DaxError("TYPE", `The function ${fn} cannot work with values of type ${col.dataType === "string" ? "String" : col.dataType === "date" ? "Date" : "Boolean"}.`);
    }
    const sum = vals.reduce<number>((s, v) => s + (v as number), 0);
    return fn === "SUM" ? sum : sum / vals.length;
  }

  private related(col: ColumnInfo, env: Env): Scalar {
    for (let i = env.rows.length - 1; i >= 0; i--) {
      const rc = env.rows[i]!;
      if (!rc.table.base) continue;
      const exp = env.ctx.expansion(rc.table.base.table);
      const pos = exp.colPos.get(col.id);
      if (!pos) continue;
      const stepRows = rowsForSteps(exp, rc.table.base.ids[rc.index]!);
      return col.table.value(stepRows[pos.step]!, col.index);
    }
    throw new DaxError(
      "REF",
      `The column '${col.table.name}'[${col.name}] either doesn't exist or doesn't have a relationship to any table available in the current context.`,
    );
  }

  private lookupValue(a: Node[], env: Env): Scalar {
    this.arity("LOOKUPVALUE", a, 3, Infinity);
    const result = this.resolveColumn(a[0]!, "LOOKUPVALUE");
    const pairs = a.length - 1;
    const alt = pairs % 2 === 1 ? a[a.length - 1]! : null;
    const searchCols: ColumnInfo[] = [];
    let ctx = env.ctx;
    for (let i = 1; i + 1 < a.length; i += 2) {
      const col = this.resolveColumn(a[i]!, "LOOKUPVALUE");
      if (col.table !== result.table) throw unsupported("LOOKUPVALUE with search columns from a different table than the result column");
      searchCols.push(col);
      ctx = ctx.addFilter(makeFilter([col], [[this.scalar(a[i + 1]!, env)]]), false);
    }
    const unfiltered = env.ctx.removeColumns(new Set(searchCols.map((c) => c.id)));
    if (!unfiltered.isUnfiltered(result.table)) {
      throw unsupported(
        `LOOKUPVALUE on table '${result.table.name}' while the current filter context filters it`,
        "Parity only evaluates LOOKUPVALUE where the lookup table is unfiltered; use SELECTEDVALUE or CALCULATE ( VALUES ( ... ) ) instead.",
      );
    }
    const vals = this.valuesOf(result, ctx, false).rows.map((r) => r[0]!);
    if (vals.length === 0) return alt ? this.scalar(alt, env) : null;
    if (vals.length > 1) throw new DaxError("LOOKUP", "A table of multiple values was supplied where a single value was expected.");
    return vals[0]!;
  }
}

function allRows(t: TableData): number[] {
  return Array.from({ length: t.fullCount }, (_, i) => i);
}
