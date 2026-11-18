/**
 * What the M engine needs from the outside world.
 *
 * The interpreter is synchronous, while real sources (files, SQL, HTTP, xlsx/parquet decoding) are async.
 * Every external read therefore goes through one synchronous entry point, `MHost.request`, which either
 * returns the (already fetched) answer or throws `NeedData` (see ./driver.ts). The fetch-and-replay driver
 * catches it, performs the request asynchronously, caches the answer and evaluates again until no request
 * is outstanding. Answers are plain, structured-cloneable data so they can cross IPC and be cached.
 *
 * Plain values crossing this boundary (HostTable rows) are JS values in a normalized shape:
 *   null; boolean; number; string; Date (UTC fields carry the wall clock — same as the model's DataStore);
 *   or text in the forms 'YYYY-MM-DD' (date), 'YYYY-MM-DD HH:MM:SS[.fff]' (timestamp), 'HH:MM:SS' (time)
 *   when the column type says so; Uint8Array for binary.
 */
export interface HostColumn {
  name: string;
  /** Logical type: boolean, integer, bigint, double, decimal, varchar, date, timestamp, datetimeoffset, time, binary, ... */
  type: string;
}

export interface HostTable {
  columns: HostColumn[];
  rows: unknown[][];
}

export interface HostFileEntry {
  name: string;
  /** Absolute path (or a host-specific path usable with a `file` request). */
  path: string;
  isFolder: boolean;
  size?: number;
  /** ms since epoch */
  modified?: number;
  created?: number;
  accessed?: number;
}

/** A cell of a decoded workbook: scalars, or tagged dates (`$date: 'YYYY-MM-DD'`, `$datetime: 'YYYY-MM-DD HH:MM:SS'`). */
export type WorkbookCell = string | number | boolean | null | { $date: string } | { $datetime: string } | { $time: string };

/** @deprecated name kept for older tests */
export type MockCell = WorkbookCell;

/** A decoded Excel workbook (sheets as raw cell grids starting at the used range, Excel tables, defined names). */
export interface WorkbookData {
  sheets?: { name: string; rows: WorkbookCell[][]; hidden?: boolean }[];
  tables?: { name: string; columns: string[]; rows: WorkbookCell[][] }[];
  definedNames?: { name: string; rows: WorkbookCell[][] }[];
}

/** @deprecated alias */
export type MockWorkbook = WorkbookData;

export interface HttpAnswer {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface SqlItem {
  schema: string;
  item: string;
  kind: "Table" | "View";
}

export interface SharePointFileEntry {
  name: string;
  folderPath: string;
  read(): Uint8Array;
  path: string;
}

export interface HostLakehouse {
  id: string;
  name: string;
  schemas(): string[];
  tables(schema: string): string[];
  readTable(schema: string, table: string): HostTable;
  /** `dir` is relative to the lakehouse root: `Files` or `Files/data/...`. */
  list(dir: string): HostFileEntry[];
  readFile(path: string): Uint8Array;
}

export interface HostWorkspace {
  id: string;
  name: string;
  lakehouses: HostLakehouse[];
}

/** Every external read the engine can make, as plain data (the cache key is derived from it). */
export type DataRequest =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string; recursive: boolean }
  | { kind: "sql-items"; server: string; database: string }
  | { kind: "sql-databases"; server: string }
  /**
   * SQL Server: whole table (navigation) or a native query. `columns` / `where` / `orderBy` / `skip` / `top` are
   * folded navigation reads (`where` and `orderBy` are T-SQL text).
   */
  | { kind: "sql"; server: string; database: string; schema?: string; item?: string; query?: string; columns?: string[]; where?: string; orderBy?: string; skip?: number; top?: number }
  /** Other databases (PostgreSQL, MySQL/MariaDB, SQLite): navigation listing. `server` is the file path for SQLite. */
  | { kind: "db-items"; driver: DbDriver; server: string; database: string }
  | { kind: "db-databases"; driver: DbDriver; server: string }
  /**
   * A complete SQL statement in the driver's dialect (navigation reads are rendered by the M side, so
   * folding is visible in the text). `table` names the navigated table (SQLite uses its declared types).
   */
  | { kind: "db"; driver: DbDriver; server: string; database: string; query: string; table?: { schema: string; item: string } }
  /** Firestore: collection ids under the database root or under a document (`parent` = "users/abc"). */
  | { kind: "firestore-collections"; project: string; database: string; parent?: string; emulator?: string }
  /** Firestore: documents of a collection (or collection group), filtered / limited at the source; paged by the connector. */
  | {
      kind: "firestore-query";
      project: string;
      database: string;
      parent?: string;
      collection: string;
      allDescendants?: boolean;
      filters?: FirestoreFilter[];
      orderBy?: { field: string; desc: boolean }[];
      limit?: number;
      emulator?: string;
    }
  /** S3-compatible object storage: objects under a prefix (recursive) or one level (folders included). */
  | { kind: "s3-list"; bucket: string; prefix: string; recursive: boolean; endpoint?: string; region?: string; forcePathStyle?: boolean }
  | { kind: "s3-object"; bucket: string; key: string; endpoint?: string; region?: string; forcePathStyle?: boolean }
  | { kind: "http"; url: string; method: string; headers: Record<string, string>; body?: string }
  /** `path` (not part of the cache key) helps in-process hosts identify the source. */
  | { kind: "decode"; format: "xlsx" | "parquet"; key: string; bytes: Uint8Array; path?: string }
  /** Only in-process hosts (tests, sync hosts) answer these. */
  | { kind: "lakehouse-contents" }
  | { kind: "sharepoint-files"; url: string };

export type DbDriver = "postgresql" | "mysql" | "sqlite" | "duckdb";

/** A Firestore REST value (`{ stringValue: "x" }`, `{ integerValue: "1" }`, …). */
export type FirestoreValue = Record<string, unknown>;

/** A Firestore field filter (REST `FieldFilter.Operator` names). */
export interface FirestoreFieldFilter {
  field: string;
  op: "EQUAL" | "LESS_THAN" | "LESS_THAN_OR_EQUAL" | "GREATER_THAN" | "GREATER_THAN_OR_EQUAL" | "IN" | "ARRAY_CONTAINS";
  value: FirestoreValue;
}

/**
 * A Firestore filter: a field filter, a unary IS_NOT_NULL (the field exists and is not null), or a composite
 * AND / OR of filters (REST `CompositeFilter`).
 */
export type FirestoreFilter = FirestoreFieldFilter | { field: string; op: "IS_NOT_NULL" } | { op: "AND" | "OR"; filters: FirestoreFilter[] };

/** A Firestore document as returned by the REST API. */
export interface FirestoreDocument {
  /** projects/{p}/databases/{d}/documents/{path} */
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export interface DataAnswers {
  file: Uint8Array;
  folder: HostFileEntry[];
  "sql-items": SqlItem[];
  "sql-databases": string[];
  sql: HostTable;
  http: HttpAnswer;
  decode: WorkbookData | HostTable;
  "lakehouse-contents": HostWorkspace[];
  "sharepoint-files": SharePointFileEntry[];
  "db-items": SqlItem[];
  "db-databases": string[];
  db: HostTable;
  "firestore-collections": string[];
  "firestore-query": FirestoreDocument[];
  /** paths are `s3://bucket/key` (folders end without a slash; `isFolder` marks them) */
  "s3-list": HostFileEntry[];
  "s3-object": Uint8Array;
}

export interface MHost {
  /**
   * Synchronous access to external data: returns the answer, throws an MError for a failed source, or
   * throws `NeedData` (./driver.ts) when the answer hasn't been fetched yet.
   */
  request<K extends DataRequest["kind"]>(req: Extract<DataRequest, { kind: K }>): DataAnswers[K];
  /** The single clock behind DateTime.LocalNow, DateTimeZone.UtcNow, etc. Must be stable during one evaluation. */
  now(): Date;
  /** Offset of "local" time from UTC in minutes (DateTime.LocalNow = UTC + offset). */
  localOffsetMinutes?: number;
  /**
   * Fold predicates whose values come from other steps / queries (default true). Set to false when privacy
   * levels forbid sending one source's data to another: such filters then run locally.
   */
  foldComputed?: boolean;
  /** The host's `sql` requests honour `columns` / `where` / `orderBy` / `skip` / `top` (query folding). Default false. */
  folding?: boolean;
}
