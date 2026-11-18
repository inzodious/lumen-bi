/**
 * In-memory sample for the Lumen app: a universe's semantic model plus its gold tables as a
 * `DataStore` (keyed by model table name; columns keep their snake_case source names, which the
 * engine resolves through `sourceColumn`). Pure TS — safe to run in the renderer or a worker.
 *
 *   const { model, data } = sampleProject(findUniverse('starlite')!, { scale: 'tiny' })
 */
import type { DataStore } from '../../../src/core/model/data.ts'
import type { SemanticModel } from '../../../src/core/model/types.ts'
import { collectUniverse, DEFAULT_TODAY } from './runner.ts'
import type { Collected } from './runner.ts'
import type { ScaleName, Universe } from './schema.ts'
import { buildSemanticModel } from './semantic/model.ts'

export interface SampleOptions {
  scale?: ScaleName
  seed?: number
  today?: Date
}

export interface SampleProject {
  model: SemanticModel
  data: DataStore
  collected: Collected
}

export function sampleProject(u: Universe, o: SampleOptions = {}): SampleProject {
  const collected = collectUniverse(u, { seed: o.seed ?? 42, scale: o.scale ?? 'tiny', today: o.today ?? DEFAULT_TODAY })
  const model = buildSemanticModel(u)
  const data: DataStore = { tables: new Map(), status: new Map() }
  for (const spec of collected.specs) {
    if (spec.layer !== 'gold' || !spec.model) continue
    const t = collected.tables.get(spec.name)!
    data.tables.set(spec.model.name, t)
    data.status.set(spec.model.name, { state: 'loaded', source: 'synthetic', rowCount: t.rowCount })
  }
  return { model, data, collected }
}
