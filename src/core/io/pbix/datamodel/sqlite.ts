/**
 * sql.js (WASM SQLite) loading for `metadata.sqlitedb`.
 *
 * `src/core` must run in Node (vitest), the Electron renderer and workers, and each of those
 * locates the `.wasm` binary differently, so the factory is injectable:
 *
 *  - Node / vitest: the default factory does `import('sql.js')`, whose Node build finds
 *    `sql-wasm.wasm` next to itself. Nothing to configure.
 *  - Vite renderer / worker: call once at startup
 *      ```ts
 *      import initSqlJs from 'sql.js'
 *      import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
 *      setSqlJsFactory(() => initSqlJs({ locateFile: () => wasmUrl }))
 *      ```
 *    (or pass `{ sqlJs: () => … }` to `readDataModel`).
 */

import type { Database, SqlJsStatic, SqlValue } from 'sql.js'

export type SqlJsFactory = () => Promise<SqlJsStatic>

let factory: SqlJsFactory | undefined
let cached: Promise<SqlJsStatic> | undefined

/** Override how sql.js is initialised (e.g. to point it at a bundled wasm URL). */
export function setSqlJsFactory(f: SqlJsFactory | undefined): void {
  factory = f
  cached = undefined
}

async function defaultFactory(): Promise<SqlJsStatic> {
  type Init = (cfg?: object) => Promise<SqlJsStatic>
  const mod = (await import('sql.js')) as unknown as Init | { default?: Init }
  const init: Init | undefined = typeof mod === 'function' ? mod : mod.default
  if (typeof init !== 'function') throw new Error('sql.js: could not resolve initSqlJs')
  return init()
}

export function getSqlJs(override?: SqlJsFactory): Promise<SqlJsStatic> {
  if (override) return override()
  if (!cached) {
    cached = (factory ?? defaultFactory)()
    cached.catch(() => {
      cached = undefined
    })
  }
  return cached
}

export type Row = Record<string, SqlValue>

/** Thin read-only wrapper over a sql.js database with schema-tolerant helpers. */
export class MetadataDb {
  private columnCache = new Map<string, Set<string>>()
  constructor(readonly db: Database) {}

  static async open(bytes: Uint8Array, override?: SqlJsFactory): Promise<MetadataDb> {
    const SQL = await getSqlJs(override)
    return new MetadataDb(new SQL.Database(bytes))
  }

  close(): void {
    this.db.close()
  }

  columns(table: string): Set<string> {
    let s = this.columnCache.get(table)
    if (!s) {
      s = new Set()
      try {
        const r = this.db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
        if (r.length) for (const v of r[0].values) s.add(String(v[1]))
      } catch {
        // missing table
      }
      this.columnCache.set(table, s)
    }
    return s
  }

  hasTable(table: string): boolean {
    return this.columns(table).size > 0
  }

  /** `SELECT * FROM [table]` as objects; [] when the table does not exist in this schema version. */
  all(table: string): Row[] {
    if (!this.hasTable(table)) return []
    return this.query(`SELECT * FROM [${table}]`)
  }

  query(sql: string): Row[] {
    const res = this.db.exec(sql)
    if (!res.length) return []
    const { columns, values } = res[0]
    return values.map((v) => {
      const o: Row = {}
      for (let i = 0; i < columns.length; i++) o[columns[i]] = v[i]
      return o
    })
  }
}
