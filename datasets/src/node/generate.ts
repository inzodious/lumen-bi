/**
 * Node orchestrator: streams a universe's batches into a Fabric-style lakehouse folder
 * (Files/bronze + Delta Tables), optional CSV exports, the PBIP semantic model + starter report,
 * and the README. Partitioned tables are flushed batch by batch, so memory stays bounded at
 * `large` scale; non-partitioned tables are buffered and written once.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { TableData } from '../../../src/core/model/data.ts'
import { renderUniverseReadme } from '../core/readme.ts'
import { allTables, concatTables, makeContext, rowsToTable, runUniverse } from '../core/runner.ts'
import type { RunOptions } from '../core/runner.ts'
import type { TableSpec, Universe } from '../core/schema.ts'
import { buildSemanticModel } from '../core/semantic/model.ts'
import { pbipFile, reportFiles, semanticModelFiles } from '../core/semantic/pbip.ts'
import { DeltaTableWriter } from './delta.ts'
import { bronzeBytes, tableCsv } from './formats.ts'

export type OutputFormat = 'delta' | 'csv'

/** Max rows buffered across all partitioned Delta tables before everything is flushed. */
const GLOBAL_BUFFER_ROWS = 800_000

export interface GenerateOptions extends RunOptions {
  outDir: string
  formats: OutputFormat[]
  log?: (msg: string) => void
}

export interface GenerateResult {
  id: string
  dir: string
  ms: number
  rows: Map<string, number>
  bytes: Map<string, number>
  bronze: Map<string, { files: number; rows: number }>
  issues: Map<string, number>
  totalBytes: number
  fileCount: number
}

function writeText(path: string, content: string | Uint8Array): number {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return typeof content === 'string' ? Buffer.byteLength(content) : content.length
}

export function loadBaseTheme(): unknown {
  const url = new URL('../../../src/core/report/themes/CY24SU10.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8'))
}

export function lakehouseDir(outDir: string, u: Universe): string {
  return join(resolve(outDir), u.id, `${u.name}.Lakehouse`)
}

export async function generateUniverse(u: Universe, o: GenerateOptions): Promise<GenerateResult> {
  const t0 = performance.now()
  const dir = join(resolve(o.outDir), u.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const lake = join(dir, `${u.name}.Lakehouse`)
  const specs = allTables(u)
  const specByName = new Map(specs.map((s) => [s.name, s]))
  const wantDelta = o.formats.includes('delta')
  const wantCsv = o.formats.includes('csv')
  const timestamp = o.today.getTime() + 23 * 3_600_000
  let totalBytes = 0
  let fileCount = 0

  const writers = new Map<string, DeltaTableWriter>()
  for (const s of specs) writers.set(s.name, new DeltaTableWriter(s, join(lake, 'Tables', s.name), timestamp))
  const buffered = new Map<string, TableData[]>()
  const csvStarted = new Set<string>()
  const rows = new Map<string, number>()
  const bronze = new Map<string, { files: number; rows: number }>()
  const issues = new Map<string, number>()

  const emitCsv = (spec: TableSpec, t: TableData) => {
    if (!wantCsv) return
    const path = join(dir, 'csv', `${spec.name}.csv`)
    const header = !csvStarted.has(spec.name)
    if (header) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '')
      csvStarted.add(spec.name)
      fileCount++
    }
    const text = tableCsv(t, spec.columns.map((c) => c.kind), header)
    appendFileSync(path, text)
    totalBytes += Buffer.byteLength(text)
  }

  for (const batch of runUniverse(u, o, issues)) {
    for (const [name, t] of batch.tables) {
      const spec = specByName.get(name)!
      rows.set(name, (rows.get(name) ?? 0) + t.rowCount)
      emitCsv(spec, t)
      if (!wantDelta) continue
      if (spec.partitionByYearOf) writers.get(name)!.append(t)
      else {
        let list = buffered.get(name)
        if (!list) buffered.set(name, (list = []))
        list.push(t)
      }
    }
    for (const f of batch.bronze) {
      totalBytes += writeText(join(lake, 'Files', 'bronze', f.path), bronzeBytes(f))
      fileCount++
      const b = bronze.get(f.source) ?? { files: 0, rows: 0 }
      b.files++
      b.rows += f.rows.length
      bronze.set(f.source, b)
    }
    // global memory budget across all partitioned tables
    let pendingRows = 0
    for (const w of writers.values()) pendingRows += w.bufferedRows
    if (pendingRows > GLOBAL_BUFFER_ROWS) for (const w of writers.values()) w.flushAll()
    o.log?.(`  ${u.id}: batch ${batch.label}`)
  }

  const bytes = new Map<string, number>()
  const partitionFiles = new Map<string, string[]>()
  for (const spec of specs) {
    if (!rows.has(spec.name)) rows.set(spec.name, 0)
    if (wantCsv && !csvStarted.has(spec.name)) emitCsv(spec, rowsToTable(spec, []))
    if (!wantDelta) continue
    const w = writers.get(spec.name)!
    const parts = buffered.get(spec.name)
    if (parts?.length) w.append(concatTables(spec, parts))
    buffered.delete(spec.name)
    w.commit(() => rowsToTable(spec, []))
    bytes.set(spec.name, w.bytes)
    totalBytes += w.bytes
    fileCount += w.files.length + 1
    partitionFiles.set(spec.name, w.files)
  }

  // Semantic model, report, pbip
  const model = buildSemanticModel(u, { lakehousePath: lake, partitionFiles })
  for (const [p, text] of Object.entries(semanticModelFiles(u, model))) {
    totalBytes += writeText(join(dir, `${u.name}.SemanticModel`, p), text)
    fileCount++
  }
  for (const [p, text] of Object.entries(reportFiles(u, u.report, loadBaseTheme()))) {
    totalBytes += writeText(join(dir, `${u.name}.Report`, p), text)
    fileCount++
  }
  totalBytes += writeText(join(dir, `${u.name}.pbip`), pbipFile(u))
  writeText(join(dir, '.gitignore'), '**/.pbi/localSettings.json\n**/.pbi/cache.abf\n')

  const ctx = makeContext(u, o, new Map())
  const readme = renderUniverseReadme(u, specs, {
    scale: o.scale,
    seed: o.seed,
    today: o.today,
    start: ctx.start,
    rows,
    bytes,
    bronze,
    issues,
    model,
    rootLink: '../../README.md'
  })
  totalBytes += writeText(join(dir, 'README.md'), readme)
  fileCount += 3
  return { id: u.id, dir, ms: performance.now() - t0, rows, bytes, bronze, issues, totalBytes, fileCount }
}

/** Render the README for docs/ (committed copy) from a finished generation. */
export function readmeForDocs(u: Universe, o: RunOptions, r: GenerateResult): string {
  const ctx = makeContext(u, o, new Map())
  const model = buildSemanticModel(u, {})
  return renderUniverseReadme(u, allTables(u), {
    scale: o.scale,
    seed: o.seed,
    today: o.today,
    start: ctx.start,
    rows: r.rows,
    bytes: r.bytes,
    bronze: r.bronze,
    issues: r.issues,
    model,
    rootLink: '../README.md'
  })
}
