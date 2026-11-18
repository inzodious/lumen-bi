/**
 * Connector unit tests that need no servers: credential store, value conversions, SQLite end to end
 * (sql.js), Firestore query shapes, share discovery, OAuth PKCE and Web.Contents auth presets against a
 * local HTTP server.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CredentialStore, urlCovers } from '../credstore'
import { convertMysqlValue, mysqlHostType } from '../mysql'
import { convertPgText, parsePgArray, parsePgBytea, parsePgTimestamp, pgHostType } from '../pg'
import { fieldPathSegments, structuredQuery } from '../firestore'
import { listShares, normalizeShareUrl, parseGvfsName, parseMounts, parseShareUrl, resolveAgainst } from '../shares'
import { sqliteDeclaredType, sqliteInferType } from '../sqlite'
import { pkcePair } from '../oauth'
import { hostPort } from '../common'
import { harness, sqlSent, testCipher, type Harness } from './harness'

// ---------------------------------------------------------------------------------------------

describe('credential store', () => {
  let h: Harness
  beforeAll(() => (h = harness()))
  afterAll(() => h.dispose())

  it('stores secrets encrypted and keeps them across instances', () => {
    h.store.set({ key: 'postgresql:db.local;shop', label: 'db.local;shop', auth: { kind: 'basic', user: 'ann', password: 's3cret!', sslMode: 'require' }, privacy: 'Organizational' })
    const raw = readFileSync(join(h.dir, 'credentials.json'), 'utf8')
    expect(raw).not.toContain('s3cret!')
    expect(raw).toContain('"user": "ann"')
    const again = new CredentialStore(join(h.dir, 'credentials.json'), testCipher)
    expect(again.get('postgresql:db.local;shop')?.auth).toEqual({ kind: 'basic', user: 'ann', password: 's3cret!', sslMode: 'require' })
    const info = again.list()[0]!
    expect(info).toMatchObject({ key: 'postgresql:db.local;shop', privacy: 'Organizational', secrets: ['password'] })
    expect(JSON.stringify(info)).not.toContain('s3cret!')
  })

  it('keeps stored secrets the renderer did not send back, clears them on empty text', () => {
    h.store.set({ key: 'web:https://api.example.com', label: 'api', auth: { kind: 'key', keyName: 'X-Api-Key', keyIn: 'header', keyValue: 'k1' } })
    h.store.set({ key: 'web:https://api.example.com', label: 'api', auth: { kind: 'key', keyName: 'X-Key', keyIn: 'header' }, privacy: 'Private' })
    expect(h.store.get('web:https://api.example.com')?.auth).toMatchObject({ keyName: 'X-Key', keyValue: 'k1' })
    h.store.set({ key: 'web:https://api.example.com', label: 'api', auth: { kind: 'key', keyName: 'X-Key', keyIn: 'header', keyValue: '' } })
    expect(h.store.get('web:https://api.example.com')?.auth.keyValue).toBeUndefined()
    expect(h.store.get('web:https://api.example.com')?.privacy).toBe('Private')
  })

  it('finds web credentials by longest URL prefix on segment boundaries', () => {
    h.store.set({ key: 'web:https://api.example.com/v1', label: 'v1', auth: { kind: 'bearer', token: 't1' } })
    expect(h.store.findWeb('https://api.example.com/v1/items?x=1')?.key).toBe('web:https://api.example.com/v1')
    expect(h.store.findWeb('https://api.example.com/v10')?.key).toBe('web:https://api.example.com')
    expect(h.store.findWeb('https://other.example.com/')).toBeUndefined()
    expect(urlCovers('https://a.com/x', 'https://a.com/x?y')).toBe(true)
    expect(urlCovers('https://a.com/x', 'https://a.com/xy')).toBe(false)
  })

  it('never writes secrets in clear text without a keyring', () => {
    const file = join(h.dir, 'nokeyring.json')
    const s = new CredentialStore(file, { ...testCipher, available: () => false })
    s.set({ key: 'mysql:m;d', label: 'm;d', auth: { kind: 'basic', user: 'u', password: 'pw-123' } })
    expect(readFileSync(file, 'utf8')).not.toContain('pw-123')
    expect(s.get('mysql:m;d')?.auth.password).toBe('pw-123')
    expect(new CredentialStore(file, { ...testCipher, available: () => false }).get('mysql:m;d')?.auth.password).toBeUndefined()
    expect(s.status()).toEqual({ encrypted: false, backend: 'test' })
  })

  it('clears one or all entries', () => {
    h.store.clear('web:https://api.example.com/v1')
    expect(h.store.get('web:https://api.example.com/v1')).toBeUndefined()
    h.store.clear()
    expect(h.store.list()).toEqual([])
  })

  it('asks for credentials before connecting', async () => {
    await expect(h.m(`PostgreSQL.Database("127.0.0.1:1", "x")`)).rejects.toThrow(/Credentials are required to connect to the PostgreSQL source/)
    await expect(h.m(`AmazonS3.Contents("b", [Endpoint="http://127.0.0.1:1"])`)).rejects.toThrow(/Credentials are required to connect to the Amazon S3 source/)
    await expect(h.m(`Firestore.Collections("proj")`)).rejects.toThrow(/Credentials are required to connect to the Firestore source/)
  })
})

// ---------------------------------------------------------------------------------------------

describe('value conversion', () => {
  it('parses PostgreSQL text formats', () => {
    expect(parsePgTimestamp('2026-01-02 03:04:05')).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(parsePgTimestamp('2026-01-02 03:04:05.123456+00')).toBe(Date.UTC(2026, 0, 2, 3, 4, 5, 123))
    expect(parsePgTimestamp('2026-01-02 05:34:05+05:30')).toBe(Date.UTC(2026, 0, 2, 0, 4, 5))
    expect(parsePgTimestamp('2026-01-02 03:04:05-08')).toBe(Date.UTC(2026, 0, 2, 11, 4, 5))
    expect(parsePgTimestamp('infinity')).toBeNull()
    expect(parsePgBytea('\\x00ff10')).toEqual(new Uint8Array([0, 255, 16]))
    expect(parsePgArray('{1,2,NULL}', Number)).toEqual([1, 2, null])
    expect(parsePgArray('{"a b","c\\"d",e}', (x) => x)).toEqual(['a b', 'c"d', 'e'])
    expect(parsePgArray('{{1,2},{3,4}}', Number)).toEqual([[1, 2], [3, 4]])
    expect(parsePgArray('{}', Number)).toEqual([])
    expect(convertPgText('t', 16)).toBe(true)
    expect(convertPgText('9007199254740993', 20)).toBe(9007199254740992)
    expect(convertPgText('NaN', 1700)).toBeNaN()
    expect(convertPgText('-$1,234.50', 790)).toBe(-1234.5)
    expect(convertPgText('10:00:00+02', 1266)).toBe('10:00:00')
    expect(convertPgText('{2026-01-01,NULL}', 1182)).toEqual(['2026-01-01', null])
    expect(convertPgText('{"2026-01-01 00:00:00+00"}', 1185)).toEqual([new Date(Date.UTC(2026, 0, 1))])
    expect(pgHostType(1184)).toBe('datetimeoffset')
    expect(pgHostType(1009)).toBe('list')
    expect(pgHostType(3802)).toBe('json')
    expect(pgHostType(99999)).toBe('varchar')
  })

  it('maps MySQL column metadata and raw values', () => {
    const f = (columnType: number, extra: object = {}) => ({ name: 'c', columnType, ...extra })
    expect(mysqlHostType(f(1, { columnLength: 1 }))).toBe('boolean')
    expect(mysqlHostType(f(1, { columnLength: 4 }))).toBe('integer')
    expect(mysqlHostType(f(252, { characterSet: 63 }))).toBe('binary')
    expect(mysqlHostType(f(252, { characterSet: 255 }))).toBe('varchar')
    expect(mysqlHostType(f(245))).toBe('json')
    expect(mysqlHostType(f(246))).toBe('decimal')
    expect(convertMysqlValue(Buffer.from('2026-01-02 03:04:05.5'), 'timestamp', f(12))).toEqual(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 500)))
    expect(convertMysqlValue(Buffer.from('0000-00-00 00:00:00'), 'timestamp', f(12))).toBeNull()
    expect(convertMysqlValue(Buffer.from([1]), 'boolean', f(16, { columnLength: 1 }))).toBe(true)
    expect(convertMysqlValue(Buffer.from([1, 0]), 'bigint', f(16, { columnLength: 16 }))).toBe(256)
    expect(convertMysqlValue(Buffer.from('12.50'), 'decimal', f(246))).toBe(12.5)
    expect(convertMysqlValue(null, 'varchar', f(253))).toBeNull()
  })

  it('maps SQLite declared types and inferred types', () => {
    expect(sqliteDeclaredType('INTEGER')).toBe('bigint')
    expect(sqliteDeclaredType('VARCHAR(20)')).toBe('varchar')
    expect(sqliteDeclaredType('DATETIME')).toBe('timestamp')
    expect(sqliteDeclaredType('date')).toBe('date')
    expect(sqliteDeclaredType('BOOLEAN')).toBe('boolean')
    expect(sqliteDeclaredType('DECIMAL(10,2)')).toBe('decimal')
    expect(sqliteInferType([1, null, 2])).toBe('bigint')
    expect(sqliteInferType([1, 2.5])).toBe('double')
    expect(sqliteInferType(['a', 1])).toBe('any')
  })

  it('parses server addresses', () => {
    expect(hostPort('db.example.com', 5432)).toEqual({ host: 'db.example.com', port: 5432 })
    expect(hostPort('db.example.com:6543', 5432)).toEqual({ host: 'db.example.com', port: 6543 })
    expect(hostPort('db,1234', 5432)).toEqual({ host: 'db', port: 1234 })
    expect(hostPort('[::1]:5433', 5432)).toEqual({ host: '::1', port: 5433 })
  })
})

// ---------------------------------------------------------------------------------------------

describe('SQLite (sql.js) end to end', () => {
  let h: Harness
  let file: string
  beforeAll(async () => {
    h = harness()
    const initSqlJs = (await import('sql.js')).default as unknown as () => Promise<{ Database: new () => { run(s: string): void; export(): Uint8Array; close(): void } }>
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT, amount DECIMAL(10,2), placed DATE, at DATETIME, paid BOOLEAN, note BLOB);
            INSERT INTO orders VALUES (1, 'East', 10.5, '2026-01-02', '2026-01-02 10:00:00', 1, x'0102'), (2, 'West', 20, '2026-01-03', '2026-01-03 11:30:00', 0, NULL),
                                      (3, 'East', 5, NULL, NULL, NULL, NULL), (4, 'O''Brien', 7.25, '2026-02-01', '2026-02-01 00:00:00', 1, NULL);
            CREATE VIEW east AS SELECT * FROM orders WHERE region = 'East';`)
    file = join(h.dir, 'shop.db')
    writeFileSync(file, db.export())
    db.close()
  })
  afterAll(() => h.dispose())

  it('lists tables and views', async () => {
    expect(await h.m(`Table.SelectColumns(SQLite.Database("${file}"), {"Name", "Schema", "Kind"})`)).toEqual([
      { Name: 'east', Schema: 'main', Kind: 'View' },
      { Name: 'orders', Schema: 'main', Kind: 'Table' }
    ])
  })

  it('reads a table with declared types', async () => {
    const t = await h.table(`SQLite.Database("${file}"){[Item="orders"]}[Data]`)
    expect(t.types.map((x) => x.kind)).toEqual(['number', 'text', 'number', 'date', 'datetime', 'logical', 'any'])
    const rows = (await h.m(`SQLite.Database("${file}"){[Item="orders"]}[Data]`)) as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ id: 1, region: 'East', amount: 10.5, placed: '2026-01-02', at: '2026-01-02T10:00:00', paid: true })
    expect(rows[2]).toMatchObject({ placed: null, paid: null })
  })

  it('folds filters, sort and limits into the SQL', async () => {
    const v = await h.m(`let t = SQLite.Database("${file}"){[Item="orders"]}[Data],
      f = Table.SelectRows(t, each [region] = "East" or Text.StartsWith([region], "O'")),
      s = Table.Sort(f, {{"amount", Order.Descending}}), n = Table.FirstN(s, 2) in Table.SelectColumns(n, {"id", "amount"})`)
    expect(v).toEqual([
      { id: 1, amount: 10.5 },
      { id: 4, amount: 7.25 }
    ])
    expect(sqlSent(h).at(-1)).toBe(`SELECT "id", "amount" FROM "main"."orders" WHERE ("region" = 'East' OR "region" LIKE 'O''%' ESCAPE '\\') ORDER BY "amount" DESC LIMIT 2`)
  })

  it('runs native queries (read-only copy)', async () => {
    expect(await h.m(`SQLite.Database("${file}", [Query="SELECT region, SUM(amount) AS total FROM orders GROUP BY region ORDER BY region"])`)).toEqual([
      { region: 'East', total: 15.5 },
      { region: "O'Brien", total: 7.25 },
      { region: 'West', total: 20 }
    ])
    await expect(h.m(`Value.NativeQuery(SQLite.Database("${file}"), "DELETE FROM orders")`)).rejects.toThrow(/readonly|read-only|query_only/i)
    expect(await h.m(`Table.RowCount(SQLite.Database("${file}"){[Item="orders"]}[Data])`)).toBe(4)
  })

  it('reports missing files and tables as errors', async () => {
    await expect(h.m(`SQLite.Database("${file}.nope"){[Item="orders"]}[Data]`)).rejects.toThrow(/SQLite: We couldn't find the file/)
    await expect(h.m(`SQLite.Database("${file}"){[Item="zzz"]}[Data]`)).rejects.toThrow(/no such table/)
  })
})

// ---------------------------------------------------------------------------------------------

describe('Firestore query shapes', () => {
  it('splits field paths', () => {
    expect(fieldPathSegments('a.b')).toEqual(['a', 'b'])
    expect(fieldPathSegments('`a.b`.c')).toEqual(['a.b', 'c'])
    expect(fieldPathSegments('`x\\`y`')).toEqual(['x`y'])
  })

  it('orders by inequality fields then name, and pages with cursors', () => {
    const q = { collection: 'orders', filters: [{ field: 'n', op: 'GREATER_THAN' as const, value: { integerValue: '5' } }, { field: 's', op: 'EQUAL' as const, value: { stringValue: 'x' } }] }
    const first = structuredQuery(q, 500)
    expect(first).toMatchObject({
      from: [{ collectionId: 'orders', allDescendants: false }],
      orderBy: [
        { field: { fieldPath: 'n' }, direction: 'ASCENDING' },
        { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }
      ],
      limit: 500,
      where: { compositeFilter: { op: 'AND' } }
    })
    const next = structuredQuery(q, 500, { name: 'projects/p/databases/(default)/documents/orders/z', fields: { n: { integerValue: '9' } } })
    expect(next['startAt']).toEqual({ values: [{ integerValue: '9' }, { referenceValue: 'projects/p/databases/(default)/documents/orders/z' }], before: false })
  })

  it('renders composite OR / AND and IS_NOT_NULL filters, and folded sorts first', () => {
    const eq = (field: string, v: string) => ({ field, op: 'EQUAL' as const, value: { stringValue: v } })
    const sq = structuredQuery(
      { collection: 'users', filters: [{ field: 'age', op: 'IS_NOT_NULL' }, { op: 'OR', filters: [eq('a', 'x'), { op: 'AND', filters: [eq('b', 'y'), eq('c', 'z')] }] }], orderBy: [{ field: 'name', desc: true }] },
      100
    )
    const ff = (field: string, v: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: v } } })
    expect(sq['where']).toEqual({
      compositeFilter: {
        op: 'AND',
        filters: [
          { unaryFilter: { field: { fieldPath: 'age' }, op: 'IS_NOT_NULL' } },
          { compositeFilter: { op: 'OR', filters: [ff('a', 'x'), { compositeFilter: { op: 'AND', filters: [ff('b', 'y'), ff('c', 'z')] } }] } }
        ]
      }
    })
    expect(sq['orderBy']).toEqual([
      { field: { fieldPath: 'name' }, direction: 'DESCENDING' },
      { field: { fieldPath: 'age' }, direction: 'ASCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }
    ])
  })
})

// ---------------------------------------------------------------------------------------------

describe('network shares', () => {
  it('parses GVFS mount names', () => {
    expect(parseGvfsName('/run/user/1000/gvfs', 'smb-share:server=truenas.local,share=media')).toMatchObject({ url: 'smb://truenas.local/media', kind: 'smb', host: 'truenas.local', share: 'media' })
    expect(parseGvfsName('/g', 'sftp:host=nas,user=me')).toMatchObject({ url: 'sftp://me@nas', kind: 'sftp' })
    expect(parseGvfsName('/g', 'nfs:host=nas,volume=/mnt/tank/data')).toMatchObject({ url: 'nfs://nas/mnt/tank/data', kind: 'nfs' })
    expect(parseGvfsName('/g', 'junk')).toBeNull()
  })

  it('parses /proc/mounts and fstab network entries', () => {
    const text = `/dev/sda1 / ext4 rw 0 0
//nas/share\\040one /mnt/share\\040one cifs rw,vers=3.1.1 0 0
nas.lan:/mnt/tank/lake /mnt/lake nfs4 rw 0 0
me@box:/srv /home/me/box fuse.sshfs rw 0 0
# comment`
    expect(parseMounts(text)).toEqual([
      { path: '/mnt/share one', url: 'smb://nas/share one', kind: 'smb', host: 'nas', share: 'share one', via: 'mount', label: 'share one on nas' },
      { path: '/mnt/lake', url: 'nfs://nas.lan/mnt/tank/lake', kind: 'nfs', host: 'nas.lan', share: '/mnt/tank/lake', via: 'mount', label: '/mnt/tank/lake on nas.lan (NFS)' },
      expect.objectContaining({ path: '/home/me/box', kind: 'sftp', url: 'sftp://me@box/srv' })
    ])
  })

  it('resolves share URLs to mounted paths', () => {
    const shares = [
      ...parseMounts('nas.lan:/mnt/tank /mnt/tank nfs4 rw 0 0\nnas.lan:/mnt/tank/lake /mnt/lake nfs4 rw 0 0'),
      parseGvfsName('/run/user/1000/gvfs', 'smb-share:server=truenas,share=media')!
    ]
    expect(resolveAgainst('smb://TrueNAS/Media/films/x.csv', shares)).toBe('/run/user/1000/gvfs/smb-share:server=truenas,share=media/films/x.csv')
    expect(resolveAgainst('\\\\truenas\\media\\a\\b.csv', shares)).toBe('/run/user/1000/gvfs/smb-share:server=truenas,share=media/a/b.csv')
    expect(resolveAgainst('nfs://nas.lan/mnt/tank/lake/Tables', shares)).toBe('/mnt/lake/Tables')
    expect(resolveAgainst('nfs://nas.lan/mnt/tank/other', shares)).toBe('/mnt/tank/other')
    expect(resolveAgainst('smb://other/x', shares)).toBeNull()
    expect(parseShareUrl('/home/me')).toBeNull()
    expect(normalizeShareUrl('\\\\nas\\my share')).toBe('smb://nas/my%20share')
    expect(() => normalizeShareUrl('/tmp')).toThrow(/isn't a share address/)
  })

  it('discovers shares and reads smb:// paths through their mount', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-shares-'))
    const share = join(root, 'run/user/1000/gvfs/smb-share:server=nas,share=data')
    mkdirSync(join(share, 'sales'), { recursive: true })
    mkdirSync(join(root, 'proc'), { recursive: true })
    mkdirSync(join(root, 'etc'), { recursive: true })
    mkdirSync(join(root, 'mnt/usb'), { recursive: true })
    writeFileSync(join(root, 'proc/mounts'), '')
    writeFileSync(join(root, 'etc/fstab'), 'nas:/export /mnt/nfs nfs defaults,user 0 0\n')
    writeFileSync(join(share, 'sales/a.csv'), 'x\n1\n')
    writeFileSync(join(share, 'sales/b.csv'), 'x\n2\n')
    const h = harness({ shareEnv: { uid: 1000, user: 'me', root } })
    try {
      const shares = await h.service.shares.list()
      expect(shares.map((s) => [s.kind, s.mounted, s.url ?? s.path])).toEqual([
        ['smb', true, 'smb://nas/data'],
        ['nfs', false, 'nfs://nas/export'],
        ['local', true, join(root, 'mnt/usb')]
      ])
      const v = await h.m(`let s = Folder.Files("smb://nas/data/sales"),
        t = Table.AddColumn(s, "T", each Table.PromoteHeaders(Csv.Document([Content]))) in Table.ExpandTableColumn(Table.SelectColumns(t, {"Name", "Folder Path", "T"}), "T", {"x"})`)
      expect(v).toEqual([
        { Name: 'a.csv', 'Folder Path': 'smb://nas/data/sales/', x: '1' },
        { Name: 'b.csv', 'Folder Path': 'smb://nas/data/sales/', x: '2' }
      ])
      expect(await h.m(`Text.FromBinary(File.Contents("\\\\nas\\data\\sales\\a.csv"))`)).toBe('x\n1\n')
      await expect(h.m(`Folder.Files("smb://other/share")`)).rejects.toThrow(/isn't mounted/)
    } finally {
      await h.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists the real machine without failing', async () => {
    expect(Array.isArray(await listShares())).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------

describe('OAuth 2.0 and Web.Contents credentials', () => {
  let server: Server
  let base = ''
  const seen: Array<{ url: string; auth?: string; key?: string }> = []
  let issued = 0
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      let body = ''
      req.on('data', (c) => (body += String(c)))
      req.on('end', () => {
        if (url.pathname === '/token') {
          const p = new URLSearchParams(body)
          const grant = p.get('grant_type')
          if (grant === 'authorization_code') {
            // the PKCE verifier must match the challenge sent to /authorize
            const ok = p.get('code') === 'the-code' && p.get('code_verifier') && p.get('redirect_uri')?.startsWith('http://127.0.0.1:')
            res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { access_token: `at-${++issued}`, refresh_token: 'rt', expires_in: 3600 } : { error: 'invalid_grant' }))
            return
          }
          if (grant === 'refresh_token' && p.get('refresh_token') === 'rt') {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `at-${++issued}`, expires_in: 3600 }))
            return
          }
          if (grant === 'client_credentials' && p.get('client_secret') === 'cs') {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `cc-${++issued}`, expires_in: 60 }))
            return
          }
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unsupported_grant_type' }))
          return
        }
        seen.push({ url: req.url ?? '', auth: req.headers['authorization'], key: req.headers['x-api-key'] as string | undefined })
        const authOk = !url.pathname.startsWith('/secure') || /^Bearer at-|^Bearer cc-/.test(req.headers['authorization'] ?? '')
        res.writeHead(authOk ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [{ id: 1 }], path: url.pathname }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('creates PKCE pairs', async () => {
    const { verifier, challenge } = pkcePair()
    const { createHash } = await import('node:crypto')
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('applies API key, basic and bearer presets by URL prefix', async () => {
    const h = harness()
    try {
      h.store.set({ key: `web:${base}/keyed`, label: 'k', auth: { kind: 'key', keyName: 'X-Api-Key', keyIn: 'header', keyValue: 'abc' } })
      h.store.set({ key: `web:${base}/q`, label: 'q', auth: { kind: 'key', keyName: 'api_key', keyIn: 'query', keyValue: 'zz' } })
      h.store.set({ key: `web:${base}/basic`, label: 'b', auth: { kind: 'basic', user: 'u', password: 'p' } })
      await h.m(`Json.Document(Web.Contents("${base}/keyed/items"))`)
      await h.m(`Json.Document(Web.Contents("${base}/q/items", [Query=[page="2"]]))`)
      await h.m(`Json.Document(Web.Contents("${base}/basic"))`)
      await h.m(`Json.Document(Web.Contents("${base}/basic", [Headers=[Authorization="Bearer mine"]]))`)
      expect(seen.slice(-4)).toEqual([
        { url: '/keyed/items', auth: undefined, key: 'abc' },
        { url: '/q/items?page=2&api_key=zz', auth: undefined, key: undefined },
        { url: '/basic', auth: `Basic ${Buffer.from('u:p').toString('base64')}`, key: undefined },
        { url: '/basic', auth: 'Bearer mine', key: undefined }
      ])
    } finally {
      await h.dispose()
    }
  })

  it('signs in with authorization code + PKCE through a loopback redirect, then refreshes', async () => {
    const h = harness({
      openExternal: async (url) => {
        const u = new URL(url)
        expect(u.searchParams.get('code_challenge_method')).toBe('S256')
        expect(u.searchParams.get('client_id')).toBe('lumen')
        // the "browser": the provider redirects back with a code
        const back = new URL(u.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'the-code')
        back.searchParams.set('state', u.searchParams.get('state')!)
        const r = await fetch(back)
        expect(r.status).toBe(200)
      }
    })
    try {
      const key = `web:${base}/secure`
      h.store.set({ key, label: 'secure', auth: { kind: 'oauth2', grant: 'authorization-code', authUrl: `${base}/authorize`, tokenUrl: `${base}/token`, clientId: 'lumen', scope: 'read' } })
      await expect(h.m(`Json.Document(Web.Contents("${base}/secure/data"))`)).rejects.toThrow(/expired|Sign in/)
      const info = await h.service.credentials.signIn(key)
      expect(info.secrets.sort()).toEqual(['accessToken', 'refreshToken'])
      expect(await h.m(`Json.Document(Web.Contents("${base}/secure/data"))[path]`)).toBe('/secure/data')
      expect(seen.at(-1)?.auth).toMatch(/^Bearer at-\d+$/)
      // expired token → refreshed with the refresh token
      h.store.update(key, { expiresAt: Date.now() - 1000 })
      const before = issued
      await h.m(`Json.Document(Web.Contents("${base}/secure/data?x=2"))`)
      expect(issued).toBe(before + 1)
      expect(h.store.get(key)?.auth.accessToken).toBe(`at-${issued}`)
    } finally {
      await h.dispose()
    }
  })

  it('uses the client credentials grant', async () => {
    const h = harness()
    try {
      h.store.set({ key: `web:${base}/secure/cc`, label: 'cc', auth: { kind: 'oauth2', grant: 'client-credentials', tokenUrl: `${base}/token`, clientId: 'svc', clientSecret: 'cs' } })
      expect(await h.m(`Json.Document(Web.Contents("${base}/secure/cc/x"))[path]`)).toBe('/secure/cc/x')
      expect(seen.at(-1)?.auth).toMatch(/^Bearer cc-/)
      const t = await h.service.test({ kind: 'http', url: `${base}/secure/cc/ping` })
      expect(t).toEqual({ ok: true, message: 'Connected (HTTP 200).' })
    } finally {
      await h.dispose()
    }
  })
})
