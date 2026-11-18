/**
 * Microsoft public sample PBIX files (real data): every measure evaluates without error at grand total, and every
 * visual's query (approximated from its field wells: columns -> group-by, measures/aggregations -> values, with the
 * report/page/visual filters) runs within the performance budget.
 *
 * Location: LUMEN_SAMPLES_DIR (or WBI_PBIX_SAMPLES_DIR), else a sibling `pbix-samples` folder next to the repo. Skipped when absent.
 * WBI_SAMPLES_VERBOSE=1 prints per-visual timings.
 */
import { describe, expect, it } from 'vitest'
import { files, openSample, visualRequests, VERBOSE } from './samples'

// Target is 300 ms per visual (LUMEN_PERF_STRICT=1). In the full parallel suite the CPU is shared, so allow headroom
// there; the strict budget is checked when this file runs alone or with LUMEN_PERF_STRICT set.
const VISUAL_BUDGET_MS = process.env.LUMEN_PERF_STRICT ? 300 : 1000

describe.skipIf(files.length === 0)('Microsoft sample PBIX files', () => {
  for (const file of files) {
    it(`${file}: every measure evaluates at grand total; every visual < ${VISUAL_BUDGET_MS} ms`, async () => {
      const { doc, engine } = await openSample(file)
      const errors: string[] = []
      let measures = 0
      for (const t of doc.model.tables) {
        for (const m of t.measures) {
          measures++
          try {
            engine.evaluateScalar(`[${m.name.replace(/]/g, ']]')}]`)
          } catch (e) {
            errors.push(`${t.name}[${m.name}]: ${(e as Error).message}`)
          }
        }
      }
      if (errors.length) console.log(file, errors)
      expect(errors).toEqual([])
      const reqs = visualRequests(doc)
      const slow: string[] = []
      const warn: string[] = []
      let total = 0
      const missing: string[] = []
      for (const { page, visual, req } of reqs) {
        // a visual bound to a field the model does not have (Power BI shows "fix this" there): not an engine error
        const absent = req.groupBy.find((g) => 'kind' in g && g.kind === 'sq' && !engine.describeField(g.expr))
        if (absent) {
          missing.push(`${page} / ${visual}`)
          continue
        }
        const t0 = performance.now()
        const r = engine.summarize(req)
        const ms = performance.now() - t0
        total += ms
        if (VERBOSE) console.log(`${file} | ${page} | ${visual} | ${ms.toFixed(1)} ms | ${r.rows.length} rows`)
        if (ms > VISUAL_BUDGET_MS) slow.push(`${page} / ${visual}: ${ms.toFixed(0)} ms`)
        for (const w of r.warnings ?? []) warn.push(`${page} / ${visual}: ${w}`)
      }
      if (VERBOSE) console.log(`${file}: ${measures} measures, ${reqs.length} visuals, ${total.toFixed(0)} ms total`)
      if (warn.length) console.log(file, warn.slice(0, 20))
      if (missing.length && VERBOSE) console.log(file, 'visuals with fields missing from the model:', missing)
      expect(slow).toEqual([])
      expect(warn).toEqual([])
    }, 300_000)
  }
})

describe.skipIf(!files.includes('Store Sales.pbix'))('Store Sales.pbix regressions', () => {
  it('bare [Column] inside an aggregator resolves against the measure home table (Sales Per Sq Ft by District)', async () => {
    const { engine } = await openSample('Store Sales.pbix')
    const r = engine.summarize({
      groupBy: [{ table: 'District', column: 'District' }],
      values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales Per Sq Ft' } }]
    })
    expect(r.warnings ?? []).toEqual([])
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.every((row) => typeof row[1] === 'number' && row[1] > 0)).toBe(true)
    // independent check at grand total: TotalSalesTY / (distinct months in Sales * selling area of all stores) * 12
    const ty = engine.evaluateScalar('[TotalSalesTY]').value as number
    const months = engine.evaluateScalar('DISTINCTCOUNT ( Sales[MonthID] )').value as number
    const area = engine.evaluateScalar('SUM ( Store[SellingAreaSize] )').value as number
    const v = engine.evaluateScalar('[Sales Per Sq Ft]').value as number
    expect(v).toBeCloseTo((ty / (months * area)) * 12, 6)
  }, 120_000)
})
