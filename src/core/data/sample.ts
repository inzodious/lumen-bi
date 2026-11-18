/**
 * Built-in sample project ("Sample - Sales"): a small but complete star-schema model with
 * generated data, ~18 measures and a three-page PBIR report. Used by the start screen's
 * "Try a sample" and by headless captures (`#/?sample=1`).
 *
 * Deterministic: every call returns an identical project (seeded data, stable object names and
 * lineage tags). Pure TS — no DOM/Node APIs — so it can run in a worker.
 *
 *   sample-data.ts    row generator (seasonality, growth, skewed popularity, promotions)
 *   sample-model.ts   SemanticModel: tables, relationships, hierarchies, measures, M partitions
 *   sample-report.ts  PBIR report: Overview / Products / Customers & Regions
 */
import type { ProjectDocument } from '../project'
import { emptyDataStore, type DataStore } from '../model/data'
import { generateSampleRows, type SampleTableRows } from './sample-data'
import { buildSampleModel, MEASURE_TABLE, MEASURE_TABLE_ROWS, SAMPLE_TABLE_ORDER } from './sample-model'
import { buildSampleReport } from './sample-report'
import { stableUuid } from './sample-random'

export { SAMPLE_ANNOTATION, SAMPLE_MEASURES } from './sample-model'

function toTableData(t: SampleTableRows) {
  return {
    columns: t.columns.map((c, i) => ({ name: c.name, type: c.type, values: t.rows.map((r) => r[i] ?? null) })),
    rowCount: t.rows.length
  }
}

export function createSampleProject(): ProjectDocument {
  const rows = generateSampleRows()
  const model = buildSampleModel(rows)

  const data: DataStore = emptyDataStore()
  const at = '2025-12-31T00:00:00.000Z'
  for (const name of SAMPLE_TABLE_ORDER) {
    const t = toTableData(rows[name])
    data.tables.set(name, t)
    data.status.set(name, { state: 'loaded', source: 'import', at, rowCount: t.rowCount })
  }
  data.tables.set(MEASURE_TABLE, toTableData(MEASURE_TABLE_ROWS))
  data.status.set(MEASURE_TABLE, { state: 'loaded', source: 'import', at, rowCount: 0 })

  return {
    id: `sample-${stableUuid('sample-project')}`,
    name: 'Sample - Sales',
    source: { kind: 'new' },
    model,
    data,
    report: buildSampleReport(),
    diagnostics: [],
    dirty: false
  }
}
