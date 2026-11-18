/**
 * Sweep regression (engine level, no Electron): opens each Microsoft public sample PBIX (real data),
 * probes every visual of every page (field wells → engine query under the saved filter context) and
 * checks there are no engine errors, plus card values against the values Microsoft publishes for
 * these samples (see docs/SWEEP.md "Accuracy oracle").
 *
 * LUMEN_SAMPLES_DIR=/path/to/pbix-samples npx vitest run src/renderer/src/app/sweep
 * LUMEN_SWEEP_DUMP=/abs/dir also writes one probe JSON per sample (for triage). Skipped when unset.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openProject } from '@core/io/open'
import { nodeFs } from '@core/io/nodefs'
import { createEngine } from '@core/engine/engine'
import { generateSyntheticData } from '@core/data/synthetic'
import { CARD_TYPES, probeReport, type VisualProbe } from '../probe'

const DIR = process.env.LUMEN_SAMPLES_DIR ?? ''
const DUMP = process.env.LUMEN_SWEEP_DUMP ?? ''
const TRACE = !!process.env.LUMEN_SWEEP_TRACE
const files = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pbix$/i.test(f)).sort() : []

/**
 * Published values ("Take a tour of the … sample" pages on Microsoft Learn, and their screenshots):
 * card visual (page display name + `Table.Measure`) → value, compared after rounding to the published
 * precision.
 */
interface CardOracle {
  page: string
  field: string
  value: number
  /** absolute tolerance (half a unit of the published precision) */
  tol: number
  /** the value is read off a chart (no card shows it): any visual's grand total of the field counts */
  anyVisual?: boolean
}
const ORACLE: Record<string, CardOracle[]> = {
  // learn.microsoft.com/power-bi/create-reports/sample-store-sales: "This Year Sales $22.05M"
  'Store Sales.pbix': [{ page: 'Store Sales Overview', field: 'Sales.This Year Sales', value: 22.05e6, tol: 0.005e6 }],
  // sample-retail-analysis: "a total of 104 stores, 10 of which are new"
  'Retail Analysis Sample PBIX.pbix': [
    { page: 'Overview', field: 'Store.Total Stores', value: 104, tol: 0 },
    { page: 'Overview', field: 'Store.New Stores', value: 10, tol: 0 }
  ],
  // sample-customer-profitability: "gross margin is 42.5%", "80 customers", "five different products";
  // Team Scorecard screenshot: 83 customers, 7 products, 42.5%
  'Customer Profitability Sample PBIX.pbix': [
    { page: 'Industry Margin Analysis', field: 'Fact.# of Customers', value: 80, tol: 0 },
    { page: 'Industry Margin Analysis', field: 'Fact.# of Products', value: 5, tol: 0 },
    { page: 'Industry Margin Analysis', field: 'Fact.GM%', value: 0.425, tol: 0.0005 },
    { page: 'Team Scorecard', field: 'Fact.# of Customers', value: 83, tol: 0 },
    { page: 'Team Scorecard', field: 'Fact.# of Products', value: 7, tol: 0 }
  ],
  // sample-supplier-quality: "33 million defective pieces, causing a total downtime of 77,000 minutes"
  'Supplier-Quality-Analysis-Sample-PBIX.pbix': [
    { page: 'Downtime Analysis', field: 'Metrics.Total Defect Qty', value: 33e6, tol: 0.5e6 },
    { page: 'Downtime Analysis', field: 'Metrics.Total Downtime Minutes', value: 77000, tol: 500 }
  ],
  // sample-procurement, Discount Analysis screenshot: "4.23 % Discount %", "$4,068,848 Discount Savings"
  'Procurement Analysis Sample PBIX.pbix': [
    { page: 'Discount Analysis', field: 'Invoice.Discount %', value: 0.0423, tol: 0.00005, anyVisual: true },
    { page: 'Discount Analysis', field: 'Invoice Line Item.Discount Savings', value: 4068848, tol: 0.5, anyVisual: true }
  ]
}

function checkOracle(file: string, probes: VisualProbe[]): string[] {
  const bad: string[] = []
  for (const c of ORACLE[file] ?? []) {
    const hits = probes.filter((p) => p.pageDisplayName === c.page && (c.anyVisual || CARD_TYPES.has(p.visualType)) && p.totals?.some((t) => t.ref === c.field))
    if (!hits.length) {
      bad.push(`${c.page} / ${c.field}: no card`)
      continue
    }
    for (const h of hits) {
      const v = h.totals!.find((t) => t.ref === c.field)!.value
      if (typeof v !== 'number' || Math.abs(v - c.value) > c.tol) bad.push(`${c.page} / ${c.field}: ${String(v)} ≠ ${c.value}`)
    }
  }
  return bad
}

describe.skipIf(files.length === 0)('sweep: Microsoft sample PBIX files (engine level)', () => {
  for (const file of files) {
    it(`${file}: every visual query runs without engine errors`, async () => {
      const doc = await openProject(join(DIR, file), nodeFs)
      const engine = createEngine(doc.model, doc.data)
      const calc = engine.processCalculated()
      const probes: VisualProbe[] = doc.report ? probeReport(engine, doc.report, TRACE ? { onVisual: (p, v) => process.stderr.write(`[probe] ${file} / ${p.json?.displayName ?? p.name} / ${v.json?.visual?.visualType} ${v.name}\n`) } : {}) : []
      if (DUMP) writeFileSync(join(DUMP, file.replace(/\.pbix$/i, '.probe.json')), JSON.stringify({ file, calc, diagnostics: doc.diagnostics, probes }, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1))
      // Q&A visuals re-interpret their question at run time; their saved fields can be stale (Regional Sales)
      const errors = probes.filter((p) => p.error && p.visualType !== 'qnaVisual').map((p) => `${p.pageDisplayName} / ${p.visualType} ${p.title ?? p.visual}: ${p.error}`)
      expect(errors).toEqual([])
      expect(checkOracle(file, probes)).toEqual([])
    })
  }
})

/**
 * PBIP corpus without data (LUMEN_CORPUS_DIR): synthetic sample data + engine probe. Asserts only generic
 * properties (never names): every report opens, synthetic data fills the model, and the share of data-bound
 * visuals whose query fails or returns nothing stays small. LUMEN_SWEEP_DUMP writes C01.. probe files.
 */
const CORPUS = process.env.LUMEN_CORPUS_DIR ?? ''

function findReports(dir: string, depth = 4): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const p = join(dir, e.name)
    if (/\.Report$/.test(e.name)) out.push(p)
    else if (depth > 0) out.push(...findReports(p, depth - 1))
  }
  return out.sort()
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('sweep: PBIP corpus with synthetic data (engine level)', () => {
  const reports = CORPUS && existsSync(CORPUS) ? findReports(CORPUS) : []
  reports.forEach((path, i) => {
    const label = `C${String(i + 1).padStart(2, '0')}`
    it(`${label}: opens, synthetic data fills the model, visuals return data`, async () => {
      const doc = await openProject(path, nodeFs)
      // same order as the app: the store builds an engine (deriving calculated tables from no data) on open,
      // then "Use sample data" generates rows and the engine is rebuilt
      createEngine(doc.model, doc.data).processCalculated()
      // like the sweep (app/sweep/sweep.ts): names / ids that filters and formulas mention are reused, so visuals
      // pinned to them return data — the app's default withholds them, which empties those visuals by design
      generateSyntheticData(doc, { onlyEmpty: true, identifyingLiterals: 'reuse' })
      const engine = createEngine(doc.model, doc.data)
      const calc = engine.processCalculated()
      const probes = doc.report ? probeReport(engine, doc.report, TRACE ? { onVisual: (p, v) => process.stderr.write(`[probe] ${label} / ${p.name} / ${v.json?.visual?.visualType} ${v.name}\n`) } : {}) : []
      const bound = probes.filter((p) => !p.hidden && (p.groups.length || p.values.length))
      const failed = bound.filter((p) => p.error)
      const empty = bound.filter((p) => !p.error && (p.rows === 0 || (p.totals?.length && p.totals.every((t) => t.value === null))))
      if (DUMP) writeFileSync(join(DUMP, `${label}.probe.json`), JSON.stringify({ label, calc, diagnostics: doc.diagnostics, probes }, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1))
      expect(doc.model.tables.length).toBeGreaterThan(0)
      expect(failed.length + empty.length).toBeLessThanOrEqual(Math.ceil(bound.length * 0.25))
    }, 300_000) // large reports probe hundreds of visuals (some matrices take seconds each)
  })
})
