/**
 * Data source functions. Every external read goes through `ctx.host.request` (see ../host.ts and
 * ../driver.ts), so these functions stay synchronous; the driver fetches what they ask for and replays.
 */
import { gunzipSync, gzipSync, deflateSync, inflateSync } from "fflate";
import { parseDateTimeText, parseTimeText } from "../calendar.ts";
import { toText } from "../convert.ts";
import { bytesKey } from "../driver.ts";
import { MError } from "../errors.ts";
import type { DataRequest, HostFileEntry, HostLakehouse, HostTable, WorkbookCell, WorkbookData } from "../host.ts";
import { setMetadata } from "../interpreter.ts";
import {
  Lazy,
  MBinary,
  MDate,
  MDateTime,
  MDateTimeZone,
  MList,
  MRecord,
  MTable,
  MTime,
  MType,
  MS_PER_DAY,
  T,
  cannotConvert,
  type Cell,
  type FoldSpec,
  type MValue,
} from "../values.ts";
import { parseXml, xmlText, type XmlElement } from "../xml.ts";
import { flag, num, text, textOrNull, type LibContext, type Library } from "./util.ts";
import { renderPredicate } from "./fold.ts";
import { DIALECTS, TSQL } from "./sqldialect.ts";
import { deltaTableFromFiles, type DeltaFile } from "./delta.ts";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Host values → M

const HOST_TYPES: Record<string, MType> = {
  boolean: T.logical.asNullable(),
  bit: T.logical.asNullable(),
  integer: T.int64,
  int: T.int64,
  bigint: T.int64,
  smallint: T.int64,
  tinyint: T.int64,
  double: T.number.asNullable(),
  float: T.number.asNullable(),
  real: T.number.asNullable(),
  decimal: T.number.asNullable(),
  numeric: T.number.asNullable(),
  money: new MType("number", true, "Currency"),
  varchar: T.text.asNullable(),
  text: T.text.asNullable(),
  string: T.text.asNullable(),
  guid: T.text.asNullable(),
  uuid: T.text.asNullable(),
  json: T.text.asNullable(),
  list: T.list.asNullable(),
  record: T.record.asNullable(),
  timestamptz: T.datetimezone.asNullable(),
  datetimezone: T.datetimezone.asNullable(),
  date: T.date.asNullable(),
  timestamp: T.datetime.asNullable(),
  datetime: T.datetime.asNullable(),
  datetimeoffset: T.datetimezone.asNullable(),
  time: T.time.asNullable(),
  binary: T.binary.asNullable(),
};

export function mTypeOfHost(type: string): MType {
  return HOST_TYPES[type.toLowerCase()] ?? T.any;
}

function utcDays(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

/** Converts one normalized host value (see ../host.ts) to M. */
export function fromHostValue(v: unknown, type: string): MValue {
  if (v === null || v === undefined) return null;
  const t = type.toLowerCase();
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    if (t === "date") return new MDate(utcDays(v));
    if (t === "time") return new MTime(((v.getTime() % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
    if (t === "datetimeoffset" || t === "timestamptz" || t === "datetimezone") return new MDateTimeZone(v.getTime(), 0);
    return new MDateTime(v.getTime());
  }
  if (typeof v === "string") {
    if (t === "date") {
      const p = parseDateTimeText(v);
      if (p) return new MDate(Math.floor(p.ms / MS_PER_DAY));
    }
    if (t === "timestamp" || t === "datetime") {
      const p = parseDateTimeText(v);
      if (p) return new MDateTime(p.ms);
    }
    if (t === "time") {
      const ms = parseTimeText(v);
      if (ms !== null) return new MTime(ms);
    }
    if (t === "datetimeoffset" || t === "timestamptz" || t === "datetimezone") {
      const p = parseDateTimeText(v);
      if (p) return new MDateTimeZone(p.ms, p.offsetMinutes ?? 0);
    }
    if (t === "bigint" || t === "integer" || t === "int") return Number(v);
    return v;
  }
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Uint8Array) return new MBinary(v);
  if (Array.isArray(v)) return MList.of(v.map((x) => fromHostValue(x, "other")));
  if (typeof v === "object") return MRecord.from(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromHostValue(x, "other")]));
  return String(v);
}

export function hostRows(t: HostTable): Cell[][] {
  const types = t.columns.map((c) => c.type);
  return t.rows.map((r) => types.map((ty, i) => fromHostValue(r[i], ty)));
}

export function hostTableToM(t: HostTable): MTable {
  return new MTable(
    t.columns.map((c) => c.name),
    t.columns.map((c) => mTypeOfHost(c.type)),
    hostRows(t),
  );
}

export function navTable(columns: string[], rows: Cell[][] | (() => Cell[][])): MTable {
  return new MTable(columns, columns.map(() => T.any), rows);
}

function binaryOrText(v: MValue): { bytes: Uint8Array; path?: string } {
  if (v instanceof MBinary) return { bytes: v.bytes, path: v.path };
  if (typeof v === "string") return { bytes: encoder.encode(v) };
  throw cannotConvert(v, "Binary");
}

const ENCODINGS: Record<number, string> = {
  65001: "utf-8",
  1252: "windows-1252",
  1200: "utf-16le",
  1201: "utf-16be",
  20127: "us-ascii",
  28591: "iso-8859-1",
  28605: "iso-8859-15",
  1250: "windows-1250",
  1251: "windows-1251",
  932: "shift_jis",
  936: "gbk",
  950: "big5",
  65000: "utf-7",
};

export function decodeText(bytes: Uint8Array, encoding: number | null): string {
  let label = ENCODINGS[encoding ?? 65001];
  if (!label || label === "utf-7") throw new MError("Expression.Error", `The text encoding ${encoding} is not supported. Use 65001 (UTF-8), 1252, 1200 (UTF-16) or another common code page.`);
  // a byte order mark wins, like .NET's StreamReader
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
  return new TextDecoder(label).decode(bytes).replace(/^﻿/, "");
}

/** Splits CSV text into rows of raw fields. `quotedLineBreaks` = QuoteStyle.Csv. */
export function parseCsv(src: string, delimiter: string, quotedLineBreaks: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    fieldStarted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
        continue;
      }
      if ((c === "\n" || c === "\r") && !quotedLineBreaks) {
        inQuotes = false;
        if (c === "\r" && src[i + 1] === "\n") i++;
        endRow();
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (delimiter && src.startsWith(delimiter, i)) {
      row.push(field);
      field = "";
      fieldStarted = false;
      i += delimiter.length - 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    field += c;
    fieldStarted = true;
  }
  if (field !== "" || row.length > 0 || inQuotes) endRow();
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Workbooks

function workbookCell(c: WorkbookCell): MValue {
  if (c === null || typeof c !== "object") return c;
  if ("$date" in c) {
    const p = parseDateTimeText(c.$date);
    if (!p) throw new MError("DataFormat.Error", `Workbook: '${c.$date}' is not a valid date.`);
    return new MDate(Math.floor(p.ms / MS_PER_DAY));
  }
  if ("$time" in c) {
    const ms = parseTimeText(c.$time);
    if (ms === null) throw new MError("DataFormat.Error", `Workbook: '${c.$time}' is not a valid time.`);
    return new MTime(ms);
  }
  const p = parseDateTimeText(c.$datetime);
  if (!p) throw new MError("DataFormat.Error", `Workbook: '${c.$datetime}' is not a valid datetime.`);
  return new MDateTime(p.ms);
}

function gridTable(rows: WorkbookCell[][], useHeaders: boolean): MTable {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: width }, (_x, i) => workbookCell(r[i] ?? null)));
  let names = Array.from({ length: width }, (_x, i) => `Column${i + 1}`);
  let body = grid;
  if (useHeaders && grid.length) {
    const seen = new Map<string, number>();
    names = grid[0]!.map((v, i) => {
      let n = v === null || v === "" ? `Column${i + 1}` : toText(v)!;
      const k = seen.get(n) ?? 0;
      seen.set(n, k + 1);
      if (k) n = `${n}_${k}`;
      return n;
    });
    body = grid.slice(1);
  }
  return new MTable(names, names.map(() => T.any), body);
}

function workbookTable(wb: WorkbookData, useHeaders: boolean): MTable {
  const rows: Cell[][] = [];
  for (const sheet of wb.sheets ?? []) rows.push([sheet.name, new Lazy(() => gridTable(sheet.rows, useHeaders)), sheet.name, "Sheet", sheet.hidden ?? false]);
  for (const tbl of wb.tables ?? []) {
    const data = new Lazy(() => new MTable([...tbl.columns], tbl.columns.map(() => T.any), tbl.rows.map((r) => tbl.columns.map((_c, i) => workbookCell(r[i] ?? null)))));
    rows.push([tbl.name, data, tbl.name, "Table", false]);
  }
  for (const dn of wb.definedNames ?? []) rows.push([dn.name, new Lazy(() => gridTable(dn.rows, useHeaders)), dn.name, "DefinedName", false]);
  return navTable(["Name", "Data", "Item", "Kind", "Hidden"], rows);
}

// ---------------------------------------------------------------------------------------------
// Files and folders

export function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1) : "";
}

function fileDate(ms: number | undefined, ctx: LibContext): MValue {
  return ms === undefined ? null : new MDateTime(ms + ctx.localOffsetMinutes * 60_000);
}

function fileContent(ctx: LibContext, path: string): MBinary {
  return new MBinary(() => ctx.host.request({ kind: "file", path }), path);
}

export const FOLDER_COLUMNS = ["Content", "Name", "Extension", "Date accessed", "Date modified", "Date created", "Attributes", "Folder Path"];

function attributes(e: HostFileEntry): MRecord {
  return MRecord.from([
    ["Content Type", e.isFolder ? null : contentType(e.name)],
    ["Kind", e.isFolder ? "Folder" : kindOfFile(e.name)],
    ["Size", e.size ?? null],
    ["ReadOnly", false],
    ["Hidden", e.name.startsWith(".")],
    ["System", false],
    ["Directory", e.isFolder],
    ["Archive", !e.isFolder],
  ]);
}

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".xml": "text/xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".parquet": "application/vnd.apache.parquet",
};
function contentType(name: string): string | null {
  return CONTENT_TYPES[extension(name).toLowerCase()] ?? null;
}
function kindOfFile(name: string): string {
  const ext = extension(name).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") return "Excel File";
  if (ext === ".csv" || ext === ".txt") return "Text";
  return "File";
}

export function folderRow(ctx: LibContext, e: HostFileEntry, content: Cell): Cell[] {
  return [content, e.name, e.isFolder ? "" : extension(e.name), fileDate(e.accessed ?? e.modified, ctx), fileDate(e.modified, ctx), fileDate(e.created ?? e.modified, ctx), attributes(e), parentPath(e.path)];
}

export function folderFiles(ctx: LibContext, path: string): MTable {
  return navTable(FOLDER_COLUMNS, () =>
    ctx.host
      .request({ kind: "folder", path, recursive: true })
      .filter((e) => !e.isFolder)
      .map((e) => folderRow(ctx, e, fileContent(ctx, e.path))),
  );
}

function folderContents(ctx: LibContext, path: string): MTable {
  return navTable(FOLDER_COLUMNS, () =>
    ctx.host.request({ kind: "folder", path, recursive: false }).map((e) => folderRow(ctx, e, e.isFolder ? new Lazy(() => folderContents(ctx, e.path)) : fileContent(ctx, e.path))),
  );
}

// ---------------------------------------------------------------------------------------------
// Lakehouse navigation (in-process hosts only; the desktop fetcher answers with guidance)

function lakehouseFolder(lh: HostLakehouse, dir: string): MTable {
  const entries = lh.list(dir);
  const rows: Cell[][] = entries.map((e) => [
    e.isFolder ? new Lazy(() => lakehouseFolder(lh, e.path)) : new Lazy(() => new MBinary(lh.readFile(e.path), `${lh.name}/${e.path}`)),
    e.name,
    e.isFolder ? "" : extension(e.name),
    `${lh.name}/${dir}/`,
    e.isFolder ? "Folder" : "File",
  ]);
  return navTable(["Content", "Name", "Extension", "Folder Path", "ItemKind"], rows);
}

function lakehouseItems(lh: HostLakehouse): MTable {
  const rows: Cell[][] = [["Files", "Files", "Folder", new Lazy(() => lakehouseFolder(lh, "Files")), false]];
  for (const schema of lh.schemas()) {
    const tables = new Lazy(() =>
      navTable(
        ["Id", "Name", "ItemKind", "Data", "IsLeaf"],
        lh.tables(schema).map((t) => [t, t, "Table", new Lazy(() => hostTableToM(lh.readTable(schema, t))), true]),
      ),
    );
    rows.push([schema, schema, "Schema", tables, false]);
  }
  return navTable(["Id", "Name", "ItemKind", "Data", "IsLeaf"], rows);
}

function lakehouseContents(ctx: LibContext): MTable {
  const workspaces = ctx.host.request({ kind: "lakehouse-contents" });
  return navTable(
    ["workspaceId", "workspaceName", "Data"],
    workspaces.map((ws) => [
      ws.id,
      ws.name,
      new Lazy(() =>
        navTable(
          ["lakehouseId", "lakehouseName", "Data", "ItemKind"],
          ws.lakehouses.map((lh) => [lh.id, lh.name, new Lazy(() => lakehouseItems(lh)), "Lakehouse"]),
        ),
      ),
    ]),
  );
}

// ---------------------------------------------------------------------------------------------
// JSON / XML

export function jsonToM(v: unknown): MValue {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return MList.of(v.map(jsonToM));
  if (typeof v === "object") return MRecord.from(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, jsonToM(x)]));
  return v as MValue;
}

function mToJson(v: MValue): unknown {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof MList) return v.values().map(mToJson);
  if (v instanceof MRecord) return Object.fromEntries(v.names.map((n) => [n, mToJson(v.get(n))]));
  if (v instanceof MTable) return v.records().map((r) => mToJson(r));
  if (v instanceof MDate || v instanceof MDateTime || v instanceof MDateTimeZone || v instanceof MTime) return toText(v);
  if (v instanceof MBinary) return btoa(String.fromCharCode(...v.bytes));
  throw new MError("Expression.Error", `We cannot convert a value of type ${v.constructor.name.replace(/^M/, "")} to JSON.`);
}

export function parseJson(bytes: Uint8Array, encoding: number | null): MValue {
  const s = decodeText(bytes, encoding);
  try {
    return jsonToM(JSON.parse(s));
  } catch (e) {
    throw new MError("DataFormat.Error", "We found an unexpected character in the JSON input.", (e as Error).message);
  }
}

/** Xml.Document: [Name, Namespace, Value, Attributes] per node; element values are nested tables. */
function xmlDocumentTable(nodes: (XmlElement | string)[]): MTable {
  const rows: Cell[][] = [];
  for (const n of nodes) {
    if (typeof n === "string") {
      if (!n.trim()) continue;
      rows.push(["#text", "", n, null]);
      continue;
    }
    const attrs = new MTable(["Name", "Namespace", "Value"], [T.text, T.text, T.text], n.attrs.map((a) => [a.name, a.ns, a.value]));
    const onlyText = n.children.every((c) => typeof c === "string");
    rows.push([n.name, n.ns, onlyText ? xmlText(n) : new Lazy(() => xmlDocumentTable(n.children)), attrs]);
  }
  return new MTable(["Name", "Namespace", "Value", "Attributes"], [T.text, T.text, T.any, T.table], rows);
}

/**
 * Xml.Tables semantics (approximation of Power Query's inference): an element's child elements become
 * columns (repeated names → one row per instance), attributes become `Attribute:name` columns,
 * text-only children become text values and complex children nested tables.
 */
function xmlRowsTable(elements: XmlElement[]): MTable {
  const cols: string[] = [];
  const seen = new Set<string>();
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      cols.push(c);
    }
  };
  for (const e of elements) {
    for (const ch of e.children) if (typeof ch !== "string") add(ch.name);
    for (const a of e.attrs) add(`Attribute:${a.name}`);
  }
  const hasElementChildren = cols.some((c) => !c.startsWith("Attribute:"));
  if (!hasElementChildren) add("Element:Text");
  const rows = elements.map((e) =>
    cols.map((c): Cell => {
      if (c === "Element:Text") return xmlText(e);
      if (c.startsWith("Attribute:")) return e.attrs.find((a) => a.name === c.slice(10))?.value ?? null;
      const kids = e.children.filter((x): x is XmlElement => typeof x !== "string" && x.name === c);
      if (!kids.length) return null;
      if (kids.length === 1 && kids[0]!.children.every((x) => typeof x === "string") && !kids[0]!.attrs.length) return xmlText(kids[0]!);
      return new Lazy(() => xmlRowsTable(kids));
    }),
  );
  return new MTable(cols, cols.map(() => T.any), rows);
}

function xmlTables(root: XmlElement): MTable {
  const groups = new Map<string, XmlElement[]>();
  for (const ch of root.children) if (typeof ch !== "string") groups.set(ch.name, [...(groups.get(ch.name) ?? []), ch]);
  if (!groups.size) return new MTable(["Name", "Table"], [T.text, T.table], [[root.name, xmlRowsTable([root])]]);
  return new MTable(
    ["Name", "Table"],
    [T.text, T.table],
    [...groups.entries()].map(([name, els]) => [name, new Lazy(() => xmlRowsTable(els))]),
  );
}

// ---------------------------------------------------------------------------------------------
// Binary helpers

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s]/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new MError("DataFormat.Error", "The input is not a valid Base-64 string.");
  const bin = atob(clean.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function hexDecode(s: string): Uint8Array {
  const clean = s.replace(/\s/g, "");
  if (clean.length % 2 || !/^[0-9a-fA-F]*$/.test(clean)) throw new MError("DataFormat.Error", "The input is not a valid hexadecimal string.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function binaryArg(v: MValue): Uint8Array {
  if (v instanceof MBinary) return v.bytes;
  throw cannotConvert(v, "Binary");
}

function splitLines(s: string, includeSeparators: boolean, quoteCsv: boolean): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoteCsv && c === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    if (c === "\n" || c === "\r") {
      const end = i;
      if (c === "\r" && s[i + 1] === "\n") i++;
      out.push(includeSeparators ? s.slice(start, i + 1) : s.slice(start, end));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

// ---------------------------------------------------------------------------------------------
// SQL

function sqlLiteral(v: MValue): string {
  if (v === null) return "NULL";
  if (typeof v === "string") return `N'${v.replace(/'/g, "''")}'`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof MDate || v instanceof MDateTime || v instanceof MDateTimeZone || v instanceof MTime) return `'${toText(v)}'`;
  throw new MError("Expression.Error", "Value.NativeQuery: parameters must be text, number, logical, date or time values.");
}

function nativeQueryTable(ctx: LibContext, server: string, database: string, query: string): MTable {
  return hostTableToM(ctx.host.request({ kind: "sql", server, database, query }));
}

/** A navigation read: schema first (TOP 0), rows on first use — foldable (see ./fold.ts). */
function sqlItemTable(ctx: LibContext, server: string, database: string, schema: string, item: string): MTable {
  const base = { kind: "sql" as const, server, database, schema, item };
  const head = ctx.host.request({ ...base, top: 0 });
  const read = (spec: FoldSpec): Cell[][] => {
    const req: Extract<DataRequest, { kind: "sql" }> = { ...base };
    if (spec.columns) req.columns = spec.columns;
    if (spec.filter) req.where = renderPredicate(spec.filter, TSQL);
    if (spec.orderBy?.length) req.orderBy = spec.orderBy.map((k) => TSQL.orderItem(k)).join(", ");
    if (spec.skip) req.skip = spec.skip;
    if (spec.top !== undefined) req.top = spec.top;
    return hostRows(ctx.host.request(req));
  };
  const t = new MTable(
    head.columns.map((c) => c.name),
    head.columns.map((c) => mTypeOfHost(c.type)),
    () => read({}),
  );
  // T-SQL can't express every M value (e.g. time literals): such predicates run locally
  t.fold = {
    read,
    spec: {},
    columns: head.columns.map((c) => c.name),
    caps: { filter: (p) => renderPredicate(p, TSQL) !== undefined },
    sql: {
      key: `sql|${server.toLowerCase()}|${database.toLowerCase()}`,
      dialect: "tsql",
      select: (spec) =>
        TSQL.select({ schema, item, columns: spec.columns, where: spec.filter ? renderPredicate(spec.filter, TSQL) : undefined, orderBy: spec.orderBy, skip: spec.skip, top: spec.top }),
      run: (query) => hostRows(ctx.host.request({ kind: "sql", server, database, query })),
    },
  };
  return t;
}

function sqlNavigation(ctx: LibContext, server: string, database: string): MTable {
  const items = () => ctx.host.request({ kind: "sql-items", server, database });
  const row = (schema: string, item: string, kind: string): Cell[] => [item, new Lazy(() => sqlItemTable(ctx, server, database, schema, item)), schema, item, kind];
  const columns = ["Name", "Data", "Schema", "Item", "Kind"];
  const t = navTable(columns, () => items().map((it) => row(it.schema, it.item, it.kind)));
  t.source = { kind: "sql", server, database };
  // Source{[Schema="dbo",Item="x"]} resolves without listing every table (one fewer round trip).
  t.navLookup = (key) => {
    const names = key.names;
    if (!names.every((n) => n === "Schema" || n === "Item" || n === "Name")) return undefined;
    const get = (n: string) => (key.has(n) ? key.get(n) : undefined);
    const item = get("Item") ?? get("Name");
    const schema = get("Schema") ?? "dbo";
    if (typeof item !== "string" || typeof schema !== "string") return undefined;
    return new MRecord(columns, row(schema, item, "Table"));
  };
  t.navHint = (key) => {
    const schema = key.has("Schema") ? key.get("Schema") : null;
    try {
      const inSchema = items().filter((i) => i.schema === schema).map((i) => i.item);
      return typeof schema === "string" ? (inSchema.length ? `(Items in schema '${schema}': ${inSchema.slice(0, 20).join(", ")}${inSchema.length > 20 ? ", …" : ""}.)` : `(No tables are visible in schema '${schema}'.)`) : undefined;
    } catch {
      return undefined;
    }
  };
  return t;
}

// ---------------------------------------------------------------------------------------------
// Web / OData

function queryString(q: MRecord): string {
  const parts: string[] = [];
  for (const n of q.names) {
    const v = q.get(n);
    const vals = v instanceof MList ? v.values() : [v];
    for (const x of vals) parts.push(`${encodeURIComponent(n)}=${encodeURIComponent(x === null ? "" : (toText(x) ?? ""))}`);
  }
  return parts.join("&");
}

function webRequest(url: string, options: MValue): { req: Extract<DataRequest, { kind: "http" }>; manual: number[] } {
  let full = url;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let manual: number[] = [];
  if (options instanceof MRecord) {
    const rel = flag(options, "RelativePath");
    if (typeof rel === "string" && rel) full = `${full.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
    const q = flag(options, "Query");
    if (q instanceof MRecord && q.names.length) full += (full.includes("?") ? "&" : "?") + queryString(q);
    const h = flag(options, "Headers");
    if (h instanceof MRecord) for (const n of h.names) headers[n] = text(h.get(n));
    const c = flag(options, "Content");
    if (c instanceof MBinary) body = new TextDecoder().decode(c.bytes);
    else if (typeof c === "string") body = c;
    const ms = flag(options, "ManualStatusHandling");
    if (ms instanceof MList) manual = ms.values().map(num);
    const key = flag(options, "ApiKeyName");
    if (typeof key === "string") throw new MError("Expression.Error", "Web.Contents: ApiKeyName credentials aren't supported; put the key in Query or Headers.");
  }
  return { req: { kind: "http", url: full, method: body !== undefined ? "POST" : "GET", headers, body }, manual };
}

function webContents(ctx: LibContext, url: string, options: MValue): MBinary {
  const { req, manual } = webRequest(url, options);
  const res = ctx.host.request(req);
  if (res.status >= 400 && !manual.includes(res.status)) {
    throw new MError("DataSource.Error", `Web.Contents failed to get contents from '${req.url}' (${res.status}).`, MRecord.from([["DataSourceKind", "Web"], ["DataSourcePath", url], ["Url", req.url]]));
  }
  const b = new MBinary(res.body, req.url);
  setMetadata(
    b,
    MRecord.from([
      ["Content.Type", res.headers["content-type"] ?? null],
      ["Content.Uri", req.url],
      ["Content.Name", req.url.split("?")[0]!.split("/").pop() ?? ""],
      ["Headers", MRecord.from(Object.entries(res.headers))],
      ["Response.Status", res.status],
    ]),
  );
  return b;
}

function recordsTable(items: MValue[]): MTable {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const it of items) if (it instanceof MRecord) for (const n of it.names) if (!seen.has(n) && !n.includes("@odata.")) (seen.add(n), cols.push(n));
  return new MTable(cols, cols.map(() => T.any), items.map((it) => cols.map((c) => (it instanceof MRecord && it.has(c) ? it.get(c) : null))));
}

function odataFeed(ctx: LibContext, url: string, headers: MValue): MTable {
  const h: Record<string, string> = { Accept: "application/json;odata.metadata=minimal" };
  if (headers instanceof MRecord) for (const n of headers.names) h[n] = text(headers.get(n));
  const get = (u: string): MRecord => {
    const res = ctx.host.request({ kind: "http", url: u, method: "GET", headers: h });
    if (res.status >= 400) throw new MError("DataSource.Error", `OData: Request failed (${res.status}) for '${u}'.`, u);
    const v = parseJson(res.body, null);
    if (!(v instanceof MRecord)) throw new MError("DataFormat.Error", "OData: The feed's response isn't an OData JSON payload.");
    return v;
  };
  const first = get(url);
  const value = first.has("value") ? first.get("value") : null;
  if (!(value instanceof MList)) throw new MError("DataFormat.Error", "OData: The response has no 'value' array (only OData v4 JSON feeds are supported).");
  const context = first.has("@odata.context") ? first.get("@odata.context") : null;
  const isService = typeof context === "string" && /\$metadata$/.test(context) && value.values().every((x) => x instanceof MRecord && x.has("url") && x.has("name"));
  if (isService) {
    const base = url.replace(/\/+$/, "");
    return navTable(
      ["Name", "Data", "Signature"],
      value.values().map((x) => {
        const r = x as MRecord;
        const target = text(r.get("url"));
        return [text(r.get("name")), new Lazy(() => odataFeed(ctx, /^https?:/i.test(target) ? target : `${base}/${target}`, headers)), "table"];
      }),
    );
  }
  const items = [...value.values()];
  let next = first.has("@odata.nextLink") ? first.get("@odata.nextLink") : null;
  for (let page = 0; typeof next === "string" && page < 1000; page++) {
    const r = get(next);
    const v = r.has("value") ? r.get("value") : null;
    if (v instanceof MList) items.push(...v.values());
    next = r.has("@odata.nextLink") ? r.get("@odata.nextLink") : null;
  }
  return recordsTable(items);
}

// ---------------------------------------------------------------------------------------------
// Delta Lake

/** The files of a Folder.Files-shaped table as Delta files (Content read on demand). */
export function deltaFilesOf(files: MTable): DeltaFile[] {
  const name = files.columnIndex("Name");
  const content = files.columnIndex("Content");
  const folder = files.index.get("Folder Path");
  const val = (c: Cell): MValue => (c instanceof Lazy ? c.get() : c);
  return files.rows.map((r) => {
    let f = folder === undefined ? "" : String(val(r[folder]!) ?? "").replace(/\\/g, "/");
    if (f && !f.endsWith("/")) f += "/";
    const cell = r[content]!;
    return { name: String(val(r[name]!)), folder: f, read: () => binaryArg(val(cell)) };
  });
}

// ---------------------------------------------------------------------------------------------

function unsupportedSource(name: string, guidance: string): (args: MValue[]) => MValue {
  return () => {
    throw new MError("DataSource.Error", `${name} isn't available in Lumen: ${guidance}`);
  };
}

export function installSources(lib: Library): void {
  const def = lib.def.bind(lib);

  def("File.Contents", "path, ?options", ([p], ctx) => {
    const path = text(p!);
    return new MBinary(ctx.host.request({ kind: "file", path }), path);
  });
  def("Folder.Files", "path, ?options", ([p], ctx) => folderFiles(ctx, text(p!)));
  def("Folder.Contents", "path, ?options", ([p], ctx) => folderContents(ctx, text(p!)));

  def("Text.FromBinary", "binary, ?encoding", ([b, e]) => (b === null ? null : decodeText(binaryOrText(b!).bytes, e === null ? null : num(e!))));
  def("Text.ToBinary", "text, ?encoding, ?includeByteOrderMark", ([t, e, bom]) => {
    if (t === null) return null;
    const enc = e === null ? 65001 : num(e!);
    let bytes: Uint8Array;
    if (enc === 1200) {
      const s = text(t!);
      bytes = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) (bytes[i * 2] = s.charCodeAt(i) & 0xff), (bytes[i * 2 + 1] = s.charCodeAt(i) >> 8);
    } else bytes = encoder.encode(text(t!));
    if (bom === true && enc === 65001) bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    return new MBinary(bytes);
  });

  def("Csv.Document", "source, ?columns, ?delimiter, ?extraValues, ?encoding", ([src, columns, delimiter, _extra, encoding]) => {
    const opts = columns instanceof MRecord ? columns : null;
    const colsArg = opts ? flag(opts, "Columns") : columns!;
    const delim = textOrNull(opts ? flag(opts, "Delimiter") : delimiter!) ?? ",";
    const enc = opts ? flag(opts, "Encoding") : encoding!;
    const quoteStyle = opts ? flag(opts, "QuoteStyle") : null;
    const { bytes } = binaryOrText(src!);
    // QuoteStyle.Csv is the default, with or without an options record.
    const raw = parseCsv(decodeText(bytes, enc === null ? null : num(enc)), delim, quoteStyle === null || num(quoteStyle) === 1);
    let names: string[];
    let types: MType[];
    if (colsArg === null) {
      const width = Math.max(0, ...raw.map((r) => r.length));
      names = Array.from({ length: width }, (_x, i) => `Column${i + 1}`);
      types = names.map(() => T.any);
    } else if (typeof colsArg === "number") {
      names = Array.from({ length: colsArg }, (_x, i) => `Column${i + 1}`);
      types = names.map(() => T.any);
    } else if (colsArg instanceof MType && colsArg.fields) {
      names = colsArg.fields.map((f) => f.name);
      types = colsArg.fields.map((f) => f.type);
    } else {
      names = (colsArg as MList).values().map(text);
      types = names.map(() => T.any);
    }
    // Like Power Query, a fixed Columns count silently drops extra fields: a classic schema-drift trap.
    const rows = raw.map((r) => names.map((_n, i) => (i < r.length ? r[i]! : null)));
    return new MTable(names, types, rows);
  });

  def("Lines.FromBinary", "binary, ?quoteStyle, ?includeLineSeparators, ?encoding", ([b, q, inc, e]) => {
    if (b === null) return null;
    return MList.of(splitLines(decodeText(binaryOrText(b!).bytes, e === null ? null : num(e!)), inc === true, q !== null && num(q!) === 1));
  });
  def("Lines.FromText", "text, ?quoteStyle, ?includeLineSeparators", ([t, q, inc]) => (t === null ? null : MList.of(splitLines(text(t!), inc === true, q !== null && num(q!) === 1))));
  def("Lines.ToText", "lines, ?lineSeparator", ([l, s]) => {
    const sep = textOrNull(s!) ?? "\r\n";
    return (l as MList).values().map((x) => text(x) + sep).join("");
  });
  def("Lines.ToBinary", "lines, ?lineSeparator, ?encoding, ?includeByteOrderMark", ([l, s]) => {
    const sep = textOrNull(s!) ?? "\r\n";
    return new MBinary(encoder.encode((l as MList).values().map((x) => text(x) + sep).join("")));
  });

  def("Json.Document", "jsonText, ?encoding", ([src, e]) => parseJson(binaryOrText(src!).bytes, e === null ? null : num(e!)));
  def("Json.FromValue", "value, ?encoding", ([v]) => new MBinary(encoder.encode(JSON.stringify(mToJson(v!)))));

  def("Xml.Document", "contents, ?encoding", ([c, e]) => {
    const root = parseXml(decodeText(binaryOrText(c!).bytes, e === null ? null : num(e!)));
    return xmlDocumentTable([root]);
  });
  def("Xml.Tables", "contents, ?options, ?encoding", ([c, _o, e]) => xmlTables(parseXml(decodeText(binaryOrText(c!).bytes, e === null ? null : num(e!)))));

  def("Excel.Workbook", "workbook, ?useHeaders, ?delayTypes", ([wb, h], ctx) => {
    const input = binaryOrText(wb!);
    const useHeaders = h instanceof MRecord ? flag(h, "UseHeaders") === true : h === true;
    const b = input.bytes;
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
      throw new MError("DataFormat.Error", "Legacy .xls workbooks aren't supported in Lumen. Save the file as .xlsx in Excel (or LibreOffice) and point the query at the new file.", input.path ?? null);
    }
    const data = ctx.host.request({ kind: "decode", format: "xlsx", key: bytesKey(b), bytes: b, path: input.path }) as WorkbookData;
    return workbookTable(data, useHeaders);
  });
  def("Excel.CurrentWorkbook", "", unsupportedSource("Excel.CurrentWorkbook", "it only works inside Excel. Read the workbook with Excel.Workbook(File.Contents(\"<path>.xlsx\")) instead."));

  def("Parquet.Document", "binary, ?options", ([b], ctx) => {
    const { bytes, path } = binaryOrText(b!);
    return hostTableToM(ctx.host.request({ kind: "decode", format: "parquet", key: bytesKey(bytes), bytes, path }) as HostTable);
  });
  def("DeltaLake.Table", "directory, ?options", ([d], ctx) => {
    const files = typeof d === "string" ? folderFiles(ctx, d) : d instanceof MTable ? d : null;
    if (!files) throw cannotConvert(d!, "Table");
    return deltaTableFromFiles(ctx, deltaFilesOf(files));
  });

  // Binary
  def("Binary.FromText", "text, ?encoding", ([t, e]) => {
    if (t === null) return null;
    const enc = e === null ? 0 : num(e!);
    return new MBinary(enc === 1 ? hexDecode(text(t!)) : base64Decode(text(t!)));
  });
  def("Binary.ToText", "binary, ?encoding", ([b, e]) => {
    if (b === null) return null;
    const bytes = binaryArg(b!);
    return e !== null && num(e!) === 1 ? [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("") : base64Encode(bytes);
  });
  def("Binary.Decompress", "binary, compressionType", ([b, c]) => {
    if (b === null) return null;
    const bytes = binaryArg(b!);
    const kind = num(c!);
    try {
      if (kind === 0) return new MBinary(gunzipSync(bytes));
      if (kind === 1) return new MBinary(inflateSync(bytes));
    } catch (e) {
      throw new MError("DataFormat.Error", `The compressed data is invalid or corrupt (${(e as Error).message}).`);
    }
    throw new MError("Expression.Error", "Binary.Decompress: only Compression.GZip and Compression.Deflate are supported.");
  });
  def("Binary.Compress", "binary, compressionType", ([b, c]) => {
    if (b === null) return null;
    const bytes = binaryArg(b!);
    const kind = num(c!);
    if (kind === 0) return new MBinary(gzipSync(bytes));
    if (kind === 1) return new MBinary(deflateSync(bytes));
    throw new MError("Expression.Error", "Binary.Compress: only Compression.GZip and Compression.Deflate are supported.");
  });
  def("Binary.Length", "binary", ([b]) => (b === null ? null : binaryArg(b!).length));
  def("Binary.Buffer", "binary", ([b]) => (b === null ? null : new MBinary(binaryArg(b!), (b as MBinary).path)));
  def("Binary.From", "value, ?encoding", ([v, e]) => {
    if (v === null) return null;
    if (v instanceof MBinary) return v;
    if (typeof v === "string") return new MBinary(e !== null && num(e!) === 1 ? hexDecode(v) : base64Decode(v));
    throw cannotConvert(v!, "Binary");
  });
  def("Binary.Combine", "binaries", ([l]) => {
    const parts = (l as MList).values().map(binaryArg);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (out.set(p, o), (o += p.length));
    return new MBinary(out);
  });
  def("Binary.ToList", "binary", ([b]) => MList.of([...binaryArg(b!)]));
  def("Binary.FromList", "list", ([l]) => new MBinary(Uint8Array.from((l as MList).values().map(num))));
  def("Binary.Range", "binary, offset, ?count", ([b, o, c]) => {
    const bytes = binaryArg(b!);
    const start = num(o!);
    return new MBinary(bytes.slice(start, c === null ? undefined : start + num(c!)));
  });
  def("Binary.InferContentType", "source", ([b]) => {
    const bytes = binaryArg(b!);
    const ct = bytes[0] === 0x50 && bytes[1] === 0x4b ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : bytes[0] === 0x7b || bytes[0] === 0x5b ? "application/json" : bytes[0] === 0x3c ? "text/xml" : "text/csv";
    return MRecord.from([["Content.Type", ct]]);
  });
  for (const [k, v] of Object.entries({
    "BinaryEncoding.Base64": 0,
    "BinaryEncoding.Hex": 1,
    "Compression.GZip": 0,
    "Compression.Deflate": 1,
    "Compression.Snappy": 2,
    "Compression.Brotli": 3,
    "Compression.LZ4": 4,
    "Compression.Zstandard": 5,
    "Compression.None": -1,
    "TextEncoding.Utf8": 65001,
    "TextEncoding.Utf16": 1200,
    "TextEncoding.Unicode": 1200,
    "TextEncoding.BigEndianUnicode": 1201,
    "TextEncoding.Ascii": 20127,
    "TextEncoding.Windows": 1252,
    "CsvStyle.QuoteAfterDelimiter": 0,
    "CsvStyle.QuoteAlways": 1,
    "WebMethod.Get": 0,
    "WebMethod.Post": 1,
  })) lib.constant(k, v);

  // Web / OData
  def("Web.Contents", "url, ?options", ([u, o], ctx) => webContents(ctx, text(u!), o!));
  def("Web.Headers", "url, ?options", ([u, o], ctx) => {
    const { req } = webRequest(text(u!), o!);
    return MRecord.from(Object.entries(ctx.host.request(req).headers));
  });
  def("Web.Page", "html", unsupportedSource("Web.Page", "HTML table extraction needs a browser engine. Use an API endpoint with Json.Document(Web.Contents(...)) or download the data as CSV."));
  def("OData.Feed", "serviceUri, ?headers, ?options", ([u, h], ctx) => odataFeed(ctx, text(u!), h!));

  // SQL
  def("Sql.Database", "server, database, ?options", ([s, d, o], ctx) => {
    const server = text(s!);
    const database = text(d!);
    if (o instanceof MRecord && o.has("Query")) return nativeQueryTable(ctx, server, database, text(o.get("Query")));
    return sqlNavigation(ctx, server, database);
  });
  def("Sql.Databases", "server, ?options", ([s], ctx) => {
    const server = text(s!);
    const t = navTable(["Name", "Data", "Kind"], () => ctx.host.request({ kind: "sql-databases", server }).map((name) => [name, new Lazy(() => sqlNavigation(ctx, server, name)), "Database"]));
    t.navLookup = (key) => {
      if (key.names.length !== 1 || key.names[0] !== "Name" || typeof key.get("Name") !== "string") return undefined;
      const name = key.get("Name") as string;
      return new MRecord(["Name", "Data", "Kind"], [name, new Lazy(() => sqlNavigation(ctx, server, name)), "Database"]);
    };
    return t;
  });
  def("Value.NativeQuery", "target, query, ?parameters, ?options", ([t, q, p], ctx) => {
    if (!(t instanceof MTable) || !t.source) {
      throw new MError("Expression.Error", "Value.NativeQuery: native queries are only supported on a database (the result of Sql.Database, PostgreSQL.Database, MySQL.Database or SQLite.Database).");
    }
    const src = t.source;
    const literal = (v: MValue): string => {
      if (src.kind === "sql") return sqlLiteral(v);
      const lit = DIALECTS[src.driver].literal(v);
      if (lit === undefined) throw new MError("Expression.Error", "Value.NativeQuery: parameters must be text, number, logical, date or time values.");
      return lit;
    };
    let sql = text(q!);
    if (p instanceof MRecord) for (const n of p.names) sql = sql.replace(new RegExp(`@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), literal(p.get(n)));
    else if (p instanceof MList) {
      const vals = p.values();
      let k = 0;
      sql = sql.replace(/\?/g, () => literal(vals[k++] ?? null));
    }
    if (src.kind === "db") return hostTableToM(ctx.host.request({ kind: "db", driver: src.driver, server: src.server, database: src.database, query: sql }));
    return nativeQueryTable(ctx, src.server, src.database, sql);
  });

  // Fabric / Power BI service sources
  def("Lakehouse.Contents", "?options", (_args, ctx) => lakehouseContents(ctx));
  def("Fabric.Warehouse", "?options", (_args, ctx) => lakehouseContents(ctx));
  def("Lakehouse.Tables", "?options", (_args, ctx) => lakehouseContents(ctx));
  const dataflowGuidance =
    "dataflows live in the Power BI / Fabric service and can't be read offline. Point the query at the dataflow's destination (e.g. its lakehouse SQL analytics endpoint with Sql.Database) or at an exported file.";
  def("PowerBI.Dataflows", "?options", unsupportedSource("PowerBI.Dataflows", dataflowGuidance));
  def("PowerPlatform.Dataflows", "?options", unsupportedSource("PowerPlatform.Dataflows", dataflowGuidance));
  def("AnalysisServices.Database", "server, database, ?options", unsupportedSource("AnalysisServices.Database", "connecting to Analysis Services / Power BI datasets isn't supported."));
  def("AzureStorage.DataLake", "endpoint, ?options", unsupportedSource("AzureStorage.DataLake", "Azure storage sign-in isn't supported. Download the files (e.g. with azcopy) and use Folder.Files / DeltaLake.Table on the local copy."));
  def("AzureStorage.Blobs", "account, ?options", unsupportedSource("AzureStorage.Blobs", "Azure storage sign-in isn't supported. Download the files and use Folder.Files on the local copy."));
  def("Odbc.DataSource", "connectionString, ?options", unsupportedSource("Odbc.DataSource", "ODBC drivers aren't available. Use Sql.Database for SQL Server / Azure SQL / Fabric, or export the data to a file."));
  def("Odbc.Query", "connectionString, query, ?options", unsupportedSource("Odbc.Query", "ODBC drivers aren't available."));
  def("OleDb.DataSource", "connectionString, ?options", unsupportedSource("OleDb.DataSource", "OLE DB providers are Windows-only."));

  const sharePoint = ([u]: MValue[], ctx: LibContext) => {
    const url = text(u!);
    const files = ctx.host.request({ kind: "sharepoint-files", url });
    return navTable(
      ["Content", "Name", "Extension", "Folder Path"],
      files.map((f) => [new Lazy(() => new MBinary(f.read(), f.path)), f.name, extension(f.name), f.folderPath]),
    );
  };
  def("SharePoint.Files", "url, ?options", sharePoint);
  def("SharePoint.Contents", "url, ?options", sharePoint);
  def("SharePoint.Tables", "url, ?options", unsupportedSource("SharePoint.Tables", "SharePoint lists need SharePoint sign-in. Export the list to Excel/CSV and read the file."));

}
