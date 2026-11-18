import { arrowToResult, type ArrowTableLike } from "./arrow.ts";
import type { QueryResult, SyncDb } from "./types.ts";

export interface BlockingConnection {
  query(sql: string): ArrowTableLike;
  close(): void;
}

export interface BlockingBindings {
  connect(): BlockingConnection;
  registerFileText(name: string, text: string): void;
  registerFileBuffer(name: string, buffer: Uint8Array): void;
  dropFile(name: string): void;
  copyFileToBuffer(name: string): Uint8Array;
  reset(): void;
}

export class DuckSyncDb implements SyncDb {
  private readonly conn: BlockingConnection;

  constructor(private readonly bindings: BlockingBindings) {
    this.conn = bindings.connect();
  }

  /**
   * The Arrow build bundled with DuckDB-WASM mis-decodes MONTH_DAY_NANO intervals,
   * so interval columns are re-read as DuckDB's own text rendering.
   */
  query(sql: string): QueryResult {
    const result = arrowToResult(this.conn.query(sql));
    const intervals = result.columns.filter((c) => c.type === "interval").map((c) => c.name);
    if (intervals.length === 0) return result;
    const replace = intervals.map((n) => `CAST("${n.replace(/"/g, '""')}" AS VARCHAR) AS "${n.replace(/"/g, '""')}"`).join(", ");
    const reread = arrowToResult(this.conn.query(`SELECT * REPLACE (${replace}) FROM (${sql.trim().replace(/;\s*$/, "")})`));
    return { columns: result.columns, rows: reread.rows };
  }

  exec(sql: string): void {
    this.conn.query(sql);
  }

  registerFileText(path: string, text: string): void {
    this.bindings.registerFileText(path, text);
  }

  registerFileBuffer(path: string, bytes: Uint8Array): void {
    this.bindings.registerFileBuffer(path, bytes);
  }

  dropFile(path: string): void {
    this.bindings.dropFile(path);
  }

  copyFileToBuffer(path: string): Uint8Array {
    return this.bindings.copyFileToBuffer(path);
  }

  close(): void {
    this.conn.close();
  }
}
