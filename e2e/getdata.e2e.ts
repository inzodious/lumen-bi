/**
 * Get data: generated mock lakehouse (Delta tables) → Lakehouse folder connector → Navigator → Load; the DuckDB
 * connector on the same lakehouse folder and on a .duckdb file (created here with DuckDB-WASM).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { ROOT, OUT_DIR, useLumen, lumenEval } from './harness'

const require = createRequire(import.meta.url)

/** A DuckDB database file written with DuckDB-WASM (Node build). */
async function createDuckDb(file: string, sql: string[]): Promise<void> {
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
  for (const q of sql) c.query(q)
  c.query('CHECKPOINT fixture')
  c.query('USE memory')
  c.query('DETACH fixture')
  c.close()
  b.reset()
}

/** Navigator: tick `label`, wait for its preview to contain `preview`, Load, and wait for rows in the model. */
async function loadFromNavigator(page: Page, label: RegExp, preview: RegExp, table: string): Promise<void> {
  const nav = page.getByRole('dialog', { name: 'Navigator' })
  const item = nav.getByRole('treeitem').filter({ hasText: label })
  await item.waitFor()
  await item.locator('input[type="checkbox"], [role="checkbox"]').first().click()
  await item.click()
  await expect.poll(() => nav.locator('.wbi-nav__preview').innerText()).toMatch(preview)
  await nav.getByRole('button', { name: 'Load', exact: true }).click()
  await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project?.model.tables.map((t) => t.name) ?? [])).toContain(table)
  await expect.poll(() => lumenEval(page, (l, t) => l.useApp.getState().project!.data.tables.get(t)?.rowCount ?? 0, table), { timeout: 30_000 }).toBeGreaterThan(0)
}

async function openConnector(page: Page, search: string, option: RegExp): Promise<void> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'Get data', exact: true }).click()
  const gd = page.getByRole('dialog', { name: /^Get data$/i })
  await gd.locator('.wbi-gd-search input').fill(search)
  await gd.getByRole('option', { name: option }).click()
  await gd.getByRole('button', { name: 'Connect', exact: true }).click()
}

describe('get data', () => {
  const lumen = useLumen({ route: { start: '1' } })
  let lakehouse = ''
  beforeAll(() => {
    const out = mkdtempSync(join(OUT_DIR, 'lakehouse-'))
    execFileSync(process.execPath, [join(ROOT, 'datasets/src/node/cli.ts'), 'generate', 'starlite', '--scale', 'tiny', '--out', out], { cwd: ROOT, stdio: 'pipe' })
    lakehouse = join(out, 'starlite', 'Starlite.Lakehouse')
  }, 120_000)

  it('loads a Delta table from a lakehouse folder into a blank report', async () => {
    const { page } = lumen()
    await page.getByRole('dialog', { name: /Welcome to Lumen/ }).getByRole('button', { name: /Blank report/ }).click()
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'Get data', exact: true }).click()
    const gd = page.getByRole('dialog', { name: /^Get data$/i })
    await gd.locator('.wbi-gd-search input').fill('lakehouse')
    await gd.getByRole('option', { name: /Lakehouse folder \(Delta\)/ }).click()
    await gd.getByRole('button', { name: 'Connect', exact: true }).click()
    const conn = page.getByRole('dialog', { name: /Lakehouse folder/ })
    await conn.getByLabel('Folder').fill(lakehouse)
    await conn.getByRole('button', { name: 'OK', exact: true }).click()
    const nav = page.getByRole('dialog', { name: 'Navigator' })
    const item = nav.getByRole('treeitem').filter({ hasText: /^gold_dim_store$/ })
    await item.waitFor()
    await item.locator('input[type="checkbox"], [role="checkbox"]').first().click()
    // preview of the focused table
    await item.click()
    await expect.poll(() => nav.locator('.wbi-nav__preview').innerText()).toMatch(/store/i)
    await nav.getByRole('button', { name: 'Load', exact: true }).click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project?.model.tables.map((t) => t.name) ?? [])).toContain('gold_dim_store')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.data.tables.get('gold_dim_store')?.rowCount ?? 0), { timeout: 30_000 }).toBeGreaterThan(0)
    // the M uses the lakehouse/Delta connector and the Data pane lists the table
    const m = await lumenEval(page, (l) => l.useApp.getState().project!.model.tables.find((t) => t.name === 'gold_dim_store')!.partitions[0]?.expression ?? '')
    expect(m).toMatch(/Delta|Lakehouse|Parquet/i)
    await expect.poll(() => page.locator('.wbi-dtree .wbi-dtree__name', { hasText: /^gold_dim_store$/ }).count()).toBe(1)
    await expect.poll(() => page.locator('.wbi-modal').count()).toBe(0)
  })

  it('DuckDB: a lakehouse folder lists its Delta tables as views and loads one', async () => {
    const { page } = lumen()
    await openConnector(page, 'duckdb', /DuckDB database/)
    const conn = page.getByRole('dialog', { name: /DuckDB database/ })
    await conn.getByRole('radio', { name: /Lakehouse folder/ }).click()
    await conn.getByLabel('Folder').fill(lakehouse)
    await conn.getByRole('button', { name: 'OK', exact: true }).click()
    const nav = page.getByRole('dialog', { name: 'Navigator' })
    await nav.getByRole('treeitem').filter({ hasText: /gold_fact_sales_line$/ }).waitFor()
    expect(await nav.getByRole('treeitem').count()).toBeGreaterThanOrEqual(25)
    await loadFromNavigator(page, /gold_dim_product$/, /product/i, 'gold_dim_product')
    const m = await lumenEval(page, (l) => l.useApp.getState().project!.model.tables.find((t) => t.name === 'gold_dim_product')!.partitions[0]?.expression ?? '')
    expect(m).toMatch(/DuckDB\.Database\(/)
  })

  it('DuckDB: a .duckdb file lists tables and views of every schema and loads one', async () => {
    const { page } = lumen()
    const file = join(mkdtempSync(join(OUT_DIR, 'duck-')), 'shop.duckdb')
    await createDuckDb(file, [
      'CREATE TABLE orders (id INTEGER, region VARCHAR, amount DECIMAL(10, 2), placed DATE)',
      "INSERT INTO orders VALUES (1, 'North', 10.5, DATE '2024-01-02'), (2, 'South', 20.25, DATE '2024-02-03'), (3, 'North', 7, NULL)",
      'CREATE SCHEMA sales',
      'CREATE VIEW sales.by_region AS SELECT region, SUM(amount) AS total FROM main.orders GROUP BY region'
    ])
    await openConnector(page, 'duckdb', /DuckDB database/)
    const conn = page.getByRole('dialog', { name: /DuckDB database/ })
    await conn.getByLabel('File').fill(file)
    await conn.getByRole('button', { name: 'OK', exact: true }).click()
    const nav = page.getByRole('dialog', { name: 'Navigator' })
    await nav.getByRole('treeitem').filter({ hasText: /by_region$/ }).waitFor()
    await loadFromNavigator(page, /main\.orders$/, /North/, 'orders')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.data.tables.get('orders')?.rowCount ?? 0)).toBe(3)
    await expect.poll(() => page.locator('.wbi-modal').count()).toBe(0)
  })
})
