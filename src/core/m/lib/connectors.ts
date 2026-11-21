/**
 * Connector functions beyond the built-in Power Query sources:
 *
 *   PostgreSQL.Database(server, database, [Query, JsonAsRecords])   — navigation, native queries, folding
 *   MySQL.Database(server, database, [Query, JsonAsRecords])        — MySQL / MariaDB
 *   SQLite.Database(path, [Query])                                  — Lumen extension (sql.js in the main process)
 *   DuckDB.Database(path, [Query])                                  — a .duckdb file or a lakehouse folder (DuckDB-WASM in the main process)
 *   Firestore.Collections(projectId, [Database, Parent, EmulatorHost, NestedMaps, Metadata])
 *   Firestore.Query(projectId, collectionId, [Parent, AllDescendants, Where, OrderBy, Limit, …])
 *   AmazonS3.Contents(bucket, [Endpoint, Region, ForcePathStyle, Prefix])   — Folder.Files-shaped
 *   Lakehouse.Folder(path, [Endpoint, Region, ForcePathStyle])      — Fabric-style lakehouse folder (Tables/ Delta + Files/)
 *
 * Everything external goes through `ctx.host.request` (see ../host.ts); the main process connectors
 * (src/main/ipc/connectors/*) answer, with credentials from the data source settings — never from M.
 */
import { MError } from "../errors.ts";
import type { DbDriver, FirestoreDocument, FirestoreFieldFilter, FirestoreFilter, FirestoreValue, HostFileEntry, HostTable } from "../host.ts";
import { Lazy, MBinary, MDateTimeZone, MDate, MDateTime, MList, MRecord, MTable, MType, T, type Cell, type FoldPred, type FoldSpec, type MValue } from "../values.ts";
import { formatDateTime } from "../calendar.ts";
import { deltaTableFromFiles, type DeltaFile } from "./delta.ts";
import { renderPredicate } from "./fold.ts";
import { base64Decode, deltaFilesOf, folderFiles, FOLDER_COLUMNS, folderRow, hostRows, hostTableToM, jsonToM, navTable } from "./sources.ts";
import { DIALECTS } from "./sqldialect.ts";
import { flag, num, text, textOrNull, type LibContext, type Library } from "./util.ts";

// ---------------------------------------------------------------------------------------------
// Databases (PostgreSQL, MySQL / MariaDB, SQLite)

const DB_LABEL: Record<DbDriver, string> = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite", duckdb: "DuckDB" };

interface DbTarget {
  driver: DbDriver;
  server: string;
  database: string;
  jsonRecords: boolean;
}

function defaultSchema(t: DbTarget): string {
  return t.driver === "postgresql" ? "public" : t.driver === "mysql" ? t.database : "main";
}

/** json / jsonb columns: text (as Power BI does) or parsed records/lists (JsonAsRecords=true). */
function dbTable(t: DbTarget, host: HostTable): MTable {
  const m = hostTableToM(host);
  if (!t.jsonRecords) return m;
  const jsonCols = host.columns.map((c, i) => (c.type === "json" ? i : -1)).filter((i) => i >= 0);
  if (!jsonCols.length) return m;
  const types = m.types.map((ty, i) => (jsonCols.includes(i) ? T.any : ty));
  return new MTable(m.columns, types, () => m.rows.map((r) => r.map((c, i) => (jsonCols.includes(i) && typeof c === "string" ? parseJsonCell(c) : c))));
}

function parseJsonCell(s: string): Cell {
  try {
    return jsonToM(JSON.parse(s));
  } catch {
    return Lazy.failed(new MError("DataFormat.Error", "We found an unexpected character in the JSON input.", s.slice(0, 80)));
  }
}

/** A navigation read: schema first (LIMIT 0), rows on first use — foldable (see ./fold.ts). */
function dbItemTable(ctx: LibContext, t: DbTarget, schema: string, item: string): MTable {
  const d = DIALECTS[t.driver];
  const base = { kind: "db" as const, driver: t.driver, server: t.server, database: t.database, table: { schema, item } };
  const sql = (spec: FoldSpec) =>
    d.select({ schema, item, columns: spec.columns, where: spec.filter ? renderPredicate(spec.filter, d) : undefined, orderBy: spec.orderBy, skip: spec.skip, top: spec.top });
  const head = ctx.host.request({ ...base, query: sql({ top: 0 }) });
  const read = (spec: FoldSpec): Cell[][] => rowsOf(t, ctx.host.request({ ...base, query: sql(spec) }));
  const headM = dbTable(t, head);
  const out = new MTable(headM.columns, headM.types, () => read({}));
  const sqlKey = `${t.driver}|${t.driver === "sqlite" || t.driver === "duckdb" ? t.server : t.server.toLowerCase()}|${t.database.toLowerCase()}`;
  out.fold = {
    read,
    spec: {},
    columns: headM.columns,
    caps: { filter: (p) => renderPredicate(p, d) !== undefined, sort: true, skip: true },
    sql: { key: sqlKey, dialect: d.name, select: sql, run: (q) => rowsOf(t, ctx.host.request({ kind: "db", driver: t.driver, server: t.server, database: t.database, query: q })) },
  };
  return out;
}

function rowsOf(t: DbTarget, host: HostTable): Cell[][] {
  return t.jsonRecords ? dbTable(t, host).rows : hostRows(host);
}

function dbNavigation(ctx: LibContext, t: DbTarget): MTable {
  const items = () => ctx.host.request({ kind: "db-items", driver: t.driver, server: t.server, database: t.database });
  const row = (schema: string, item: string, kind: string): Cell[] => [item, new Lazy(() => dbItemTable(ctx, t, schema, item)), schema, item, kind];
  const columns = ["Name", "Data", "Schema", "Item", "Kind"];
  const nav = navTable(columns, () => items().map((it) => row(it.schema, it.item, it.kind)));
  nav.source = { kind: "db", driver: t.driver, server: t.server, database: t.database };
  // Source{[Schema="public",Item="x"]} resolves without listing every table (one fewer round trip).
  nav.navLookup = (key) => {
    if (!key.names.every((n) => n === "Schema" || n === "Item" || n === "Name")) return undefined;
    const get = (n: string) => (key.has(n) ? key.get(n) : undefined);
    const item = get("Item") ?? get("Name");
    const schema = get("Schema") ?? defaultSchema(t);
    if (typeof item !== "string" || typeof schema !== "string") return undefined;
    return new MRecord(columns, row(schema, item, "Table"));
  };
  nav.navHint = (key) => {
    const schema = key.has("Schema") ? key.get("Schema") : null;
    try {
      const inSchema = items()
        .filter((i) => i.schema === schema)
        .map((i) => i.item);
      return typeof schema === "string" ? (inSchema.length ? `(Items in schema '${schema}': ${inSchema.slice(0, 20).join(", ")}${inSchema.length > 20 ? ", …" : ""}.)` : `(No tables are visible in schema '${schema}'.)`) : undefined;
    } catch {
      return undefined;
    }
  };
  return nav;
}

function dbSource(ctx: LibContext, driver: DbDriver, server: string, database: string, options: MValue): MTable {
  if (!server.trim()) throw new MError("Expression.Error", `${DB_LABEL[driver]}: the ${driver === "sqlite" || driver === "duckdb" ? "file path" : "server"} is empty.`);
  const t: DbTarget = { driver, server, database, jsonRecords: flag(options, "JsonAsRecords") === true };
  const query = textOrNull(flag(options, "Query"));
  if (query !== null) return dbTable(t, ctx.host.request({ kind: "db", driver, server, database, query }));
  return dbNavigation(ctx, t);
}

// ---------------------------------------------------------------------------------------------
// Firestore

interface FirestoreTarget {
  project: string;
  database: string;
  parent?: string;
  emulator?: string;
  nestedMaps: "Flatten" | "Record";
  metadata: boolean;
}

const META_COLUMNS = ["_id", "_path", "_createTime", "_updateTime"];
/** Fields of documents beyond the sampled schema (only when the sample didn't cover the whole collection). */
const OTHER_FIELDS = "_otherFields";
/** Documents read to infer the columns (the whole collection when it is smaller). */
export const FIRESTORE_SAMPLE = 1000;

function documentPath(name: string): string {
  const i = name.indexOf("/documents/");
  return i >= 0 ? name.slice(i + "/documents/".length) : name;
}

function timestampToM(s: string): MValue {
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? s : new MDateTimeZone(ms, 0);
}

/** A Firestore REST value → M. Maps stay records here (flattening happens per column). */
export function firestoreValueToM(v: FirestoreValue | undefined): MValue {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue === true;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) {
    const d = v.doubleValue;
    return typeof d === "number" ? d : d === "NaN" ? NaN : d === "Infinity" ? Infinity : d === "-Infinity" ? -Infinity : Number(d);
  }
  if ("stringValue" in v) return String(v.stringValue);
  if ("timestampValue" in v) return timestampToM(String(v.timestampValue));
  if ("bytesValue" in v) return new MBinary(base64Decode(String(v.bytesValue)));
  if ("referenceValue" in v) return documentPath(String(v.referenceValue));
  if ("geoPointValue" in v) {
    const g = (v.geoPointValue ?? {}) as { latitude?: number; longitude?: number };
    return MRecord.from([
      ["Latitude", g.latitude ?? 0],
      ["Longitude", g.longitude ?? 0],
    ]);
  }
  if ("arrayValue" in v) return MList.of((((v.arrayValue ?? {}) as { values?: FirestoreValue[] }).values ?? []).map(firestoreValueToM));
  if ("mapValue" in v) {
    const fields = (((v.mapValue ?? {}) as { fields?: Record<string, FirestoreValue> }).fields ?? {}) as Record<string, FirestoreValue>;
    return MRecord.from(Object.entries(fields).map(([k, x]) => [k, firestoreValueToM(x)]));
  }
  return null;
}

/** An M scalar → a Firestore REST value (folded filters). Datetimes without a zone are taken as UTC. */
export function mToFirestoreValue(v: MValue): FirestoreValue | undefined {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? { integerValue: String(v) } : Number.isFinite(v) ? { doubleValue: v } : undefined;
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof MDateTimeZone) return { timestampValue: new Date(v.utcMs).toISOString() };
  if (v instanceof MDateTime) return { timestampValue: `${formatDateTime(v.ms)}Z` };
  if (v instanceof MDate) return { timestampValue: new Date(v.days * 86_400_000).toISOString() };
  return undefined;
}

/** A field path as Firestore wants it (segments that aren't plain identifiers are back-quoted). */
export function firestoreFieldPath(segments: string[]): string {
  return segments.map((s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `\`${s.replace(/[`\\]/g, (c) => `\\${c}`)}\``)).join(".");
}

interface FsColumn {
  name: string;
  /** field path segments */
  path: string[];
}

/** Columns of a set of documents: top-level fields, nested maps flattened to `a.b` (NestedMaps="Flatten"). */
function firestoreColumns(docs: FirestoreDocument[], nested: "Flatten" | "Record"): FsColumn[] {
  const cols: FsColumn[] = [];
  const seen = new Set<string>();
  const walk = (fields: Record<string, FirestoreValue>, path: string[], depth: number) => {
    for (const [k, v] of Object.entries(fields)) {
      const p = [...path, k];
      if (nested === "Flatten" && v && "mapValue" in v && depth < 8) {
        const sub = ((v.mapValue ?? {}) as { fields?: Record<string, FirestoreValue> }).fields ?? {};
        if (Object.keys(sub).length) {
          walk(sub, p, depth + 1);
          continue;
        }
      }
      const name = p.join(".");
      if (!seen.has(name)) {
        seen.add(name);
        cols.push({ name, path: p });
      }
    }
  };
  for (const d of docs) walk(d.fields ?? {}, [], 0);
  // Firestore doesn't order fields: sort the columns (like the Firebase console) so they are stable
  return cols.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function fieldAt(fields: Record<string, FirestoreValue> | undefined, path: string[]): FirestoreValue | undefined {
  let cur: FirestoreValue | undefined = { mapValue: { fields: fields ?? {} } };
  for (const seg of path) {
    if (!cur || !("mapValue" in cur)) return undefined;
    cur = (((cur.mapValue ?? {}) as { fields?: Record<string, FirestoreValue> }).fields ?? {})[seg];
  }
  return cur;
}

const FS_KIND_TYPES: Record<string, MType> = {
  integerValue: T.int64,
  doubleValue: T.number.asNullable(),
  stringValue: T.text.asNullable(),
  booleanValue: T.logical.asNullable(),
  timestampValue: T.datetimezone.asNullable(),
  bytesValue: T.binary.asNullable(),
  referenceValue: T.text.asNullable(),
  geoPointValue: T.record.asNullable(),
  arrayValue: T.list.asNullable(),
  mapValue: T.record.asNullable(),
};

function columnType(docs: FirestoreDocument[], c: FsColumn): MType {
  const kinds = new Set<string>();
  for (const d of docs) {
    const v = fieldAt(d.fields, c.path);
    if (!v || "nullValue" in v) continue;
    kinds.add(Object.keys(v)[0]!);
  }
  if (kinds.size === 2 && kinds.has("integerValue") && kinds.has("doubleValue")) return T.number.asNullable();
  if (kinds.size !== 1) return T.any;
  return FS_KIND_TYPES[[...kinds][0]!] ?? T.any;
}

function documentsTable(t: FirestoreTarget, docs: FirestoreDocument[], cols: FsColumn[], types: MType[], extra: boolean): { columns: string[]; types: MType[]; rows: () => Cell[][] } {
  const names = [...(t.metadata ? META_COLUMNS : META_COLUMNS.slice(0, 2)), ...cols.map((c) => c.name)];
  const allTypes = [...names.slice(0, names.length - cols.length).map((n) => (n.endsWith("Time") ? T.datetimezone.asNullable() : T.text.asNullable())), ...types];
  if (extra) {
    names.push(OTHER_FIELDS);
    allTypes.push(T.record.asNullable());
  }
  const known = new Set(cols.map((c) => c.name));
  return {
    columns: names,
    types: allTypes,
    rows: () => rowsOfDocs(t, docs, cols, known, extra),
  };
}

function rowsOfDocs(t: FirestoreTarget, docs: FirestoreDocument[], cols: FsColumn[], known: Set<string>, extra: boolean): Cell[][] {
  return docs.map((d) => {
    const path = documentPath(d.name);
    const row: Cell[] = [path.slice(path.lastIndexOf("/") + 1), path];
    if (t.metadata) row.push(d.createTime ? timestampToM(d.createTime) : null, d.updateTime ? timestampToM(d.updateTime) : null);
    for (const c of cols) row.push(firestoreValueToM(fieldAt(d.fields, c.path)));
    if (extra) {
      const others = firestoreColumns([d], t.nestedMaps).filter((c) => !known.has(c.name));
      row.push(others.length ? MRecord.from(others.map((c) => [c.name, firestoreValueToM(fieldAt(d.fields, c.path))])) : null);
    }
    return row;
  });
}

const FS_OPS: Record<string, FirestoreFieldFilter["op"]> = { "=": "EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL" };

/**
 * Folded predicate → Firestore filters (AND-ed), or undefined when Firestore can't match M exactly.
 * Exact: comparisons and IN with non-null values (a missing or null field matches neither in M nor in Firestore),
 * `or` of such filters (composite OR), and `<> null` (IS_NOT_NULL: the field exists and isn't null — M: not null).
 * Not folded: `<> value` (Firestore's != drops documents without the field, which M keeps), `= null` (IS_NULL
 * doesn't match missing fields, which M sees as null), `not`, text matching.
 */
export function firestoreFilters(p: FoldPred, fieldOf: (column: string) => string[] | undefined): FirestoreFilter[] | undefined {
  switch (p.op) {
    case "and": {
      const a = firestoreFilters(p.left, fieldOf);
      const b = firestoreFilters(p.right, fieldOf);
      return a && b ? [...a, ...b] : undefined;
    }
    case "or": {
      const a = firestoreFilters(p.left, fieldOf);
      const b = firestoreFilters(p.right, fieldOf);
      if (!a || !b) return undefined;
      const one = (x: FirestoreFilter[]): FirestoreFilter => (x.length === 1 ? x[0]! : { op: "AND", filters: x });
      const flat = (x: FirestoreFilter): FirestoreFilter[] => ("filters" in x && x.op === "OR" ? x.filters : [x]);
      return [{ op: "OR", filters: [...flat(one(a)), ...flat(one(b))] }];
    }
    case "null": {
      const path = fieldOf(p.column);
      return p.negate && path ? [{ field: firestoreFieldPath(path), op: "IS_NOT_NULL" }] : undefined;
    }
    case "cmp": {
      // `<>` would drop documents where the field is missing or null, which M keeps
      const op = FS_OPS[p.cmp];
      const path = fieldOf(p.column);
      const value = mToFirestoreValue(p.value);
      return op && path && value && !("nullValue" in value) ? [{ field: firestoreFieldPath(path), op, value }] : undefined;
    }
    case "in": {
      const path = fieldOf(p.column);
      if (!path || p.orNull || !p.values.length || p.values.length > 30) return undefined;
      const values = p.values.map(mToFirestoreValue);
      if (values.some((v) => !v)) return undefined;
      return [{ field: firestoreFieldPath(path), op: "IN", value: { arrayValue: { values } } }];
    }
    default:
      return undefined;
  }
}

/**
 * Does Firestore order this field like M's Table.Sort? Numbers (integers and doubles compare numerically),
 * booleans and timestamps do; text too, except that Firestore compares UTF-8 bytes and M UTF-16 code units
 * (differs only between U+E000–U+FFFF and characters beyond U+FFFF). References, bytes, maps, arrays, geo
 * points and mixed types are left to M.
 */
function sortableField(docs: FirestoreDocument[], path: string[]): boolean {
  const kinds = new Set<string>();
  for (const d of docs) {
    const v = fieldAt(d.fields, path);
    if (v && !("nullValue" in v)) kinds.add(Object.keys(v)[0]!);
  }
  if (kinds.has("integerValue") || kinds.has("doubleValue")) return [...kinds].every((k) => k === "integerValue" || k === "doubleValue");
  return kinds.size === 1 && ["stringValue", "booleanValue", "timestampValue"].includes([...kinds][0]!);
}

/** Columns a folded filter guarantees to be present and non-null (top-level AND-ed comparisons / IN / IS_NOT_NULL). */
function nonNullColumns(p: FoldPred | undefined, out = new Set<string>()): Set<string> {
  if (!p) return out;
  if (p.op === "and") {
    nonNullColumns(p.left, out);
    nonNullColumns(p.right, out);
  } else if (p.op === "cmp" || (p.op === "in" && !p.orNull) || (p.op === "null" && p.negate)) out.add(p.column);
  return out;
}

interface FirestoreQuery {
  collection: string;
  allDescendants?: boolean;
  filters?: FirestoreFilter[];
  orderBy?: { field: string; desc: boolean }[];
  limit?: number;
}

function firestoreRequest(t: FirestoreTarget, q: FirestoreQuery) {
  const req: Extract<import("../host.ts").DataRequest, { kind: "firestore-query" }> = { kind: "firestore-query", project: t.project, database: t.database, collection: q.collection };
  if (t.parent) req.parent = t.parent;
  if (t.emulator) req.emulator = t.emulator;
  if (q.allDescendants) req.allDescendants = true;
  if (q.filters?.length) req.filters = q.filters;
  if (q.orderBy?.length) req.orderBy = q.orderBy;
  if (q.limit !== undefined) req.limit = q.limit;
  return req;
}

/** Documents of a collection as a table: columns from a sample, rows on first use; filters and FirstN fold. */
function firestoreTable(ctx: LibContext, t: FirestoreTarget, q: FirestoreQuery): MTable {
  const sampleLimit = q.limit !== undefined ? Math.min(q.limit, FIRESTORE_SAMPLE) : FIRESTORE_SAMPLE;
  const sample = ctx.host.request(firestoreRequest(t, { ...q, limit: sampleLimit }));
  const complete = sample.length < sampleLimit || (q.limit !== undefined && q.limit <= FIRESTORE_SAMPLE);
  const cols = firestoreColumns(sample, t.nestedMaps);
  const types = cols.map((c) => columnType(sample, c));
  const shape = documentsTable(t, sample, cols, types, !complete);
  const known = new Set(cols.map((c) => c.name));
  const fieldOf = (column: string) => cols.find((c) => c.name === column)?.path;
  const read = (spec: FoldSpec): Cell[][] => {
    const filters = spec.filter ? firestoreFilters(spec.filter, fieldOf) : undefined;
    const limit = spec.top !== undefined ? (q.limit !== undefined ? Math.min(q.limit, spec.top) : spec.top) : q.limit;
    const orderBy = spec.orderBy?.length ? [...spec.orderBy.map((k) => ({ field: firestoreFieldPath(fieldOf(k.column)!), desc: k.desc })), ...(q.orderBy ?? [])] : q.orderBy;
    let docs: FirestoreDocument[];
    if (complete && !filters && !spec.orderBy?.length && (limit === undefined || limit >= sample.length)) docs = sample;
    else docs = ctx.host.request(firestoreRequest(t, { ...q, filters: [...(q.filters ?? []), ...(filters ?? [])], orderBy, limit }));
    const rows = rowsOfDocs(t, docs, cols, known, !complete);
    if (!spec.columns) return rows;
    const idx = spec.columns.map((c) => shape.columns.indexOf(c));
    return rows.map((r) => idx.map((i) => r[i]!));
  };
  const out = new MTable(shape.columns, shape.types, () => read({}));
  out.fold = {
    read,
    spec: {},
    columns: shape.columns,
    caps: {
      filter: (p) => firestoreFilters(p, fieldOf) !== undefined,
      sort: false,
      // Firestore's orderBy also drops documents without the field: a sort folds only on fields the filter already
      // requires (non-null), of one value type (Firestore orders mixed types by type); nulls are excluded, so M's
      // nulls-first / last order can't differ
      orderBy: (keys, s) => {
        const present = nonNullColumns(s.filter);
        return keys.every((k) => present.has(k.column) && !!fieldOf(k.column) && sortableField(sample, fieldOf(k.column)!));
      },
      skip: false,
      columns: true,
    },
  };
  return out;
}

function firestoreTarget(project: string, options: MValue): FirestoreTarget {
  if (!project.trim()) throw new MError("Expression.Error", "Firestore: the project ID is empty.");
  const nested = textOrNull(flag(options, "NestedMaps")) ?? "Flatten";
  if (nested !== "Flatten" && nested !== "Record") throw new MError("Expression.Error", 'Firestore: NestedMaps must be "Flatten" or "Record".');
  const parent = textOrNull(flag(options, "Parent"));
  return {
    project,
    database: textOrNull(flag(options, "Database")) ?? "(default)",
    parent: parent ? parent.replace(/^\/+|\/+$/g, "") : undefined,
    emulator: textOrNull(flag(options, "EmulatorHost")) ?? undefined,
    nestedMaps: nested,
    metadata: flag(options, "Metadata") !== false,
  };
}

const ORDER_OPS: Record<string, FirestoreFieldFilter["op"]> = {
  "=": "EQUAL",
  "==": "EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  in: "IN",
  "array-contains": "ARRAY_CONTAINS",
};

/** Where = {{"field", "op", value}, …} of Firestore.Query. */
function whereOption(v: MValue): FirestoreFilter[] {
  if (v === null) return [];
  const items = v instanceof MList ? v.values() : [];
  const list = items.length && typeof items[0] === "string" ? [v] : items;
  return list.map((it) => {
    const parts = it instanceof MList ? it.values() : [];
    if (parts.length !== 3 || typeof parts[0] !== "string" || typeof parts[1] !== "string") throw new MError("Expression.Error", 'Firestore.Query: each Where item must be {"field", "operator", value}.');
    const op = ORDER_OPS[parts[1].toLowerCase()];
    if (!op) throw new MError("Expression.Error", `Firestore.Query: the operator '${parts[1]}' isn't supported (use =, <, <=, >, >=, in, array-contains).`);
    const raw = parts[2]!;
    const value = op === "IN" ? (raw instanceof MList ? { arrayValue: { values: raw.values().map((x) => mToFirestoreValue(x) ?? { nullValue: null }) } } : undefined) : mToFirestoreValue(raw);
    if (!value) throw new MError("Expression.Error", `Firestore.Query: the value for '${parts[0]}' can't be sent to Firestore.`);
    return { field: firestoreFieldPath(parts[0].split(".")), op, value };
  });
}

function orderOption(v: MValue): { field: string; desc: boolean }[] {
  if (v === null) return [];
  if (typeof v === "string") return [{ field: firestoreFieldPath(v.split(".")), desc: false }];
  const items = (v as MList).values();
  const list = items.length === 2 && typeof items[0] === "string" && typeof items[1] === "number" ? [v] : items;
  return list.map((it) => {
    if (typeof it === "string") return { field: firestoreFieldPath(it.split(".")), desc: false };
    const [f, o] = (it as MList).values();
    return { field: firestoreFieldPath(text(f!).split(".")), desc: o === 1 };
  });
}

function firestoreCollections(ctx: LibContext, t: FirestoreTarget): MTable {
  const row = (id: string): Cell[] => [id, new Lazy(() => firestoreTable(ctx, t, { collection: id })), "Collection", t.parent ? `${t.parent}/${id}` : id];
  const columns = ["Name", "Data", "Kind", "Path"];
  const nav = navTable(columns, () => {
    const req: Extract<import("../host.ts").DataRequest, { kind: "firestore-collections" }> = { kind: "firestore-collections", project: t.project, database: t.database };
    if (t.parent) req.parent = t.parent;
    if (t.emulator) req.emulator = t.emulator;
    return ctx.host.request(req).map(row);
  });
  nav.navLookup = (key) => {
    if (key.names.length !== 1 || key.names[0] !== "Name" || typeof key.get("Name") !== "string") return undefined;
    return new MRecord(columns, row(key.get("Name") as string));
  };
  return nav;
}

// ---------------------------------------------------------------------------------------------
// Object storage (S3-compatible) and locations

export interface S3Store {
  bucket: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
}

function s3Store(bucket: string, options: MValue): S3Store {
  const store: S3Store = { bucket };
  const endpoint = textOrNull(flag(options, "Endpoint"));
  const region = textOrNull(flag(options, "Region"));
  const fps = flag(options, "ForcePathStyle");
  if (endpoint) store.endpoint = endpoint.replace(/\/+$/, "");
  if (region) store.region = region;
  if (typeof fps === "boolean") store.forcePathStyle = fps;
  else if (endpoint) store.forcePathStyle = true; // MinIO / TrueNAS / Garage style endpoints
  return store;
}

/** `s3://bucket/prefix` → bucket + key prefix. */
export function parseS3Url(url: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/i.exec(url.trim());
  return m ? { bucket: m[1]!, key: m[2]! } : null;
}

/** Somewhere files live: a local / mounted path (incl. smb:// and \\host\share, resolved by the host) or a bucket. */
interface Location {
  list(dir: string, recursive: boolean): HostFileEntry[];
  read(path: string): Uint8Array;
}

function fsLocation(ctx: LibContext): Location {
  return {
    list: (dir, recursive) => ctx.host.request({ kind: "folder", path: dir, recursive }),
    read: (path) => ctx.host.request({ kind: "file", path }),
  };
}

function s3Location(ctx: LibContext, store: S3Store): Location {
  const conn: { endpoint?: string; region?: string; forcePathStyle?: boolean } = {};
  if (store.endpoint) conn.endpoint = store.endpoint;
  if (store.region) conn.region = store.region;
  if (store.forcePathStyle !== undefined) conn.forcePathStyle = store.forcePathStyle;
  const keyOf = (path: string) => {
    const p = parseS3Url(path);
    if (!p || p.bucket !== store.bucket) throw new MError("Expression.Error", `The path '${path}' isn't in the bucket '${store.bucket}'.`);
    return p.key;
  };
  return {
    list: (dir, recursive) => {
      let prefix = keyOf(dir);
      if (prefix && !prefix.endsWith("/")) prefix += "/";
      return ctx.host.request({ kind: "s3-list", bucket: store.bucket, prefix, recursive, ...conn });
    },
    read: (path) => ctx.host.request({ kind: "s3-object", bucket: store.bucket, key: keyOf(path), ...conn }),
  };
}

function locationOf(ctx: LibContext, path: string, options: MValue): { loc: Location; root: string } {
  const s3 = parseS3Url(path);
  if (s3) return { loc: s3Location(ctx, s3Store(s3.bucket, options)), root: `s3://${s3.bucket}${s3.key ? `/${s3.key.replace(/\/+$/, "")}` : ""}` };
  return { loc: fsLocation(ctx), root: path.replace(/[\\/]+$/, "") };
}

function contentOf(loc: Location, path: string): MBinary {
  return new MBinary(() => loc.read(path), path);
}

/** Folder.Files-shaped table over a location (recursive). */
function locationFiles(ctx: LibContext, loc: Location, dir: string): MTable {
  return navTable(FOLDER_COLUMNS, () =>
    loc
      .list(dir, true)
      .filter((e) => !e.isFolder)
      .map((e) => folderRow(ctx, e, contentOf(loc, e.path))),
  );
}

/** Folder.Contents-shaped navigation over a location (folders are nested tables). */
function locationContents(ctx: LibContext, loc: Location, dir: string): MTable {
  return navTable(FOLDER_COLUMNS, () => loc.list(dir, false).map((e) => folderRow(ctx, e, e.isFolder ? new Lazy(() => locationContents(ctx, loc, e.path)) : contentOf(loc, e.path))));
}

function folderOf(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1).replace(/\\/g, "/") : "";
}

function deltaFiles(loc: Location, entries: HostFileEntry[]): DeltaFile[] {
  return entries.filter((e) => !e.isFolder).map((e) => ({ name: e.name, folder: folderOf(e.path), read: () => loc.read(e.path) }));
}

// ---------------------------------------------------------------------------------------------
// Lakehouse folders (Fabric layout: Tables/<table> or Tables/<schema>/<table> Delta tables, Files/)

const LAKEHOUSE_COLUMNS = ["Id", "Name", "ItemKind", "Data", "IsLeaf"];

function lakehouseFolder(ctx: LibContext, path: string, options: MValue): MTable {
  const { loc, root } = locationOf(ctx, path, options);
  const tablesDir = `${root}/Tables`;
  // entry paths are compared in '/' form: on Windows the root and the listed paths may use backslashes
  const slash = (s: string) => s.replace(/\\/g, "/");
  const tablesKey = slash(tablesDir);
  const nav = navTable(LAKEHOUSE_COLUMNS, () => {
    let entries: HostFileEntry[] = [];
    try {
      entries = loc.list(tablesDir, true);
    } catch (e) {
      if (!(e instanceof MError) || e.reason !== "DataSource.NotFound") throw e;
    }
    // a Delta table is a folder holding _delta_log/
    const tables = new Map<string, HostFileEntry[]>();
    for (const e of entries) {
      const folder = folderOf(e.path);
      const m = /^(.*)\/_delta_log\/$/.exec(folder);
      if (m && m[1]!.startsWith(`${tablesKey}/`)) tables.set(m[1]!, []);
    }
    const dirs = [...tables.keys()].sort((a, b) => b.length - a.length);
    for (const e of entries) {
      const dir = dirs.find((d) => slash(e.path).startsWith(`${d}/`));
      if (dir) tables.get(dir)!.push(e);
    }
    const rel = (d: string) => d.slice(tablesKey.length + 1);
    const tableRow = (dir: string): Cell[] => {
      const name = rel(dir).split("/").pop()!;
      return [name, name, "Table", new Lazy(() => deltaTableFromFiles(ctx, deltaFiles(loc, tables.get(dir)!))), true];
    };
    const rows: Cell[][] = [];
    const schemas = new Map<string, string[]>();
    for (const d of [...tables.keys()].sort()) {
      const parts = rel(d).split("/");
      if (parts.length === 1) rows.push(tableRow(d));
      else schemas.set(parts[0]!, [...(schemas.get(parts[0]!) ?? []), d]);
    }
    for (const [schema, dirsOf] of schemas) rows.push([schema, schema, "Schema", new Lazy(() => navTable(LAKEHOUSE_COLUMNS, dirsOf.map(tableRow))), false]);
    rows.push(["Files", "Files", "Folder", new Lazy(() => locationContents(ctx, loc, `${root}/Files`)), false]);
    return rows;
  });
  return nav;
}

// ---------------------------------------------------------------------------------------------

export function installConnectors(lib: Library): void {
  const def = lib.def.bind(lib);

  def("PostgreSQL.Database", "server, database, ?options", ([s, d, o], ctx) => dbSource(ctx, "postgresql", text(s!), text(d!), o!));
  def("MySQL.Database", "server, database, ?options", ([s, d, o], ctx) => dbSource(ctx, "mysql", text(s!), text(d!), o!));
  def("SQLite.Database", "path, ?options", ([p, o], ctx) => dbSource(ctx, "sqlite", text(p!), "", o!));
  // a .duckdb file, or a lakehouse folder (Delta tables as views, Parquet files by relative path)
  def("DuckDB.Database", "path, ?options", ([p, o], ctx) => dbSource(ctx, "duckdb", text(p!), "", o!));

  def("Firestore.Collections", "projectId, ?options", ([p, o], ctx) => firestoreCollections(ctx, firestoreTarget(text(p!), o!)));
  def("Firestore.Query", "projectId, collectionId, ?options", ([p, c, o], ctx) => {
    const t = firestoreTarget(text(p!), o!);
    const limit = flag(o!, "Limit");
    return firestoreTable(ctx, t, {
      collection: text(c!),
      allDescendants: flag(o!, "AllDescendants") === true,
      filters: whereOption(flag(o!, "Where")),
      orderBy: orderOption(flag(o!, "OrderBy")),
      limit: limit === null ? undefined : num(limit),
    });
  });

  def("AmazonS3.Contents", "bucket, ?options", ([b, o], ctx) => {
    const bucket = text(b!).replace(/^s3:\/\//i, "").replace(/\/.*$/, "");
    const prefix = (textOrNull(flag(o!, "Prefix")) ?? "").replace(/^\/+/, "");
    const loc = s3Location(ctx, s3Store(bucket, o!));
    return locationFiles(ctx, loc, `s3://${bucket}/${prefix}`);
  });

  def("Lakehouse.Folder", "path, ?options", ([p, o], ctx) => lakehouseFolder(ctx, text(p!), o!));

  // DeltaLake.Table over a bucket path (the text form; tables from AmazonS3.Contents work as before)
  const orig = lib.entries.get("DeltaLake.Table");
  def("DeltaLake.Table", "directory, ?options", ([d, o], ctx) => {
    if (typeof d === "string" && parseS3Url(d)) {
      const { loc, root } = locationOf(ctx, d, o!);
      return deltaTableFromFiles(ctx, deltaFiles(loc, loc.list(root, true)));
    }
    if (typeof d === "string") return deltaTableFromFiles(ctx, deltaFilesOf(folderFiles(ctx, d)));
    if (d instanceof MTable) return deltaTableFromFiles(ctx, deltaFilesOf(d));
    if (orig) return (orig as import("../values.ts").MFunction).impl([d!, o!]);
    throw new MError("Expression.Error", "DeltaLake.Table expects a folder path or a table of files.");
  });
}
