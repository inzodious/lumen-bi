import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'fflate'
import { parquetMetadata } from 'hyparquet'
import { parquetWriteBuffer } from 'hyparquet-writer'
import type { DirEntry, FileSystem } from '../../io/fs'
import { nodeFs } from '../../io/nodefs'
import type { ProjectDocument } from '../../project'
import type { ColumnDef, DataType, SemanticModel, TableDef } from '../../model/types'
import { emptyDataStore, getColumn } from '../../model/data'
import type { SqlRequest } from '../../../shared/host'
import { refreshProject, previewQuery, coerceValue, tableQuery } from '../refresh'
import { listQueries, dataSourcesOf } from '../queries'
import type { RefreshHost } from '../fetcher'
import { parseExpression } from '../../m/parser.ts'
import { evaluateQuery } from '../../m/engine.ts'
import { MTable, MDate } from '../../m/values.ts'

const enc = new TextEncoder()

/** In-memory FileSystem */
function memFs(files: Record<string, string | Uint8Array>): FileSystem {
  const bytes = (p: string) => {
    const f = files[p]
    if (f === undefined) throw new Error(`ENOENT: no such file '${p}'`)
    return typeof f === 'string' ? enc.encode(f) : f
  }
  return {
    readFile: async (p) => bytes(p),
    readText: async (p) => new TextDecoder().decode(bytes(p)),
    writeFile: async () => undefined,
    list: async (dir) => {
      const prefix = dir.replace(/\/?$/, '/')
      const out = new Map<string, DirEntry>()
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        const name = rest.split('/')[0]!
        const isDir = rest.includes('/')
        out.set(name, { name, path: prefix + name, isDirectory: isDir, size: isDir ? 0 : bytes(p).length, mtime: Date.UTC(2026, 0, 1) })
      }
      if (!out.size) throw new Error(`ENOENT: no such directory '${dir}'`)
      return [...out.values()]
    },
    exists: async (p) => p in files,
    stat: async () => null,
    mkdirp: async () => undefined,
    remove: async () => undefined
  }
}

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}

function tbl(name: string, columns: ColumnDef[], m: string): TableDef {
  return { name, columns, measures: [], hierarchies: [], partitions: [{ name, mode: 'import', sourceType: 'm', expression: m }] }
}

function project(model: Partial<SemanticModel>): ProjectDocument {
  return {
    id: 't',
    name: 't',
    source: { kind: 'new' },
    model: { name: 'm', tables: [], relationships: [], expressions: [], roles: [], ...model },
    data: emptyDataStore(),
    diagnostics: [],
    dirty: false
  }
}

const sqlLog: SqlRequest[] = []
function host(files: Record<string, string | Uint8Array>): RefreshHost {
  return {
    fs: memFs(files),
    now: () => new Date(Date.UTC(2026, 10, 17, 9)),
    localOffsetMinutes: 0,
    connectors: {
      sqlQuery: async (req) => {
        sqlLog.push(req)
        const cols = [
          { name: 'id', type: 'integer' },
          { name: 'stage', type: 'varchar' },
          { name: 'amount', type: 'decimal' }
        ]
        if (/TOP \(0\)/.test(req.query ?? '')) return { columns: cols, rows: [] }
        if (req.query === "SELECT [id], [amount] FROM [dbo].[deals] WHERE [stage] = N'Won'") {
          return { columns: [cols[0]!, cols[2]!], rows: [[1, 100], [3, 25.5]] }
        }
        if (/FROM \[dbo\]\.\[deals\]/.test(req.query ?? '')) {
          return { columns: cols, rows: [[1, 'Won', 100], [2, 'Lost', 50], [3, 'Won', 25.5]] }
        }
        throw new Error("Invalid object name 'nope'.")
      },
      sqlListItems: async () => [{ schema: 'dbo', item: 'deals', kind: 'Table' }],
      http: async (req) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: enc.encode(JSON.stringify({ url: req.url, items: [1, 2] })) })
    }
  }
}

function enterData(rows: string[][], cols: string[]): string {
  const b64 = Buffer.from(deflateSync(enc.encode(JSON.stringify(rows)))).toString('base64')
  return `let
    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${b64}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${cols.map((c) => `#"${c}" = _t`).join(', ')}]),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"${cols[0]}", type text}})
in
    #"Changed Type"`
}

describe('refreshProject', () => {
  const csv = 'OrderId,Region,Amount,OrderDate\n1,East,10.5,2026-01-02\n2,West,20,2026-01-03\n3,East,,2026-02-01\n'
  const parquet = new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: 'k', data: [1n, 2n, 3n] as never, type: 'INT64' },
        { name: 'label', data: ['a', 'b', 'c'], type: 'STRING' },
        { name: 'ts', data: [new Date(Date.UTC(2026, 0, 1, 8)), null, new Date(Date.UTC(2026, 5, 30))], type: 'TIMESTAMP' }
      ]
    })
  )
  const files = { '/data/orders.csv': csv, '/data/dim.parquet': parquet, '/data/sub/x.json': '[{"a":1},{"a":2}]' }

  const model = (): Partial<SemanticModel> => ({
    expressions: [
      { name: 'DataFolder', kind: 'm', expression: '"/data" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]', queryGroup: 'Parameters' },
      { name: 'fnDouble', kind: 'm', expression: '(x as number) as number => x * 2' }
    ],
    tables: [
      tbl(
        'Orders',
        [col('Order Id', 'int64', { sourceColumn: 'OrderId' }), col('Region', 'string'), col('Amount', 'decimal'), col('OrderDate', 'dateTime'), col('Twice', 'double'), { name: 'Calc', dataType: 'double', kind: 'calculated', expression: '1' }],
        `let
    Source = Csv.Document(File.Contents(DataFolder & "/orders.csv"),[Delimiter=",", Columns=4, Encoding=65001, QuoteStyle=QuoteStyle.None]),
    #"Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),
    #"Changed Type" = Table.TransformColumnTypes(#"Promoted Headers",{{"OrderId", Int64.Type}, {"Region", type text}, {"Amount", type number}, {"OrderDate", type date}}),
    Added = Table.AddColumn(#"Changed Type", "Twice", each fnDouble([OrderId]), type number)
in
    Added`
      ),
      tbl('Dim', [col('k', 'int64'), col('label', 'string'), col('ts', 'dateTime')], `Parquet.Document(File.Contents(DataFolder & "/dim.parquet"))`),
      tbl('Status', [col('Status', 'string'), col('Rank', 'int64')], enterData([['Won', '1'], ['Lost', '2']], ['Status', 'Rank'])),
      tbl('Deals', [col('id', 'int64'), col('amount', 'decimal')], `let Source = Sql.Database("myserver.database.windows.net", "sales"), d = Source{[Schema="dbo",Item="deals"]}[Data], w = Table.SelectRows(d, each [stage] = "Won"), c = Table.SelectColumns(w, {"id", "amount"}) in c`),
      tbl('Broken', [col('x', 'string')], `Csv.Document(File.Contents("/missing.csv"))`),
      tbl('WrongCols', [col('nope', 'string')], `#table({"a"}, {{"1"}})`)
    ]
  })

  it('loads every table, maps sourceColumn names, coerces types and isolates failures', async () => {
    const p = project(model())
    const progress: string[] = []
    const r = await refreshProject(p, host(files), { onProgress: (t, s) => progress.push(`${t}:${s}`) })
    const byName = Object.fromEntries(r.tables.map((t) => [t.table, t]))
    expect(byName.Orders).toMatchObject({ ok: true, rows: 3 })
    expect(byName.Dim).toMatchObject({ ok: true, rows: 3 })
    expect(byName.Status).toMatchObject({ ok: true, rows: 2 })
    expect(byName.Deals?.error).toBeUndefined()
    expect(byName.Deals).toMatchObject({ ok: true })
    expect(byName.Broken).toMatchObject({ ok: false })
    expect(byName.Broken!.error).toMatch(/couldn't find the file '\/missing.csv'/)
    expect(byName.WrongCols!.error).toMatch(/The 'nope' column does not exist in the rowset/)

    const orders = p.data.tables.get('Orders')!
    expect(orders.columns.map((c) => c.name)).toEqual(['Order Id', 'Region', 'Amount', 'OrderDate', 'Twice'])
    expect(getColumn(orders, 'Order Id')!.values).toEqual([1, 2, 3])
    expect(getColumn(orders, 'Amount')!.values).toEqual([10.5, 20, null])
    expect(getColumn(orders, 'OrderDate')!.values).toEqual([new Date(Date.UTC(2026, 0, 2)), new Date(Date.UTC(2026, 0, 3)), new Date(Date.UTC(2026, 1, 1))])
    expect(getColumn(orders, 'Twice')!.values).toEqual([2, 4, 6])
    expect(p.data.status.get('Orders')).toMatchObject({ state: 'loaded', source: 'query', rowCount: 3 })
    expect(p.data.status.get('Broken')).toMatchObject({ state: 'error' })

    const dim = p.data.tables.get('Dim')!
    expect(getColumn(dim, 'k')!.values).toEqual([1, 2, 3])
    expect(getColumn(dim, 'ts')!.values).toEqual([new Date(Date.UTC(2026, 0, 1, 8)), null, new Date(Date.UTC(2026, 5, 30))])
    expect(getColumn(p.data.tables.get('Status')!, 'Rank')!.values).toEqual([1, 2])
    expect(getColumn(p.data.tables.get('Deals')!, 'amount')!.values).toEqual([100, 25.5])
    // folded: one schema probe + one filtered, projected read
    const reads = sqlLog.filter((q) => !/TOP \(0\)/.test(q.query ?? ''))
    expect(reads.map((q) => q.query)).toEqual(["SELECT [id], [amount] FROM [dbo].[deals] WHERE [stage] = N'Won'"])
    expect(reads[0]!.auth).toEqual({ kind: 'azure-default' })
    expect(progress).toContain('Orders:running')
    expect(progress).toContain('Broken:error')
  })

  it('keeps the previous data of a table whose refresh fails', async () => {
    const p = project(model())
    await refreshProject(p, host(files), { tables: ['Orders'] })
    const before = p.data.tables.get('Orders')
    const r = await refreshProject(p, host({}), { tables: ['Orders'] })
    expect(r.tables[0]!.ok).toBe(false)
    expect(p.data.tables.get('Orders')).toBe(before)
    expect(p.data.status.get('Orders')).toMatchObject({ state: 'loaded' })
  })

  it.each(['Lumen_Sample', 'WrapperBI_Sample'])('keeps generated rows of a %s-annotated table whose query only declares the schema', async (annotation) => {
    const t = { ...tbl('S', [col('a', 'string')], '#table(type table [a = text], {})'), annotations: { [annotation]: 'true' } }
    const p = project({ tables: [t] })
    const rows = { columns: [{ name: 'a', type: 'string' as const, values: ['x', 'y'] }], rowCount: 2 }
    p.data.tables.set('S', rows)
    const r = await refreshProject(p, host({}))
    expect(r.tables[0]).toMatchObject({ ok: true, rows: 2, skipped: 'sample data kept' })
    expect(p.data.tables.get('S')).toBe(rows)
  })

  it('honours abort signals', async () => {
    const p = project(model())
    const ctl = new AbortController()
    ctl.abort()
    await expect(refreshProject(p, host(files), { signal: ctl.signal })).rejects.toThrow()
  })

  it('cancels while a SQL request hangs (e.g. a pending sign-in) and asks the host to stop it', async () => {
    const t = tbl('Hang', [col('id', 'int64')], `let Source = Sql.Database("srv.example", "db"), d = Source{[Schema="dbo",Item="deals"]}[Data] in d`)
    const p = project({ tables: [t] })
    const started: string[] = []
    const cancelled: string[] = []
    const h = host({})
    h.connectors.sqlQuery = (req) => {
      started.push(req.cancelId ?? '(none)')
      return new Promise(() => undefined)
    }
    h.connectors.cancel = async (id) => void cancelled.push(id)
    const ctl = new AbortController()
    const run = refreshProject(p, h, { signal: ctl.signal })
    await vi.waitFor(() => expect(started).toHaveLength(1))
    ctl.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(started[0]).not.toBe('(none)')
    expect(cancelled).toEqual(started)
    expect(p.data.status.get('Hang')).toMatchObject({ state: 'empty', reason: 'Refresh cancelled' })
  })

  it('coerces values per data type like Power BI', () => {
    expect(coerceValue(new MDate(0), 'dateTime')).toEqual(new Date(0))
    expect(coerceValue('12', 'int64')).toBe(12)
    expect(coerceValue(1.23456, 'decimal')).toBe(1.2346)
    expect(coerceValue(12, 'string')).toBe('12')
    expect(coerceValue('true', 'boolean')).toBe(true)
  })

  it('previews queries and steps', async () => {
    const p = project(model())
    const src = p.model.tables[0]!.partitions[0]!.expression!
    const pv = await previewQuery(p, host(files), src, { name: 'Orders', step: 'Promoted Headers' })
    expect(pv.outline?.steps.map((s) => s.name)).toEqual(['Source', 'Promoted Headers', 'Changed Type', 'Added'])
    expect(pv.step).toBe('Promoted Headers')
    expect(pv.result.ok).toBe(true)
    if (pv.result.ok && pv.result.preview.kind === 'table') {
      expect(pv.result.preview.columns.map((c) => c.name)).toEqual(['OrderId', 'Region', 'Amount', 'OrderDate'])
      expect(pv.result.preview.rows[0]).toEqual(['1', 'East', '10.5', '2026-01-02'])
    }
    const bad = await previewQuery(p, host(files), 'let a = 1 + "x" in a')
    expect(bad.result.ok).toBe(false)
  })

  it('lists queries and data sources', () => {
    const p = project(model())
    const qs = listQueries(p.model)
    expect(qs.find((q) => q.name === 'DataFolder')).toMatchObject({ kind: 'parameter', group: 'Parameters' })
    expect(qs.find((q) => q.name === 'fnDouble')?.kind).toBe('function')
    expect(qs.find((q) => q.name === 'Orders')?.kind).toBe('table')
    const ds = dataSourcesOf(p.model).map((d) => d.kind + ':' + ('server' in d ? d.server : 'path' in d ? d.path : ''))
    expect(ds).toContain('sql:myserver.database.windows.net')
    expect(ds).toContain('file:/missing.csv')
  })

  it('builds entity (Direct Lake) partitions on their expression source', () => {
    const m: SemanticModel = { name: 'm', tables: [{ name: 'T', columns: [], measures: [], hierarchies: [], partitions: [{ name: 'T', mode: 'directLake', sourceType: 'entity', entityName: 'fact x', schemaName: 'gold', expressionSource: 'DatabaseQuery' }] }], relationships: [], expressions: [{ name: 'DatabaseQuery', kind: 'm', expression: 'Sql.Database("a", "b")' }], roles: [] }
    const q = tableQuery(m, m.tables[0]!)
    expect(q && 'source' in q && q.source).toContain('Source{[Schema="gold",Item="fact x"]}[Data]')
  })
})

// ---------------------------------------------------------------------------------------------
// Fictional datasets (datasets/): Parquet partitions + LakehousePath parameter, end to end

const DATASETS_CLI = resolve(import.meta.dirname, '../../../../datasets/src/node/cli.ts')

describe.skipIf(!existsSync(DATASETS_CLI))('refresh a generated lakehouse dataset end to end', () => {
  it('loads every table with the row counts of the gold Parquet files', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lumen-ds-'))
    try {
      execFileSync(process.execPath, [DATASETS_CLI, 'generate', 'starlite', '--scale', 'tiny', '--out', out], { stdio: 'pipe' })
      const root = join(out, 'starlite')
      const pbip = readdirSync(root).find((f) => f.endsWith('.pbip'))!
      const { openProject } = await import('../../io/open')
      const p = await openProject(join(root, pbip), nodeFs, { loadData: false })
      p.data = emptyDataStore()
      const lake = readdirSync(root).find((f) => f.endsWith('.Lakehouse'))!
      const param = p.model.expressions.find((e) => e.name === 'LakehousePath')!
      param.expression = param.expression.replace(/^"[^"]*"/, JSON.stringify(join(root, lake)))
      const r = await refreshProject(p, { fs: nodeFs, connectors: host({}).connectors, now: () => new Date() })
      const failed = r.tables.filter((t) => !t.ok)
      expect(failed).toEqual([])
      expect(r.tables.length).toBeGreaterThan(8)
      // every table's rows = the Parquet row count its partition reads
      for (const t of p.model.tables) {
        const q = tableQuery(p.model, t)
        if (!q || !('source' in q)) continue
        const paths = [...q.source.matchAll(/"(\/Tables\/[^"]+\.parquet)"/g)].map((m) => join(root, lake, m[1]!))
        if (!paths.length) continue
        const expected = paths.reduce((n, f) => n + Number(parquetMetadata(new Uint8Array(readFileSync(f)).buffer as ArrayBuffer).num_rows), 0)
        expect([t.name, p.data.tables.get(t.name)?.rowCount]).toEqual([t.name, expected])
      }
      // the refreshed data drives the DAX engine: most measures produce a value
      const { createEngine } = await import('../../engine/engine')
      const engine = createEngine(p.model, p.data)
      engine.processCalculated()
      const measures = p.model.tables.flatMap((t) => t.measures)
      let nonBlank = 0
      for (const m of measures) {
        try {
          if (engine.evaluateScalar(`[${m.name.replace(/]/g, ']]')}]`).value !== null) nonBlank++
        } catch {
          /* counted as blank */
        }
      }
      expect(measures.length).toBeGreaterThan(10)
      expect(nonBlank / measures.length).toBeGreaterThan(0.6)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('reads a partitioned Delta table folder with DeltaLake.Table', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lumen-ds-'))
    try {
      execFileSync(process.execPath, [DATASETS_CLI, 'generate', 'starlite', '--scale', 'tiny', '--out', out], { stdio: 'pipe' })
      const tables = join(out, 'starlite', readdirSync(join(out, 'starlite')).find((f) => f.endsWith('.Lakehouse'))!, 'Tables')
      const partitioned = readdirSync(tables).find((d) => readdirSync(join(tables, d)).some((x) => x.startsWith('year=')))!
      const dir = join(tables, partitioned)
      const logs = readdirSync(join(dir, '_delta_log')).filter((f) => f.endsWith('.json'))
      let expected = 0
      for (const f of logs) for (const line of readFileSync(join(dir, '_delta_log', f), 'utf8').split('\n')) if (line.includes('"add"')) expected += JSON.parse(line).add.stats ? JSON.parse(JSON.parse(line).add.stats).numRecords : 0
      const p = project({})
      const pv = await previewQuery(p, { fs: nodeFs, connectors: host({}).connectors, now: () => new Date() }, `let t = DeltaLake.Table(${JSON.stringify(dir)}) in Table.RowCount(t)`)
      expect(pv.result.ok && pv.result.preview.kind === 'number' ? pv.result.preview.value : pv.result).toBe(expected)
      const cols = await previewQuery(p, { fs: nodeFs, connectors: host({}).connectors, now: () => new Date() }, `Table.ColumnNames(DeltaLake.Table(${JSON.stringify(dir)}))`)
      expect(cols.result.ok && cols.result.preview.kind === 'list' && cols.result.preview.items).toContain('year')
      void statSync
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------------------------
// External corpus (read-only; never decodes cache.abf): every partition/expression parses and every
// "Enter data" table evaluates to its declared columns. Generic assertions only.

const CORPUS = process.env.LUMEN_CORPUS_DIR

function corpusSafeFs(base: FileSystem): FileSystem {
  const blocked = (p: string): boolean => /(^|\/)cache\.abf$/i.test(p)
  const ro = async (): Promise<never> => {
    throw new Error('read-only')
  }
  return {
    ...base,
    readFile: async (p) => (blocked(p) ? ro() : base.readFile(p)),
    readText: async (p) => (blocked(p) ? ro() : base.readText(p)),
    list: async (d) => (await base.list(d)).filter((e) => !blocked(e.path)),
    exists: async (p) => (blocked(p) ? false : base.exists(p)),
    stat: async (p) => (blocked(p) ? null : base.stat(p)),
    writeFile: ro,
    mkdirp: ro,
    remove: ro
  }
}

function findModels(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (!statSync(p).isDirectory()) continue
    if (e.endsWith('.SemanticModel')) out.push(p)
    else findModels(p, out)
  }
  return out
}

describe.skipIf(!CORPUS)('external corpus: Power Query compatibility', () => {
  const models = CORPUS ? findModels(CORPUS) : []

  it('parses every partition and shared expression, and evaluates every Enter data table', async () => {
    const { openProject } = await import('../../io/open')
    let parsed = 0
    let enterData = 0
    const failures: string[] = []
    for (const [i, dir] of models.entries()) {
      const p = await openProject(dir, corpusSafeFs(nodeFs), { loadData: false })
      p.data = emptyDataStore()
      const sources = [...p.model.tables.flatMap((t) => t.partitions.filter((x) => x.sourceType === 'm').map((x) => ({ t, src: x.expression ?? '' }))), ...p.model.expressions.filter((e) => e.kind === 'm').map((e) => ({ t: null, src: e.expression }))]
      for (const { t, src } of sources) {
        try {
          parseExpression(src)
          parsed++
        } catch (e) {
          failures.push(`model #${i}: parse error ${(e as Error).message}`)
          continue
        }
        if (t && /Binary\.Decompress\(Binary\.FromText\(/.test(src) && !/Sql\.Database|File\.Contents|Web\.Contents/.test(src)) {
          const ev = evaluateQuery(src, { previewSteps: false })
          if (!ev.result.ok || !(ev.result.value instanceof MTable)) {
            failures.push(`model #${i}: an Enter data table failed: ${ev.result.ok ? 'not a table' : ev.result.error.message}`)
            continue
          }
          const got = new Set(ev.result.value.columns)
          const missing = t.columns.filter((c) => c.kind === 'data' && !got.has(c.sourceColumn ?? c.name))
          if (missing.length) failures.push(`model #${i}: an Enter data table lacks ${missing.length} declared column(s)`)
          enterData++
        }
      }
    }
    expect(failures).toEqual([])
    expect(parsed).toBeGreaterThan(50)
    expect(enterData).toBeGreaterThan(5)
  })

  it('knows every function the corpus queries call', async () => {
    const { openProject } = await import('../../io/open')
    const { createSession } = await import('../../m/engine.ts')
    const lib = new Set(createSession().interp.globals.vars.keys())
    const unknown = new Set<string>()
    for (const dir of models) {
      const p = await openProject(dir, corpusSafeFs(nodeFs), { loadData: false })
      p.data = emptyDataStore()
      const names = new Set([...p.model.expressions.map((e) => e.name), ...p.model.tables.map((t) => t.name)])
      const srcs = [...p.model.tables.flatMap((t) => t.partitions.filter((x) => x.sourceType === 'm').map((x) => x.expression ?? '')), ...p.model.expressions.filter((e) => e.kind === 'm').map((e) => e.expression)]
      for (const src of srcs) {
        const visit = (n: unknown): void => {
          if (!n || typeof n !== 'object') return
          if (Array.isArray(n)) return n.forEach(visit)
          const node = n as { t?: string; name?: string }
          if (node.t === 'ident' && node.name && /^[A-Z][A-Za-z0-9]*\.[A-Z]/.test(node.name) && !names.has(node.name) && !lib.has(node.name)) unknown.add(node.name)
          for (const [k, v] of Object.entries(node)) if (k !== 'pos') visit(v)
        }
        visit(parseExpression(src))
      }
    }
    expect([...unknown]).toEqual([])
  })
})

describe('Excel.Workbook over real .xlsx files', () => {
  it('lists sheets and tables, keeps the used range and promotes headers like Power Query', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Data')
    ws.getCell('B3').value = 'Name'
    ws.getCell('C3').value = 'When'
    ws.getCell('D3').value = 'Qty'
    ws.getCell('B4').value = 'Ann'
    ws.getCell('C4').value = new Date(Date.UTC(2026, 2, 1))
    ws.getCell('D4').value = { formula: '1+1', result: 2 }
    wb.addWorksheet('Lookup').addTable({ name: 'Prices', ref: 'F1', headerRow: true, columns: [{ name: 'Item' }, { name: 'Price' }], rows: [['a', 1.5], ['b', 2]] })
    wb.addWorksheet('Hidden', { state: 'hidden' })
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const p = project({})
    const h = host({ '/wb.xlsx': bytes })
    const nav = await previewQuery(p, h, `Table.SelectColumns(Excel.Workbook(File.Contents("/wb.xlsx"), null, true), {"Name", "Kind", "Hidden"})`)
    expect(nav.result.ok && nav.result.preview.kind === 'table' && nav.result.preview.rows).toEqual([
      ['Data', 'Sheet', false],
      ['Lookup', 'Sheet', false],
      ['Hidden', 'Sheet', true],
      ['Prices', 'Table', false]
    ])
    const sheet = await previewQuery(p, h, `Table.PromoteHeaders(Excel.Workbook(File.Contents("/wb.xlsx")){[Item="Data",Kind="Sheet"]}[Data])`)
    expect(sheet.result.ok && sheet.result.preview.kind === 'table' && sheet.result.preview.columns.slice(0, 3).map((c) => c.name)).toEqual(['Name', 'When', 'Qty'])
    expect(sheet.result.ok && sheet.result.preview.kind === 'table' && sheet.result.preview.rows[0]!.slice(0, 3)).toEqual(['Ann', '2026-03-01', 2])
    const t = await previewQuery(p, h, `Excel.Workbook(File.Contents("/wb.xlsx")){[Item="Prices",Kind="Table"]}[Data]`)
    expect(t.result.ok && t.result.preview.kind === 'table' && t.result.preview.rows).toEqual([
      ['a', 1.5],
      ['b', 2]
    ])
  })
})
