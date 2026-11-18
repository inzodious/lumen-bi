/**
 * On-disk output checks (tiny scale, every universe): Delta logs, Parquet round-trip against the
 * in-memory tables, CSV exports, bronze files (CSV/JSON/NDJSON/XLSX), PBIP/PBIR/TMDL integrity and
 * byte-identical regeneration.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import ExcelJS from 'exceljs'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Scalar } from '../../../src/core/model/data.ts'
import { readTmdlFiles } from '../../../src/core/tmdl/read.ts'
import { openProject } from '../../../src/core/io/open.ts'
import { nodeFs } from '../../../src/core/io/nodefs.ts'
import { collectUniverse, DEFAULT_TODAY } from '../core/runner.ts'
import type { Collected } from '../core/runner.ts'
import type { TableSpec, Universe } from '../core/schema.ts'
import { UNIVERSES } from '../core/universes/index.ts'
import { PARTITION_COLUMN, sparkType } from './delta.ts'
import { generateUniverse } from './generate.ts'
import type { GenerateResult } from './generate.ts'

const OPTS = { seed: 42, scale: 'tiny' as const, today: DEFAULT_TODAY }
const root = mkdtempSync(join(tmpdir(), 'lumen-datasets-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out.sort()
}

function hashTree(dir: string, skip: (rel: string) => boolean): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of walk(dir)) {
    const rel = relative(dir, f)
    if (skip(rel)) continue
    m.set(rel, createHash('sha256').update(readFileSync(f)).digest('hex'))
  }
  return m
}

function arrayBuffer(path: string): ArrayBuffer {
  const b = readFileSync(path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function norm(v: unknown): string {
  if (v === null || v === undefined) return 'N'
  if (typeof v === 'bigint') return `n${Number(v)}`
  if (typeof v === 'number') return `n${Math.round(v * 1e6) / 1e6}`
  if (v instanceof Date) return `d${v.getTime()}`
  return `${typeof v}:${String(v)}`
}

/** Minimal RFC-4180 record splitter (handles quotes and embedded delimiters/newlines). */
function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

describe.each(UNIVERSES.map((u) => [u.id, u] as const))('lakehouse output %s', (_id, u: Universe) => {
  let result: GenerateResult
  let c: Collected
  const out = join(root, 'a')
  let lake: string

  beforeAll(async () => {
    result = await generateUniverse(u, { ...OPTS, outDir: out, formats: ['delta', 'csv'] })
    c = collectUniverse(u, OPTS)
    lake = join(out, u.id, `${u.name}.Lakehouse`)
  }, 120_000)

  it('writes the Fabric lakehouse layout', () => {
    expect(existsSync(join(lake, 'Files', 'bronze'))).toBe(true)
    for (const s of c.specs) expect(existsSync(join(lake, 'Tables', s.name, '_delta_log', '00000000000000000000.json')), s.name).toBe(true)
    for (const p of [`${u.name}.pbip`, `${u.name}.SemanticModel/definition.pbism`, `${u.name}.Report/definition.pbir`, 'README.md']) expect(existsSync(join(out, u.id, p)), p).toBe(true)
  })

  it('writes valid Delta logs whose schema, sizes and stats match the Parquet files', () => {
    for (const spec of c.specs) {
      const dir = join(lake, 'Tables', spec.name)
      const lines = readFileSync(join(dir, '_delta_log', '00000000000000000000.json'), 'utf8').trim().split('\n')
      const actions = lines.map((l) => JSON.parse(l) as Record<string, Record<string, unknown>>)
      expect(Object.keys(actions[0])).toEqual(['commitInfo'])
      expect(actions[1].protocol).toEqual({ minReaderVersion: 1, minWriterVersion: 2 })
      const meta = actions[2].metaData as { schemaString: string; partitionColumns: string[]; format: { provider: string } }
      expect(meta.format.provider).toBe('parquet')
      const schema = JSON.parse(meta.schemaString) as { type: string; fields: Array<{ name: string; type: string; nullable: boolean }> }
      expect(schema.type).toBe('struct')
      const expected = spec.columns.map((col) => [col.name, sparkType(col.kind)])
      if (spec.partitionByYearOf) expected.push([PARTITION_COLUMN, 'integer'])
      expect(schema.fields.map((f) => [f.name, f.type])).toEqual(expected)
      expect(meta.partitionColumns).toEqual(spec.partitionByYearOf ? [PARTITION_COLUMN] : [])
      const adds = actions.slice(3).map((a) => a.add as { path: string; size: number; partitionValues: Record<string, string>; stats: string; dataChange: boolean })
      expect(adds.length).toBeGreaterThan(0)
      let rows = 0
      const onDisk = walk(dir).filter((f) => f.endsWith('.parquet')).map((f) => relative(dir, f))
      expect(adds.map((a) => a.path).sort()).toEqual(onDisk.sort())
      for (const a of adds) {
        const file = join(dir, a.path)
        expect(statSync(file).size, a.path).toBe(a.size)
        const md = parquetMetadata(arrayBuffer(file))
        const stats = JSON.parse(a.stats) as { numRecords: number; nullCount: Record<string, number> }
        expect(Number(md.num_rows)).toBe(stats.numRecords)
        expect(md.schema.slice(1).map((e) => e.name)).toEqual(spec.columns.map((col) => col.name))
        if (spec.partitionByYearOf) expect(a.path.startsWith(`${PARTITION_COLUMN}=${a.partitionValues[PARTITION_COLUMN]}/`)).toBe(true)
        else expect(a.partitionValues).toEqual({})
        rows += stats.numRecords
      }
      expect(rows, spec.name).toBe(c.tables.get(spec.name)!.rowCount)
      expect(result.rows.get(spec.name)).toBe(rows)
    }
  })

  it('round-trips every table through Parquet (hyparquet) exactly', async () => {
    for (const spec of c.specs as TableSpec[]) {
      const dir = join(lake, 'Tables', spec.name)
      const files = walk(dir).filter((f) => f.endsWith('.parquet'))
      const fromDisk: string[] = []
      for (const f of files) {
        const rows = (await parquetReadObjects({ file: arrayBuffer(f) })) as Array<Record<string, unknown>>
        for (const r of rows) fromDisk.push(spec.columns.map((col) => norm(r[col.name])).join('|'))
      }
      const t = c.tables.get(spec.name)!
      const expected: string[] = []
      for (let i = 0; i < t.rowCount; i++) expected.push(t.columns.map((col) => norm(col.values[i] as Scalar)).join('|'))
      expect(fromDisk.sort(), spec.name).toEqual(expected.sort())
    }
  })

  it('exports clean CSVs with headers and every row', () => {
    for (const spec of c.specs) {
      const rows = parseCsv(readFileSync(join(out, u.id, 'csv', `${spec.name}.csv`), 'utf8'))
      expect(rows[0]).toEqual(spec.columns.map((col) => col.name))
      expect(rows.length - 1, spec.name).toBe(c.tables.get(spec.name)!.rowCount)
    }
  })

  it('writes readable bronze files in every declared format', async () => {
    const bronzeDir = join(lake, 'Files', 'bronze')
    for (const f of c.bronze) {
      const path = join(bronzeDir, f.path)
      expect(existsSync(path), f.path).toBe(true)
      if (f.format === 'csv') {
        const recs = parseCsv(readFileSync(path, 'utf8'), f.csv?.delimiter ?? ',')
        expect(recs.length - 1, f.path).toBe(f.rows.length)
      } else if (f.format === 'ndjson') {
        const lines = readFileSync(path, 'utf8').trim().split('\n').filter((l) => l.length)
        expect(lines.length, f.path).toBe(f.rows.length)
        for (const l of lines) JSON.parse(l)
      } else if (f.format === 'json') {
        const j = JSON.parse(readFileSync(path, 'utf8')) as unknown
        const data = Array.isArray(j) ? j : (j as Record<string, unknown>)[f.json?.dataKey ?? 'data']
        expect(Array.isArray(data), f.path).toBe(true)
        expect((data as unknown[]).length).toBe(f.rows.length)
      } else {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(readFileSync(path) as unknown as ArrayBuffer)
        const ws = wb.worksheets[0]
        expect(ws.rowCount, f.path).toBe(f.rows.length + 1 + (f.xlsx?.titleLines?.length ?? 0))
      }
    }
  })

  it('writes a PBIP project whose report and partitions point at real model fields and files', () => {
    const smDir = join(out, u.id, `${u.name}.SemanticModel`)
    const files: Record<string, string> = {}
    for (const f of walk(join(smDir, 'definition'))) files[relative(join(smDir, 'definition'), f)] = readFileSync(f, 'utf8')
    const { model, errors } = readTmdlFiles(files)
    expect(errors).toEqual([])
    for (const t of model.tables) {
      for (const p of t.partitions) {
        if (p.sourceType !== 'm') continue
        const table = /\/Tables\/(\w+)\//.exec(p.expression!)![1]
        const names = [...p.expression!.matchAll(/((?:year=\d+\/)?part-[\w-]+\.snappy\.parquet)/g)].map((m) => m[1])
        expect(names.length, t.name).toBeGreaterThan(0)
        for (const n of names) expect(existsSync(join(lake, 'Tables', table, n)), `${t.name}: ${n}`).toBe(true)
      }
    }
    const lakePath = model.expressions.find((e) => e.name === 'LakehousePath')!.expression
    expect(lakePath).toContain(JSON.stringify(lake).slice(1, -1))
    const pbip = JSON.parse(readFileSync(join(out, u.id, `${u.name}.pbip`), 'utf8')) as { artifacts: Array<{ report: { path: string } }> }
    expect(pbip.artifacts[0].report.path).toBe(`${u.name}.Report`)
    const rep = join(out, u.id, `${u.name}.Report`)
    const pbir = JSON.parse(readFileSync(join(rep, 'definition.pbir'), 'utf8')) as { datasetReference: { byPath: { path: string } } }
    expect(pbir.datasetReference.byPath.path).toBe(`../${u.name}.SemanticModel`)
    const report = JSON.parse(readFileSync(join(rep, 'definition', 'report.json'), 'utf8')) as { themeCollection: { baseTheme: { name: string } } }
    expect(existsSync(join(rep, 'StaticResources', 'SharedResources', 'BaseThemes', `${report.themeCollection.baseTheme.name}.json`))).toBe(true)
    const pages = JSON.parse(readFileSync(join(rep, 'definition', 'pages', 'pages.json'), 'utf8')) as { pageOrder: string[] }
    expect(pages.pageOrder.length).toBe(u.report.length)
    let visuals = 0
    for (const pid of pages.pageOrder) {
      expect(existsSync(join(rep, 'definition', 'pages', pid, 'page.json'))).toBe(true)
      for (const vf of walk(join(rep, 'definition', 'pages', pid, 'visuals'))) {
        visuals++
        const text = readFileSync(vf, 'utf8')
        JSON.parse(text)
        for (const m of text.matchAll(/"Entity": "([^"]+)"\s*}\s*},\s*"Property": "([^"]+)"/g)) {
          const t = model.tables.find((x) => x.name === m[1])
          expect(t, `entity ${m[1]}`).toBeDefined()
          expect(t!.columns.some((col) => col.name === m[2]) || t!.measures.some((x) => x.name === m[2]), `${m[1]}.${m[2]}`).toBe(true)
        }
      }
    }
    expect(visuals).toBe(u.report.reduce((n, p) => n + p.visuals.length, 0))
  })

  it('opens end-to-end in Lumen (openProject on the .pbip)', async () => {
    const doc = await openProject(join(out, u.id, `${u.name}.pbip`), nodeFs)
    expect(doc.source.kind).toBe('pbip')
    expect(doc.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    expect(doc.report).toBeDefined()
    const goldModelTables = c.specs.filter((s) => s.layer === 'gold' && s.model).length
    expect(doc.model.tables.length).toBe(goldModelTables + 2 + (u.fieldParameter ? 1 : 0))
    expect(doc.model.tables.find((t) => t.name === '_Measures')!.measures.length).toBe(u.measures.length)
    expect(doc.model.relationships.length).toBeGreaterThan(5)
    expect(JSON.stringify(doc.report)).toContain(u.report[0].name)
  })

  it('regenerates byte-identical output', async () => {
    const out2 = join(root, 'b')
    await generateUniverse(u, { ...OPTS, outDir: out2, formats: ['delta', 'csv'] })
    // expressions.tmdl holds the absolute LakehousePath, which differs between the two folders
    const skip = (rel: string) => rel.endsWith('expressions.tmdl')
    const a = hashTree(join(out, u.id), skip)
    const b = hashTree(join(out2, u.id), skip)
    expect(a.size).toBeGreaterThan(20)
    expect([...b.keys()]).toEqual([...a.keys()])
    for (const [k, h] of a) expect(b.get(k), k).toBe(h)
  }, 120_000)
})
