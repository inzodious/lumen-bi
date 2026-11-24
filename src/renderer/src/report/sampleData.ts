/**
 * Sample data on empty visuals (core/sample/spec.ts): decides whether a visual draws a sample, builds the engines the
 * samples query (the report's sample dataset and the generic one) and the host context a sample draws with.
 *
 * A sample is drawn in isolation: no report, page or slicer filter reaches it, it selects nothing and it never writes
 * to visual.json (a sort clicked in a sample table header is not kept), so nothing about it can leak into the report.
 */
import type { QueryEngine } from '@core/engine/api'
import { createEngine } from '@core/engine/engine'
import { decodeLiteral } from '@core/report/literal'
import { parseSampleDataset, sampleDatasetModel, SAMPLE_DATA_FILE } from '@core/sample/dataset'
import { genericSampleDataset, genericSampleQuery } from '@core/sample/generic'
import { referencedEntities, reportSampleDataOn, visualHasFields, visualSampleSpec, withSampleQuery } from '@core/sample/spec'
import type { VisualDefinition, VisualHostContext } from '../visuals/contract'
import { cachedEngine } from './cachedEngine'

export type SampleSource = 'report' | 'generic'

export interface SampleDraw {
  json: any
  engine: QueryEngine
  source: SampleSource
}

let genericEngine: QueryEngine | undefined
const reportEngines = new Map<string, QueryEngine | null>()

function engineOf(model: Parameters<typeof createEngine>[0], data: Parameters<typeof createEngine>[1]): QueryEngine {
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}

export function genericSampleEngine(): QueryEngine {
  if (!genericEngine) {
    const { model, data } = sampleDatasetModel(genericSampleDataset())
    genericEngine = engineOf(model, data)
  }
  return genericEngine
}

/** The engine of a report's sample dataset (`sampleData.lumen.json`), or null when it has none or it can't be read. */
export function reportSampleEngine(sidecarText: string | undefined): QueryEngine | null {
  if (!sidecarText) return null
  if (reportEngines.has(sidecarText)) return reportEngines.get(sidecarText)!
  let engine: QueryEngine | null = null
  const ds = parseSampleDataset(sidecarText)
  if (ds) {
    try {
      const { model, data } = sampleDatasetModel(ds)
      engine = engineOf(model, data)
    } catch {
      engine = null
    }
  }
  if (reportEngines.size > 4) reportEngines.delete(reportEngines.keys().next().value as string)
  reportEngines.set(sidecarText, engine)
  return engine
}

export function sampleDatasetText(sidecarFiles: Record<string, string> | undefined): string | undefined {
  return sidecarFiles?.[SAMPLE_DATA_FILE]
}

function literalText(prop: any): string {
  const v = prop?.expr?.Literal?.Value
  if (typeof v !== 'string') return ''
  const d = decodeLiteral(v)
  return typeof d === 'string' ? d : ''
}

/** Text that says what a visual is about: its title and subtitle. */
export function sampleHints(visualJson: any): string {
  const vco = visualJson?.visual?.visualContainerObjects ?? {}
  return [literalText(vco.title?.[0]?.properties?.text), literalText(vco.subTitle?.[0]?.properties?.text)].filter(Boolean).join(' ')
}

/** Can this kind of visual show data at all? (not text boxes, shapes, buttons, custom visuals…) */
export function takesSampleData(def: VisualDefinition | undefined): boolean {
  return !!def && def.roles.length > 0 && def.category !== 'element' && def.category !== 'custom'
}

/**
 * Where a visual stands: 'on' draws a sample, 'off' has its sample cleared, null when samples don't apply (the
 * report has them off, the visual has fields of its own, or it takes no data).
 */
export function sampleStatus(visualJson: any, def: VisualDefinition | undefined, reportJson: any): 'on' | 'off' | null {
  if (!reportSampleDataOn(reportJson) || !visualJson?.visual || !takesSampleData(def) || visualHasFields(visualJson)) return null
  return visualSampleSpec(visualJson)?.off ? 'off' : 'on'
}

function resolves(engine: QueryEngine, query: any, objects: any): boolean {
  const tables = new Set(engine.model.tables.map((t) => t.name))
  for (const e of referencedEntities(query)) if (!tables.has(e)) return false
  for (const e of referencedEntities(objects)) if (!tables.has(e)) return false
  for (const role of Object.values<any>(query?.queryState ?? {}))
    for (const p of role?.projections ?? []) if (!engine.describeField(p.field)) return false
  return true
}

/** The sample a visual draws, or null when it draws none. */
export function sampleDrawFor(visualJson: any, def: VisualDefinition | undefined, reportJson: any, sidecarText: string | undefined): SampleDraw | null {
  if (sampleStatus(visualJson, def, reportJson) !== 'on') return null
  const spec = visualSampleSpec(visualJson)
  if (spec?.query) {
    const engine = reportSampleEngine(sidecarText)
    if (engine && resolves(engine, spec.query, spec.objects)) return { json: withSampleQuery(visualJson, spec.query, spec.objects), engine, source: 'report' }
  }
  const query = genericSampleQuery(String(visualJson.visual.visualType ?? ''), def!.roles.map((r) => r.name), sampleHints(visualJson))
  if (!query) return null
  return { json: withSampleQuery(visualJson, query), engine: genericSampleEngine(), source: 'generic' }
}

const NO_IDS: never[] = []
const noop = () => {}

/** The host context a sample draws with: its own engine, no filters, no selection, no writes. */
export function sampleContext(ctx: VisualHostContext, engine: QueryEngine): VisualHostContext {
  const eng = cachedEngine(engine)
  return {
    ...ctx,
    engine: eng,
    format: (v, f, t) => eng.format(v, f, t),
    filters: [],
    highlightFilters: undefined,
    selection: NO_IDS,
    pageSelection: undefined,
    select: noop,
    setSlicerFilter: noop,
    slicerFilter: undefined,
    slicerCleared: false,
    updateVisual: noop
  }
}
