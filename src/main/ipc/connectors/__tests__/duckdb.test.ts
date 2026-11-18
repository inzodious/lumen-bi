/**
 * DuckDB.Database end to end (M engine → fetcher → connector service → DuckDB-WASM), no servers: a database file
 * created here with DuckDB-WASM itself, and a lakehouse folder (generated Delta tables, when the datasets generator
 * runs) whose views must have exactly the rows Lakehouse.Folder reads.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { harness, type Harness } from './harness'

const require = createRequire(import.meta.url)

/** Creates a DuckDB database file with DuckDB-WASM (absolute paths go to the real file system). */
async function createDatabase(file: string, sql: string[]): Promise<void> {
  const entry = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = dirname(entry)
  const duckdb = require(entry)
  const bundles = {
    mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: join(dist, 'duckdb-node-eh.worker.cjs') }
  }
  const b = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME)
  await b.instantiate(() => {})
  const c = b.connect()
  c.query(`ATTACH '${file}' AS fixture`)
  c.query('USE fixture')
  for (const s of sql) c.query(s)
  c.query('CHECKPOINT fixture')
  c.query('USE memory')
  c.query('DETACH fixture')
  c.close()
  b.reset()
}

describe('DuckDB.Database on a database file', () => {
  let h: Harness
  let dir: string
  let file: string
  beforeAll(async () => {
    h = harness()
    dir = mkdtempSync(join(tmpdir(), 'lumen-duck-'))
    file = join(dir, 'shop.duckdb')
    await createDatabase(file, [
      'CREATE TABLE orders (id INTEGER, region VARCHAR, amount DECIMAL(10, 2), placed DATE, ordered_at TIMESTAMP, paid BOOLEAN, tags VARCHAR[])',
      "INSERT INTO orders VALUES (1, 'North', 10.50, DATE '2024-01-02', TIMESTAMP '2024-01-02 03:04:05', TRUE, ['a', 'b']), (2, 'South', 20.25, DATE '2024-02-03', NULL, FALSE, NULL), (3, 'North', NULL, NULL, NULL, NULL, []), (4, 'East', 5, DATE '2024-03-04', TIMESTAMP '2024-03-04 00:00:00', TRUE, ['c'])",
      'CREATE TABLE regions (code VARCHAR, manager VARCHAR)',
      "INSERT INTO regions VALUES ('North', 'Ann'), ('East', 'Bo'), ('West', 'Cy'), (NULL, 'Nobody')",
      "INSERT INTO orders VALUES (5, NULL, 1, NULL, NULL, NULL, NULL)",
      'CREATE SCHEMA sales',
      'CREATE VIEW sales.by_region AS SELECT region, SUM(amount) AS total FROM main.orders GROUP BY region'
    ])
  }, 60_000)
  afterAll(async () => {
    await h.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('navigation lists the tables and views of every schema', async () => {
    expect(await h.m(`Table.SelectColumns(DuckDB.Database("${file}"), {"Name", "Schema", "Kind"})`)).toEqual([
      { Name: 'orders', Schema: 'main', Kind: 'Table' },
      { Name: 'regions', Schema: 'main', Kind: 'Table' },
      { Name: 'by_region', Schema: 'sales', Kind: 'View' }
    ])
  })

  it('reads a table with typed values (decimal, date, timestamp, boolean, lists as JSON text)', async () => {
    const t = await h.table(`DuckDB.Database("${file}"){[Schema="main",Item="orders"]}[Data]`)
    expect(t.types.map((x) => x.kind)).toEqual(['number', 'text', 'number', 'date', 'datetime', 'logical', 'text'])
    const rows = (await h.m(`DuckDB.Database("${file}"){[Schema="main",Item="orders"]}[Data]`)) as Array<Record<string, unknown>>
    expect(rows.length).toBe(5)
    expect(rows[0]!.amount).toBe(10.5)
    expect(rows[0]!.tags).toBe('["a","b"]')
    expect(rows[1]!.ordered_at).toBeNull()
    expect(rows.map((r) => r.paid)).toEqual([true, false, null, true, null])
  })

  it('folds filters, sorting and top into the SQL', async () => {
    const v = await h.m(`let t = DuckDB.Database("${file}"){[Item="orders"]}[Data],
      f = Table.SelectRows(t, each [region] = "North"),
      s = Table.Sort(f, {{"id", Order.Descending}}),
      n = Table.FirstN(s, 1) in Table.SelectColumns(n, {"id"})`)
    expect(v).toEqual([{ id: 3 }])
    const sql = h.log.filter((r) => r.kind === 'db').map((r) => (r as { query: string }).query)
    expect(sql.some((q) => /WHERE .*"region" = 'North'/.test(q) && /ORDER BY "id" DESC NULLS LAST/.test(q) && /LIMIT 1/.test(q))).toBe(true)
  })

  it('folds Table.NestedJoin + ExpandTableColumn into one JOIN (every kind), with M results', async () => {
    const db = `DuckDB.Database("${file}")`
    const join = (kind: string) => `let o = Table.SelectColumns(${db}{[Item="orders"]}[Data], {"id", "region"}), r = ${db}{[Item="regions"]}[Data],
      j = Table.NestedJoin(o, {"region"}, r, {"code"}, "R", ${kind}), e = Table.ExpandTableColumn(j, "R", {"manager"}, {"Manager"})
      in Table.Sort(e, {{"id", Order.Ascending}, {"Manager", Order.Ascending}})`
    const local = async (src: string) => {
      // the same steps with the joined column read locally first (Table.Buffer stops folding)
      return h.m(src.replace('j = Table.NestedJoin(o,', 'j = Table.NestedJoin(Table.Buffer(o),'))
    }
    for (const kind of ['JoinKind.Inner', 'JoinKind.LeftOuter', 'JoinKind.RightOuter', 'JoinKind.FullOuter']) {
      const folded = await h.m(join(kind))
      const sql = h.log.filter((r) => r.kind === 'db').map((r) => (r as { query: string }).query)
      expect(sql.some((q) => /JOIN/.test(q) && /IS NOT DISTINCT FROM/.test(q)), kind).toBe(true)
      expect(folded, kind).toEqual(await local(join(kind)))
    }
    // null keys match each other like in M; a right outer join keeps the unmatched regions
    expect(await h.m(join('JoinKind.Inner'))).toEqual([
      { id: 1, region: 'North', Manager: 'Ann' },
      { id: 3, region: 'North', Manager: 'Ann' },
      { id: 4, region: 'East', Manager: 'Bo' },
      { id: 5, region: null, Manager: 'Nobody' }
    ])
    // later steps fold on top of the join
    const v = await h.m(`let o = ${db}{[Item="orders"]}[Data], r = ${db}{[Item="regions"]}[Data],
      j = Table.NestedJoin(o, {"region"}, r, {"code"}, "R", JoinKind.LeftOuter), e = Table.ExpandTableColumn(j, "R", {"manager"}),
      f = Table.SelectRows(e, each [manager] = "Ann") in Table.RowCount(f)`)
    expect(v).toBe(2)
    expect(h.log.filter((r) => r.kind === 'db').map((r) => (r as { query: string }).query).some((q) => /^SELECT .* FROM \(SELECT .*JOIN.*\) AS "_" WHERE "manager" = 'Ann'/.test(q))).toBe(true)
  })

  it('native queries over the file and views in other schemas; writes are refused', async () => {
    expect(await h.m(`DuckDB.Database("${file}", [Query="SELECT region, SUM(amount) AS total FROM orders WHERE region IS NOT NULL GROUP BY region ORDER BY region"])`)).toEqual([
      { region: 'East', total: 5 },
      { region: 'North', total: 10.5 },
      { region: 'South', total: 20.25 }
    ])
    expect(await h.m(`Table.RowCount(DuckDB.Database("${file}"){[Schema="sales",Item="by_region"]}[Data])`)).toBe(4)
    await expect(h.m(`DuckDB.Database("${file}", [Query="COPY orders TO 'out.csv'"])`)).rejects.toThrow(/read-only/)
    await expect(h.m(`DuckDB.Database("${file}", [Query="DELETE FROM orders"])`)).rejects.toThrow(/read-only/)
  })

  it('a missing file and a non-DuckDB file are clear errors', async () => {
    await expect(h.m(`DuckDB.Database("${join(dir, 'nope.duckdb')}")`)).rejects.toThrow(/couldn't find/)
    const bad = join(dir, 'text.duckdb')
    writeFileSync(bad, 'just some text, not a database')
    await expect(h.m(`DuckDB.Database("${bad}")`)).rejects.toThrow(/isn't a DuckDB database/)
  })
})

// a hand-made Delta table (JSON log only, two commits: add, then remove + add) next to a Files/ Parquet file
describe('DuckDB.Database on a lakehouse folder', () => {
  let h: Harness
  let dir: string
  beforeAll(async () => {
    h = harness()
    dir = mkdtempSync(join(tmpdir(), 'lumen-duck-lh-'))
    const table = join(dir, 'Tables', 'sales')
    mkdirSync(join(table, '_delta_log'), { recursive: true })
    mkdirSync(join(table, 'region=North'), { recursive: true })
    mkdirSync(join(table, 'region=South'), { recursive: true })
    mkdirSync(join(dir, 'Files', 'raw'), { recursive: true })
    // Parquet files written by DuckDB-WASM into the real file system
    await createDatabase(join(dir, 'scratch.duckdb'), [
      `COPY (SELECT * FROM (VALUES (1, 10.0), (2, 20.0)) v(id, amount)) TO '${join(table, 'region=North', 'part-0.parquet')}' (FORMAT parquet)`,
      `COPY (SELECT * FROM (VALUES (3, 30.0)) v(id, amount)) TO '${join(table, 'region=South', 'part-0.parquet')}' (FORMAT parquet)`,
      `COPY (SELECT * FROM (VALUES (4, 99.0)) v(id, amount)) TO '${join(table, 'region=South', 'part-1.parquet')}' (FORMAT parquet)`,
      `COPY (SELECT 'x' AS k, 7 AS n) TO '${join(dir, 'Files', 'raw', 'extra.parquet')}' (FORMAT parquet)`
    ])
    rmSync(join(dir, 'scratch.duckdb'), { force: true })
    const schema = JSON.stringify({ type: 'struct', fields: [{ name: 'id', type: 'integer' }, { name: 'amount', type: 'double' }, { name: 'region', type: 'string' }] })
    const commit0 = [
      { protocol: { minReaderVersion: 1, minWriterVersion: 2 } },
      { metaData: { id: 't', format: { provider: 'parquet' }, schemaString: schema, partitionColumns: ['region'], configuration: {} } },
      { add: { path: 'region=North/part-0.parquet', partitionValues: { region: 'North' }, size: 1, modificationTime: 0, dataChange: true } },
      { add: { path: 'region=South/part-1.parquet', partitionValues: { region: 'South' }, size: 1, modificationTime: 0, dataChange: true } }
    ]
    // commit 1 replaces South's file (the removed one has the 99 row)
    const commit1 = [
      { remove: { path: 'region=South/part-1.parquet', dataChange: true } },
      { add: { path: 'region=South/part-0.parquet', partitionValues: { region: 'South' }, size: 1, modificationTime: 0, dataChange: true } }
    ]
    writeFileSync(join(table, '_delta_log', '00000000000000000000.json'), commit0.map((a) => JSON.stringify(a)).join('\n'))
    writeFileSync(join(table, '_delta_log', '00000000000000000001.json'), commit1.map((a) => JSON.stringify(a)).join('\n'))
  }, 60_000)
  afterAll(async () => {
    await h.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a Delta table is a view of its current snapshot, with partition values', async () => {
    expect(await h.m(`Table.SelectColumns(DuckDB.Database("${dir}"), {"Name", "Kind"})`)).toEqual([{ Name: 'sales', Kind: 'View' }])
    expect(await h.m(`DuckDB.Database("${dir}", [Query="SELECT region, COUNT(*) AS n, SUM(amount) AS total FROM sales GROUP BY region ORDER BY region"])`)).toEqual([
      { region: 'North', n: 2, total: 30 },
      { region: 'South', n: 1, total: 30 }
    ])
  })

  it('Parquet files are readable by their path relative to the folder', async () => {
    expect(await h.m(`DuckDB.Database("${dir}", [Query="SELECT k, n FROM read_parquet('Files/raw/extra.parquet')"])`)).toEqual([{ k: 'x', n: 7 }])
  })

  it('deletion vectors are refused', async () => {
    const log = join(dir, 'Tables', 'sales', '_delta_log')
    writeFileSync(
      join(log, '00000000000000000002.json'),
      JSON.stringify({ add: { path: 'region=North/part-0.parquet', partitionValues: { region: 'North' }, size: 1, modificationTime: 0, dataChange: true, deletionVector: { storageType: 'u', pathOrInlineDv: 'x', offset: 1, sizeInBytes: 1, cardinality: 1 } } })
    )
    try {
      await expect(h.m(`DuckDB.Database("${dir}", [Query="SELECT COUNT(*) FROM sales"])`)).rejects.toThrow(/deletion vectors/)
    } finally {
      rmSync(join(log, '00000000000000000002.json'))
    }
  })
})

// the generated datasets lakehouse: every Delta view has the rows Lakehouse.Folder reads
let gen = ''
let generated = false
try {
  gen = mkdtempSync(join(tmpdir(), 'lumen-duck-gen-'))
  execFileSync('node', ['datasets/src/node/cli.ts', 'generate', 'starlite', '--scale', 'tiny', '--out', gen], { stdio: 'pipe', timeout: 120_000 })
  generated = true
} catch {
  generated = false
}

describe.skipIf(!generated)('DuckDB.Database on a generated lakehouse', () => {
  let h: Harness
  const root = () => join(gen, 'starlite', 'Starlite.Lakehouse')
  beforeAll(() => {
    h = harness()
  })
  afterAll(async () => {
    await h.dispose()
    rmSync(gen, { recursive: true, force: true })
  })
  it('every Delta table: DuckDB COUNT(*) = Lakehouse.Folder row count', async () => {
    const tables = readdirSync(join(root(), 'Tables')).sort()
    const nav = (await h.m(`Table.SelectColumns(DuckDB.Database("${root()}"), {"Name"})`)) as Array<{ Name: string }>
    expect(nav.map((r) => r.Name).sort()).toEqual(tables)
    for (const t of tables) {
      const viaDuck = (await h.m(`DuckDB.Database("${root()}", [Query="SELECT COUNT(*) AS n FROM ""${t}"""])`)) as Array<{ n: number }>
      const viaM = await h.m(`Table.RowCount(Lakehouse.Folder("${root()}"){[Id="${t}",ItemKind="Table"]}[Data])`)
      expect({ t, n: viaDuck[0]!.n }).toEqual({ t, n: viaM })
    }
  }, 180_000)
})
