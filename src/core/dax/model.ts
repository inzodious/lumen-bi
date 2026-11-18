/** Structural stand-ins for the lakehouse types (tests pass the DuckDB-backed implementation). */
export interface QueryResult {
  columns: { name: string; type: string; rawType: string }[];
  rows: unknown[][];
}
export interface Workspace {
  query(sql: string): QueryResult;
}
import { DaxError, unsupported } from "./errors.ts";
import { Evaluator } from "./evaluator.ts";
import { FilterContext } from "./filters.ts";
import { checkFunctions } from "./functions.ts";
import { parse, type Node } from "./parser.ts";
import { DaxDate, keyOf, type Scalar } from "./values.ts";

export type DataType = "int" | "double" | "string" | "date" | "boolean";

export interface ColumnSpec {
  name: string;
  dataType: DataType;
  formatString?: string;
  isHidden?: boolean;
}

export interface ColumnInfo {
  id: number;
  table: TableData;
  index: number;
  name: string;
  dataType: DataType;
  formatString?: string;
  isHidden: boolean;
  /** Sort by column: visuals order this column's values by the other column's. */
  sortBy?: ColumnInfo;
}

export type ColumnRef = string | { table: string; column: string };

export class TableData {
  readonly columns: ColumnInfo[] = [];
  readonly rows: Scalar[][] = [];
  /** A virtual blank row exists when some relationship has many-side keys with no match here. */
  hasBlankRow = false;
  private readonly keyIndexes = new Map<number, Map<string, number>>();

  constructor(readonly name: string) {}

  get rowCount(): number {
    return this.rows.length;
  }

  /** Real rows plus the blank row, if any. The blank row's index is rowCount. */
  get fullCount(): number {
    return this.rows.length + (this.hasBlankRow ? 1 : 0);
  }

  get blankIndex(): number {
    return this.hasBlankRow ? this.rows.length : -1;
  }

  value(row: number, col: number): Scalar {
    return row >= this.rows.length ? null : this.rows[row]![col]!;
  }

  column(name: string): ColumnInfo | undefined {
    const n = name.toLowerCase();
    return this.columns.find((c) => c.name.toLowerCase() === n);
  }

  keyIndex(col: number): Map<string, number> {
    let idx = this.keyIndexes.get(col);
    if (!idx) {
      idx = new Map();
      for (let r = 0; r < this.rows.length; r++) {
        const k = keyOf(this.rows[r]![col]!);
        if (!idx.has(k)) idx.set(k, r);
      }
      this.keyIndexes.set(col, idx);
    }
    return idx;
  }
}

export type CrossFilter = "single" | "both";

export interface Relationship {
  id: string;
  from: ColumnInfo;
  to: ColumnInfo;
  isActive: boolean;
  crossFilteringBehavior: CrossFilter;
  /** Whether row-level security also flows from the many side up to the one side. */
  securityFilteringBehavior: CrossFilter;
  cardinality: "manyToOne" | "oneToOne";
}

export interface RelationshipSpec {
  id?: string;
  /** Many side, e.g. "fact_transmissions[account_id]" or "fact_transmissions.account_id". */
  fromColumn: ColumnRef;
  /** One side. */
  toColumn: ColumnRef;
  isActive?: boolean;
  crossFilteringBehavior?: "single" | "both" | "oneDirection" | "bothDirections";
  securityFilteringBehavior?: "single" | "both" | "oneDirection" | "bothDirections";
  cardinality?: "manyToOne" | "oneToOne";
}

export interface Measure {
  name: string;
  table: string;
  expression: string;
  ast: Node;
  formatString?: string;
  formatStringDefinition?: string;
  formatAst?: Node;
  displayFolder?: string;
}

export interface MeasureSpec {
  name: string;
  expression: string;
  table?: string;
  formatString?: string;
  formatStringDefinition?: string;
  displayFolder?: string;
}

export interface CalculatedColumnSpec {
  table: string;
  name: string;
  expression: string;
  /** Inferred from the values when omitted. */
  dataType?: DataType;
  formatString?: string;
  isHidden?: boolean;
}

export interface CalculationItem {
  name: string;
  ordinal: number;
  expression: string;
  ast: Node;
  formatStringDefinition?: string;
  formatAst?: Node;
}

export interface CalculationGroup {
  table: TableData;
  column: ColumnInfo;
  precedence: number;
  items: CalculationItem[];
}

export interface CalculationGroupSpec {
  name: string;
  column?: string;
  ordinalColumn?: string;
  precedence?: number;
  items: { name: string; expression: string; formatStringDefinition?: string; ordinal?: number }[];
}

function parseExpression(expr: string, what: string): Node {
  try {
    const ast = parse(expr);
    checkFunctions(ast);
    return ast;
  } catch (e) {
    if (e instanceof DaxError) throw new DaxError(e.code, `${what}: ${e.message}`);
    throw e;
  }
}

function convert(v: unknown, col: ColumnSpec, table: string): Scalar {
  if (v === null || v === undefined) return null;
  const where = `column '${col.name}' in table '${table}'`;
  switch (col.dataType) {
    case "int": {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isInteger(n)) throw new DaxError("TYPE", `Cannot convert value '${String(v)}' to Whole Number for ${where}.`);
      return n;
    }
    case "double": {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || Number.isNaN(n)) throw new DaxError("TYPE", `Cannot convert value '${String(v)}' to Decimal Number for ${where}.`);
      return n;
    }
    case "string":
      return String(v);
    case "boolean":
      if (typeof v === "boolean") return v;
      throw new DaxError("TYPE", `Cannot convert value '${String(v)}' to True/False for ${where}.`);
    case "date":
      if (v instanceof DaxDate) return v;
      if (v instanceof Date) return new DaxDate(Math.floor(v.getTime() / 86_400_000));
      if (typeof v === "string") return DaxDate.fromIso(v);
      throw new DaxError("TYPE", `Cannot convert value '${String(v)}' to Date for ${where}.`);
  }
}

export function parseColumnRef(ref: ColumnRef): { table: string; column: string } {
  if (typeof ref !== "string") return ref;
  const m = /^\s*(?:'((?:[^']|'')+)'|([^[.]+?))\s*(?:\[((?:[^\]]|\]\])+)\]|\.(.+))\s*$/.exec(ref);
  if (!m) throw new DaxError("REF", `'${ref}' is not a column reference. Write it as table[column].`);
  return { table: (m[1]?.replace(/''/g, "'") ?? m[2]!).trim(), column: (m[3]?.replace(/]]/g, "]") ?? m[4]!).trim() };
}

export class Model {
  readonly tables = new Map<string, TableData>();
  readonly relationships: Relationship[] = [];
  readonly measures = new Map<string, Measure>();
  readonly calculationGroups: CalculationGroup[] = [];
  dateTable: { table: TableData; column: ColumnInfo } | null = null;
  private nextColumnId = 1;
  private dirty = true;

  addTable(name: string, columns: ColumnSpec[], rows: (Record<string, unknown> | unknown[])[] = []): TableData {
    if (this.tables.has(name.toLowerCase())) throw new DaxError("MODEL", `The model already has a table named '${name}'.`);
    const t = new TableData(name);
    columns.forEach((c, index) => {
      if (t.column(c.name)) throw new DaxError("MODEL", `Table '${name}' has two columns named '${c.name}'.`);
      t.columns.push({ id: this.nextColumnId++, table: t, index, name: c.name, dataType: c.dataType, formatString: c.formatString, isHidden: c.isHidden ?? false });
    });
    for (const r of rows) {
      if (Array.isArray(r)) {
        if (r.length !== columns.length) throw new DaxError("MODEL", `A row for table '${name}' has ${r.length} values but the table has ${columns.length} columns.`);
        t.rows.push(columns.map((c, i) => convert(r[i], c, name)));
      } else {
        for (const k of Object.keys(r)) {
          if (!columns.some((c) => c.name === k)) throw new DaxError("MODEL", `A row for table '${name}' has a value for '${k}', which is not a column of the table.`);
        }
        t.rows.push(columns.map((c) => convert(r[c.name], c, name)));
      }
    }
    this.tables.set(name.toLowerCase(), t);
    this.dirty = true;
    return t;
  }

  table(name: string): TableData {
    const t = this.tables.get(name.toLowerCase());
    if (!t) throw new DaxError("REF", `Cannot find table '${name}'.`);
    return t;
  }

  findTable(name: string): TableData | undefined {
    return this.tables.get(name.toLowerCase());
  }

  column(ref: ColumnRef): ColumnInfo {
    const { table, column } = parseColumnRef(ref);
    const c = this.table(table).column(column);
    if (!c) throw new DaxError("REF", `Column '${column}' in table '${table}' cannot be found or may not be used in this expression.`);
    return c;
  }

  /** Power BI refuses a sort column with more than one value for a value of the sorted column. */
  setSortBy(ref: ColumnRef, by: string): void {
    const col = this.column(ref);
    const key = col.table.column(by);
    if (!key) throw new DaxError("REF", `Column '${by}' in table '${col.table.name}' cannot be found or may not be used in this expression.`);
    const seen = new Map<string, string>();
    for (const row of col.table.rows) {
      const k = keyOf(row[col.index] ?? null);
      const v = keyOf(row[key.index] ?? null);
      if (seen.has(k) && seen.get(k) !== v) {
        throw new DaxError(
          "MODEL",
          `We can't sort the '${col.name}' column by '${key.name}'. There can't be more than one value in '${key.name}' for the same value in '${col.name}'. Please choose a different column for sorting or update the data in '${key.name}'.`,
        );
      }
      seen.set(k, v);
    }
    col.sortBy = key;
  }

  addRelationship(spec: RelationshipSpec): Relationship {
    const from = this.column(spec.fromColumn);
    const to = this.column(spec.toColumn);
    const card = spec.cardinality ?? "manyToOne";
    if (card !== "manyToOne" && card !== "oneToOne") throw unsupported(`Relationship cardinality '${String(card)}'`);
    const seen = new Set<string>();
    for (const row of to.table.rows) {
      const k = keyOf(row[to.index]!);
      if (seen.has(k)) {
        throw new DaxError(
          "MODEL",
          `Column '${to.name}' in table '${to.table.name}' contains a duplicate value '${String(row[to.index])}', so it cannot be the one side of a relationship.`,
        );
      }
      seen.add(k);
    }
    const cfb = spec.crossFilteringBehavior ?? "single";
    const rel: Relationship = {
      id: spec.id ?? `${from.table.name}.${from.name}->${to.table.name}.${to.name}`,
      from,
      to,
      isActive: spec.isActive ?? true,
      crossFilteringBehavior: cfb === "both" || cfb === "bothDirections" ? "both" : "single",
      securityFilteringBehavior: spec.securityFilteringBehavior === "both" || spec.securityFilteringBehavior === "bothDirections" ? "both" : "single",
      cardinality: card,
    };
    if (rel.isActive) {
      const clash = this.relationships.find((r) => r.isActive && r.from.table === from.table && r.to.table === to.table);
      if (clash) {
        throw new DaxError(
          "MODEL",
          `There is already an active relationship between '${from.table.name}' and '${to.table.name}' (${clash.id}). Make this one inactive and use USERELATIONSHIP.`,
        );
      }
    }
    this.relationships.push(rel);
    this.dirty = true;
    return rel;
  }

  /** Adds a calculated column, evaluated now in each row's context, so add relationships (and any measures it uses) first. */
  addCalculatedColumn(spec: CalculatedColumnSpec): ColumnInfo {
    const t = this.table(spec.table);
    if (t.column(spec.name)) throw new DaxError("MODEL", `Table '${t.name}' already has a column named '${spec.name}'.`);
    const ast = parseExpression(spec.expression, `Calculated column '${t.name}'[${spec.name}]`);
    this.prepare();
    const values = new Evaluator(this).rowValues(t, ast, new FilterContext(this));
    const dataType = spec.dataType ?? inferType(values, `${t.name}[${spec.name}]`);
    const col: ColumnInfo = { id: this.nextColumnId++, table: t, index: t.columns.length, name: spec.name, dataType, formatString: spec.formatString, isHidden: spec.isHidden ?? false };
    const where = { name: spec.name, dataType };
    t.columns.push(col);
    t.rows.forEach((r, i) => r.push(values[i] === null ? null : convert(values[i], where, t.name)));
    this.dirty = true;
    return col;
  }

  addMeasure(spec: MeasureSpec): Measure {
    const key = spec.name.toLowerCase();
    if (this.measures.has(key)) throw new DaxError("MODEL", `The model already has a measure named '${spec.name}'.`);
    const table = spec.table ?? "_measures_kpi";
    if (!this.findTable(table)) this.addTable(table, [{ name: "placeholder", dataType: "string", isHidden: true }]);
    const m: Measure = {
      name: spec.name,
      table: this.table(table).name,
      expression: spec.expression,
      ast: parseExpression(spec.expression, `Measure '${spec.name}'`),
      formatString: spec.formatString,
      formatStringDefinition: spec.formatStringDefinition,
      formatAst: spec.formatStringDefinition ? parseExpression(spec.formatStringDefinition, `formatStringDefinition of '${spec.name}'`) : undefined,
      displayFolder: spec.displayFolder,
    };
    this.measures.set(key, m);
    return m;
  }

  measure(name: string): Measure | undefined {
    return this.measures.get(name.toLowerCase());
  }

  addCalculationGroup(spec: CalculationGroupSpec): CalculationGroup {
    const colName = spec.column ?? "Name";
    const ordName = spec.ordinalColumn ?? "Ordinal";
    const items: CalculationItem[] = spec.items.map((it, i) => ({
      name: it.name,
      ordinal: it.ordinal ?? i,
      expression: it.expression,
      ast: parseExpression(it.expression, `Calculation item '${it.name}'`),
      formatStringDefinition: it.formatStringDefinition,
      formatAst: it.formatStringDefinition ? parseExpression(it.formatStringDefinition, `formatStringDefinition of '${it.name}'`) : undefined,
    }));
    const t = this.addTable(
      spec.name,
      [
        { name: colName, dataType: "string" },
        { name: ordName, dataType: "int", isHidden: true },
      ],
      items.map((it) => [it.name, it.ordinal]),
    );
    const g: CalculationGroup = { table: t, column: t.columns[0]!, precedence: spec.precedence ?? 0, items };
    this.calculationGroups.push(g);
    return g;
  }

  markAsDateTable(table: string, column = "date"): void {
    const t = this.table(table);
    const c = t.column(column);
    if (!c) throw new DaxError("REF", `Column '${column}' in table '${table}' cannot be found.`);
    if (c.dataType !== "date") throw new DaxError("MODEL", `The date table key '${table}[${column}]' must have data type date.`);
    const seen = new Set<string>();
    for (const r of t.rows) {
      const v = r[c.index]!;
      if (v === null) throw new DaxError("MODEL", `The date column '${table}[${column}]' contains a blank, so it cannot mark a date table.`);
      if (seen.has(keyOf(v))) throw new DaxError("MODEL", `The date column '${table}[${column}]' contains duplicate dates, so it cannot mark a date table.`);
      seen.add(keyOf(v));
    }
    const days = t.rows.map((r) => (r[c.index] as DaxDate).days).sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      if (days[i]! - days[i - 1]! !== 1) throw new DaxError("MODEL", `The date column '${table}[${column}]' has gaps, so it cannot mark a date table. A date table needs one row per day.`);
    }
    this.dateTable = { table: t, column: c };
  }

  /** Computes blank rows. Called before evaluation; cheap when nothing changed. */
  prepare(): void {
    if (!this.dirty) return;
    for (const t of this.tables.values()) t.hasBlankRow = false;
    for (const r of this.relationships) {
      const idx = r.to.table.keyIndex(r.to.index);
      if (r.from.table.rows.some((row) => !idx.has(keyOf(row[r.from.index]!)) || row[r.from.index] === null)) r.to.table.hasBlankRow = true;
    }
    this.dirty = false;
  }
}

function inferType(values: Scalar[], where: string): DataType {
  const kinds = new Set<DataType>();
  for (const v of values) {
    if (v === null) continue;
    if (v instanceof DaxDate) kinds.add("date");
    else if (typeof v === "boolean") kinds.add("boolean");
    else if (typeof v === "string") kinds.add("string");
    else kinds.add(Number.isInteger(v) ? "int" : "double");
  }
  if (kinds.has("int") && kinds.has("double")) kinds.delete("int");
  if (kinds.size > 1) {
    throw unsupported(`A calculated column that mixes ${[...kinds].join(" and ")} values (${where})`, "Make every branch return the same type, for example with FORMAT or VALUE.");
  }
  return [...kinds][0] ?? "double";
}

function logicalToDataType(type: string, rawType: string, column: string): DataType {
  switch (type) {
    case "integer":
    case "bigint":
      return "int";
    case "double":
    case "decimal":
      return "double";
    case "varchar":
      return "string";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    default:
      throw unsupported(`Loading column '${column}' of type ${rawType} into a semantic model`);
  }
}

export function loadQueryResult(model: Model, name: string, result: QueryResult): TableData {
  const columns = result.columns.map((c) => ({ name: c.name, dataType: logicalToDataType(c.type, c.rawType, c.name) }));
  return model.addTable(name, columns, result.rows as unknown[][]);
}

/** Imports a lakehouse table (a `lakehouse.schema.table` ref) or any SELECT into the model, like an Import-mode partition. */
export function loadTableFromWorkspace(model: Model, ws: Workspace, name: string, source: string): TableData {
  const sql = /^\s*select\b/i.test(source) || /^\s*with\b/i.test(source) ? source : `SELECT * FROM ${source}`;
  return loadQueryResult(model, name, ws.query(sql));
}
