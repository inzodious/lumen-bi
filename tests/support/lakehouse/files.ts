import { LakehouseError, type SyncDb } from "./types.ts";

export interface FileInfo {
  path: string;
  name: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
  /** Last write, in milliseconds since the epoch (0 for directories), like `FileInfo.modifyTime` in notebookutils. */
  modifyTime: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The Files area of every lakehouse. Paths are stored as `<lakehouse>/Files/...`
 * and registered into DuckDB under the same name, so `read_csv('<lakehouse>/Files/...')`
 * and globs work against landed files.
 */
export class LakehouseFiles {
  private readonly files = new Map<string, Uint8Array>();
  private readonly mtimes = new Map<string, number>();
  private readonly dirs = new Set<string>();
  private rev = 0;

  constructor(
    private readonly db: SyncDb,
    private readonly defaultLakehouse: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Accepts `Files/x`, `/lakehouse/default/Files/x`, `<lakehouse>/Files/x` and
   * `abfss://...@onelake.../<lakehouse>.Lakehouse/Files/x` forms.
   */
  resolve(path: string): string {
    let p = path.trim().replace(/\\/g, "/");
    const abfss = p.match(/^abfss:\/\/[^/]+\/([^/]+?)(?:\.Lakehouse)?\/(Files\/.*|Files)$/i);
    if (abfss) p = `${abfss[1]!.toLowerCase()}/${abfss[2]}`;
    else if (p.startsWith("/lakehouse/default/")) p = `${this.defaultLakehouse()}/${p.slice("/lakehouse/default/".length)}`;
    else if (p.startsWith("Files/") || p === "Files") p = `${this.defaultLakehouse()}/${p}`;
    p = p.replace(/\/+/g, "/").replace(/\/$/, "");
    if (!/^[a-z0-9_]+\/Files(\/|$)/.test(p)) {
      throw new LakehouseError("INVALID_PATH", `Path is not inside a lakehouse Files area: ${path}. Use a Files/... path (or /lakehouse/default/Files/...); Delta tables are written with saveAsTable.`);
    }
    return p;
  }

  private addParents(resolved: string): void {
    const parts = resolved.split("/");
    for (let i = 2; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }

  /** Bumped by every change, so a grader can tell whether a run touched the Files area. */
  get revision(): number {
    return this.rev;
  }

  /** `modifiedAt` backdates the write (a source drop that landed earlier); the default is the workspace clock. */
  put(path: string, content: string | Uint8Array, overwrite = true, modifiedAt?: Date): void {
    const p = this.resolve(path);
    this.rev++;
    if (!overwrite && this.files.has(p)) throw new LakehouseError("FILE_EXISTS", `File already exists: ${path}`);
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    if (this.files.has(p)) this.db.dropFile(p);
    this.files.set(p, bytes);
    this.mtimes.set(p, (modifiedAt ?? this.now()).getTime());
    this.addParents(p);
    this.db.registerFileBuffer(p, bytes);
  }

  mkdirs(path: string): void {
    const p = this.resolve(path);
    this.rev++;
    this.dirs.add(p);
    this.addParents(p);
  }

  exists(path: string): boolean {
    const p = this.resolve(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  read(path: string): Uint8Array {
    const p = this.resolve(path);
    const bytes = this.files.get(p);
    if (!bytes) throw new LakehouseError("FILE_NOT_FOUND", `File not found: ${path}`);
    return bytes;
  }

  /** Milliseconds since the epoch of the file's last write. */
  modifiedTime(path: string): number {
    const p = this.resolve(path);
    if (!this.files.has(p)) throw new LakehouseError("FILE_NOT_FOUND", `File not found: ${path}`);
    return this.mtimes.get(p) ?? 0;
  }

  head(path: string, maxBytes = 65536): string {
    return decoder.decode(this.read(path).slice(0, maxBytes));
  }

  ls(path: string): FileInfo[] {
    const p = this.resolve(path);
    if (!this.dirs.has(p) && !p.endsWith("/Files")) {
      if (this.files.has(p)) throw new LakehouseError("NOT_A_DIRECTORY", `Not a directory: ${path}`);
      throw new LakehouseError("FILE_NOT_FOUND", `Path not found: ${path}`);
    }
    const prefix = `${p}/`;
    const children = new Map<string, FileInfo>();
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) {
        const name = d.slice(prefix.length);
        children.set(name, { path: d, name: `${name}/`, isDir: true, isFile: false, size: 0, modifyTime: 0 });
      }
    }
    for (const [f, bytes] of this.files) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
        const name = f.slice(prefix.length);
        children.set(name, { path: f, name, isDir: false, isFile: true, size: bytes.length, modifyTime: this.mtimes.get(f) ?? 0 });
      }
    }
    return [...children.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  rm(path: string, recursive = false): boolean {
    const p = this.resolve(path);
    this.rev++;
    if (this.files.has(p)) {
      this.files.delete(p);
      this.mtimes.delete(p);
      this.db.dropFile(p);
      return true;
    }
    if (!this.dirs.has(p)) return false;
    const prefix = `${p}/`;
    const nested = [...this.files.keys()].filter((f) => f.startsWith(prefix));
    const nestedDirs = [...this.dirs].filter((d) => d.startsWith(prefix));
    if (!recursive && (nested.length || nestedDirs.length)) {
      throw new LakehouseError("DIRECTORY_NOT_EMPTY", `Directory is not empty: ${path}. Pass recurse=True.`);
    }
    for (const f of nested) {
      this.files.delete(f);
      this.mtimes.delete(f);
      this.db.dropFile(f);
    }
    for (const d of nestedDirs) this.dirs.delete(d);
    this.dirs.delete(p);
    return true;
  }

  list(prefix = ""): string[] {
    return [...this.files.keys()].filter((f) => f.startsWith(prefix)).sort();
  }
}
