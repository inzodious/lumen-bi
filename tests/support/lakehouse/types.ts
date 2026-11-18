export type LogicalType =
  | "boolean"
  | "integer"
  | "bigint"
  | "double"
  | "decimal"
  | "varchar"
  | "date"
  | "timestamp"
  | "time"
  | "interval"
  | "list"
  | "struct"
  | "map"
  | "blob"
  | "null"
  | "other";

export type Scalar = null | boolean | number | string;
export type Value = Scalar | Value[] | { [key: string]: Value };

export interface Column {
  name: string;
  type: LogicalType;
  rawType: string;
}

export interface QueryResult {
  columns: Column[];
  rows: Value[][];
}

export interface SyncDb {
  query(sql: string): QueryResult;
  exec(sql: string): void;
  registerFileText(path: string, text: string): void;
  registerFileBuffer(path: string, bytes: Uint8Array): void;
  dropFile(path: string): void;
  copyFileToBuffer(path: string): Uint8Array;
  close(): void;
}

export interface TableRef {
  lakehouse: string;
  schema: string;
  table: string;
}

export type WriteMode = "append" | "overwrite" | "error" | "errorifexists" | "ignore";

export interface WriteOptions {
  mode?: WriteMode;
  overwriteSchema?: boolean;
  mergeSchema?: boolean;
  partitionBy?: string[];
  operationParameters?: Record<string, unknown>;
  /** History entry overrides for writers Delta records differently (insertInto and replaceWhere log WRITE). */
  operation?: string;
  numOutputRows?: number;
  /** The history timestamp, for seeded datasets that replay earlier runs; the default is the workspace clock. */
  commitTime?: Date;
}

/**
 * One WHEN clause of a Delta merge. Conditions and expressions are SQL over the `target.` and
 * `source.` qualifiers, exactly like the merge condition.
 */
export type MatchedClause =
  | { action: "updateAll"; condition?: string }
  | { action: "update"; condition?: string; set: Record<string, string> }
  | { action: "delete"; condition?: string };

export type NotMatchedClause =
  | { action: "insertAll"; condition?: string }
  | { action: "insert"; condition?: string; values: Record<string, string> };

export interface MergeClauses {
  /** Evaluated in order; the first clause whose condition holds applies. Only the last may omit its condition. */
  matched?: MatchedClause[];
  notMatched?: NotMatchedClause[];
  /** Shorthands kept for callers that predate clause lists; they append an unconditional clause. */
  whenMatchedUpdateAll?: boolean;
  whenMatchedDelete?: boolean;
  whenNotMatchedInsertAll?: boolean;
}

export interface HistoryEntry {
  version: number;
  timestamp: string;
  operation: string;
  operationParameters: Record<string, unknown>;
  numOutputRows: number;
}

export class LakehouseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LakehouseError";
  }
}
