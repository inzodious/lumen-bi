/**
 * SQL dialects for query folding and navigation reads: identifier quoting, literals, LIKE patterns and
 * the shape of a folded SELECT (TOP vs LIMIT/OFFSET). The M side renders the complete statement, so the
 * connector only executes text (and tests can assert exactly what is sent).
 *
 * Semantics notes (documented gaps, shared with Power BI's own folding):
 *  - text comparisons follow the server's collation (MySQL / SQL Server are usually case-insensitive,
 *    PostgreSQL and SQLite case-sensitive like M);
 *  - SQLite stores dates as text: folded date comparisons assume ISO text ('YYYY-MM-DD HH:MM:SS').
 */
import { formatDate, formatDateTime, formatOffset } from "../calendar.ts";
import { MDate, MDateTime, MDateTimeZone, MTime, type MValue } from "../values.ts";
import { formatTime } from "../calendar.ts";

export type SqlDialectName = "tsql" | "postgresql" | "mysql" | "sqlite" | "duckdb";

export interface SortKey {
  column: string;
  desc: boolean;
}

export interface SelectSpec {
  /** schema-qualified target (schema may be empty) */
  schema?: string;
  item: string;
  columns?: string[];
  where?: string;
  orderBy?: SortKey[];
  skip?: number;
  top?: number;
  /** a derived table (complete SELECT) instead of schema / item */
  fromSql?: string;
}

export interface SqlDialect {
  name: SqlDialectName;
  ident(name: string): string;
  /** SQL literal for an M scalar, or undefined when the value can't be expressed. */
  literal(v: MValue): string | undefined;
  /** `col LIKE 'pattern'` for a LIKE pattern whose metacharacters are already escaped with `\` (or `[x]` in T-SQL). */
  like(column: string, kind: "starts" | "ends" | "contains", text: string): string;
  /** ORDER BY item reproducing M's null ordering (nulls first ascending, last descending). */
  orderItem(k: SortKey): string;
  /** Can a Skip fold without an ORDER BY? */
  skipWithoutOrder: boolean;
  select(spec: SelectSpec): string;
}

const isPlainNumber = (v: MValue): v is number => typeof v === "number" && Number.isFinite(v);

function sqlDateTime(ms: number): string {
  return formatDateTime(ms).replace("T", " ");
}

function quotedText(s: string, backslashes: boolean): string {
  let t = s.replace(/'/g, "''");
  if (backslashes) t = t.replace(/\\/g, "\\\\");
  return `'${t}'`;
}

/** Escapes LIKE metacharacters with a backslash. */
function likeBackslash(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function pattern(kind: "starts" | "ends" | "contains", escaped: string): string {
  return kind === "starts" ? `${escaped}%` : kind === "ends" ? `%${escaped}` : `%${escaped}%`;
}

function columnsOf(d: SqlDialect, spec: SelectSpec): string {
  return spec.columns?.length ? spec.columns.map((c) => d.ident(c)).join(", ") : "*";
}

function fromOf(d: SqlDialect, spec: SelectSpec): string {
  if (spec.fromSql) return `(${spec.fromSql}) AS ${d.ident("_")}`;
  return `${spec.schema ? `${d.ident(spec.schema)}.` : ""}${d.ident(spec.item)}`;
}

/** Null-safe equality (M joins match null keys with each other). */
export function nullSafeEquals(d: SqlDialect, a: string, b: string): string {
  switch (d.name) {
    case "postgresql":
    case "duckdb":
      return `${a} IS NOT DISTINCT FROM ${b}`;
    case "mysql":
      return `${a} <=> ${b}`;
    case "sqlite":
      return `${a} IS ${b}`;
    default:
      return `(${a} = ${b} OR (${a} IS NULL AND ${b} IS NULL))`;
  }
}

function tail(d: SqlDialect, spec: SelectSpec): string {
  let s = spec.where ? ` WHERE ${spec.where}` : "";
  if (spec.orderBy?.length) s += ` ORDER BY ${spec.orderBy.map((k) => d.orderItem(k)).join(", ")}`;
  return s;
}

export const TSQL: SqlDialect = {
  name: "tsql",
  ident: (n) => `[${n.replace(/]/g, "]]")}]`,
  literal(v) {
    if (v === null) return "NULL";
    if (typeof v === "string") return `N${quotedText(v, false)}`;
    if (typeof v === "number") return isPlainNumber(v) ? String(v) : undefined;
    if (typeof v === "boolean") return v ? "1" : "0";
    if (v instanceof MDate) return `'${formatDate(v.days)}'`;
    if (v instanceof MDateTime) return `'${formatDateTime(v.ms)}'`;
    if (v instanceof MDateTimeZone) return `'${formatDateTime(v.utcMs)}'`;
    return undefined;
  },
  like: (col, kind, text) => `${col} LIKE N'${pattern(kind, text.replace(/'/g, "''").replace(/([[\]%_])/g, "[$1]"))}'`,
  orderItem: (k) => `${TSQL.ident(k.column)}${k.desc ? " DESC" : ""}`,
  skipWithoutOrder: false,
  select(spec) {
    const top = spec.top !== undefined && !spec.skip ? `TOP (${spec.top}) ` : "";
    let s = `SELECT ${top}${columnsOf(TSQL, spec)} FROM ${fromOf(TSQL, spec)}${tail(TSQL, spec)}`;
    if (spec.skip) s += ` OFFSET ${spec.skip} ROWS${spec.top !== undefined ? ` FETCH NEXT ${spec.top} ROWS ONLY` : ""}`;
    return s;
  },
};

export const POSTGRESQL: SqlDialect = {
  name: "postgresql",
  ident: (n) => `"${n.replace(/"/g, '""')}"`,
  literal(v) {
    if (v === null) return "NULL";
    if (typeof v === "string") return quotedText(v, false);
    if (typeof v === "number") return isPlainNumber(v) ? String(v) : undefined;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v instanceof MDate) return `DATE '${formatDate(v.days)}'`;
    if (v instanceof MDateTime) return `TIMESTAMP '${sqlDateTime(v.ms)}'`;
    if (v instanceof MDateTimeZone) return `TIMESTAMPTZ '${sqlDateTime(v.ms)}${formatOffset(v.offsetMinutes)}'`;
    if (v instanceof MTime) return `TIME '${formatTime(v.ms)}'`;
    return undefined;
  },
  // standard_conforming_strings is on by default: backslashes are literal in '…' and LIKE's escape is `\`
  like: (col, kind, text) => `${col} LIKE ${quotedText(pattern(kind, likeBackslash(text)), false)}`,
  // PostgreSQL sorts nulls last ascending; M sorts them first
  orderItem: (k) => `${POSTGRESQL.ident(k.column)} ${k.desc ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
  skipWithoutOrder: true,
  select(spec) {
    let s = `SELECT ${columnsOf(POSTGRESQL, spec)} FROM ${fromOf(POSTGRESQL, spec)}${tail(POSTGRESQL, spec)}`;
    if (spec.top !== undefined) s += ` LIMIT ${spec.top}`;
    if (spec.skip) s += ` OFFSET ${spec.skip}`;
    return s;
  },
};

export const MYSQL: SqlDialect = {
  name: "mysql",
  ident: (n) => `\`${n.replace(/`/g, "``")}\``,
  literal(v) {
    if (v === null) return "NULL";
    // MySQL treats backslash as an escape inside '…' (unless NO_BACKSLASH_ESCAPES)
    if (typeof v === "string") return quotedText(v, true);
    if (typeof v === "number") return isPlainNumber(v) ? String(v) : undefined;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v instanceof MDate) return `'${formatDate(v.days)}'`;
    if (v instanceof MDateTime) return `'${sqlDateTime(v.ms)}'`;
    if (v instanceof MDateTimeZone) return `'${sqlDateTime(v.utcMs)}'`;
    if (v instanceof MTime) return `'${formatTime(v.ms)}'`;
    return undefined;
  },
  like: (col, kind, text) => `${col} LIKE ${quotedText(pattern(kind, likeBackslash(text)), true)}`,
  // MySQL already sorts nulls first ascending / last descending, like M
  orderItem: (k) => `${MYSQL.ident(k.column)}${k.desc ? " DESC" : ""}`,
  skipWithoutOrder: true,
  select(spec) {
    let s = `SELECT ${columnsOf(MYSQL, spec)} FROM ${fromOf(MYSQL, spec)}${tail(MYSQL, spec)}`;
    if (spec.top !== undefined || spec.skip) s += ` LIMIT ${spec.top ?? "18446744073709551615"}`;
    if (spec.skip) s += ` OFFSET ${spec.skip}`;
    return s;
  },
};

export const SQLITE: SqlDialect = {
  name: "sqlite",
  ident: (n) => `"${n.replace(/"/g, '""')}"`,
  literal(v) {
    if (v === null) return "NULL";
    if (typeof v === "string") return quotedText(v, false);
    if (typeof v === "number") return isPlainNumber(v) ? String(v) : undefined;
    if (typeof v === "boolean") return v ? "1" : "0";
    if (v instanceof MDate) return `'${formatDate(v.days)}'`;
    if (v instanceof MDateTime) return `'${sqlDateTime(v.ms)}'`;
    if (v instanceof MDateTimeZone) return `'${sqlDateTime(v.utcMs)}'`;
    if (v instanceof MTime) return `'${formatTime(v.ms)}'`;
    return undefined;
  },
  // SQLite's LIKE has no default escape character (and is case-insensitive for ASCII: a documented gap)
  like: (col, kind, text) => `${col} LIKE ${quotedText(pattern(kind, likeBackslash(text)), false)} ESCAPE '\\'`,
  // SQLite sorts nulls first ascending / last descending, like M
  orderItem: (k) => `${SQLITE.ident(k.column)}${k.desc ? " DESC" : ""}`,
  skipWithoutOrder: true,
  select(spec) {
    let s = `SELECT ${columnsOf(SQLITE, spec)} FROM ${fromOf(SQLITE, spec)}${tail(SQLITE, spec)}`;
    if (spec.top !== undefined || spec.skip) s += ` LIMIT ${spec.top ?? -1}`;
    if (spec.skip) s += ` OFFSET ${spec.skip}`;
    return s;
  },
};

/** DuckDB: PostgreSQL-compatible literals and LIMIT / OFFSET; nulls sort last ascending (M: first). */
export const DUCKDB: SqlDialect = {
  ...POSTGRESQL,
  name: "duckdb",
  orderItem: (k) => `${POSTGRESQL.ident(k.column)} ${k.desc ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
  select(spec) {
    let s = `SELECT ${columnsOf(DUCKDB, spec)} FROM ${fromOf(DUCKDB, spec)}${tail(DUCKDB, spec)}`;
    if (spec.top !== undefined) s += ` LIMIT ${spec.top}`;
    if (spec.skip) s += ` OFFSET ${spec.skip}`;
    return s;
  },
};

export const DIALECTS: Record<SqlDialectName, SqlDialect> = { tsql: TSQL, postgresql: POSTGRESQL, mysql: MYSQL, sqlite: SQLITE, duckdb: DUCKDB };
