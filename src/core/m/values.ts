import { MError } from "./errors.ts";
import { civilFromDays, describeDateTimeArgs, durationParts } from "./calendar.ts";

export const MS_PER_DAY = 86_400_000;

export class MDate {
  constructor(readonly days: number) {}
}

/** Wall-clock milliseconds since 1970-01-01T00:00, with no zone. */
export class MDateTime {
  constructor(readonly ms: number) {}
}

/** Wall-clock milliseconds plus the offset that wall clock is in. */
export class MDateTimeZone {
  constructor(
    readonly ms: number,
    readonly offsetMinutes: number,
  ) {}
  get utcMs(): number {
    return this.ms - this.offsetMinutes * 60_000;
  }
}

export class MTime {
  constructor(readonly ms: number) {}
}

export class MDuration {
  constructor(readonly ms: number) {}
}

export class MBinary {
  private data: Uint8Array | null;
  private thunk: (() => Uint8Array) | null;
  /** `bytes` may be a thunk so a source (File.Contents, folder listings) is only read when used. */
  constructor(
    bytes: Uint8Array | (() => Uint8Array),
    readonly path?: string,
  ) {
    if (typeof bytes === "function") {
      this.data = null;
      this.thunk = bytes;
    } else {
      this.data = bytes;
      this.thunk = null;
    }
  }
  get bytes(): Uint8Array {
    if (this.data === null) {
      this.data = this.thunk!();
      this.thunk = null;
    }
    return this.data;
  }
}

export type TypeKind =
  | "any"
  | "anynonnull"
  | "none"
  | "null"
  | "logical"
  | "number"
  | "text"
  | "date"
  | "datetime"
  | "datetimezone"
  | "time"
  | "duration"
  | "binary"
  | "list"
  | "record"
  | "table"
  | "function"
  | "type";

export interface TypeField {
  name: string;
  type: MType;
  optional: boolean;
}

export class MType {
  constructor(
    readonly kind: TypeKind,
    readonly nullable = false,
    readonly facet?: string,
    readonly fields?: TypeField[],
    readonly item?: MType,
    readonly open = false,
  ) {}

  asNullable(): MType {
    if (this.nullable || this.kind === "any" || this.kind === "null") return this;
    return new MType(this.kind, true, this.facet, this.fields, this.item, this.open);
  }

  toString(): string {
    const base = this.facet ? `${this.facet}.Type` : this.kind;
    if (this.kind === "table" && this.fields) {
      return `table [${this.fields.map((f) => `${f.name} = ${f.type.toString()}`).join(", ")}]`;
    }
    return this.nullable && !this.facet ? `nullable ${base}` : base;
  }
}

export const T = {
  any: new MType("any"),
  anynonnull: new MType("anynonnull"),
  none: new MType("none"),
  null: new MType("null"),
  logical: new MType("logical"),
  number: new MType("number"),
  text: new MType("text"),
  date: new MType("date"),
  datetime: new MType("datetime"),
  datetimezone: new MType("datetimezone"),
  time: new MType("time"),
  duration: new MType("duration"),
  binary: new MType("binary"),
  list: new MType("list"),
  record: new MType("record"),
  table: new MType("table"),
  function: new MType("function"),
  type: new MType("type"),
  int64: new MType("number", true, "Int64"),
};

export interface FunctionParam {
  name: string;
  optional: boolean;
  type?: MType;
}

export class MFunction {
  /** For closures: the defining expression and scope (used by query folding to translate `each` predicates). */
  origin?: { expr: unknown; env: unknown; evaluate(expr: unknown): MValue };
  constructor(
    readonly name: string,
    readonly params: FunctionParam[],
    readonly impl: (args: MValue[]) => MValue,
  ) {}
  get minArgs(): number {
    return this.params.filter((p) => !p.optional).length;
  }
}

type LazyState = 0 | 1 | 2 | 3;

/** A memoized, cycle-checked thunk: let bindings, record fields and table cells. */
export class Lazy {
  private state: LazyState = 0;
  private value: MValue = null;
  private error: unknown;
  meta?: MRecord;

  constructor(private thunk: (() => MValue) | null) {}

  static of(value: MValue): Lazy {
    const l = new Lazy(null);
    l.state = 2;
    l.value = value;
    return l;
  }

  static failed(error: unknown): Lazy {
    const l = new Lazy(null);
    l.state = 3;
    l.error = error;
    return l;
  }

  get settled(): boolean {
    return this.state >= 2;
  }

  get failed(): boolean {
    return this.state === 3;
  }

  /** Forces the thunk and reports whether it errors, without throwing. */
  errorOf(): unknown {
    try {
      this.get();
      return undefined;
    } catch (e) {
      return e;
    }
  }

  get(): MValue {
    if (this.state === 2) return this.value;
    if (this.state === 3) throw this.error;
    if (this.state === 1) throw new MError("Expression.Error", "A cyclic reference was encountered during evaluation.");
    this.state = 1;
    try {
      this.value = this.thunk!();
      this.state = 2;
      this.thunk = null;
      return this.value;
    } catch (e) {
      this.error = e;
      this.state = 3;
      this.thunk = null;
      throw e;
    }
  }
}

export type Cell = MValue | Lazy;

export function force(c: Cell): MValue {
  return c instanceof Lazy ? c.get() : c;
}

export class MList {
  constructor(readonly cells: Cell[]) {}
  static of(values: MValue[]): MList {
    return new MList(values);
  }
  get length(): number {
    return this.cells.length;
  }
  get(i: number): MValue {
    return force(this.cells[i]!);
  }
  values(): MValue[] {
    return this.cells.map(force);
  }
}

export class MRecord {
  readonly index: Map<string, number>;
  constructor(
    readonly names: string[],
    readonly cells: Cell[],
    index?: Map<string, number>,
  ) {
    this.index = index ?? new Map(names.map((n, i) => [n, i]));
  }
  static from(entries: [string, MValue][]): MRecord {
    return new MRecord(
      entries.map((e) => e[0]),
      entries.map((e) => e[1]),
    );
  }
  has(name: string): boolean {
    return this.index.has(name);
  }
  cell(name: string): Cell | undefined {
    const i = this.index.get(name);
    return i === undefined ? undefined : this.cells[i];
  }
  get(name: string): MValue {
    const i = this.index.get(name);
    if (i === undefined) throw fieldNotFound(name);
    return force(this.cells[i]!);
  }
}

/**
 * A folded row filter, independent of the source's query language (rendered by the source: SQL text for
 * databases, structured filters for Firestore). `value`s are non-null M scalars.
 */
export type FoldPred =
  | { op: "cmp"; column: string; cmp: "=" | "<>" | "<" | "<=" | ">" | ">="; value: MValue }
  | { op: "null"; column: string; negate: boolean }
  | { op: "in"; column: string; values: MValue[]; orNull: boolean }
  | { op: "like"; column: string; mode: "starts" | "ends" | "contains"; text: string }
  | { op: "and" | "or"; left: FoldPred; right: FoldPred }
  | { op: "not"; expr: FoldPred }
  | { op: "const"; value: boolean };

/**
 * Where a table's rows come from when they can still be pushed down to the source (query folding).
 * Set only on tables that are an untransformed (or foldably transformed) source read.
 */
export interface FoldSource {
  /** Builds the rows for a folded read (columns subset / filter / order / skip / top). */
  read(spec: FoldSpec): Cell[][];
  spec: FoldSpec;
  /** Column names of the source (for SelectRows translation) */
  columns: string[];
  /** What the source can fold. Default: everything (SQL sources). */
  caps?: FoldCaps;
  /** SQL sources: how to compose this read into a larger statement (join folding, see ../lib/fold.ts). */
  sql?: FoldSql;
}

export interface FoldSql {
  /** reads with the same key run on the same server and database (a join of two of them can run there) */
  key: string;
  /** SQL dialect name (../lib/sqldialect.ts) */
  dialect: string;
  /** the complete SELECT of a folded read */
  select(spec: FoldSpec): string;
  /** runs a complete SELECT on the source */
  run(sql: string): Cell[][];
}

export interface FoldCaps {
  /** Can the source evaluate this predicate exactly like M? */
  filter?(p: FoldPred): boolean;
  sort?: boolean;
  /** Can the source sort by these keys given the current read (overrides `sort`)? */
  orderBy?(keys: { column: string; desc: boolean }[], spec: FoldSpec): boolean;
  skip?: boolean;
  /** column selection (projection) */
  columns?: boolean;
}

export interface FoldSpec {
  columns?: string[];
  /** Row filter (successive SelectRows are AND-ed). */
  filter?: FoldPred;
  /** ORDER BY keys, most significant first. */
  orderBy?: { column: string; desc: boolean }[];
  skip?: number;
  top?: number;
  /**
   * A folded predicate uses values computed from other steps or queries (not literals): those values are
   * sent to the source, which matters for privacy levels.
   */
  computed?: boolean;
}

export class MTable {
  private cachedIndex?: Map<string, number>;
  private rowData: Cell[][] | null;
  private rowThunk: (() => Cell[][]) | null;
  /** Navigation tables can explain a key miss. */
  navHint?: (key: MRecord) => string | undefined;
  /** Navigation tables can answer a key lookup without materializing every row (e.g. SQL navigation). */
  navLookup?: (key: MRecord) => MRecord | undefined;
  /** Source information for navigation tables (Value.NativeQuery on Sql.Database / PostgreSQL.Database / …). */
  source?: { kind: "sql"; server: string; database: string } | { kind: "db"; driver: "postgresql" | "mysql" | "sqlite" | "duckdb"; server: string; database: string };
  /** Present while the table is a foldable source read. */
  fold?: FoldSource;
  /** Table.NestedJoin of two reads of the same SQL source, not read yet: Table.ExpandTableColumn can fold it to a JOIN. */
  pendingJoin?: { left: MTable; right: MTable; leftKeys: string[]; rightKeys: string[]; kind: number; column: string };
  /** `rows` may be a thunk: the rows are read from the source the first time they're needed. */
  constructor(
    readonly columns: string[],
    readonly types: MType[],
    rows: Cell[][] | (() => Cell[][]),
  ) {
    if (typeof rows === "function") {
      this.rowData = null;
      this.rowThunk = rows;
    } else {
      this.rowData = rows;
      this.rowThunk = null;
    }
  }

  get rows(): Cell[][] {
    if (this.rowData === null) {
      this.rowData = this.rowThunk!();
      this.rowThunk = null;
    }
    return this.rowData;
  }

  /** True when the rows haven't been read yet. */
  get deferred(): boolean {
    return this.rowData === null;
  }

  get index(): Map<string, number> {
    this.cachedIndex ??= new Map(this.columns.map((c, i) => [c, i]));
    return this.cachedIndex;
  }

  columnIndex(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw columnNotFound(name);
    return i;
  }

  row(i: number): MRecord {
    return new MRecord(this.columns, this.rows[i]!, this.index);
  }

  records(): MRecord[] {
    return this.rows.map((r) => new MRecord(this.columns, r, this.index));
  }

  column(name: string): MList {
    const i = this.columnIndex(name);
    return new MList(this.rows.map((r) => r[i]!));
  }
}

export type MValue =
  | null
  | boolean
  | number
  | string
  | MDate
  | MDateTime
  | MDateTimeZone
  | MTime
  | MDuration
  | MBinary
  | MList
  | MRecord
  | MTable
  | MFunction
  | MType;

export type ValueKind =
  | "null"
  | "logical"
  | "number"
  | "text"
  | "date"
  | "datetime"
  | "datetimezone"
  | "time"
  | "duration"
  | "binary"
  | "list"
  | "record"
  | "table"
  | "function"
  | "type";

export function kindOf(v: MValue): ValueKind {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return "logical";
    case "number":
      return "number";
    case "string":
      return "text";
  }
  if (v instanceof MDate) return "date";
  if (v instanceof MDateTime) return "datetime";
  if (v instanceof MDateTimeZone) return "datetimezone";
  if (v instanceof MTime) return "time";
  if (v instanceof MDuration) return "duration";
  if (v instanceof MBinary) return "binary";
  if (v instanceof MList) return "list";
  if (v instanceof MRecord) return "record";
  if (v instanceof MTable) return "table";
  if (v instanceof MFunction) return "function";
  return "type";
}

const KIND_TITLES: Record<string, string> = {
  null: "Null",
  logical: "Logical",
  number: "Number",
  text: "Text",
  date: "Date",
  datetime: "DateTime",
  datetimezone: "DateTimeZone",
  time: "Time",
  duration: "Duration",
  binary: "Binary",
  list: "List",
  record: "Record",
  table: "Table",
  function: "Function",
  type: "Type",
  any: "Any",
  anynonnull: "AnyNonNull",
  none: "None",
};

export function kindTitle(kind: string): string {
  return KIND_TITLES[kind] ?? kind;
}

export function typeTitle(t: MType): string {
  return kindTitle(t.kind);
}

export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "Infinity";
  if (n === -Infinity) return "-Infinity";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-5) {
    const [mant, exp] = n.toExponential(14).split("e");
    const m = mant!.replace(/\.?0+$/, "");
    const e = Number(exp);
    return `${m}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  return String(Number(n.toPrecision(15)));
}

/** How Power Query renders a value inside an error message. */
export function describeValue(v: MValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof MDate) {
    const { y, m, d } = civilFromDays(v.days);
    return `#date(${y}, ${m}, ${d})`;
  }
  if (v instanceof MDateTime) return `#datetime(${describeDateTimeArgs(v.ms)})`;
  if (v instanceof MDateTimeZone) {
    const oh = Math.trunc(v.offsetMinutes / 60);
    return `#datetimezone(${describeDateTimeArgs(v.ms)}, ${oh}, ${v.offsetMinutes - oh * 60})`;
  }
  if (v instanceof MTime) return `#time(${describeDateTimeArgs(v.ms).split(", ").slice(3).join(", ")})`;
  if (v instanceof MDuration) {
    const p = durationParts(v.ms);
    return `#duration(${[p.d, p.h, p.mi, p.s + p.ms / 1000].map((n) => n * p.sign).join(", ")})`;
  }
  return `[${kindTitle(kindOf(v))}]`;
}

export function fieldNotFound(name: string): MError {
  return new MError("Expression.Error", `The field '${name}' of the record wasn't found.`, name);
}

export function columnNotFound(name: string): MError {
  return new MError("Expression.Error", `The column '${name}' of the table wasn't found.`, name);
}

export function cannotConvert(v: MValue, typeName: string): MError {
  return new MError("Expression.Error", `We cannot convert the value ${describeValue(v)} to type ${typeName}.`, v);
}

const TYPE_RANK: Record<ValueKind, number> = {
  null: 0,
  logical: 1,
  number: 2,
  text: 3,
  date: 4,
  datetime: 5,
  datetimezone: 6,
  time: 7,
  duration: 8,
  binary: 9,
  list: 10,
  record: 11,
  table: 12,
  function: 13,
  type: 14,
};

/** M `=`: values of different kinds are never equal (and never an error). */
export function valuesEqual(a: MValue, b: MValue): boolean {
  if (a === null || b === null) return a === b;
  const ka = kindOf(a);
  if (ka !== kindOf(b)) return false;
  switch (ka) {
    case "logical":
    case "number":
    case "text":
      return a === b;
    case "date":
      return (a as MDate).days === (b as MDate).days;
    case "datetime":
    case "time":
    case "duration":
      return (a as MDateTime).ms === (b as MDateTime).ms;
    case "datetimezone":
      return (a as MDateTimeZone).utcMs === (b as MDateTimeZone).utcMs;
    case "binary": {
      const x = (a as MBinary).bytes;
      const y = (b as MBinary).bytes;
      return x.length === y.length && x.every((byte, i) => byte === y[i]);
    }
    case "list": {
      const x = a as MList;
      const y = b as MList;
      return x.length === y.length && x.cells.every((c, i) => valuesEqual(force(c), y.get(i)));
    }
    case "record": {
      const x = a as MRecord;
      const y = b as MRecord;
      return x.names.length === y.names.length && x.names.every((n) => y.has(n) && valuesEqual(x.get(n), y.get(n)));
    }
    case "table": {
      const x = a as MTable;
      const y = b as MTable;
      if (x.columns.length !== y.columns.length || x.rows.length !== y.rows.length) return false;
      if (!x.columns.every((c) => y.index.has(c))) return false;
      return x.rows.every((row, r) =>
        x.columns.every((c, i) => valuesEqual(force(row[i]!), force(y.rows[r]![y.index.get(c)!]!))),
      );
    }
    default:
      return a === b;
  }
}

function scalarKey(v: MValue): number | string | null {
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof MDate) return v.days;
  if (v instanceof MDateTimeZone) return v.utcMs;
  if (v instanceof MDateTime || v instanceof MTime || v instanceof MDuration) return v.ms;
  return null;
}

/** Relational comparison of same-kind values; null for unordered kinds. */
export function compareSameKind(a: MValue, b: MValue): number | null {
  const x = scalarKey(a);
  const y = scalarKey(b);
  if (x === null || y === null) return null;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
}

/** `Value.Compare`: a total order used by sorting, grouping and List.Min/Max. */
export function valueCompare(a: MValue, b: MValue): number {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return TYPE_RANK[ka] - TYPE_RANK[kb];
  if (ka === "null") return 0;
  const c = compareSameKind(a, b);
  if (c !== null) return c;
  if (valuesEqual(a, b)) return 0;
  throw new MError("Expression.Error", `We cannot apply operator < to types ${kindTitle(ka)} and ${kindTitle(kb)}.`);
}

/** A string key such that valuesEqual(a, b) implies hashKey(a) === hashKey(b). */
export function hashKey(v: MValue): string {
  const k = kindOf(v);
  switch (k) {
    case "null":
      return "n";
    case "text":
      return `t${v as string}`;
    case "list":
      return `l[${(v as MList).values().map(hashKey).join("|")}]`;
    case "record": {
      const r = v as MRecord;
      return `r{${[...r.names].sort().map((n) => `${n}:${hashKey(r.get(n))}`).join("|")}}`;
    }
    default: {
      const s = scalarKey(v);
      return s === null ? `${k}?` : `${k}${String(s)}`;
    }
  }
}
