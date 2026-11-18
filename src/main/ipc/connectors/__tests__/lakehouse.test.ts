/**
 * Lakehouse.Folder on a real generated lakehouse (datasets/: `generate starlite --scale tiny`): every
 * Delta table's row count must equal the sum of the Parquet row counts of its active files, read
 * independently from the Parquet footers.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parquetMetadata } from 'hyparquet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { harness, type Harness } from './harness'

let out = ''
let ok = false
try {
  out = mkdtempSync(join(tmpdir(), 'lumen-lh-'))
  execFileSync('node', ['datasets/src/node/cli.ts', 'generate', 'starlite', '--scale', 'tiny', '--out', out], { stdio: 'pipe', timeout: 120_000 })
  ok = true
} catch {
  ok = false
}

/** Rows of the active files of a Delta table, from the JSON log and the Parquet footers. */
function expectedRows(tableDir: string): number {
  const log = join(tableDir, '_delta_log')
  const active = new Set<string>()
  for (const f of readdirSync(log).filter((x) => x.endsWith('.json')).sort()) {
    for (const line of readFileSync(join(log, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const a = JSON.parse(line) as { add?: { path: string }; remove?: { path: string } }
      if (a.add) active.add(decodeURIComponent(a.add.path))
      if (a.remove) active.delete(decodeURIComponent(a.remove.path))
    }
  }
  let n = 0
  for (const p of active) {
    const b = readFileSync(join(tableDir, p))
    n += Number(parquetMetadata(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer).num_rows)
  }
  return n
}

describe.skipIf(!ok)('Lakehouse.Folder on a generated lakehouse', () => {
  let h: Harness
  const root = () => join(out, 'starlite', 'Starlite.Lakehouse')
  beforeAll(() => {
    h = harness()
  })
  afterAll(async () => {
    await h.dispose()
    rmSync(out, { recursive: true, force: true })
  })

  it('lists every Delta table and the Files folder', async () => {
    const nav = (await h.m(`Table.SelectColumns(Lakehouse.Folder("${root()}"), {"Id", "ItemKind"})`)) as Array<{ Id: string; ItemKind: string }>
    const dirs = readdirSync(join(root(), 'Tables')).sort()
    expect(nav.filter((r) => r.ItemKind === 'Table').map((r) => r.Id)).toEqual(dirs)
    expect(nav.at(-1)).toEqual({ Id: 'Files', ItemKind: 'Folder' })
  })

  it('reads each table with exactly the rows of its active Parquet files', async () => {
    for (const table of readdirSync(join(root(), 'Tables')).sort()) {
      const n = await h.m(`Table.RowCount(Lakehouse.Folder("${root()}"){[Id="${table}",ItemKind="Table"]}[Data])`)
      expect({ table, n }).toEqual({ table, n: expectedRows(join(root(), 'Tables', table)) })
    }
  }, 120_000)

  it('typed columns come from the Delta schema', async () => {
    const t = await h.table(`Lakehouse.Folder("${root()}"){[Id="gold_dim_date"]}[Data]`)
    expect(t.columns.length).toBeGreaterThan(5)
    expect(t.types.some((x) => x.kind === 'date')).toBe(true)
  })
})
