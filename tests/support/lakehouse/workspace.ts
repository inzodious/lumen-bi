import { LakehouseFiles } from "./files.ts";
import { writeQueryToFiles, type FileWriteOptions, type FileWriteResult } from "./filewrite.ts";
import { parseRef, quoteIdent, quoteLiteral, refKey, sqlName } from "./refs.ts";
import {
  LakehouseError,
  type Column,
  type HistoryEntry,
  type MatchedClause,
  type MergeClauses,
  type NotMatchedClause,
  type QueryResult,
  type SyncDb,
  type TableRef,
  type WriteOptions,
} from "./types.ts";

const DELTA_SCHEMA = "_delta";
const HIDDEN_SCHEMAS = `'information_schema', 'pg_catalog', 'main', '${DELTA_SCHEMA}'`;
const MAX_VERSIONS_KEPT = 25;
const NUMERIC_WIDENING: Record<string, string[]> = {
  TINYINT: ["SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE"],
  SMALLINT: ["INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE"],
  INTEGER: ["BIGINT", "HUGEINT", "FLOAT", "DOUBLE"],
  BIGINT: ["HUGEINT", "DOUBLE"],
  FLOAT: ["DOUBLE"],
  DATE: ["TIMESTAMP"],
};

export interface WorkspaceOptions {
  lakehouses?: Record<string, string[]>;
  defaultLakehouse?: string;
  now?: () => Date;
  /** Job ids for file writes (part-00000-<id>-c000.csv); defaults to crypto.randomUUID. */
  newId?: () => string;
}

export interface WriteResult {
  ref: string;
  version: number;
  operation: string;
  numOutputRows: number;
}

export interface MergeResult extends WriteResult {
  numUpdatedRows: number;
  numInsertedRows: number;
  numDeletedRows: number;
}

interface SchemaColumn {
  name: string;
  type: string;
}

/**
 * A simulated Fabric workspace: lakehouses are DuckDB catalogs, so
 * `lakehouse.schema.table` resolves natively. Every write is recorded as a
 * Delta-style version with a snapshot, which backs history, time travel and restore.
 */
/** Delta records the save mode with SaveMode's own casing. */
const DELTA_MODE: Record<string, string> = { overwrite: "Overwrite", append: "Append", error: "ErrorIfExists", errorifexists: "ErrorIfExists", ignore: "Ignore" };

export class Workspace {
  readonly files: LakehouseFiles;
  private readonly lakehouses = new Set<string>();
  private readonly endpointVisible = new Map<string, Set<string>>();
  private defaultLh: string;
  private readonly now: () => Date;
  private readonly newId: () => string;

  private constructor(
    readonly db: SyncDb,
    options: WorkspaceOptions,
  ) {
    this.defaultLh = options.defaultLakehouse ?? "lh_bronze";
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.files = new LakehouseFiles(db, () => this.defaultLh, () => this.now());
  }

  static create(db: SyncDb, options: WorkspaceOptions = {}): Workspace {
    const ws = new Workspace(db, options);
    const lakehouses = options.lakehouses ?? { lh_bronze: ["dbo"], lh_silver: ["dbo"], lh_gold: ["dbo"] };
    for (const [name, schemas] of Object.entries(lakehouses)) ws.createLakehouse(name, schemas);
    if (!ws.lakehouses.has(ws.defaultLh)) {
      const first = Object.keys(lakehouses)[0];
      if (!first) throw new LakehouseError("NO_LAKEHOUSE", "A workspace needs at least one lakehouse.");
      ws.defaultLh = first;
    }
    ws.useDefault();
    return ws;
  }

  get defaultLakehouse(): string {
    return this.defaultLh;
  }

  setDefaultLakehouse(name: string): void {
    this.assertLakehouse(name);
    this.defaultLh = name;
    this.useDefault();
  }

  private useDefault(): void {
    this.db.exec(`USE ${quoteIdent(this.defaultLh)}.${quoteIdent("dbo")}`);
  }

  private assertLakehouse(name: string): void {
    if (!this.lakehouses.has(name)) throw new LakehouseError("LAKEHOUSE_NOT_FOUND", `Lakehouse not found: ${name}`);
  }

  createLakehouse(name: string, schemas: string[] = ["dbo"]): void {
    const lh = name.toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(lh)) throw new LakehouseError("INVALID_NAME", `Invalid lakehouse name: ${name}`);
    if (!this.lakehouses.has(lh)) {
      this.db.exec(`ATTACH ':memory:' AS ${quoteIdent(lh)}`);
      this.lakehouses.add(lh);
      this.endpointVisible.set(lh, new Set());
      this.files.mkdirs(`${lh}/Files`);
      const meta = this.meta(lh);
      this.db.exec(`CREATE SCHEMA ${meta}`);
      this.db.exec(
        `CREATE TABLE ${meta}."log" (table_ref VARCHAR, version INTEGER, ts TIMESTAMP, operation VARCHAR, parameters VARCHAR, num_output_rows BIGINT, snapshot VARCHAR)`,
      );
      this.db.exec(`CREATE TABLE ${meta}."table_props" (table_ref VARCHAR PRIMARY KEY, partition_by VARCHAR)`);
    }
    for (const s of new Set(["dbo", ...schemas])) this.createSchema(lh, s);
  }

  private meta(lakehouse: string): string {
    return `${quoteIdent(lakehouse)}.${quoteIdent(DELTA_SCHEMA)}`;
  }

  private snapshotName(r: TableRef, snapshot: string): string {
    return `${this.meta(r.lakehouse)}.${quoteIdent(snapshot)}`;
  }

  createSchema(lakehouse: string, schema: string): void {
    this.assertLakehouse(lakehouse);
    const s = schema.toLowerCase();
    if (s === DELTA_SCHEMA) throw new LakehouseError("RESERVED_NAME", `Schema name ${DELTA_SCHEMA} is reserved.`);
    this.db.exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(lakehouse)}.${quoteIdent(s)}`);
  }

  listLakehouses(): string[] {
    return [...this.lakehouses].sort();
  }

  listSchemas(lakehouse: string): string[] {
    this.assertLakehouse(lakehouse);
    return this.db
      .query(
        `SELECT schema_name FROM information_schema.schemata WHERE catalog_name = ${quoteLiteral(lakehouse)} AND schema_name NOT IN (${HIDDEN_SCHEMAS}) ORDER BY 1`,
      )
      .rows.map((r) => String(r[0]));
  }

  listTables(lakehouse: string, schema?: string): string[] {
    this.assertLakehouse(lakehouse);
    const schemaFilter = schema ? ` AND table_schema = ${quoteLiteral(schema.toLowerCase())}` : "";
    return this.db
      .query(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_catalog = ${quoteLiteral(lakehouse)} AND table_schema NOT IN (${HIDDEN_SCHEMAS})${schemaFilter} ORDER BY 1, 2`,
      )
      .rows.map((r) => `${lakehouse}.${r[0]}.${r[1]}`);
  }

  ref(ref: string | TableRef): TableRef {
    const parsed = typeof ref === "string" ? parseRef(ref, this.defaultLh) : ref;
    this.assertLakehouse(parsed.lakehouse);
    return parsed;
  }

  tableExists(ref: string | TableRef): boolean {
    let r: TableRef;
    try {
      r = this.ref(ref);
    } catch {
      return false;
    }
    const res = this.db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_catalog = ${quoteLiteral(r.lakehouse)} AND table_schema = ${quoteLiteral(r.schema)} AND table_name = ${quoteLiteral(r.table)}`,
    );
    return res.rows.length > 0;
  }

  private requireTable(ref: string | TableRef): TableRef {
    const r = this.ref(ref);
    if (!this.tableExists(r)) {
      throw new LakehouseError("TABLE_NOT_FOUND", `[TABLE_OR_VIEW_NOT_FOUND] The table or view \`${refKey(r)}\` cannot be found.`);
    }
    return r;
  }

  private schemaOfSql(selectSql: string): SchemaColumn[] {
    return this.db.query(`DESCRIBE ${selectSql}`).rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));
  }

  describe(ref: string | TableRef): SchemaColumn[] {
    const r = this.requireTable(ref);
    return this.schemaOfSql(`SELECT * FROM ${sqlName(r)}`);
  }

  query(sql: string): QueryResult {
    return this.db.query(sql);
  }

  columns(sql: string): Column[] {
    return this.db.query(`SELECT * FROM (${sql}) LIMIT 0`).columns;
  }

  private rowCount(r: TableRef): number {
    return Number(this.db.query(`SELECT count(*) FROM ${sqlName(r)}`).rows[0]?.[0] ?? 0);
  }

  private currentVersion(r: TableRef): number {
    const res = this.db.query(`SELECT max(version) FROM ${this.meta(r.lakehouse)}."log" WHERE table_ref = ${quoteLiteral(refKey(r))}`);
    const v = res.rows[0]?.[0];
    return v === null || v === undefined ? -1 : Number(v);
  }

  private recordVersion(r: TableRef, operation: string, parameters: Record<string, unknown>, numOutputRows: number, at?: Date): number {
    const key = refKey(r);
    const meta = this.meta(r.lakehouse);
    const version = this.currentVersion(r) + 1;
    const snapshot = `${r.schema}__${r.table}__v${version}`;
    this.db.exec(`CREATE TABLE ${this.snapshotName(r, snapshot)} AS SELECT * FROM ${sqlName(r)}`);
    const ts = (at ?? this.now()).toISOString().replace("T", " ").replace("Z", "");
    this.db.exec(
      `INSERT INTO ${meta}."log" VALUES (${quoteLiteral(key)}, ${version}, TIMESTAMP ${quoteLiteral(ts)}, ${quoteLiteral(operation)}, ${quoteLiteral(JSON.stringify(parameters))}, ${numOutputRows}, ${quoteLiteral(snapshot)})`,
    );
    const stale = this.db.query(
      `SELECT snapshot FROM ${meta}."log" WHERE table_ref = ${quoteLiteral(key)} AND snapshot IS NOT NULL AND version <= ${version - MAX_VERSIONS_KEPT}`,
    );
    for (const row of stale.rows) {
      this.db.exec(`DROP TABLE IF EXISTS ${this.snapshotName(r, String(row[0]))}`);
    }
    if (stale.rows.length) {
      this.db.exec(
        `UPDATE ${meta}."log" SET snapshot = NULL WHERE table_ref = ${quoteLiteral(key)} AND version <= ${version - MAX_VERSIONS_KEPT}`,
      );
    }
    return version;
  }

  private schemaMismatch(r: TableRef, detail: string): LakehouseError {
    return new LakehouseError(
      "SCHEMA_MISMATCH",
      `A schema mismatch detected when writing to the Delta table ${refKey(r)}. ${detail} To enable schema migration using DataFrameWriter, set: '.option("mergeSchema", "true")'. To overwrite the table schema, set '.option("overwriteSchema", "true")'.`,
    );
  }

  private compatible(from: string, to: string): boolean {
    if (from === to) return true;
    if (from.startsWith("DECIMAL") && to.startsWith("DECIMAL")) return true;
    if (from === "\"NULL\"" || from === "NULL") return true;
    return NUMERIC_WIDENING[from]?.includes(to) ?? false;
  }

  /** Adds new source columns to the target and returns them, or throws if evolution is not allowed. */
  private reconcileSchema(r: TableRef, source: SchemaColumn[], allowNewColumns: boolean): SchemaColumn[] {
    const target = this.describe(r);
    const byName = new Map(target.map((c) => [c.name.toLowerCase(), c]));
    const added: SchemaColumn[] = [];
    for (const col of source) {
      const existing = byName.get(col.name.toLowerCase());
      if (!existing) {
        added.push(col);
        continue;
      }
      if (!this.compatible(col.type, existing.type)) {
        throw this.schemaMismatch(r, `Column \`${col.name}\` has type ${col.type} but the table has ${existing.type}.`);
      }
    }
    if (added.length && !allowNewColumns) {
      throw this.schemaMismatch(r, `New column(s) not in the table schema: ${added.map((c) => c.name).join(", ")}.`);
    }
    for (const col of added) {
      this.db.exec(`ALTER TABLE ${sqlName(r)} ADD COLUMN ${quoteIdent(col.name)} ${col.type}`);
    }
    return added;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN TRANSACTION");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** `df.write.format("delta").mode(...).saveAsTable(ref)` where the DataFrame is `selectSql`. */
  saveAsTable(ref: string | TableRef, selectSql: string, options: WriteOptions = {}): WriteResult {
    const r = this.ref(ref);
    const mode = options.mode ?? "errorifexists";
    const exists = this.tableExists(r);
    const params: Record<string, unknown> = { mode: DELTA_MODE[mode] ?? mode, ...options.operationParameters };
    if (options.partitionBy?.length) params.partitionBy = options.partitionBy;
    if (exists && options.partitionBy?.length && !(mode === "overwrite" && options.overwriteSchema)) {
      const current = this.partitionColumns(r);
      const given = options.partitionBy;
      if (current.length !== given.length || current.some((c, i) => c.toLowerCase() !== given[i]!.toLowerCase())) {
        const list = (cs: string[]) => `[${cs.map((c) => `\`${c}\``).join(", ")}]`;
        throw new LakehouseError(
          "PARTITION_MISMATCH",
          `Partition columns do not match the partition columns of the table.\nGiven: ${list(given)}\nTable: ${list(current)}\nPartitioning is set when a table is created. To change it, overwrite with .option("overwriteSchema", "true").`,
        );
      }
    }
    this.createSchema(r.lakehouse, r.schema);
    const source = `(${selectSql})`;

    if (exists && (mode === "error" || mode === "errorifexists")) {
      throw new LakehouseError("TABLE_ALREADY_EXISTS", `[TABLE_OR_VIEW_ALREADY_EXISTS] Cannot create table ${refKey(r)} because it already exists. Use mode("overwrite") or mode("append").`);
    }
    if (exists && mode === "ignore") {
      return { ref: refKey(r), version: this.currentVersion(r), operation: "NOOP", numOutputRows: 0 };
    }

    return this.transaction(() => {
      let operation: string;
      const before = exists ? this.rowCount(r) : 0;
      if (!exists) {
        this.db.exec(`CREATE TABLE ${sqlName(r)} AS SELECT * FROM ${source}`);
        this.db.exec(
          `INSERT OR REPLACE INTO ${this.meta(r.lakehouse)}."table_props" VALUES (${quoteLiteral(refKey(r))}, ${quoteLiteral(JSON.stringify(options.partitionBy ?? []))})`,
        );
        operation = "CREATE TABLE AS SELECT";
      } else if (mode === "append") {
        this.reconcileSchema(r, this.schemaOfSql(`SELECT * FROM ${source}`), options.mergeSchema === true);
        this.db.exec(`INSERT INTO ${sqlName(r)} BY NAME SELECT * FROM ${source}`);
        operation = "WRITE";
      } else if (options.overwriteSchema) {
        this.db.exec(`CREATE OR REPLACE TABLE ${sqlName(r)} AS SELECT * FROM ${source}`);
        if (options.partitionBy?.length) {
          this.db.exec(
            `INSERT OR REPLACE INTO ${this.meta(r.lakehouse)}."table_props" VALUES (${quoteLiteral(refKey(r))}, ${quoteLiteral(JSON.stringify(options.partitionBy))})`,
          );
        }
        operation = "CREATE OR REPLACE TABLE AS SELECT";
      } else {
        this.reconcileSchema(r, this.schemaOfSql(`SELECT * FROM ${source}`), options.mergeSchema === true);
        this.db.exec(`CREATE TEMP TABLE "_parity_stage" AS SELECT * FROM ${source}`);
        this.db.exec(`DELETE FROM ${sqlName(r)}`);
        this.db.exec(`INSERT INTO ${sqlName(r)} BY NAME SELECT * FROM "_parity_stage"`);
        this.db.exec(`DROP TABLE "_parity_stage"`);
        operation = "CREATE OR REPLACE TABLE AS SELECT";
      }
      const after = this.rowCount(r);
      const rows = options.numOutputRows ?? (exists && mode === "append" ? after - before : after);
      operation = options.operation ?? operation;
      const version = this.recordVersion(r, operation, params, rows, options.commitTime);
      return { ref: refKey(r), version, operation, numOutputRows: rows };
    });
  }

  /**
   * `DeltaTable.forName(ref).alias("target").merge(source.alias("source"), condition)`.
   * The condition refers to `target.` and `source.` exactly as a notebook would write it.
   */
  merge(ref: string | TableRef, sourceSql: string, condition: string, clauses: MergeClauses, options: { autoMerge?: boolean } = {}): MergeResult {
    const r = this.requireTable(ref);
    const matched: MatchedClause[] = [...(clauses.matched ?? [])];
    if (clauses.whenMatchedDelete) matched.push({ action: "delete" });
    if (clauses.whenMatchedUpdateAll) matched.push({ action: "updateAll" });
    const notMatched: NotMatchedClause[] = [...(clauses.notMatched ?? [])];
    if (clauses.whenNotMatchedInsertAll) notMatched.push({ action: "insertAll" });
    if (!matched.length && !notMatched.length) {
      throw new LakehouseError("DELTA_MERGE_MISSING_WHEN", "[DELTA_MERGE_MISSING_WHEN] There must be at least one WHEN clause in a MERGE statement.");
    }
    if (matched.slice(0, -1).some((c) => !c.condition)) {
      throw new LakehouseError(
        "DELTA_NON_LAST_MATCHED_CLAUSE_OMIT_CONDITION",
        "[DELTA_NON_LAST_MATCHED_CLAUSE_OMIT_CONDITION] When there are more than one MATCHED clauses in a MERGE statement, only the last MATCHED clause can omit the condition.",
      );
    }
    if (notMatched.slice(0, -1).some((c) => !c.condition)) {
      throw new LakehouseError(
        "DELTA_NON_LAST_NOT_MATCHED_CLAUSE_OMIT_CONDITION",
        "[DELTA_NON_LAST_NOT_MATCHED_CLAUSE_OMIT_CONDITION] When there are more than one NOT MATCHED clauses in a MERGE statement, only the last NOT MATCHED clause can omit the condition.",
      );
    }
    const target = sqlName(r);
    const src = `"_parity_merge_src"`;
    const m = `"_parity_merge_m"`;
    const ins = `"_parity_merge_ins"`;
    return this.transaction(() => {
      this.db.exec(`CREATE TEMP TABLE ${src} AS SELECT * FROM (${sourceSql})`);
      try {
        const onlyUnconditionalDelete = matched.length === 1 && matched[0]!.action === "delete" && !matched[0]!.condition;
        if (matched.length && !onlyUnconditionalDelete) {
          const multi = this.db.query(
            `SELECT count(*) FROM (SELECT target.rowid FROM ${target} AS target JOIN ${src} AS source ON ${condition} GROUP BY target.rowid HAVING count(*) > 1)`,
          );
          if (Number(multi.rows[0]?.[0] ?? 0) > 0) {
            throw new LakehouseError(
              "DELTA_MULTIPLE_SOURCE_ROW_MATCHING_TARGET_ROW_IN_MERGE",
              `[DELTA_MULTIPLE_SOURCE_ROW_MATCHING_TARGET_ROW_IN_MERGE] Cannot perform Merge as multiple source rows matched and attempted to modify the same target row in the Delta table ${refKey(r)} in possibly conflicting ways. Deduplicate the source on the merge keys first.`,
            );
          }
        }
        const sourceCols = this.schemaOfSql(`SELECT * FROM ${src}`);
        const usesAll = matched.some((c) => c.action === "updateAll") || notMatched.some((c) => c.action === "insertAll");
        if (usesAll) {
          // Without schema evolution, Delta ignores source columns the target doesn't have.
          const existing = new Set(this.describe(r).map((c) => c.name.toLowerCase()));
          this.reconcileSchema(r, options.autoMerge === true ? sourceCols : sourceCols.filter((c) => existing.has(c.name.toLowerCase())), options.autoMerge === true);
        }
        const targetCols = this.describe(r).map((c) => c.name);
        const sourceNames = new Set(sourceCols.map((c) => c.name.toLowerCase()));
        const missing = targetCols.filter((c) => !sourceNames.has(c.toLowerCase()));
        if (usesAll && missing.length && options.autoMerge !== true) {
          throw new LakehouseError(
            "DELTA_MERGE_UNRESOLVED_EXPRESSION",
            `[DELTA_MERGE_UNRESOLVED_EXPRESSION] Cannot resolve ${missing.map((c) => `target.${c}`).join(", ")} in UPDATE/INSERT clause given the source columns: ${sourceCols.map((c) => c.name).join(", ")}.`,
          );
        }
        const assignments = (kind: "UPDATE" | "INSERT", exprs: Record<string, string>): [string, string][] =>
          Object.entries(exprs).map(([key, expr]) => {
            const col = targetCols.find((c) => c.toLowerCase() === key.toLowerCase());
            if (!col) {
              throw new LakehouseError(
                "DELTA_MERGE_UNRESOLVED_EXPRESSION",
                `[DELTA_MERGE_UNRESOLVED_EXPRESSION] Cannot resolve \`${key}\` in ${kind} clause given columns ${targetCols.map((c) => `target.${c}`).join(", ")}.`,
              );
            }
            if (kind === "INSERT" && /\btarget\s*\./i.test(expr)) {
              throw new LakehouseError(
                "DELTA_MERGE_UNRESOLVED_EXPRESSION",
                `[DELTA_MERGE_UNRESOLVED_EXPRESSION] Cannot resolve ${expr} in INSERT clause given columns ${sourceCols.map((c) => `source.${c.name}`).join(", ")}. An insert can only use source columns.`,
              );
            }
            return [col, expr];
          });
        // With schema evolution, UPDATE SET * leaves target-only columns unchanged and INSERT * leaves them null, like Delta.
        const star = targetCols.filter((c) => sourceNames.has(c.toLowerCase())).map((col): [string, string] => [col, `source.${quoteIdent(col)}`]);
        const matchedSets = matched.map((c) => (c.action === "updateAll" ? star : c.action === "update" ? assignments("UPDATE", c.set) : []));
        const insertValues = notMatched.map((c) => (c.action === "insertAll" ? star : assignments("INSERT", c.values)));
        const choose = (conds: (string | undefined)[]) =>
          `CASE ${conds.map((cond, i) => `WHEN ${cond ? `(${cond})` : "TRUE"} THEN ${i}`).join(" ")} ELSE NULL END`;

        let updated = 0;
        let deleted = 0;
        let inserted = 0;
        if (notMatched.length) {
          this.db.exec(
            `CREATE TEMP TABLE ${ins} AS SELECT source.rowid AS srid, ${choose(notMatched.map((c) => c.condition))} AS clause FROM ${src} AS source WHERE NOT EXISTS (SELECT 1 FROM ${target} AS target WHERE ${condition})`,
          );
        }
        if (matched.length) {
          this.db.exec(
            `CREATE TEMP TABLE ${m} AS SELECT target.rowid AS trid, source.rowid AS srid, ${choose(matched.map((c) => c.condition))} AS clause FROM ${target} AS target JOIN ${src} AS source ON ${condition}`,
          );
          matched.forEach((c, i) => {
            const n = Number(this.db.query(`SELECT count(DISTINCT trid) FROM ${m} WHERE clause = ${i}`).rows[0]?.[0] ?? 0);
            if (c.action === "delete") deleted += n;
            else updated += n;
            const sets = matchedSets[i]!;
            if (!n || c.action === "delete" || !sets.length) return;
            this.db.exec(
              `UPDATE ${target} AS target SET ${sets.map(([col, expr]) => `${quoteIdent(col)} = ${expr}`).join(", ")} FROM ${m} AS _m, ${src} AS source WHERE target.rowid = _m.trid AND source.rowid = _m.srid AND _m.clause = ${i}`,
            );
          });
          const deletes = matched.flatMap((c, i) => (c.action === "delete" ? [i] : []));
          if (deleted) this.db.exec(`DELETE FROM ${target} WHERE rowid IN (SELECT trid FROM ${m} WHERE clause IN (${deletes.join(", ")}))`);
        }
        notMatched.forEach((_, i) => {
          const values = insertValues[i]!;
          const n = Number(this.db.query(`SELECT count(*) FROM ${ins} WHERE clause = ${i}`).rows[0]?.[0] ?? 0);
          if (!n) return;
          inserted += n;
          this.db.exec(
            `INSERT INTO ${target} (${values.map(([col]) => quoteIdent(col)).join(", ")}) SELECT ${values.map(([, expr]) => expr).join(", ")} FROM ${src} AS source JOIN ${ins} AS _i ON source.rowid = _i.srid WHERE _i.clause = ${i}`,
          );
        });
        const describeClause = (c: MatchedClause | NotMatchedClause) => {
          const actionType = c.action.startsWith("update") ? "update" : c.action.startsWith("insert") ? "insert" : "delete";
          return c.condition ? { predicate: c.condition, actionType } : { actionType };
        };
        const rows = this.rowCount(r);
        const params = { predicate: condition, matchedPredicates: matched.map(describeClause), notMatchedPredicates: notMatched.map(describeClause) };
        const version = this.recordVersion(r, "MERGE", params, rows);
        return { ref: refKey(r), version, operation: "MERGE", numOutputRows: rows, numUpdatedRows: updated, numInsertedRows: inserted, numDeletedRows: deleted };
      } finally {
        this.db.exec(`DROP TABLE IF EXISTS ${src}`);
        this.db.exec(`DROP TABLE IF EXISTS ${m}`);
        this.db.exec(`DROP TABLE IF EXISTS ${ins}`);
      }
    });
  }

  /** `df.write.format("csv"|"json"|"parquet").save(path)`: a Spark-style directory of part files in the Files area. */
  writeFiles(path: string, selectSql: string, options: FileWriteOptions): FileWriteResult {
    return writeQueryToFiles(this.db, this.files, path, selectSql, options, this.newId);
  }

  deleteWhere(ref: string | TableRef, predicate?: string): WriteResult {
    const r = this.requireTable(ref);
    return this.transaction(() => {
      const before = this.rowCount(r);
      this.db.exec(`DELETE FROM ${sqlName(r)}${predicate ? ` WHERE ${predicate}` : ""}`);
      const rows = this.rowCount(r);
      const version = this.recordVersion(r, "DELETE", { predicate: predicate ?? "true", numDeletedRows: before - rows }, rows);
      return { ref: refKey(r), version, operation: "DELETE", numOutputRows: rows };
    });
  }

  dropTable(ref: string | TableRef): void {
    const r = this.requireTable(ref);
    this.db.exec(`DROP TABLE ${sqlName(r)}`);
    const key = refKey(r);
    const meta = this.meta(r.lakehouse);
    for (const row of this.db.query(`SELECT snapshot FROM ${meta}."log" WHERE table_ref = ${quoteLiteral(key)} AND snapshot IS NOT NULL`).rows) {
      this.db.exec(`DROP TABLE IF EXISTS ${this.snapshotName(r, String(row[0]))}`);
    }
    this.db.exec(`DELETE FROM ${meta}."log" WHERE table_ref = ${quoteLiteral(key)}`);
    this.db.exec(`DELETE FROM ${meta}."table_props" WHERE table_ref = ${quoteLiteral(key)}`);
    this.endpointVisible.get(r.lakehouse)?.delete(key);
  }

  history(ref: string | TableRef): HistoryEntry[] {
    const r = this.requireTable(ref);
    return this.db
      .query(
        `SELECT version, strftime(ts, '%Y-%m-%d %H:%M:%S'), operation, parameters, num_output_rows FROM ${this.meta(r.lakehouse)}."log" WHERE table_ref = ${quoteLiteral(refKey(r))} ORDER BY version DESC`,
      )
      .rows.map((row) => ({
        version: Number(row[0]),
        timestamp: String(row[1]),
        operation: String(row[2]),
        operationParameters: JSON.parse(String(row[3])) as Record<string, unknown>,
        numOutputRows: Number(row[4]),
      }));
  }

  partitionColumns(ref: string | TableRef): string[] {
    const r = this.requireTable(ref);
    const res = this.db.query(`SELECT partition_by FROM ${this.meta(r.lakehouse)}."table_props" WHERE table_ref = ${quoteLiteral(refKey(r))}`);
    return res.rows[0] ? (JSON.parse(String(res.rows[0][0])) as string[]) : [];
  }

  /** A relation name for `VERSION AS OF n`, usable inside any SELECT. */
  versionRelation(ref: string | TableRef, version: number): string {
    const r = this.requireTable(ref);
    const res = this.db.query(
      `SELECT snapshot FROM ${this.meta(r.lakehouse)}."log" WHERE table_ref = ${quoteLiteral(refKey(r))} AND version = ${Math.trunc(version)}`,
    );
    const snap = res.rows[0]?.[0];
    if (res.rows.length === 0) {
      throw new LakehouseError("VERSION_NOT_FOUND", `Cannot time travel ${refKey(r)} to version ${version}. Available versions: see DESCRIBE HISTORY.`);
    }
    if (snap === null || snap === undefined) {
      throw new LakehouseError("VERSION_VACUUMED", `Version ${version} of ${refKey(r)} has been vacuumed and can no longer be read.`);
    }
    return this.snapshotName(r, String(snap));
  }

  restore(ref: string | TableRef, version: number): WriteResult {
    const r = this.requireTable(ref);
    const relation = this.versionRelation(r, version);
    return this.transaction(() => {
      this.db.exec(`CREATE OR REPLACE TABLE ${sqlName(r)} AS SELECT * FROM ${relation}`);
      const rows = this.rowCount(r);
      const v = this.recordVersion(r, "RESTORE", { version }, rows);
      return { ref: refKey(r), version: v, operation: "RESTORE", numOutputRows: rows };
    });
  }

  /** The SQL analytics endpoint only sees tables that existed at its last metadata sync. */
  refreshSqlEndpoint(lakehouse: string): string[] {
    this.assertLakehouse(lakehouse);
    const tables = this.listTables(lakehouse);
    this.endpointVisible.set(lakehouse, new Set(tables));
    return tables;
  }

  endpointVisibleTables(lakehouse: string): string[] {
    this.assertLakehouse(lakehouse);
    const visible = this.endpointVisible.get(lakehouse) ?? new Set<string>();
    return this.listTables(lakehouse).filter((t) => visible.has(t));
  }

  /**
   * Detaches every lakehouse and drops its files, so a fresh Workspace can be created on the same
   * DuckDB instance (lakehouse names are per instance). Graders use this to reset between runs.
   */
  dispose(): void {
    this.db.exec("USE memory.main");
    for (const lh of this.lakehouses) {
      this.db.exec(`DETACH DATABASE IF EXISTS ${quoteIdent(lh)}`);
      this.files.rm(`${lh}/Files`, true);
    }
    this.lakehouses.clear();
    this.endpointVisible.clear();
  }
}
