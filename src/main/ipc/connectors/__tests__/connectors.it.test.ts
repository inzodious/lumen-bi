/**
 * Live connector integration tests against real servers in Docker:
 *   postgres:16 · mysql:8 · MinIO (bitnamilegacy/minio) · Firestore emulator (mtlynch/firestore-emulator)
 * Every query runs end to end: M → fetch-and-replay driver → fetcher → connector service → server.
 *
 * Opt-in (they start containers): LUMEN_IT=1 npx vitest run src/main/ipc/connectors
 * Skipped with a message when LUMEN_IT is unset or Docker isn't reachable. Containers are removed after.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { dockerAvailable, imagePresent, startContainer, waitFor, type Container } from './docker'
import { harness, sqlSent, type Harness } from './harness'

const IT = !!process.env['LUMEN_IT']
const DOCKER = IT && dockerAvailable()
if (IT && !DOCKER) console.warn('LUMEN_IT is set but Docker is not reachable: skipping the live connector tests.')
if (!IT) console.info('Live connector tests skipped (set LUMEN_IT=1 to run them against Docker containers).')

const live = describe.skipIf(!DOCKER)
const withImage = (image: string) => describe.skipIf(!DOCKER || !imagePresent(image))

// ---------------------------------------------------------------------------------------------

live('PostgreSQL (postgres:16)', () => {
  let c: Container
  let h: Harness
  let server = ''
  beforeAll(async () => {
    c = startContainer({ name: 'pg', image: 'postgres:16', port: 5432, env: { POSTGRES_USER: 'lumen', POSTGRES_PASSWORD: 'lumen-pw', POSTGRES_DB: 'shop' } })
    server = `${c.host}:${c.port}`
    const client = await waitFor(async () => {
      const cl = new pg.Client({ host: c.host, port: c.port, user: 'lumen', password: 'lumen-pw', database: 'shop' })
      await cl.connect()
      await cl.query('SELECT 1')
      return cl
    }, 90_000)
    await client.query(`
      CREATE TABLE public.orders (
        id int PRIMARY KEY, region text, amount numeric(10,2), qty bigint, ratio double precision, placed date,
        at timestamp, at_tz timestamptz, t time, ok boolean, meta jsonb, tags text[], nums int[], uid uuid, blob bytea, price money);
      INSERT INTO public.orders VALUES
        (1, 'East', 10.50, 9007199254740991, 0.25, '2026-01-02', '2026-01-02 10:00:00.123', '2026-01-02 10:00:00+02', '08:30:00', true,
           '{"vip": true, "tier": 2}', '{a,"b c"}', '{1,2,3}', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', '\\x0102ff', 12.34),
        (2, 'West', 20.00, 2, 'NaN', '2026-01-03', '2026-01-03 11:30:00', '2026-01-03 00:00:00Z', '23:59:59.5', false, null, '{}', null, null, null, -5),
        (3, 'East', 5.00, 3, 1.5, null, null, null, null, null, '[1, 2]', null, '{}', null, '\\x', null),
        (4, 'O''Brien', 7.25, 4, -1, '2026-02-01', '2026-02-01 00:00:00', '2026-02-01 00:00:00-05', '00:00:00', true, '"x"', '{NULL}', '{4}', null, null, 0);
      CREATE SCHEMA sales;
      CREATE VIEW sales.east AS SELECT id, amount FROM public.orders WHERE region = 'East';
      CREATE MATERIALIZED VIEW sales.totals AS SELECT region, sum(amount) AS total FROM public.orders GROUP BY region;
      CREATE TABLE public.big AS SELECT g AS n, (g % 7) AS k, md5(g::text) AS s FROM generate_series(1, 20000) g;`)
    await client.end()
    h = harness()
    h.store.set({ key: `postgresql:${server};shop`, label: `${server};shop`, auth: { kind: 'basic', user: 'lumen', password: 'lumen-pw', sslMode: 'prefer' } })
  }, 120_000)
  afterAll(async () => {
    await h?.dispose()
    c?.remove()
  })

  it('lists tables, views and materialized views', async () => {
    const nav = (await h.m(`Table.SelectColumns(PostgreSQL.Database("${server}", "shop"), {"Schema", "Item", "Kind"})`)) as unknown[]
    expect(nav).toEqual([
      { Schema: 'public', Item: 'big', Kind: 'Table' },
      { Schema: 'public', Item: 'orders', Kind: 'Table' },
      { Schema: 'sales', Item: 'east', Kind: 'View' },
      { Schema: 'sales', Item: 'totals', Kind: 'View' }
    ])
  })

  it('maps PostgreSQL types', async () => {
    const t = await h.table(`PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data]`)
    expect(Object.fromEntries(t.columns.map((c, i) => [c, `${t.types[i]!.kind}${t.types[i]!.facet ? `:${t.types[i]!.facet}` : ''}`]))).toEqual({
      id: 'number:Int64',
      region: 'text',
      amount: 'number',
      qty: 'number:Int64',
      ratio: 'number',
      placed: 'date',
      at: 'datetime',
      at_tz: 'datetimezone',
      t: 'time',
      ok: 'logical',
      meta: 'text',
      tags: 'list',
      nums: 'list',
      uid: 'text',
      blob: 'binary',
      price: 'number:Currency'
    })
    const rows = (await h.m(`Table.Sort(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data], "id")`)) as Array<Record<string, unknown>>
    expect(rows[0]).toEqual({
      id: 1,
      region: 'East',
      amount: 10.5,
      qty: 9007199254740991,
      ratio: 0.25,
      placed: '2026-01-02',
      at: '2026-01-02T10:00:00.123',
      at_tz: '2026-01-02T08:00:00+00:00',
      t: '08:30:00',
      ok: true,
      meta: '{"vip": true, "tier": 2}',
      tags: ['a', 'b c'],
      nums: [1, 2, 3],
      uid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      blob: expect.anything(),
      price: 12.34
    })
    expect(rows[1]!['ratio']).toBeNaN()
    expect(rows[1]!['t']).toBe('23:59:59.5')
    expect(rows[1]!['price']).toBe(-5)
    expect(rows[3]!['at_tz']).toBe('2026-02-01T05:00:00+00:00')
    expect(rows[3]!['tags']).toEqual([null])
    const bin = await h.m(`Binary.ToText(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data]{[id=1]}[blob], BinaryEncoding.Hex)`)
    expect(bin).toBe('0102ff')
  })

  it('folds selects, filters, sort and limits — and matches local evaluation', async () => {
    const steps = `f = Table.SelectRows(t, each ([region] = "East" or Text.StartsWith([region], "O'")) and [amount] >= 5 and [placed] <> null),
        s = Table.Sort(f, {{"amount", Order.Descending}, "id"}), n = Table.FirstN(s, 2), c = Table.SelectColumns(n, {"id", "amount", "placed"})`
    const folded = await h.m(`let t = PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data], ${steps} in c`)
    expect(sqlSent(h).at(-1)).toBe(
      `SELECT "id", "amount", "placed" FROM "public"."orders" WHERE ((("region" = 'East' OR "region" LIKE 'O''%') AND "amount" >= 5) AND "placed" IS NOT NULL) ORDER BY "amount" DESC NULLS LAST, "id" ASC NULLS FIRST LIMIT 2`
    )
    const local = await h.m(`let t = Table.Buffer(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data]), ${steps} in c`)
    expect(sqlSent(h).at(-1)).toBe(`SELECT * FROM "public"."orders"`)
    expect(folded).toEqual(local)
    expect(folded).toEqual([
      { id: 1, amount: 10.5, placed: '2026-01-02' },
      { id: 4, amount: 7.25, placed: '2026-02-01' }
    ])
  })

  it('folds <> with M null semantics, List.Contains, Skip, and datetime parameters (incremental refresh)', async () => {
    const v = await h.m(`let t = PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data],
        RangeStart = #datetime(2026, 1, 2, 12, 0, 0), RangeEnd = #datetime(2026, 2, 1, 0, 0, 0),
        f = Table.SelectRows(t, each [at] >= RangeStart and [at] < RangeEnd) in Table.SelectColumns(f, {"id"})`)
    expect(v).toEqual([{ id: 2 }])
    expect(sqlSent(h).at(-1)).toContain(`WHERE ("at" >= TIMESTAMP '2026-01-02 12:00:00' AND "at" < TIMESTAMP '2026-02-01 00:00:00')`)
    const ne = await h.m(`Table.Column(Table.SelectRows(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data], each [ok] <> true), "id")`)
    expect((ne as number[]).sort()).toEqual([2, 3])
    const inList = await h.m(`Table.Column(Table.Skip(Table.Sort(Table.SelectRows(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data], each List.Contains({"East", "West"}, [region])), "id"), 1), "id")`)
    expect(inList).toEqual([2, 3])
    expect(sqlSent(h).at(-1)).toBe(`SELECT * FROM "public"."orders" WHERE "region" IN ('East', 'West') ORDER BY "id" ASC NULLS FIRST OFFSET 1`)
  })

  it('folds Table.NestedJoin + ExpandTableColumn into a JOIN (null keys match like M) and matches local evaluation', async () => {
    const db = `PostgreSQL.Database("${server}", "shop")`
    const steps = (o: string) => `let o = ${o}, r = ${db}{[Schema="sales",Item="totals"]}[Data],
      j = Table.NestedJoin(o, {"region"}, r, {"region"}, "T", JoinKind.FullOuter), e = Table.ExpandTableColumn(j, "T", {"total"}, {"Region total"}),
      c = Table.SelectColumns(Table.Sort(e, {"id", "Region total"}), {"id", "Region total"}) in c`
    const folded = await h.m(steps(`Table.SelectColumns(${db}{[Schema="public",Item="orders"]}[Data], {"id", "region"})`))
    // a FULL JOIN on a null-safe condition isn't hash/merge-joinable in PostgreSQL: left join + unmatched right rows
    expect(sqlSent(h).some((q) => q.includes('LEFT OUTER JOIN') && q.includes('UNION ALL') && q.includes('NOT EXISTS') && q.includes('IS NOT DISTINCT FROM'))).toBe(true)
    const local = await h.m(steps(`Table.Buffer(Table.SelectColumns(${db}{[Schema="public",Item="orders"]}[Data], {"id", "region"}))`))
    expect(folded).toEqual(local)
    expect(folded).toEqual([
      { id: 1, 'Region total': 15.5 },
      { id: 2, 'Region total': 20 },
      { id: 3, 'Region total': 15.5 },
      { id: 4, 'Region total': 7.25 }
    ])
  })

  it('reads 20,000 rows and folds an aggregate-free top', async () => {
    expect(await h.m(`Table.RowCount(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="big"]}[Data])`)).toBe(20000)
    expect(await h.m(`Table.RowCount(Table.SelectRows(PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="big"]}[Data], each [k] = 3))`)).toBe(2857)
  })

  it('runs native queries, Value.NativeQuery with parameters and JSON as records', async () => {
    expect(await h.m(`PostgreSQL.Database("${server}", "shop", [Query="SELECT region, sum(amount) AS total FROM orders GROUP BY region ORDER BY 1"])`)).toEqual([
      { region: 'East', total: 15.5 },
      { region: "O'Brien", total: 7.25 },
      { region: 'West', total: 20 }
    ])
    expect(await h.m(`Value.NativeQuery(PostgreSQL.Database("${server}", "shop"), "SELECT id FROM orders WHERE region = @r AND placed >= @d ORDER BY id", [r = "O'Brien", d = #date(2026, 1, 1)])`)).toEqual([{ id: 4 }])
    const j = (await h.m(`Table.Column(PostgreSQL.Database("${server}", "shop", [Query="SELECT meta FROM orders ORDER BY id", JsonAsRecords=true]), "meta")`)) as unknown[]
    expect(j).toEqual([{ vip: true, tier: 2 }, null, [1, 2], 'x'])
    expect(await h.m(`Table.Column(PostgreSQL.Database("${server}", "shop"){[Schema="sales",Item="totals"]}[Data], "region")`)).toHaveLength(3)
  })

  it('reports wrong passwords and missing objects', async () => {
    const bad = harness()
    try {
      bad.store.set({ key: `postgresql:${server}`, label: server, auth: { kind: 'basic', user: 'lumen', password: 'wrong' } })
      await expect(bad.m(`PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="orders"]}[Data]`)).rejects.toThrow(/PostgreSQL: password authentication failed.*credentials/)
      expect(await bad.service.test({ kind: 'db-items', driver: 'postgresql', server, database: 'shop' })).toMatchObject({ ok: false })
    } finally {
      await bad.dispose()
    }
    await expect(h.m(`PostgreSQL.Database("${server}", "shop"){[Schema="public",Item="nope"]}[Data]`)).rejects.toThrow(/relation "public.nope" does not exist/)
    expect(await h.service.test({ kind: 'db-items', driver: 'postgresql', server, database: 'shop' })).toEqual({ ok: true, message: 'Connected: 4 tables and views visible.' })
  })

  it('honours SSL modes (the container has TLS off: prefer falls back, require fails)', async () => {
    const r = harness()
    try {
      r.store.set({ key: `postgresql:${server};shop`, label: 'x', auth: { kind: 'basic', user: 'lumen', password: 'lumen-pw', sslMode: 'require' } })
      await expect(r.m(`PostgreSQL.Database("${server}", "shop", [Query="select 1 as x"])`)).rejects.toThrow(/SSL/i)
      r.store.set({ key: `postgresql:${server};shop`, label: 'x', auth: { kind: 'basic', user: 'lumen', password: 'lumen-pw', sslMode: 'disable' } })
      expect(await r.m(`PostgreSQL.Database("${server}", "shop", [Query="select 1 as x"])`)).toEqual([{ x: 1 }])
    } finally {
      await r.dispose()
    }
  })
})

// ---------------------------------------------------------------------------------------------

live('MySQL (mysql:8)', () => {
  let c: Container
  let h: Harness
  let server = ''
  beforeAll(async () => {
    c = startContainer({ name: 'mysql', image: 'mysql:8', port: 3306, env: { MYSQL_ROOT_PASSWORD: 'root-pw', MYSQL_DATABASE: 'shop', MYSQL_USER: 'lumen', MYSQL_PASSWORD: 'lumen-pw' } })
    server = `${c.host}:${c.port}`
    const conn = await waitFor(async () => {
      const cn = await mysql.createConnection({ host: c.host, port: c.port, user: 'lumen', password: 'lumen-pw', database: 'shop', multipleStatements: true })
      await cn.query('SELECT 1')
      return cn
    }, 180_000, 1000)
    await conn.query(`
      CREATE TABLE orders (id INT PRIMARY KEY, region VARCHAR(20), amount DECIMAL(10,2), qty BIGINT, ratio DOUBLE, placed DATE, at DATETIME(3), ts TIMESTAMP NULL,
        t TIME, ok TINYINT(1), flag BIT(1), meta JSON, blob_col BLOB, size ENUM('S','M','L'), yr YEAR);
      INSERT INTO orders VALUES
        (1, 'East', 10.50, 9007199254740991, 0.25, '2026-01-02', '2026-01-02 10:00:00.123', '2026-01-02 08:00:00', '08:30:00', 1, b'1', '{"vip": true}', x'0102FF', 'M', 2026),
        (2, 'West', 20.00, 2, 1.5, '2026-01-03', '2026-01-03 11:30:00', NULL, '23:59:59', 0, b'0', NULL, NULL, 'S', NULL),
        (3, 'East', 5.00, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[1, 2]', NULL, NULL, NULL),
        (4, 'O\\'Brien', 7.25, 4, -1, '2026-02-01', '2026-02-01 00:00:00', '2026-02-01 05:00:00', '00:00:00', 1, b'1', '"x"', NULL, 'L', 1999);
      CREATE VIEW east AS SELECT id, amount FROM orders WHERE region = 'East';`)
    await conn.end()
    h = harness()
    h.store.set({ key: `mysql:${server}`, label: server, auth: { kind: 'basic', user: 'lumen', password: 'lumen-pw' } })
  }, 240_000)
  afterAll(async () => {
    await h?.dispose()
    c?.remove()
  })

  it('lists tables and views of the database', async () => {
    expect(await h.m(`Table.SelectColumns(MySQL.Database("${server}", "shop"), {"Schema", "Item", "Kind"})`)).toEqual([
      { Schema: 'shop', Item: 'east', Kind: 'View' },
      { Schema: 'shop', Item: 'orders', Kind: 'Table' }
    ])
  })

  it('maps MySQL types', async () => {
    const t = await h.table(`MySQL.Database("${server}", "shop"){[Schema="shop",Item="orders"]}[Data]`)
    expect(Object.fromEntries(t.columns.map((c, i) => [c, t.types[i]!.kind]))).toEqual({
      id: 'number', region: 'text', amount: 'number', qty: 'number', ratio: 'number', placed: 'date', at: 'datetime', ts: 'datetime',
      t: 'time', ok: 'logical', flag: 'logical', meta: 'text', blob_col: 'binary', size: 'text', yr: 'number'
    })
    const rows = (await h.m(`Table.Sort(MySQL.Database("${server}", "shop"){[Schema="shop",Item="orders"]}[Data], "id")`)) as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ id: 1, region: 'East', amount: 10.5, qty: 9007199254740991, placed: '2026-01-02', at: '2026-01-02T10:00:00.123', ts: '2026-01-02T08:00:00', t: '08:30:00', ok: true, flag: true, meta: '{"vip": true}', size: 'M', yr: 2026 })
    expect(rows[1]).toMatchObject({ ok: false, flag: false, ts: null, meta: null })
    expect(await h.m(`Binary.ToText(MySQL.Database("${server}", "shop"){[Schema="shop",Item="orders"]}[Data]{[id=1]}[blob_col], BinaryEncoding.Hex)`)).toBe('0102ff')
  })

  it('folds with the MySQL dialect and matches local evaluation', async () => {
    const steps = `f = Table.SelectRows(t, each Text.Contains([region], "ast") or [region] = "O'Brien"), s = Table.Sort(f, {{"amount", Order.Descending}}), n = Table.FirstN(s, 2), c = Table.SelectColumns(n, {"id", "amount"})`
    const folded = await h.m(`let t = MySQL.Database("${server}", "shop"){[Schema="shop",Item="orders"]}[Data], ${steps} in c`)
    expect(sqlSent(h).at(-1)).toBe("SELECT `id`, `amount` FROM `shop`.`orders` WHERE (`region` LIKE '%ast%' OR `region` = 'O''Brien') ORDER BY `amount` DESC LIMIT 2")
    const local = await h.m(`let t = Table.Buffer(MySQL.Database("${server}", "shop"){[Schema="shop",Item="orders"]}[Data]), ${steps} in c`)
    expect(folded).toEqual(local)
    expect(folded).toEqual([
      { id: 1, amount: 10.5 },
      { id: 4, amount: 7.25 }
    ])
  })

  it('folds a merge of two tables into a LEFT OUTER JOIN with <=> (MySQL has no FULL OUTER JOIN: that one runs locally)', async () => {
    const db = `MySQL.Database("${server}", "shop")`
    const steps = (kind: string, buffer: boolean) => `let o = Table.SelectColumns(${db}{[Schema="shop",Item="orders"]}[Data], {"id", "region"}), r = ${db}{[Schema="shop",Item="east"]}[Data],
      j = Table.NestedJoin(${buffer ? 'Table.Buffer(o)' : 'o'}, {"id"}, r, {"id"}, "E", ${kind}), e = Table.ExpandTableColumn(j, "E", {"amount"}) in Table.Sort(e, "id")`
    const folded = await h.m(steps('JoinKind.LeftOuter', false))
    expect(sqlSent(h).some((q) => q.includes('LEFT OUTER JOIN') && q.includes('<=>'))).toBe(true)
    expect(folded).toEqual(await h.m(steps('JoinKind.LeftOuter', true)))
    expect((folded as Array<{ amount: number | null }>).map((r) => r.amount)).toEqual([10.5, null, 5, null])
    const full = await h.m(steps('JoinKind.FullOuter', false))
    expect(sqlSent(h).some((q) => q.includes('JOIN'))).toBe(false)
    expect(full).toEqual(await h.m(steps('JoinKind.FullOuter', true)))
  })

  it('runs native queries and reports bad credentials', async () => {
    expect(await h.m(`Value.NativeQuery(MySQL.Database("${server}", "shop"), "SELECT COUNT(*) AS n FROM orders WHERE region = ?", {"East"})`)).toEqual([{ n: 2 }])
    const bad = harness()
    try {
      bad.store.set({ key: `mysql:${server}`, label: server, auth: { kind: 'basic', user: 'lumen', password: 'nope' } })
      await expect(bad.m(`MySQL.Database("${server}", "shop")`)).rejects.toThrow(/MySQL: Access denied.*credentials/)
    } finally {
      await bad.dispose()
    }
  })
})

// ---------------------------------------------------------------------------------------------

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out
}

withImage('bitnamilegacy/minio:latest')('S3-compatible storage (MinIO)', () => {
  let c: Container
  let h: Harness
  let endpoint = ''
  let lake = ''
  beforeAll(async () => {
    c = startContainer({ name: 'minio', image: 'bitnamilegacy/minio:latest', port: 9000, env: { MINIO_ROOT_USER: 'lumenadmin', MINIO_ROOT_PASSWORD: 'lumen-secret-1' } })
    endpoint = `http://${c.host}:${c.port}`
    const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'lumenadmin', secretAccessKey: 'lumen-secret-1' } })
    await waitFor(() => s3.send(new CreateBucketCommand({ Bucket: 'lake' })), 90_000, 1000)
    const put = (key: string, body: Uint8Array | string) => s3.send(new PutObjectCommand({ Bucket: 'lake', Key: key, Body: body }))
    await put('csv/2026/jan.csv', 'region,amount\nEast,10\nWest,20\n')
    await put('csv/2026/feb.csv', 'region,amount\nEast,5\n')
    await put('csv/readme.txt', 'not data')
    // a real generated lakehouse (Delta tables + bronze files), uploaded as-is
    lake = mkdtempSync(join(tmpdir(), 'lumen-lake-'))
    execFileSync('node', ['datasets/src/node/cli.ts', 'generate', 'starlite', '--scale', 'tiny', '--out', lake], { stdio: 'pipe', timeout: 120_000 })
    const root = join(lake, 'starlite', 'Starlite.Lakehouse')
    const files = filesUnder(join(root, 'Tables'))
    for (let i = 0; i < files.length; i += 16) await Promise.all(files.slice(i, i + 16).map((f) => put(`starlite/${relative(root, f)}`, readFileSync(f))))
    await put('starlite/Files/bronze/notes.csv', 'a,b\n1,2\n')
    s3.destroy()
    h = harness()
    h.store.set({ key: `s3:${endpoint}`, label: endpoint, auth: { kind: 'aws-keys', accessKeyId: 'lumenadmin', secretAccessKey: 'lumen-secret-1' } })
  }, 240_000)
  afterAll(async () => {
    await h?.dispose()
    c?.remove()
    if (lake) rmSync(lake, { recursive: true, force: true })
  })

  it('lists objects like Folder.Files and combines CSV files', async () => {
    const v = await h.m(`let s = AmazonS3.Contents("lake", [Endpoint="${endpoint}", Prefix="csv/"]),
        csv = Table.SelectRows(s, each [Extension] = ".csv"),
        t = Table.AddColumn(csv, "T", each Table.PromoteHeaders(Csv.Document([Content]))),
        x = Table.ExpandTableColumn(Table.SelectColumns(t, {"Name", "Folder Path", "T"}), "T", {"region", "amount"}) in x`)
    expect(v).toEqual([
      { Name: 'feb.csv', 'Folder Path': 's3://lake/csv/2026/', region: 'East', amount: '5' },
      { Name: 'jan.csv', 'Folder Path': 's3://lake/csv/2026/', region: 'East', amount: '10' },
      { Name: 'jan.csv', 'Folder Path': 's3://lake/csv/2026/', region: 'West', amount: '20' }
    ])
    const attrs = (await h.m(`AmazonS3.Contents("lake", [Endpoint="${endpoint}", Prefix="csv/2026/"]){[Name="jan.csv"]}[Attributes][Size]`)) as number
    expect(attrs).toBe(30)
  })

  it('reads Delta tables and lakehouse folders from the bucket exactly like from disk', async () => {
    const localRoot = join(lake, 'starlite', 'Starlite.Lakehouse')
    const navS3 = (await h.m(`Table.SelectColumns(Lakehouse.Folder("s3://lake/starlite", [Endpoint="${endpoint}"]), {"Id", "ItemKind"})`)) as Array<{ Id: string; ItemKind: string }>
    const navLocal = (await h.m(`Table.SelectColumns(Lakehouse.Folder("${localRoot}"), {"Id", "ItemKind"})`)) as Array<{ Id: string; ItemKind: string }>
    expect(navS3).toEqual(navLocal)
    expect(navS3.filter((r) => r.ItemKind === 'Table').length).toBeGreaterThanOrEqual(25)
    for (const table of ['gold_dim_store', 'gold_fact_sales_line', 'silver_members']) {
      const s3rows = await h.m(`Lakehouse.Folder("s3://lake/starlite", [Endpoint="${endpoint}"]){[Id="${table}",ItemKind="Table"]}[Data]`)
      const localRows = await h.m(`Lakehouse.Folder("${localRoot}"){[Id="${table}",ItemKind="Table"]}[Data]`)
      expect((s3rows as unknown[]).length).toBeGreaterThan(0)
      expect(s3rows).toEqual(localRows)
    }
    expect(await h.m(`Table.RowCount(DeltaLake.Table("s3://lake/starlite/Tables/gold_dim_store", [Endpoint="${endpoint}"]))`)).toBe(
      await h.m(`Table.RowCount(DeltaLake.Table("${join(localRoot, 'Tables', 'gold_dim_store')}"))`)
    )
    const files = await h.m(`Table.SelectColumns(Lakehouse.Folder("s3://lake/starlite", [Endpoint="${endpoint}"]){[Id="Files"]}[Data], {"Name"})`)
    expect(files).toEqual([{ Name: 'bronze' }])
  })

  it('reports bad keys and missing buckets', async () => {
    const bad = harness()
    try {
      bad.store.set({ key: `s3:${endpoint}`, label: endpoint, auth: { kind: 'aws-keys', accessKeyId: 'lumenadmin', secretAccessKey: 'wrong-secret' } })
      await expect(bad.m(`AmazonS3.Contents("lake", [Endpoint="${endpoint}"])`)).rejects.toThrow(/Amazon S3: Access to the bucket 'lake' was denied/)
      expect((await bad.service.test({ kind: 's3-list', bucket: 'lake', prefix: '', recursive: false, endpoint, forcePathStyle: true })).ok).toBe(false)
    } finally {
      await bad.dispose()
    }
    await expect(h.m(`AmazonS3.Contents("nope", [Endpoint="${endpoint}"])`)).rejects.toThrow(/bucket 'nope' doesn't exist/)
    expect(await h.service.test({ kind: 's3-list', bucket: 'lake', prefix: '', recursive: false, endpoint, forcePathStyle: true })).toEqual({ ok: true, message: "Connected: 2 items at the top level of 'lake'." })
  })
})

// ---------------------------------------------------------------------------------------------

withImage('mtlynch/firestore-emulator:latest')('Firestore (emulator)', () => {
  let c: Container
  let h: Harness
  let emulator = ''
  const project = 'lumen-it'
  const doc = async (path: string, fields: Record<string, unknown>) => {
    const i = path.lastIndexOf('/')
    const res = await fetch(`http://${emulator}/v1/projects/${project}/databases/(default)/documents/${path.slice(0, i)}?documentId=${path.slice(i + 1)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ fields })
    })
    if (!res.ok) throw new Error(`seed ${path}: ${res.status} ${await res.text()}`)
  }
  beforeAll(async () => {
    c = startContainer({ name: 'firestore', image: 'mtlynch/firestore-emulator:latest', port: 8080, env: { FIRESTORE_PROJECT_ID: project, PORT: '8080' } })
    emulator = `${c.host}:${c.port}`
    await waitFor(async () => {
      const r = await fetch(`http://${emulator}/`)
      if (!r.ok) throw new Error(String(r.status))
    }, 120_000, 1000)
    await doc('users/ann', {
      name: { stringValue: 'Ann' },
      age: { integerValue: '41' },
      address: { mapValue: { fields: { city: { stringValue: 'Oslo' }, geo: { geoPointValue: { latitude: 59.9, longitude: 10.7 } } } } },
      tags: { arrayValue: { values: [{ stringValue: 'vip' }, { stringValue: 'early' }] } },
      updated_at: { timestampValue: '2026-03-01T10:00:00Z' },
      manager: { referenceValue: `projects/${project}/databases/(default)/documents/users/bob` }
    })
    await doc('users/bob', { name: { stringValue: 'Bob' }, age: { integerValue: '35' }, address: { mapValue: { fields: { city: { stringValue: 'Rome' } } } }, updated_at: { timestampValue: '2026-01-15T00:00:00Z' } })
    await doc('users/cy', { name: { stringValue: 'Cy' }, age: { doubleValue: 29.5 }, active: { booleanValue: false }, updated_at: { timestampValue: '2026-03-05T00:00:00Z' } })
    await doc('users/ann/orders/o1', { total: { doubleValue: 12.5 }, status: { stringValue: 'paid' } })
    await doc('users/ann/orders/o2', { total: { integerValue: '7' }, status: { stringValue: 'open' } })
    await doc('users/bob/orders/o3', { total: { integerValue: '30' }, status: { stringValue: 'paid' } })
    // 1,234 events: more than two pages of 500
    for (let i = 0; i < 1234; i += 50) await Promise.all(Array.from({ length: Math.min(50, 1234 - i) }, (_x, k) => doc(`events/e${String(i + k).padStart(5, '0')}`, { n: { integerValue: String(i + k) }, kind: { stringValue: (i + k) % 3 ? 'view' : 'click' } })))
    h = harness()
  }, 300_000)
  afterAll(async () => {
    await h?.dispose()
    c?.remove()
  })

  const opts = () => `[EmulatorHost="${emulator}"]`

  it('lists root collections and subcollections', async () => {
    expect(await h.m(`Table.Column(Firestore.Collections("${project}", ${opts()}), "Name")`)).toEqual(['events', 'users'])
    expect(await h.m(`Table.SelectColumns(Firestore.Collections("${project}", [EmulatorHost="${emulator}", Parent="users/ann"]), {"Name", "Path"})`)).toEqual([{ Name: 'orders', Path: 'users/ann/orders' }])
  })

  it('reads documents with typed, flattened fields', async () => {
    const t = await h.table(`Firestore.Collections("${project}", ${opts()}){[Name="users"]}[Data]`)
    expect(t.columns).toEqual(['_id', '_path', '_createTime', '_updateTime', 'active', 'address.city', 'address.geo', 'age', 'manager', 'name', 'tags', 'updated_at'])
    const rows = (await h.m(`Table.RemoveColumns(Firestore.Collections("${project}", ${opts()}){[Name="users"]}[Data], {"_createTime", "_updateTime"})`)) as Array<Record<string, unknown>>
    expect(rows).toEqual([
      { _id: 'ann', _path: 'users/ann', active: null, 'address.city': 'Oslo', 'address.geo': { Latitude: 59.9, Longitude: 10.7 }, age: 41, manager: 'users/bob', name: 'Ann', tags: ['vip', 'early'], updated_at: '2026-03-01T10:00:00+00:00' },
      { _id: 'bob', _path: 'users/bob', active: null, 'address.city': 'Rome', 'address.geo': null, age: 35, manager: null, name: 'Bob', tags: null, updated_at: '2026-01-15T00:00:00+00:00' },
      { _id: 'cy', _path: 'users/cy', active: false, 'address.city': null, 'address.geo': null, age: 29.5, manager: null, name: 'Cy', tags: null, updated_at: '2026-03-05T00:00:00+00:00' }
    ])
    expect(t.types[t.columns.indexOf('age')]!.kind).toBe('number')
    expect(t.types[t.columns.indexOf('updated_at')]!.kind).toBe('datetimezone')
  })

  it('pages through large collections and folds filters + limits', async () => {
    expect(await h.m(`Table.RowCount(Firestore.Query("${project}", "events", ${opts()}))`)).toBe(1234)
    const v = await h.m(`let d = Firestore.Query("${project}", "events", ${opts()}), f = Table.SelectRows(d, each [kind] = "click" and [n] >= 600) in Table.RowCount(f)`)
    expect(v).toBe(Array.from({ length: 1234 }, (_x, i) => i).filter((i) => i % 3 === 0 && i >= 600).length)
    const last = h.log.filter((r) => r.kind === 'firestore-query').at(-1)
    expect(last).toMatchObject({ filters: [{ field: 'kind', op: 'EQUAL' }, { field: 'n', op: 'GREATER_THAN_OR_EQUAL' }] })
    expect(await h.m(`Table.RowCount(Table.FirstN(Firestore.Query("${project}", "events", ${opts()}), 3))`)).toBe(3)
  })

  it('expands arrays to rows, queries collection groups and filters incrementally by updated_at', async () => {
    expect(await h.m(`Table.Column(Table.ExpandListColumn(Firestore.Query("${project}", "users", [EmulatorHost="${emulator}", Where={{"name", "=", "Ann"}}]), "tags"), "tags")`)).toEqual(['vip', 'early'])
    const orders = (await h.m(`Table.SelectColumns(Table.Sort(Firestore.Query("${project}", "orders", [EmulatorHost="${emulator}", AllDescendants=true]), "_path"), {"_path", "total", "status"})`)) as unknown[]
    expect(orders).toEqual([
      { _path: 'users/ann/orders/o1', total: 12.5, status: 'paid' },
      { _path: 'users/ann/orders/o2', total: 7, status: 'open' },
      { _path: 'users/bob/orders/o3', total: 30, status: 'paid' }
    ])
    const recent = await h.m(`let RangeStart = #datetimezone(2026, 2, 1, 0, 0, 0, 0, 0), RangeEnd = #datetimezone(2026, 4, 1, 0, 0, 0, 0, 0),
        d = Firestore.Query("${project}", "users", ${opts()}), f = Table.SelectRows(d, each [updated_at] >= RangeStart and [updated_at] < RangeEnd) in Table.Column(f, "_id")`)
    expect(recent).toEqual(['ann', 'cy'])
    expect(h.log.filter((r) => r.kind === 'firestore-query').at(-1)).toMatchObject({ filters: [{ field: 'updated_at', op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: '2026-02-01T00:00:00.000Z' } }, { field: 'updated_at', op: 'LESS_THAN' }] })
    expect(await h.m(`Table.Column(Firestore.Query("${project}", "orders", [EmulatorHost="${emulator}", Parent="users/ann", OrderBy={{"total", Order.Descending}}]), "_id")`)).toEqual(['o1', 'o2'])
  })

  it('folds or, <> null and sorts on fields the filter requires', async () => {
    const users = `Firestore.Query("${project}", "users", ${opts()})`
    const lastRead = () => h.log.filter((r) => r.kind === 'firestore-query').at(-1)
    // OR queries arrived in Firestore in 2023: older emulator builds reject them (the error says so)
    const or = await fetch(`http://${emulator}/v1/projects/${project}/databases/(default)/documents:runQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }], where: { compositeFilter: { op: 'OR', filters: [{ fieldFilter: { field: { fieldPath: 'name' }, op: 'EQUAL', value: { stringValue: 'Bob' } } }] } } } })
    })
    const orQuery = `Table.Column(Table.SelectRows(${users}, each [name] = "Bob" or [age] < 30), "_id")`
    if (or.ok) expect(await h.m(orQuery)).toEqual(['bob', 'cy'])
    else await expect(h.m(orQuery)).rejects.toThrow(/may not support OR queries/)
    expect(lastRead()).toMatchObject({ filters: [{ op: 'OR', filters: [{ field: 'name', op: 'EQUAL' }, { field: 'age', op: 'LESS_THAN' }] }] })
    expect(await h.m(`Table.Column(Table.SelectRows(${users}, each [active] <> null), "_id")`)).toEqual(['cy'])
    expect(lastRead()).toMatchObject({ filters: [{ field: 'active', op: 'IS_NOT_NULL' }] })
    expect(await h.m(`Table.Column(Table.Sort(Table.SelectRows(${users}, each [age] <> null), {{"age", Order.Descending}}), "_id")`)).toEqual(['ann', 'bob', 'cy'])
    expect(lastRead()).toMatchObject({ orderBy: [{ field: 'age', desc: true }] })
    // not folded: documents without the field stay (M sorts nulls first)
    expect(await h.m(`Table.Column(Table.Sort(${users}, "active"), "_id")`)).toEqual(['ann', 'bob', 'cy'])
    // beyond the sample: the source sorts and limits
    const top = await h.m(`let e = Firestore.Query("${project}", "events", ${opts()}), f = Table.SelectRows(e, each [n] <> null) in Table.Column(Table.FirstN(Table.Sort(f, {{"n", Order.Descending}}), 3), "n")`)
    expect(top).toEqual([1233, 1232, 1231])
    expect(lastRead()).toMatchObject({ limit: 3, orderBy: [{ field: 'n', desc: true }] })
  })

  it('tests the connection', async () => {
    expect(await h.service.test({ kind: 'firestore-collections', project, database: '(default)', emulator })).toEqual({ ok: true, message: 'Connected: 2 collections.' })
  })
})
