/**
 * PBIP project files: `<Name>.pbip`, `<Name>.SemanticModel/` (definition.pbism, .platform, TMDL) and a
 * starter `<Name>.Report/` (PBIR: definition.pbir, report.json, pages, visual.json) built from the
 * universe's report spec. Returns `{ relativePath: content }` maps; the Node layer writes them.
 * The base theme JSON is supplied by the caller (it lives in src/core/report/themes).
 */
import type { SemanticModel } from '../../../../src/core/model/types.ts'
import { hash32, uuidFrom } from '../prng.ts'
import type { FieldRef, ReportPageSpec, Universe, VisualSpec } from '../schema.ts'
import { MEASURES_TABLE } from './model.ts'
import { modelToTmdlFiles } from './tmdl.ts'

const SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric'
export const BASE_THEME = 'CY24SU10'

function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n'
}

function platform(type: 'SemanticModel' | 'Report', displayName: string, seed: string): string {
  return json({
    $schema: `${SCHEMA}/gitIntegration/platformProperties/2.0.0/schema.json`,
    metadata: { type, displayName },
    config: { version: '2.0', logicalId: uuidFrom(seed) }
  })
}

/** 20-hex-char deterministic PBIR object name. */
export function pbirId(seed: string): string {
  return uuidFrom(seed).replace(/-/g, '').slice(0, 20)
}

export function semanticModelFiles(u: Universe, model: SemanticModel): Record<string, string> {
  const files: Record<string, string> = {
    '.platform': platform('SemanticModel', u.name, `${u.id}/semanticmodel`),
    'definition.pbism': json({
      $schema: `${SCHEMA}/item/semanticModel/definitionProperties/1.0.0/schema.json`,
      version: '4.2',
      settings: {}
    })
  }
  for (const [p, text] of Object.entries(modelToTmdlFiles(model))) files[`definition/${p}`] = text
  return files
}

export function pbipFile(u: Universe): string {
  return json({
    $schema: `${SCHEMA}/pbip/pbipProperties/1.0.0/schema.json`,
    version: '1.0',
    artifacts: [{ report: { path: `${u.name}.Report` } }],
    settings: { enableAutoRecovery: true }
  })
}

// ---------------------------------------------------------------------------------------------
// Visuals

function literal(value: string): unknown {
  return { expr: { Literal: { Value: value } } }
}

function columnField(f: FieldRef): unknown {
  return { Column: { Expression: { SourceRef: { Entity: f.table } }, Property: f.column } }
}

function measureField(name: string): unknown {
  return { Measure: { Expression: { SourceRef: { Entity: MEASURES_TABLE } }, Property: name } }
}

function colProj(f: FieldRef, active = false): Record<string, unknown> {
  const p: Record<string, unknown> = { field: columnField(f), queryRef: `${f.table}.${f.column}`, nativeQueryRef: f.column }
  if (active) p.active = true
  return p
}

function measureProj(name: string): Record<string, unknown> {
  return { field: measureField(name), queryRef: `${MEASURES_TABLE}.${name}`, nativeQueryRef: name }
}

function titleObjects(title: string | undefined): Record<string, unknown> | undefined {
  if (!title) return undefined
  return { title: [{ properties: { show: literal('true'), text: literal(`'${title.replace(/'/g, "''")}'`) } }] }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function visualJson(name: string, v: VisualSpec, box: Box, z: number): unknown {
  let visualType: string
  let queryState: Record<string, unknown>
  let objects: Record<string, unknown> | undefined
  let sort: unknown
  switch (v.type) {
    case 'card':
      visualType = 'card'
      queryState = { Values: { projections: [measureProj(v.measure)] } }
      break
    case 'column':
    case 'bar':
      visualType = v.type === 'column' ? 'clusteredColumnChart' : 'clusteredBarChart'
      queryState = { Category: { projections: [colProj(v.category, true)] }, Y: { projections: v.measures.map(measureProj) } }
      sort = { sort: [{ field: measureField(v.measures[0]), direction: 'Descending' }], isDefaultSort: true }
      objects = { labels: [{ properties: { show: literal('true') } }] }
      break
    case 'line':
      visualType = 'lineChart'
      queryState = { Category: { projections: [colProj(v.category, true)] }, Y: { projections: v.measures.map(measureProj) } }
      sort = { sort: [{ field: columnField(v.category), direction: 'Ascending' }] }
      break
    case 'matrix':
      visualType = 'pivotTable'
      queryState = { Rows: { projections: v.rows.map((r, i) => colProj(r, i === 0)) }, Values: { projections: v.measures.map(measureProj) } }
      if (v.columns?.length) queryState.Columns = { projections: v.columns.map((c, i) => colProj(c, i === 0)) }
      break
    case 'table':
      visualType = 'tableEx'
      queryState = { Values: { projections: [...v.columns.map((c) => colProj(c)), ...v.measures.map(measureProj)] } }
      break
    case 'slicer':
      visualType = 'slicer'
      queryState = { Values: { projections: [colProj(v.field, true)] } }
      objects = { data: [{ properties: { mode: literal(`'${v.mode ?? 'Dropdown'}'`) } }] }
      break
  }
  const visual: Record<string, unknown> = { visualType, query: { queryState } }
  if (sort) (visual.query as Record<string, unknown>).sortDefinition = sort
  if (objects) visual.objects = objects
  const vco = titleObjects(v.title)
  if (vco) visual.visualContainerObjects = vco
  visual.drillFilterOtherVisuals = true
  return {
    $schema: `${SCHEMA}/item/report/definition/visualContainer/2.7.0/schema.json`,
    name,
    position: { x: box.x, y: box.y, z, height: box.height, width: box.width, tabOrder: z },
    visual
  }
}

/**
 * Layout on a 1280×720 page: slicers across the top, then a row of cards, then charts in a
 * two-column grid filling the rest.
 */
export function layoutPage(visuals: VisualSpec[]): Box[] {
  const W = 1280
  const H = 720
  const M = 16
  const boxes: Box[] = new Array(visuals.length)
  let y = M
  const slicers = visuals.map((v, i) => [v, i] as const).filter(([v]) => v.type === 'slicer')
  if (slicers.length) {
    const w = Math.min(260, (W - M * (slicers.length + 1)) / slicers.length)
    slicers.forEach(([, i], k) => (boxes[i] = { x: M + k * (w + M), y, width: w, height: 56 }))
    y += 56 + M
  }
  const cards = visuals.map((v, i) => [v, i] as const).filter(([v]) => v.type === 'card')
  if (cards.length) {
    const w = (W - M * (cards.length + 1)) / cards.length
    cards.forEach(([, i], k) => (boxes[i] = { x: M + k * (w + M), y, width: w, height: 110 }))
    y += 110 + M
  }
  const rest = visuals.map((v, i) => [v, i] as const).filter(([v]) => v.type !== 'card' && v.type !== 'slicer')
  if (rest.length) {
    const rowsN = Math.ceil(rest.length / 2)
    const h = (H - y - M * rowsN) / rowsN
    rest.forEach(([, i], k) => {
      const row = Math.floor(k / 2)
      const lastAlone = k === rest.length - 1 && rest.length % 2 === 1
      const w = lastAlone ? W - 2 * M : (W - 3 * M) / 2
      boxes[i] = { x: M + (k % 2) * ((W - 3 * M) / 2 + M), y: y + row * (h + M), width: w, height: h }
    })
  }
  return boxes.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }))
}

export function reportFiles(u: Universe, pages: ReportPageSpec[], baseTheme: unknown): Record<string, string> {
  const files: Record<string, string> = {
    '.platform': platform('Report', u.name, `${u.id}/report`),
    'definition.pbir': json({
      $schema: `${SCHEMA}/item/report/definitionProperties/2.0.0/schema.json`,
      version: '4.0',
      datasetReference: { byPath: { path: `../${u.name}.SemanticModel` } }
    }),
    'definition/version.json': json({ $schema: `${SCHEMA}/item/report/definition/versionMetadata/1.0.0/schema.json`, version: '2.0.0' }),
    'definition/report.json': json({
      $schema: `${SCHEMA}/item/report/definition/report/3.3.0/schema.json`,
      themeCollection: {
        baseTheme: { name: BASE_THEME, reportVersionAtImport: { visual: '1.8.97', report: '2.0.97', page: '1.3.97' }, type: 'SharedResources' }
      },
      resourcePackages: [
        { name: 'SharedResources', type: 'SharedResources', items: [{ name: BASE_THEME, path: `BaseThemes/${BASE_THEME}.json`, type: 'BaseTheme' }] }
      ],
      settings: {
        useStylableVisualContainerHeader: true,
        exportDataMode: 'AllowSummarized',
        defaultDrillFilterOtherVisuals: true,
        allowChangeFilterTypes: true,
        useEnhancedTooltips: true,
        useDefaultAggregateDisplayName: true
      }
    }),
    [`StaticResources/SharedResources/BaseThemes/${BASE_THEME}.json`]: json(baseTheme)
  }
  const pageIds: string[] = []
  pages.forEach((p, pi) => {
    const pid = pbirId(`${u.id}/page/${pi}/${p.name}`)
    pageIds.push(pid)
    files[`definition/pages/${pid}/page.json`] = json({
      $schema: `${SCHEMA}/item/report/definition/page/2.1.0/schema.json`,
      name: pid,
      displayName: p.name,
      displayOption: 'FitToPage',
      height: 720,
      width: 1280
    })
    const boxes = layoutPage(p.visuals)
    p.visuals.forEach((v, vi) => {
      const vid = pbirId(`${u.id}/page/${pi}/visual/${vi}/${hash32(JSON.stringify(v))}`)
      files[`definition/pages/${pid}/visuals/${vid}/visual.json`] = json(visualJson(vid, v, boxes[vi], (vi + 1) * 1000))
    })
  })
  files['definition/pages/pages.json'] = json({
    $schema: `${SCHEMA}/item/report/definition/pagesMetadata/1.1.0/schema.json`,
    pageOrder: pageIds,
    activePageName: pageIds[0]
  })
  return files
}
