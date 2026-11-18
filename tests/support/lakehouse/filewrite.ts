import type { LakehouseFiles } from "./files.ts";
import { quoteIdent, quoteLiteral } from "./refs.ts";
import { LakehouseError, type SyncDb, type WriteMode } from "./types.ts";

export type FileFormat = "csv" | "json" | "parquet";
export type FileCompression = "none" | "snappy" | "gzip" | "zstd";

export interface FileWriteOptions {
  format: FileFormat;
  /** Spark's default is errorifexists. */
  mode?: WriteMode;
  partitionBy?: string[];
  /** CSV only. */
  header?: boolean;
  delimiter?: string;
  quote?: string;
  /** CSV escape character; Spark's default is a backslash. */
  escape?: string;
  nullValue?: string;
  quoteAll?: boolean;
  /** strftime patterns (the caller converts Spark's Java patterns). */
  dateFormat?: string;
  timestampFormat?: string;
  /** Defaults: snappy for parquet, none otherwise. */
  compression?: FileCompression;
  /** JSON only: omit null fields, Spark's default. */
  ignoreNullFields?: boolean;
}

export interface FileWriteResult {
  /** The output directory (`<lakehouse>/Files/...`). */
  path: string;
  /** Data files written by this call, in write order. */
  files: string[];
  numOutputRows: number;
  /** True when mode("ignore") found the path already there. */
  skipped: boolean;
}

const STAGE = `"_parity_write_src"`;
const SPARK_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%gZ";
const SPARK_DATE_FORMAT = "%Y-%m-%d";
export const HIVE_DEFAULT_PARTITION = "__HIVE_DEFAULT_PARTITION__";

const COMPRESSIONS: Record<FileFormat, FileCompression[]> = {
  csv: ["none", "gzip"],
  json: ["none"],
  parquet: ["none", "snappy", "gzip", "zstd"],
};

function extension(format: FileFormat, compression: FileCompression): string {
  if (format === "parquet") return compression === "none" ? ".parquet" : `.${compression === "gzip" ? "gz" : compression}.parquet`;
  return compression === "gzip" ? `.${format}.gz` : `.${format}`;
}

/** Spark's ExternalCatalogUtils.escapePathName. */
function escapePartitionValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || `"#%'*/:=?\\{[]^`.includes(ch)) out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    else out += ch;
  }
  return out;
}

interface StageColumn {
  name: string;
  type: string;
}

/**
 * Writes a query to the Files area the way Spark's file sources lay out a job: a directory of
 * `part-00000-<job id>-c000.<ext>` files (one per partition directory) plus an empty `_SUCCESS` marker.
 */
export function writeQueryToFiles(
  db: SyncDb,
  files: LakehouseFiles,
  path: string,
  selectSql: string,
  options: FileWriteOptions,
  newId: () => string,
): FileWriteResult {
  const dir = files.resolve(path);
  const mode = options.mode ?? "errorifexists";
  const compression = options.compression ?? (options.format === "parquet" ? "snappy" : "none");
  if (!COMPRESSIONS[options.format].includes(compression)) {
    throw new LakehouseError(
      "NOT_SUPPORTED",
      `[NOT_SUPPORTED_IN_PARITY] Compression codec ${compression} for ${options.format} files is not supported in Parity yet. Supported: ${COMPRESSIONS[options.format].join(", ")}.`,
    );
  }
  const exists = files.exists(dir);
  if (exists && (mode === "error" || mode === "errorifexists")) {
    throw new LakehouseError(
      "PATH_ALREADY_EXISTS",
      `[PATH_ALREADY_EXISTS] Path ${dir} already exists. Set mode as "overwrite" to overwrite the existing path, or "append" to add files to it.`,
    );
  }
  if (exists && mode === "ignore") return { path: dir, files: [], numOutputRows: 0, skipped: true };

  db.exec(`CREATE OR REPLACE TEMP TABLE ${STAGE} AS SELECT * FROM (${selectSql})`);
  try {
    const columns: StageColumn[] = db.query(`DESCRIBE ${STAGE}`).rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));
    const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
    const partitions = (options.partitionBy ?? []).map((p) => {
      const c = byName.get(p.toLowerCase());
      if (!c) {
        throw new LakehouseError(
          "PARTITION_COLUMN_NOT_FOUND",
          `[PARTITION_COLUMN_NOT_FOUND] Partition column \`${p}\` not found in schema [${columns.map((x) => x.name).join(", ")}].`,
        );
      }
      return c;
    });
    if (partitions.length && partitions.length === columns.length) {
      throw new LakehouseError("ALL_PARTITION_COLUMNS_NOT_ALLOWED", "[ALL_PARTITION_COLUMNS_NOT_ALLOWED] Cannot use all columns for partition columns.");
    }
    const partNames = new Set(partitions.map((p) => p.name));
    const dataColumns = columns.filter((c) => !partNames.has(c.name));
    const numOutputRows = Number(db.query(`SELECT count(*) FROM ${STAGE}`).rows[0]?.[0] ?? 0);

    const groups: { subdir: string; where: string }[] = [];
    if (!partitions.length) {
      groups.push({ subdir: "", where: "" });
    } else {
      const keys = partitions.map((p) => `CAST(${quoteIdent(p.name)} AS VARCHAR)`);
      const combos = db.query(`SELECT DISTINCT ${keys.join(", ")} FROM ${STAGE} ORDER BY ${keys.map((_, i) => `${i + 1} NULLS LAST`).join(", ")}`).rows;
      for (const combo of combos) {
        const segments = partitions.map((p, i) => {
          const v = combo[i];
          return `${p.name}=${v === null || v === undefined ? HIVE_DEFAULT_PARTITION : escapePartitionValue(String(v))}`;
        });
        const conds = partitions.map((p, i) => {
          const v = combo[i];
          return `CAST(${quoteIdent(p.name)} AS VARCHAR) IS NOT DISTINCT FROM ${v === null || v === undefined ? "NULL" : quoteLiteral(String(v))}`;
        });
        groups.push({ subdir: `/${segments.join("/")}`, where: ` WHERE ${conds.join(" AND ")}` });
      }
    }

    const jobId = newId();
    const ext = extension(options.format, compression);
    const outputs: { file: string; bytes: Uint8Array }[] = groups.map((g, n) => {
      const file = `${dir}${g.subdir}/part-00000-${jobId}-c000${ext}`;
      const select = `SELECT ${dataColumns.map((c) => quoteIdent(c.name)).join(", ")} FROM ${STAGE}${g.where}`;
      if (options.format === "json") return { file, bytes: new TextEncoder().encode(jsonLines(db, select, dataColumns, options)) };
      return { file, bytes: copyTo(db, `_parity_tmp/${jobId}/${n}${ext}`, select, copyOptions(options, compression)) };
    });

    if (exists && mode === "overwrite") files.rm(dir, true);
    for (const o of outputs) files.put(o.file, o.bytes);
    files.put(`${dir}/_SUCCESS`, "");
    return { path: dir, files: outputs.map((o) => o.file), numOutputRows, skipped: false };
  } finally {
    db.exec(`DROP TABLE IF EXISTS ${STAGE}`);
  }
}

function copyOptions(o: FileWriteOptions, compression: FileCompression): string {
  if (o.format === "parquet") return `FORMAT parquet, COMPRESSION ${compression === "none" ? "uncompressed" : compression}`;
  const opts = [
    "FORMAT csv",
    `HEADER ${o.header ? "true" : "false"}`,
    `DELIMITER ${quoteLiteral(o.delimiter ?? ",")}`,
    `QUOTE ${quoteLiteral(o.quote ?? '"')}`,
    `ESCAPE ${quoteLiteral(o.escape ?? "\\")}`,
    `NULLSTR ${quoteLiteral(o.nullValue ?? "")}`,
    `DATEFORMAT ${quoteLiteral(o.dateFormat ?? SPARK_DATE_FORMAT)}`,
    `TIMESTAMPFORMAT ${quoteLiteral(o.timestampFormat ?? SPARK_TIMESTAMP_FORMAT)}`,
  ];
  if (o.quoteAll) opts.push("FORCE_QUOTE *");
  if (compression === "gzip") opts.push("COMPRESSION gzip");
  return opts.join(", ");
}

/** COPY into a registered empty buffer: DuckDB-WASM writes in memory, so no temp-file rename is possible. */
function copyTo(db: SyncDb, tmp: string, select: string, options: string): Uint8Array {
  db.registerFileBuffer(tmp, new Uint8Array());
  try {
    db.exec(`COPY (${select}) TO ${quoteLiteral(tmp)} (${options}, USE_TMP_FILE false)`);
    return db.copyFileToBuffer(tmp).slice();
  } finally {
    db.dropFile(tmp);
  }
}

/** One JSON object per line, like Spark: field order follows the columns and null fields are omitted by default. */
function jsonLines(db: SyncDb, select: string, columns: StageColumn[], o: FileWriteOptions): string {
  if (!columns.length) return "";
  const ignoreNulls = o.ignoreNullFields ?? true;
  const fields = columns.map((c) => {
    const ref = `_r.${quoteIdent(c.name)}`;
    const t = c.type.toUpperCase();
    let value = `CAST(to_json(${ref}) AS VARCHAR)`;
    if (t.startsWith("TIMESTAMP")) value = `CAST(to_json(strftime(${ref}, ${quoteLiteral(o.timestampFormat ?? SPARK_TIMESTAMP_FORMAT)})) AS VARCHAR)`;
    else if (t === "DATE") value = `CAST(to_json(strftime(${ref}, ${quoteLiteral(o.dateFormat ?? SPARK_DATE_FORMAT)})) AS VARCHAR)`;
    else if (t === "BLOB") value = `CAST(to_json(base64(${ref})) AS VARCHAR)`;
    const key = quoteLiteral(`${JSON.stringify(c.name)}:`);
    return ignoreNulls ? `CASE WHEN ${ref} IS NULL THEN NULL ELSE ${key} || ${value} END` : `${key} || coalesce(${value}, 'null')`;
  });
  const rows = db.query(`SELECT '{' || concat_ws(',', ${fields.join(", ")}) || '}' FROM (${select}) AS _r`).rows;
  return rows.map((r) => `${String(r[0])}\n`).join("");
}
