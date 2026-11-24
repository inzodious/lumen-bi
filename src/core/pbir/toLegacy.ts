/**
 * PBIR -> legacy report layout (the PBIX / PBIT `Report/Layout` part): the inverse of `legacy.ts`.
 *
 * Power BI Desktop still writes `Report/Layout` inside `.pbix` / `.pbit` packages unless the PBIR preview is on, and
 * every Desktop version reads it, so packages written by Lumen carry the report in this form (see
 * docs/developer/file-format-io.md). The mapping mirrors `convertLegacyLayout` key by key:
 *   pages/<name>/page.json        -> sections[] (ordinal = page order; config / filters as JSON *strings*)
 *   visual.json                   -> visualContainers[] (x/y/z/width/height/tabOrder + config string + filters string)
 *     visual.query.queryState     -> singleVisual.projections + prototypeQuery (From aliases, Select Name = queryRef)
 *     visual.query.sortDefinition -> prototypeQuery.OrderBy (+ hasDefaultSort)
 *     projection.displayName / format -> columnProperties
 *     visualContainerObjects      -> vcObjects;  mobile.json -> layouts[id 1]
 *   page.pageBinding              -> pods[];   bookmarks/* -> config.bookmarks;   reportExtensions.json -> config.modelExtensions
 *   enum names (howCreated, displayOption, interaction types, settings, resource types) -> Desktop's numbers
 *
 * `base` (optional) is the layout the report was read from. Objects whose PBIR conversion is unchanged are then
 * written back exactly as they were (including Desktop's cached `query` / `dataTransforms`), and keys Lumen does not
 * model (ids, `linguisticSchemaSyncVersion`, unknown settings, pod ids, ...) are carried over on changed objects. A
 * changed visual drops its cached `query` / `dataTransforms` / `queryHash`: Desktop regenerates them (most visuals in
 * files saved by current Desktop carry none).
 *
 * Approximations (stated, not hidden): the layout `version` written for a report without a base layout is
 * LEGACY_LAYOUT_VERSION; report-level measures (`modelExtensions`) are written with `formatString` (the shape the
 * reader accepts) because no sample file shows Desktop's exact shape.
 */
import { deepEqual } from './pbir'
import {
  convertLegacyLayout,
  DISPLAY_OPTION,
  EXPORT_DATA_MODE,
  FILTER_SORT,
  HANDLED_SINGLE_VISUAL_KEYS,
  HOW_CREATED,
  INTERACTION,
  ITEM_TYPE,
  PACKAGE_TYPE,
  PAGES_POSITION,
  PRIMITIVE_TYPE,
  QUERY_LIMIT,
  themeVersion,
  type LegacyConversion
} from './legacy'
import type { ReportDocument } from '../report/types'
import { cloneDeep } from '../clone'

type J = Record<string, any>

/** Layout `config.version` written when there is no source layout (the version current Desktop writes). */
export const LEGACY_LAYOUT_VERSION = '5.65'

export interface LegacyLayoutResult {
  layout: J
  diagnostics: string[]
}

function index(list: readonly string[], v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const i = list.indexOf(v)
  return i >= 0 ? i : undefined
}

function reverse(map: Record<number, string>, v: unknown): number | undefined {
  if (typeof v === 'number') return v
  for (const [k, name] of Object.entries(map)) if (name === v) return Number(k)
  return undefined
}

function parse(v: unknown): any {
  if (typeof v !== 'string' || v === '') return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

/** JSON string of `value`, reusing `prev` (the source text) when it parses to the same value. */
function str(value: unknown, prev?: unknown): string {
  if (typeof prev === 'string' && deepEqual(parse(prev), value)) return prev
  return JSON.stringify(value)
}

function without(o: J | undefined, keys: Iterable<string>): J {
  const out: J = { ...(o ?? {}) }
  for (const k of keys) delete out[k]
  return out
}

function stripUndefined<T extends J>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

/** PBIR reportVersionAtImport -> legacy theme `version` ("5.N"); inverse of legacy.ts themeVersion. */
function legacyThemeVersion(v: unknown, fallback: string): string | undefined {
  if (typeof v === 'string') return v
  const m = v && typeof v === 'object' ? /^1\.8\.(\d+)$/.exec(String((v as J).visual)) : null
  if (!m) return fallback
  // "1.8.0" is what the reader makes of a theme entry without a version: write none
  return Number(m[1]) >= 36 ? `5.${Number(m[1]) - 36}` : undefined
}

// ---------------------------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------------------------

export function filtersToLegacy(filters: J[] | undefined, diagnostics: string[], where: string): J[] {
  return (filters ?? []).map((f) => {
    const how = f.howCreated === undefined ? undefined : index(HOW_CREATED, f.howCreated)
    if (f.howCreated !== undefined && how === undefined) diagnostics.push(`Report layout: unknown filter howCreated ${f.howCreated} (${where})`)
    return stripUndefined({
      name: f.name,
      displayName: f.displayName,
      expression: f.field,
      filter: f.filter,
      type: f.type,
      howCreated: how,
      restatement: f.restatement,
      isHiddenInViewMode: f.isHiddenInViewMode,
      isLockedInViewMode: f.isLockedInViewMode,
      objects: f.objects,
      ordinal: f.ordinal
    })
  })
}

// ---------------------------------------------------------------------------------------------
// visuals
// ---------------------------------------------------------------------------------------------

/** Assigns Desktop-style From aliases (first letter of the entity, then numbered) and rewrites Entity refs to them. */
class Aliases {
  from: J[] = []
  private byKey = new Map<string, string>()
  private used = new Set<string>()

  alias(entity: string, schema?: string): string {
    const key = `${schema ?? ''}\u0000${entity}`
    let a = this.byKey.get(key)
    if (a) return a
    const first = (entity.match(/[A-Za-z0-9_]/)?.[0] ?? 't').toLowerCase()
    a = first
    for (let i = 1; this.used.has(a); i++) a = `${first}${i}`
    this.used.add(a)
    this.byKey.set(key, a)
    const f: J = { Name: a, Entity: entity }
    if (schema) f.Schema = schema
    f.Type = 0
    this.from.push(f)
    return a
  }

  /** Deep copy of `expr` with every `SourceRef: { Entity }` turned into `SourceRef: { Source: alias }`. */
  rewrite(expr: any): any {
    if (Array.isArray(expr)) return expr.map((e) => this.rewrite(e))
    if (!expr || typeof expr !== 'object') return expr
    const out: J = {}
    for (const [k, v] of Object.entries(expr)) {
      if (k === 'SourceRef' && v && typeof v === 'object' && typeof (v as J).Entity === 'string') out[k] = { Source: this.alias((v as J).Entity, (v as J).Schema) }
      else out[k] = this.rewrite(v)
    }
    return out
  }
}

function queryRefOf(field: J): string {
  const inner = (f: J): J | undefined => f?.Column ?? f?.Measure ?? f?.HierarchyLevel ?? f?.Aggregation?.Expression?.Column
  const c = inner(field)
  const entity = c?.Expression?.SourceRef?.Entity ?? c?.Expression?.Hierarchy?.Expression?.SourceRef?.Entity
  const prop = c?.Property ?? c?.Level
  return entity && prop ? `${entity}.${prop}` : JSON.stringify(field)
}

function singleVisualToLegacy(v: J, isHidden: boolean, diagnostics: string[], where: string): J {
  const sv: J = { visualType: v.visualType }
  const al = new Aliases()
  const select: J[] = []
  const selected = new Set<string>()
  const projections: J = {}
  const columnProperties: J = {}
  const fieldParams: J = {}
  const showAll: string[] = []
  const query: J | undefined = v.query
  for (const [role, state] of Object.entries((query?.queryState ?? {}) as Record<string, J>)) {
    const list: J[] = []
    for (const p of (state?.projections ?? []) as J[]) {
      const queryRef: string = p.queryRef ?? queryRefOf(p.field)
      const entry: J = { queryRef }
      if (p.active !== undefined) entry.active = p.active
      list.push(entry)
      if (!selected.has(queryRef)) {
        selected.add(queryRef)
        const sel: J = { ...al.rewrite(p.field ?? {}), Name: queryRef }
        if (p.nativeQueryRef !== undefined) sel.NativeReferenceName = p.nativeQueryRef
        select.push(sel)
      }
      if (p.displayName !== undefined || p.format !== undefined) {
        const cp: J = (columnProperties[queryRef] ??= {})
        if (p.displayName !== undefined) cp.displayName = p.displayName
        if (p.format !== undefined) cp.formatString = p.format
      }
    }
    projections[role] = list
    if (Array.isArray(state?.fieldParameters) && state.fieldParameters.length)
      fieldParams[role] = state.fieldParameters.map((fp: J) =>
        stripUndefined({
          expr: al.rewrite(fp.parameterExpr),
          index: fp.index,
          length: fp.length,
          sortDirection: fp.sortDirection === 'Descending' ? 2 : fp.sortDirection === 'Ascending' ? 1 : fp.sortDirection
        })
      )
    if (state?.showAll) showAll.push(role)
  }
  // a role that only exists to carry showAll has no projections in the legacy form either
  for (const role of showAll) if (!projections[role]?.length) delete projections[role]
  if (Object.keys(projections).length || query) sv.projections = projections
  const sort: J[] = Array.isArray(query?.sortDefinition?.sort) ? query!.sortDefinition.sort : []
  if (select.length || sort.length) {
    const pq: J = { Version: 2, From: al.from, Select: select }
    if (sort.length) pq.OrderBy = sort.map((s) => ({ Direction: s.direction === 'Descending' ? 2 : 1, Expression: al.rewrite(s.field) }))
    // From is filled lazily while rewriting; keep it first in key order
    pq.From = al.from
    sv.prototypeQuery = pq
  }
  if (Object.keys(columnProperties).length) sv.columnProperties = columnProperties
  if (Object.keys(fieldParams).length) sv.queryFieldParametersByRole = fieldParams
  if (showAll.length) sv.showAllRoles = showAll
  if (v.drillFilterOtherVisuals !== undefined) sv.drillFilterOtherVisuals = v.drillFilterOtherVisuals
  if (query?.sortDefinition?.isDefaultSort) sv.hasDefaultSort = true
  if (query?.options) sv.queryOptions = query.options
  if (query?.isDrillDisabled !== undefined) sv.isDrillDisabled = query.isDrillDisabled
  if (v.autoSelectVisualType !== undefined) sv.autoSelectVisualType = v.autoSelectVisualType
  if (v.expansionStates) sv.expansionStates = v.expansionStates
  if (v.objects && Object.keys(v.objects).length) sv.objects = v.objects
  if (v.visualContainerObjects && Object.keys(v.visualContainerObjects).length) sv.vcObjects = v.visualContainerObjects
  if (v.syncGroup) sv.syncGroup = v.syncGroup
  if (isHidden) sv.display = { mode: 'hidden' }
  const known = new Set(['visualType', 'query', 'drillFilterOtherVisuals', 'autoSelectVisualType', 'expansionStates', 'objects', 'visualContainerObjects', 'syncGroup'])
  const unknown = Object.keys(v).filter((k) => !known.has(k))
  if (unknown.length) diagnostics.push(`Report layout: visual settings without a legacy equivalent were not written: ${unknown.join(', ')} (${where})`)
  return sv
}

function positionOf(p: J | undefined): J {
  const src = p ?? {}
  return stripUndefined({ x: src.x ?? 0, y: src.y ?? 0, z: src.z ?? 0, width: src.width ?? 0, height: src.height ?? 0, tabOrder: src.tabOrder, angle: src.angle })
}

const CONTAINER_OWNED = ['x', 'y', 'z', 'width', 'height', 'tabOrder', 'config', 'filters', 'query', 'queryHash', 'dataTransforms']
const CONFIG_OWNED = ['name', 'layouts', 'singleVisual', 'singleVisualGroup', 'parentGroupName', 'howCreated']

function visualToLegacy(v: { name: string; json: J; mobile?: J }, base: J | undefined, diagnostics: string[], where: string): J {
  const j = v.json
  const pos = positionOf(j.position)
  const baseCfg: J = parse(base?.config) ?? {}
  const cfg: J = { ...without(baseCfg, CONFIG_OWNED), name: j.name ?? v.name }
  const layouts: J[] = [{ id: 0, position: pos }]
  if (v.mobile?.position) layouts.push({ id: 1, position: positionOf(v.mobile.position) })
  cfg.layouts = layouts
  if (j.visual) {
    const baseSv: J = baseCfg.singleVisual ?? {}
    // carry keys Lumen does not model (e.g. newer Desktop settings) over from the source container
    const extra = without(baseSv, [...HANDLED_SINGLE_VISUAL_KEYS, 'display'])
    cfg.singleVisual = { ...singleVisualToLegacy(j.visual, j.isHidden === true, diagnostics, where), ...extra }
  } else if (j.visualGroup) {
    const g = j.visualGroup
    cfg.singleVisualGroup = stripUndefined({ displayName: g.displayName ?? v.name, groupMode: index(['ScaleMode', 'ScrollMode'], g.groupMode) ?? 0, objects: g.objects, isHidden: j.isHidden ? true : undefined })
  }
  if (j.parentGroupName) cfg.parentGroupName = j.parentGroupName
  if (typeof j.howCreated === 'string') cfg.howCreated = j.howCreated
  const out: J = { ...without(base, CONTAINER_OWNED), x: pos.x, y: pos.y, z: pos.z, width: pos.width, height: pos.height }
  if (pos.tabOrder !== undefined) out.tabOrder = pos.tabOrder
  out.config = JSON.stringify(cfg)
  out.filters = str(filtersToLegacy(j.filterConfig?.filters, diagnostics, where), base?.filters)
  return out
}

// ---------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------

function resourcePackagesToLegacy(list: J[] | undefined, base: J[] | undefined): J[] {
  return (list ?? []).map((rp) => {
    const prev = base?.find((b) => (b.resourcePackage ?? b).name === rp.name)?.resourcePackage
    const items = (rp.items ?? []).map((it: J) => {
      const prevItem = prev?.items?.find((p: J) => p.path === it.path)
      const out: J = { ...(prevItem ?? {}), type: reverse(ITEM_TYPE, it.type) ?? 100, path: it.path }
      // the reader names nameless items after their path; keep such a source item nameless
      const derived = String(it.path ?? '').replace(/^.*\//, '')
      if (it.name !== undefined && !(prevItem && prevItem.name === undefined && it.name === derived)) out.name = it.name
      return out
    })
    const out: J = { ...(prev ?? {}), name: rp.name, type: reverse(PACKAGE_TYPE, rp.type) ?? 1, items }
    if (!prev || prev.disabled !== undefined || rp.disabled !== undefined) out.disabled = rp.disabled === true
    return { resourcePackage: out }
  })
}

function themeToLegacy(t: J | undefined, cfgVersion: string, prev: J | undefined): J | undefined {
  if (!t?.name) return undefined
  // unchanged source entry (its version may be in a form the reader maps only approximately, e.g. "3.19")
  if (prev && prev.name === t.name && (prev.type === 1 ? 'RegisteredResources' : 'SharedResources') === (t.type === 'RegisteredResources' ? 'RegisteredResources' : 'SharedResources') && deepEqual(themeVersion(prev.version), t.reportVersionAtImport))
    return prev
  const out: J = stripUndefined({ name: t.name, version: legacyThemeVersion(t.reportVersionAtImport, prev?.version ?? cfgVersion), type: t.type === 'RegisteredResources' ? 1 : 2 })
  return prev && deepEqual(without(prev, ['version']), without(out, ['version'])) && prev.version === out.version ? prev : out
}

function settingsToLegacy(s: J | undefined, base: J | undefined, newReport: boolean): J {
  const out: J = { ...(base ?? {}) }
  for (const [k, v] of Object.entries(s ?? {})) {
    if (k === 'defaultDrillFilterOtherVisuals') continue
    if (k === 'exportDataMode') out[k] = index(EXPORT_DATA_MODE, v) ?? v
    else if (k === 'queryLimitOption') out[k] = index(QUERY_LIMIT, v) ?? v
    else if (k === 'pagesPosition') out[k] = index(PAGES_POSITION, v) ?? v
    else out[k] = v
  }
  // PBIR reports always use the current filter pane; in the legacy form that is an explicit setting
  // (a report read from a legacy layout keeps the filter pane it had)
  if (newReport && out.useNewFilterPaneExperience === undefined) out.useNewFilterPaneExperience = true
  return out
}

function modelExtensionsToLegacy(ext: J | undefined): J[] | undefined {
  if (!ext?.entities) return undefined
  return [
    {
      name: ext.name ?? 'extension',
      entities: (ext.entities as J[]).map((en) => ({
        name: en.name,
        extends: en.extends ?? en.name,
        hidden: en.hidden ?? false,
        measures: (en.measures ?? []).map((m: J) =>
          stripUndefined({
            name: m.name,
            dataType: reverse(PRIMITIVE_TYPE, m.dataType) ?? 13,
            dataCategory: m.dataCategory,
            expression: m.expression,
            hidden: m.hidden,
            formatString: m.formatString,
            description: m.description,
            displayFolder: m.displayFolder,
            references: m.references
          })
        )
      }))
    }
  ]
}

function bookmarksToLegacy(meta: J | undefined, files: Array<{ name: string; json: J }>): J[] | undefined {
  if (!files.length && !meta) return undefined
  const byName = new Map(files.map((f) => [f.name, f.json]))
  const one = (name: string): J => {
    const j = byName.get(name) ?? { name }
    return stripUndefined({ displayName: j.displayName ?? name, name: j.name ?? name, explorationState: j.explorationState, options: j.options })
  }
  const items: J[] = Array.isArray(meta?.items) ? meta!.items : files.map((f) => ({ name: f.name }))
  return items.map((it) => (Array.isArray(it.children) ? { name: it.name, displayName: it.displayName ?? it.name, children: it.children.map((c: string) => one(c)) } : one(it.name)))
}

function pageToSection(
  p: ReportDocument['pages'][number],
  ordinal: number,
  baseSection: J | undefined,
  basePage: LegacyConversion['pages'][number] | undefined,
  diagnostics: string[]
): J {
  const j = p.json
  const where = `page ${p.name}`
  // visuals: keep the source order (array order is Desktop's creation order), new ones after
  const baseVcs: J[] = Array.isArray(baseSection?.visualContainers) ? baseSection!.visualContainers : []
  const baseVcName = (vc: J): string | undefined => parse(vc.config)?.name ?? vc.name
  const baseIndex = new Map<string, number>()
  baseVcs.forEach((vc, i) => {
    const n = baseVcName(vc)
    if (n !== undefined && !baseIndex.has(n)) baseIndex.set(n, i)
  })
  const visuals = p.visuals.map((v, i) => ({ v, i, b: baseIndex.get(v.json?.name ?? v.name) }))
  visuals.sort((a, b) => (a.b ?? Infinity) - (b.b ?? Infinity) || a.i - b.i)
  const containers = visuals.map(({ v, b }) => {
    const baseVc = b !== undefined ? baseVcs[b] : undefined
    const baseConv = basePage?.visuals.find((bv) => bv.name === (v.json?.name ?? v.name))
    if (baseVc && baseConv && deepEqual(baseConv.json, v.json) && deepEqual(baseConv.mobile, v.mobile)) return baseVc
    return visualToLegacy(v, baseVc, diagnostics, `${where}, visual ${v.name}`)
  })
  const baseCfg: J = parse(baseSection?.config) ?? {}
  const cfg: J = without(baseCfg, ['objects', 'relationships', 'visibility', 'type'])
  if (j.visualInteractions?.length) cfg.relationships = j.visualInteractions.map((r: J) => ({ source: r.source, target: r.target, type: index(INTERACTION, r.type) ?? 0 }))
  if (j.objects && Object.keys(j.objects).length) cfg.objects = j.objects
  if (j.visibility === 'HiddenInViewMode') cfg.visibility = 1
  if (j.type === 'Tooltip') cfg.type = 1
  else if (j.type === 'Drillthrough') cfg.type = 2
  const out: J = {
    ...without(baseSection, ['name', 'displayName', 'filters', 'ordinal', 'visualContainers', 'config', 'displayOption', 'width', 'height']),
    name: p.name,
    displayName: j.displayName ?? p.name,
    filters: str(filtersToLegacy(j.filterConfig?.filters, diagnostics, where), baseSection?.filters),
    ordinal,
    visualContainers: containers,
    config: str(cfg, baseSection?.config),
    displayOption: index(DISPLAY_OPTION, j.displayOption) ?? 1,
    width: j.width ?? 1280,
    height: j.height ?? 720
  }
  // keep Desktop's original number formatting (1280 vs 1280.0 parse equal; ordinal is ours)
  if (baseSection && baseSection.width === out.width) out.width = baseSection.width
  if (baseSection && baseSection.height === out.height) out.height = baseSection.height
  if (baseSection && basePage && deepEqual(basePage.json, j) && containers.every((c, i) => c === baseVcs[i]) && containers.length === baseVcs.length) return baseSection
  return out
}

function podFor(p: ReportDocument['pages'][number], basePods: J[]): J | undefined {
  const b = p.json.pageBinding
  if (!b) return undefined
  const prev = basePods.find((x) => x.boundSection === p.name)
  const prevCfg: J = parse(prev?.config) ?? {}
  const cfg: J = without(prevCfg, ['referenceScope', 'acceptsFilterContext'])
  if (b.referenceScope === 'CrossReport') cfg.referenceScope = 1
  if (b.acceptsFilterContext === 'None') cfg.acceptsFilterContext = 1
  const pod: J = { ...without(prev, ['name', 'boundSection', 'config', 'parameters', 'type']), name: b.name ?? prev?.name ?? `Pod_${p.name}`, boundSection: p.name }
  if (prev?.config !== undefined || Object.keys(cfg).length) pod.config = str(cfg, prev?.config)
  if (Array.isArray(b.parameters) && b.parameters.length) {
    pod.parameters = str(
      b.parameters.map((x: J) => stripUndefined({ name: x.name, boundFilter: x.boundFilter, asAggregation: x.asAggregation, fieldExpr: x.fieldExpr })),
      prev?.parameters
    )
    // parameters added by later Desktop versions (e.g. isLegacySingleSelection) are carried when the param list is unchanged
    if (typeof prev?.parameters === 'string') {
      const pp = parse(prev.parameters)
      const conv = Array.isArray(pp) ? pp.map((x: J) => stripUndefined({ name: x.name, boundFilter: x.boundFilter, asAggregation: x.asAggregation, fieldExpr: x.fieldExpr })) : undefined
      if (conv && deepEqual(conv, parse(pod.parameters))) pod.parameters = prev.parameters
    }
  }
  if (prev?.type !== undefined) pod.type = prev.type
  else if (b.type === 'Drillthrough' && pod.parameters) pod.type = 1
  return pod
}

/**
 * Convert a report to the legacy `Report/Layout` JSON. With `base` (the layout the report was read from) unchanged
 * objects keep their exact source form.
 */
export function reportToLegacyLayout(doc: ReportDocument, base?: J): LegacyLayoutResult {
  const diagnostics: string[] = []
  const baseConv = base ? convertLegacyLayout(cloneDeep(base)) : undefined
  const baseCfg: J = parse(base?.config) ?? {}
  const r: J = doc.report ?? {}
  const version: string = typeof baseCfg.version === 'string' ? baseCfg.version : LEGACY_LAYOUT_VERSION

  // ---- config
  const cfg: J = without(baseCfg, [
    'version',
    'themeCollection',
    'activeSectionIndex',
    'bookmarks',
    'defaultDrillFilterOtherVisuals',
    'settings',
    'objects',
    'modelExtensions',
    'filterSortOrder',
    'slowDataSourceSettings',
    'dataSourceVariables'
  ])
  const out: J = { version }
  const tc = r.themeCollection ?? {}
  const baseTheme = themeToLegacy(tc.baseTheme, version, baseCfg.themeCollection?.baseTheme)
  const customTheme = themeToLegacy(tc.customTheme, version, baseCfg.themeCollection?.customTheme)
  // oldest layouts name the custom theme only in the top-level `theme` member (no themeCollection entry)
  const themeOnlyTopLevel = !!base && !baseCfg.themeCollection?.customTheme && customTheme?.name === base.theme
  const cfgCustom = themeOnlyTopLevel ? undefined : customTheme
  if (baseTheme || cfgCustom || baseCfg.themeCollection) out.themeCollection = stripUndefined({ ...(baseCfg.themeCollection ?? {}), baseTheme, customTheme: cfgCustom })
  const pageNames = doc.pages.map((p) => p.name)
  const active = doc.pagesMeta.activePageName ? pageNames.indexOf(doc.pagesMeta.activePageName) : 0
  out.activeSectionIndex = active >= 0 ? active : 0
  const bookmarks = bookmarksToLegacy(doc.bookmarksMeta, doc.bookmarks)
  if (bookmarks?.length) out.bookmarks = bookmarks
  const drill = r.settings?.defaultDrillFilterOtherVisuals ?? baseCfg.defaultDrillFilterOtherVisuals
  if (drill !== undefined) out.defaultDrillFilterOtherVisuals = drill
  Object.assign(out, cfg)
  // Unknown settings of the source survive; settings the PBIR conversion owns are rewritten
  const baseSettings = without(baseCfg.settings, Object.keys(baseConv?.report.settings ?? {}))
  const settings = settingsToLegacy(r.settings, baseSettings, !base)
  if (Object.keys(settings).length || baseCfg.settings) out.settings = settings
  if (r.objects && Object.keys(r.objects).length) out.objects = r.objects
  const ext = modelExtensionsToLegacy(doc.reportExtensions)
  if (ext) out.modelExtensions = baseConv && deepEqual(baseConv.reportExtensions, doc.reportExtensions) ? baseCfg.modelExtensions : ext
  const fso = index(FILTER_SORT, r.filterConfig?.filterSortOrder)
  if (fso !== undefined) out.filterSortOrder = fso
  else if (baseCfg.filterSortOrder !== undefined && !r.filterConfig?.filterSortOrder) out.filterSortOrder = baseCfg.filterSortOrder
  if (r.slowDataSourceSettings) out.slowDataSourceSettings = r.slowDataSourceSettings
  if (r.dataSourceVariables) out.dataSourceVariables = r.dataSourceVariables
  // bookmarks unchanged -> keep Desktop's original objects (they may carry keys Lumen does not model)
  if (baseConv && deepEqual(baseConv.bookmarks, doc.bookmarks) && deepEqual(baseConv.bookmarksMeta, doc.bookmarksMeta) && baseCfg.bookmarks) out.bookmarks = baseCfg.bookmarks
  const unknownReport = Object.keys(r).filter(
    (k) => !['$schema', 'themeCollection', 'filterConfig', 'objects', 'publicCustomVisuals', 'resourcePackages', 'dataSourceVariables', 'settings', 'slowDataSourceSettings'].includes(k)
  )
  if (unknownReport.length) diagnostics.push(`Report layout: report settings without a legacy equivalent were not written: ${unknownReport.join(', ')}`)

  // ---- sections + pods
  const baseSections: J[] = Array.isArray(base?.sections) ? base!.sections : []
  const sections = doc.pages.map((p, i) =>
    pageToSection(
      p,
      i,
      baseSections.find((s) => s.name === p.name),
      baseConv?.pages.find((bp) => bp.name === p.name),
      diagnostics
    )
  )
  // section ordinals follow the page order; reuse an unchanged source section only when its ordinal still matches
  sections.forEach((s, i) => {
    const b = baseSections.find((x) => x.name === s.name)
    // a source section without an ordinal at its original position stays without one
    if (b && b.ordinal === undefined && baseSections.indexOf(b) === i) {
      if ('ordinal' in s) sections[i] = without(s, ['ordinal'])
    } else if (s.ordinal !== i) sections[i] = { ...s, ordinal: i }
  })
  const basePods: J[] = Array.isArray(base?.pods) ? base!.pods : []
  const podPages = [...doc.pages].sort((a, b) => {
    const ia = basePods.findIndex((x) => x.boundSection === a.name)
    const ib = basePods.findIndex((x) => x.boundSection === b.name)
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
  })
  const pods = podPages.map((p) => podFor(p, basePods)).filter((x): x is J => !!x)

  // ---- layout
  const layout: J = without(base, ['theme', 'filters', 'resourcePackages', 'sections', 'config', 'pods', 'publicCustomVisuals'])
  if (layout.id === undefined && !base) layout.id = 0
  if (customTheme?.name) layout.theme = customTheme.name
  else if (base && 'theme' in base) layout.theme = base.theme
  const reportFilters = filtersToLegacy(r.filterConfig?.filters, diagnostics, 'report')
  if (!base || 'filters' in base || reportFilters.length) layout.filters = str(reportFilters, base?.filters)
  const packages = resourcePackagesToLegacy(r.resourcePackages, base?.resourcePackages)
  if (packages.length) layout.resourcePackages = packages
  layout.sections = sections
  if (pods.length) layout.pods = pods
  layout.config = str(out, base?.config)
  if (layout.layoutOptimization === undefined) layout.layoutOptimization = 0
  layout.publicCustomVisuals = Array.isArray(r.publicCustomVisuals) ? r.publicCustomVisuals : (base?.publicCustomVisuals ?? [])
  // a source layout that had no publicCustomVisuals key and still has none: keep it absent
  if (base && !('publicCustomVisuals' in base) && !layout.publicCustomVisuals.length) delete layout.publicCustomVisuals
  return { layout, diagnostics }
}
