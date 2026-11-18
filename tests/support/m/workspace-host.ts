import { LakehouseError, quoteIdent, type Workspace } from "@parity/lakehouse";
import { MError } from "../../../src/core/m/errors.ts";
import type { DataRequest, HostLakehouse, HostTable, MHost, MockWorkbook, SharePointFileEntry, SqlItem } from "../../../src/core/m/host.ts";

/** Test-only: the SQL endpoint view of the mock lakehouse (was part of the Parity MHost). */
interface SqlDatabaseSource {
  items(): SqlItem[];
  read(schema: string, item: string): HostTable;
  explainMissing?(schema: string, item: string): string | undefined;
}

export const DEFAULT_ENDPOINT = "parity-sql.starlane.fabric.mock";
export const DEFAULT_WORKSPACE = "Starlane Data Ops";
export const DEFAULT_SHAREPOINT = { siteUrl: "https://starlane.sharepoint.mock/sites/ops", root: "lh_bronze/Files/sharepoint/ops" };

export interface WorkspaceHostOptions {
  endpointServer?: string;
  workspaceName?: string;
  now?: () => Date;
  localOffsetMinutes?: number;
  /** Mock workbooks keyed by file path (`Files/...` or `<lakehouse>/Files/...`). */
  workbooks?: Record<string, MockWorkbook>;
  /** Maps a mock SharePoint site onto a lakehouse Files folder (the `Files/sharepoint/...` shortcut). */
  sharePoint?: { siteUrl: string; root: string }[];
  /** Sql.Database only sees tables the SQL endpoint has synced (default true, like Fabric). */
  endpointLag?: boolean;
}

/** A deterministic GUID-shaped id from a seed (FNV-1a based; stands in for uuidv5 in the mock universe). */
export function mockGuid(seed: string): string {
  let hex = "";
  for (let salt = 0; salt < 4; salt++) {
    let h = 0x811c9dc5 ^ salt;
    for (const ch of `parity:${seed}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const decoder = new TextDecoder();

function readTable(ws: Workspace, lakehouse: string, schema: string, table: string): HostTable {
  const cols = ws.describe(`${lakehouse}.${schema}.${table}`);
  const overrides = new Map<string, string>();
  const select = cols
    .map((c) => {
      const t = c.type.toUpperCase();
      if (t.startsWith("TIME") && !t.startsWith("TIMESTAMP")) overrides.set(c.name, "time");
      else if (t.startsWith("INTERVAL")) overrides.set(c.name, "varchar");
      else return quoteIdent(c.name);
      return `CAST(${quoteIdent(c.name)} AS VARCHAR) AS ${quoteIdent(c.name)}`;
    })
    .join(", ");
  const res = ws.query(`SELECT ${select || "*"} FROM ${quoteIdent(lakehouse)}.${quoteIdent(schema)}.${quoteIdent(table)}`);
  return {
    columns: res.columns.map((c) => ({ name: c.name, type: overrides.get(c.name) ?? c.type })),
    rows: res.rows,
  };
}

function wrapFileError<T>(path: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof LakehouseError) {
      if (e.code === "INVALID_PATH") {
        throw new MError(
          "DataSource.Error",
          `File or Folder: '${path}' isn't a lakehouse Files path. Parity reads files from the lakehouse Files area, e.g. Files/data/beacon/transmissions/2026-01-01/part-0.csv or lh_bronze/Files/....`,
          path,
        );
      }
      throw new MError("DataSource.NotFound", `File or Folder: Could not find file '${path}'.`, path);
    }
    throw e;
  }
}

export function workspaceHost(ws: Workspace, options: WorkspaceHostOptions = {}): MHost {
  const endpoint = options.endpointServer ?? DEFAULT_ENDPOINT;
  const workspaceName = options.workspaceName ?? DEFAULT_WORKSPACE;
  const lag = options.endpointLag ?? true;
  const sites = options.sharePoint ?? [DEFAULT_SHAREPOINT];
  const workbooks = new Map<string, MockWorkbook>();
  for (const [p, wb] of Object.entries(options.workbooks ?? {})) workbooks.set(ws.files.resolve(p), wb);

  const sqlDatabase = (server: string, database: string): SqlDatabaseSource => {
    if (server.trim().toLowerCase() !== endpoint.toLowerCase()) {
      throw new MError(
        "DataSource.Error",
        `Microsoft SQL: A network-related or instance-specific error occurred while establishing a connection to SQL Server. The server was not found or was not accessible. (Parity: this workspace's SQL analytics endpoint is ${endpoint}.)`,
        server,
      );
    }
    const db = database.trim().toLowerCase();
    if (!ws.listLakehouses().includes(db)) {
      throw new MError(
        "DataSource.Error",
        `Microsoft SQL: Cannot open database "${database}" requested by the login. The login failed. (Parity: the lakehouses on this endpoint are ${ws.listLakehouses().join(", ")}.)`,
        database,
      );
    }
    const visible = () => (lag ? ws.endpointVisibleTables(db) : ws.listTables(db));
    return {
      items: () =>
        visible().map((ref) => {
          const [, schema, item] = ref.split(".");
          return { schema: schema!, item: item!, kind: "Table" as const };
        }),
      read: (schema, item) => readTable(ws, db, schema, item),
      explainMissing: (schema, item) => {
        const ref = `${db}.${schema.toLowerCase()}.${item.toLowerCase()}`;
        if (ws.tableExists(ref) && !visible().includes(ref)) {
          return `(Parity: ${ref} exists in the lakehouse, but the SQL analytics endpoint hasn't synced it yet. Refresh the SQL endpoint, then refresh this query.)`;
        }
        const inSchema = visible()
          .filter((r) => r.split(".")[1] === schema)
          .map((r) => r.split(".")[2]);
        return inSchema.length ? `(Parity: items in schema '${schema}' are ${inSchema.join(", ")}.)` : `(Parity: no tables are visible in schema '${schema}' of ${db}.)`;
      },
    };
  };

  const lakehouse = (name: string): HostLakehouse => ({
    id: mockGuid(`lakehouse:${name}`),
    name,
    schemas: () => ws.listSchemas(name),
    tables: (schema) => ws.listTables(name, schema).map((r) => r.split(".")[2]!),
    readTable: (schema, table) => readTable(ws, name, schema, table),
    list: (dir) =>
      ws.files.ls(`${name}/${dir}`).map((f) => ({
        name: f.name.replace(/\/$/, ""),
        path: f.path.slice(name.length + 1),
        isFolder: f.isDir,
      })),
    readFile: (path) => ws.files.read(`${name}/${path}`),
  });

  const excelWorkbook = ({ bytes, path }: { bytes: Uint8Array; path?: string }): MockWorkbook => {
    if (path) {
      let resolved: string | null = null;
      try {
        resolved = ws.files.resolve(path);
      } catch {
        resolved = null;
      }
      const wb = resolved ? workbooks.get(resolved) : undefined;
      if (wb) return wb;
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      throw new MError(
        "Expression.Error",
        `Excel.Workbook can't read real .xlsx files in Parity yet (no xlsx parser is bundled). Register a mock workbook for ${path ?? "this file"} with workspaceHost(ws, { workbooks }), or store a Parity mock workbook JSON file.`,
      );
    }
    try {
      const parsed = JSON.parse(decoder.decode(bytes)) as { parityMockWorkbook?: unknown } & MockWorkbook;
      if (parsed && parsed.parityMockWorkbook) return parsed;
    } catch {
      /* fall through */
    }
    throw new MError("DataFormat.Error", `External table is not in the expected format. (Parity: ${path ?? "this file"} isn't a mock workbook.)`, path ?? null);
  };

  const sharePointFiles = (siteUrl: string): SharePointFileEntry[] => {
    const url = siteUrl.replace(/\/+$/, "");
    const site = sites.find((s) => s.siteUrl.replace(/\/+$/, "").toLowerCase() === url.toLowerCase());
    if (!site) {
      throw new MError(
        "DataSource.Error",
        `SharePoint: We couldn't find the site '${siteUrl}'. (Parity: the mock SharePoint sites are ${sites.map((s) => s.siteUrl).join(", ")}.)`,
        siteUrl,
      );
    }
    const root = ws.files.resolve(site.root);
    return ws.files.list(`${root}/`).map((p) => {
      const rel = p.slice(root.length + 1);
      const slash = rel.lastIndexOf("/");
      const dir = slash >= 0 ? `${rel.slice(0, slash)}/` : "";
      return {
        name: rel.slice(slash + 1),
        folderPath: `${site.siteUrl.replace(/\/+$/, "")}/Shared Documents/${dir}`,
        path: p,
        read: () => ws.files.read(p),
      };
    });
  };

  const answer = (req: DataRequest): unknown => {
    switch (req.kind) {
      case "sql-items":
        return sqlDatabase(req.server, req.database).items();
      case "sql": {
        const db = sqlDatabase(req.server, req.database);
        if (req.query) throw new MError("Expression.Error", "The mock SQL endpoint doesn't run native queries.");
        const schema = req.schema ?? "dbo";
        const item = req.item ?? "";
        if (!db.items().some((i) => i.schema === schema && i.item === item)) {
          throw new MError("Expression.Error", `The key didn't match any rows in the table.${db.explainMissing ? ` ${db.explainMissing(schema, item) ?? ""}` : ""}`.trimEnd());
        }
        const t = db.read(schema, item);
        if (req.top === 0) return { columns: t.columns, rows: [] };
        if (req.columns) {
          const idx = req.columns.map((c) => t.columns.findIndex((x) => x.name === c));
          return { columns: idx.map((i) => t.columns[i]!), rows: t.rows.slice(0, req.top ?? t.rows.length).map((r) => idx.map((i) => r[i])) };
        }
        return { columns: t.columns, rows: req.top !== undefined ? t.rows.slice(0, req.top) : t.rows };
      }
      case "file":
        return wrapFileError(req.path, () => ws.files.read(req.path));
      case "lakehouse-contents":
        return [{ id: mockGuid(`workspace:${workspaceName}`), name: workspaceName, lakehouses: ws.listLakehouses().map(lakehouse) }];
      case "decode":
        if (req.format === "xlsx") return excelWorkbook({ bytes: req.bytes, path: req.path });
        throw new MError("Expression.Error", "The mock host doesn't decode parquet.");
      case "sharepoint-files":
        return sharePointFiles(req.url);
      default:
        throw new MError("DataSource.Error", `The mock workspace host can't answer ${req.kind} requests.`);
    }
  };
  return {
    request: answer as MHost["request"],
    now: options.now ?? (() => new Date()),
    localOffsetMinutes: options.localOffsetMinutes ?? 0,
  };
}
