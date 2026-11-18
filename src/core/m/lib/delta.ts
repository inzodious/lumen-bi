/**
 * Delta Lake tables (DeltaLake.Table, Lakehouse.Folder): replays `_delta_log` — the latest checkpoint
 * (`_last_checkpoint` → `NNN.checkpoint[.part.parts].parquet`) plus the JSON commits after it — into the set
 * of active data files, then reads those Parquet files.
 *
 * Supported: partitioned tables (partition values typed from the table schema), column mapping mode
 * `name` / `id` (physical Parquet names mapped back to logical names), checkpoints.
 * Refused with a clear error rather than returning wrong numbers: deletion vectors (rows deleted by a
 * DELETE/MERGE without rewriting files — run `REORG TABLE … APPLY (PURGE)` / OPTIMIZE first).
 * Time travel and change data feed are not exposed.
 */
import { daysFromCivil, parseDateTimeText } from "../calendar.ts";
import { bytesKey, NeedData } from "../driver.ts";
import { MError } from "../errors.ts";
import type { HostTable } from "../host.ts";
import { MDate, MDateTime, MTable, MType, T, type Cell, type MValue } from "../values.ts";
import { decodeText, hostTableToM } from "./sources.ts";
import type { LibContext } from "./util.ts";

/** One file of a Delta table's directory tree. `folder` is normalized to forward slashes with a trailing `/`. */
export interface DeltaFile {
  name: string;
  folder: string;
  read(): Uint8Array;
}

interface DeltaAdd {
  path: string;
  partitionValues?: Record<string, string | null> | { key: string; value: string | null }[] | null;
  deletionVector?: unknown;
}

interface SchemaField {
  name: string;
  type: unknown;
  metadata?: Record<string, unknown>;
}

interface Action {
  add?: DeltaAdd | null;
  remove?: { path: string } | null;
  metaData?: { schemaString?: string; partitionColumns?: string[]; configuration?: Record<string, string> | { key: string; value: string }[] | null } | null;
}

/**
 * Runs every thunk even when some need data that isn't fetched yet, so one driver pass records all the
 * misses (reading 40 Parquet files takes 2 passes instead of 80). Rethrows the first miss afterwards.
 */
export function gatherAll<T>(fns: (() => T)[]): T[] {
  const out: T[] = [];
  let miss: NeedData | undefined;
  for (const f of fns) {
    try {
      out.push(f());
    } catch (e) {
      if (e instanceof NeedData) {
        miss ??= e;
        continue;
      }
      throw e;
    }
  }
  if (miss) throw miss;
  return out;
}

function asRecord(v: unknown): Record<string, string | null> {
  if (!v) return {};
  if (Array.isArray(v)) return Object.fromEntries(v.map((x: { key: string; value: string | null }) => [x.key, x.value]));
  return v as Record<string, string | null>;
}

function typedPartitionValue(v: string | null, type: unknown): MValue {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "string":
      return v;
    case "boolean":
      return v === "true";
    case "byte":
    case "short":
    case "integer":
    case "long":
    case "float":
    case "double":
      return v === "" ? null : Number(v);
    case "date": {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return d ? new MDate(daysFromCivil(Number(d[1]), Number(d[2]), Number(d[3]))) : v;
    }
    case "timestamp":
    case "timestamp_ntz": {
      const p = parseDateTimeText(v);
      return p ? new MDateTime(p.ms - (p.offsetMinutes ?? 0) * 60_000) : v;
    }
  }
  if (typeof type === "string" && type.startsWith("decimal")) return v === "" ? null : Number(v);
  // untyped (schema unavailable): numbers and ISO dates, as before
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return new MDate(daysFromCivil(Number(d[1]), Number(d[2]), Number(d[3])));
  return v;
}

function mTypeOfDelta(type: unknown): MType {
  switch (type) {
    case "string":
      return T.text.asNullable();
    case "boolean":
      return T.logical.asNullable();
    case "byte":
    case "short":
    case "integer":
    case "long":
      return T.int64;
    case "float":
    case "double":
      return T.number.asNullable();
    case "date":
      return T.date.asNullable();
    case "timestamp":
    case "timestamp_ntz":
      return T.datetime.asNullable();
    case "binary":
      return T.binary.asNullable();
  }
  if (typeof type === "string" && type.startsWith("decimal")) return T.number.asNullable();
  return T.any;
}

function readJsonLines(bytes: Uint8Array, where: string): Action[] {
  const out: Action[] = [];
  for (const line of decodeText(bytes, null).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Action);
    } catch {
      throw new MError("DataFormat.Error", `DeltaLake.Table: the commit '${where}' isn't valid JSON.`, where);
    }
  }
  return out;
}

/** Reads a Delta table from the files of its directory (all of them, recursively; paths relative to anything). */
export function deltaTableFromFiles(ctx: LibContext, files: DeltaFile[]): MTable {
  const logDir = files.find((f) => /(^|\/)_delta_log\/$/.test(f.folder))?.folder;
  if (!logDir) throw new MError("DataFormat.Error", "DeltaLake.Table: the folder isn't a Delta table (it has no _delta_log folder).");
  const root = logDir.slice(0, -"_delta_log/".length);
  const logFiles = files.filter((f) => f.folder === logDir);
  const commits = logFiles
    .filter((f) => /^\d{20}\.json$/.test(f.name))
    .map((f) => ({ version: Number(f.name.slice(0, 20)), file: f }))
    .sort((a, b) => a.version - b.version);

  // the latest checkpoint (from _last_checkpoint, else the highest one present)
  let checkpointVersion = -1;
  let checkpointParts: DeltaFile[] = [];
  const checkpoints = new Map<number, DeltaFile[]>();
  for (const f of logFiles) {
    const m = /^(\d{20})\.checkpoint(?:\.(\d{10})\.(\d{10}))?\.parquet$/.exec(f.name);
    if (m) checkpoints.set(Number(m[1]), [...(checkpoints.get(Number(m[1])) ?? []), f]);
  }
  const last = logFiles.find((f) => f.name === "_last_checkpoint");
  if (last) {
    try {
      const v = (JSON.parse(decodeText(last.read(), null)) as { version?: number }).version;
      if (typeof v === "number" && checkpoints.has(v)) checkpointVersion = v;
    } catch (e) {
      if (e instanceof NeedData) throw e;
      /* a torn _last_checkpoint: fall back to the files present */
    }
  }
  if (checkpointVersion < 0 && checkpoints.size) checkpointVersion = Math.max(...checkpoints.keys());
  if (checkpointVersion >= 0) checkpointParts = (checkpoints.get(checkpointVersion) ?? []).sort((a, b) => (a.name < b.name ? -1 : 1));

  const replay = commits.filter((c) => c.version > checkpointVersion);
  if (checkpointVersion < 0 && (!commits.length || commits[0]!.version !== 0)) {
    throw new MError("DataFormat.Error", "DeltaLake.Table: the log has neither a checkpoint nor its first commit (00000000000000000000.json); the table history is incomplete.");
  }
  for (let i = 1; i < replay.length; i++) {
    if (replay[i]!.version !== replay[i - 1]!.version + 1) throw new MError("DataFormat.Error", `DeltaLake.Table: commit ${replay[i - 1]!.version + 1} is missing from _delta_log.`);
  }

  const actions: Action[] = [];
  // checkpoint parts are Parquet files of actions (one non-null action column per row)
  const checkpointTables = gatherAll(
    checkpointParts.map((f) => () => {
      const bytes = f.read();
      return ctx.host.request({ kind: "decode", format: "parquet", key: bytesKey(bytes), bytes, path: `${f.folder}${f.name}` }) as HostTable;
    }),
  );
  for (const t of checkpointTables) {
    const idx = (n: string) => t.columns.findIndex((c) => c.name === n);
    const [ai, ri, mi] = [idx("add"), idx("remove"), idx("metaData")];
    for (const r of t.rows) {
      const a: Action = {};
      if (ai >= 0 && r[ai]) a.add = r[ai] as DeltaAdd;
      if (ri >= 0 && r[ri]) a.remove = r[ri] as { path: string };
      if (mi >= 0 && r[mi]) a.metaData = r[mi] as Action["metaData"];
      actions.push(a);
    }
  }
  const commitBytes = gatherAll(replay.map((c) => () => c.file.read()));
  replay.forEach((c, i) => actions.push(...readJsonLines(commitBytes[i]!, c.file.name)));

  const active = new Map<string, DeltaAdd>();
  let schema: SchemaField[] | null = null;
  let partitionColumns: string[] = [];
  let configuration: Record<string, string | null> = {};
  for (const a of actions) {
    if (a.metaData) {
      partitionColumns = a.metaData.partitionColumns ?? [];
      configuration = asRecord(a.metaData.configuration);
      try {
        schema = (JSON.parse(a.metaData.schemaString ?? "{}") as { fields?: SchemaField[] }).fields ?? null;
      } catch {
        schema = null;
      }
    }
    if (a.add) active.set(decodeURIComponent(a.add.path), a.add);
    if (a.remove) active.delete(decodeURIComponent(a.remove.path));
  }

  const mappingMode = configuration["delta.columnMapping.mode"] ?? "none";
  const physical = new Map<string, string>();
  if (schema && (mappingMode === "name" || mappingMode === "id")) {
    for (const f of schema) {
      const p = f.metadata?.["delta.columnMapping.physicalName"];
      if (typeof p === "string") physical.set(p, f.name);
    }
  }
  const schemaType = new Map((schema ?? []).map((f) => [f.name, f.type]));

  const byPath = new Map(files.map((f) => [`${f.folder}${f.name}`, f]));
  const adds = [...active.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [rel, add] of adds) {
    if (add.deletionVector) {
      throw new MError(
        "DataFormat.Error",
        "DeltaLake.Table: this table uses deletion vectors, which Lumen can't apply yet (the rows would include deleted ones). Purge them first (REORG TABLE … APPLY (PURGE), or OPTIMIZE in Fabric).",
        rel,
      );
    }
  }
  const decoded = gatherAll(
    adds.map(([rel]) => () => {
      const f = byPath.get(`${root}${rel}`);
      if (!f) throw new MError("DataSource.NotFound", `DeltaLake.Table: the data file '${rel}' listed in the log is missing.`, rel);
      const bytes = f.read();
      return ctx.host.request({ kind: "decode", format: "parquet", key: bytesKey(bytes), bytes, path: rel }) as HostTable;
    }),
  );

  const parts: MTable[] = decoded.map((host, i) => {
    const add = adds[i]![1];
    let t = hostTableToM({ columns: host.columns.map((c) => ({ ...c, name: physical.get(c.name) ?? c.name })), rows: host.rows });
    const pv = asRecord(add.partitionValues);
    const extra = partitionColumns.filter((c) => !t.index.has(c));
    if (extra.length) {
      const pvByLogical = (c: string): string | null => {
        if (c in pv) return pv[c] ?? null;
        for (const [p, l] of physical) if (l === c && p in pv) return pv[p] ?? null;
        return null;
      };
      const values = extra.map((c) => typedPartitionValue(pvByLogical(c), schemaType.get(c)));
      t = new MTable([...t.columns, ...extra], [...t.types, ...extra.map((c) => mTypeOfDelta(schemaType.get(c)))], t.rows.map((r) => [...r, ...values]));
    }
    return t;
  });

  const cols = schema ? schema.map((f) => f.name) : [...new Set(parts.flatMap((p) => p.columns))];
  const types = cols.map((c) => {
    const p = parts.find((x) => x.index.has(c));
    return p ? p.types[p.index.get(c)!]! : mTypeOfDelta(schemaType.get(c));
  });
  const rows: Cell[][] = [];
  for (const p of parts) {
    const idx = cols.map((c) => p.index.get(c));
    for (const r of p.rows) rows.push(idx.map((i) => (i === undefined ? null : r[i]!)));
  }
  return new MTable(cols, types, rows);
}
