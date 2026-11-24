/**
 * Legacy report layout -> PBIR.
 *
 * Input: the JSON of a PBIX `Report/Layout` entry (UTF-16LE) or of a PBIR-legacy `report.json`
 * (a `*.Report` folder without `definition/`). Its `config`, section `config`/`filters` and visual
 * container `config`/`filters` members are JSON *strings*.
 *
 * Mapping (mirrors what Power BI Desktop does when it upgrades a report to PBIR):
 *   sections[]                       -> pages/<name>/page.json (+ pages.json order by `ordinal`)
 *   visualContainers[].config        -> visuals/<name>/visual.json
 *     layouts[id 0].position         -> position;  layouts[id 1] -> mobile.json
 *     singleVisual.projections + prototypeQuery.Select (alias -> Entity) -> visual.query.queryState
 *     prototypeQuery.OrderBy         -> visual.query.sortDefinition
 *     columnProperties.displayName   -> projection.displayName
 *     vcObjects / objects            -> visualContainerObjects / objects
 *     title / background (oldest layouts, before vcObjects) -> visualContainerObjects.title / .background
 *     singleVisualGroup              -> visualGroup
 *   filters (report/page/visual)     -> filterConfig.filters (expression -> field, howCreated enum names)
 *   pods                             -> page.pageBinding;   config.bookmarks -> bookmarks/*
 *   config.modelExtensions           -> reportExtensions.json
 * Lossy spots (cached query/dataTransforms, unknown legacy keys) are reported as diagnostics.
 */
import { normalizeExpr } from '../report/sq'
import { SCHEMA, PBIR_VERSION } from './schemas'

type J = Record<string, any>

export interface LegacyConversion {
  report: J
  version: J
  pagesMeta: { pageOrder: string[]; activePageName?: string; [k: string]: any }
  pages: Array<{ name: string; json: J; visuals: Array<{ name: string; json: J; mobile?: J }> }>
  bookmarksMeta?: J
  bookmarks: Array<{ name: string; json: J }>
  reportExtensions?: J
  diagnostics: string[]
}

export const HOW_CREATED = ['Auto', 'User', 'Drill', 'Include', 'Exclude', 'Drillthrough']
export const DISPLAY_OPTION = ['DeprecatedDynamic', 'FitToPage', 'FitToWidth', 'ActualSize', 'ActualSizeTopLeft']
export const INTERACTION = ['Default', 'DataFilter', 'HighlightFilter', 'NoFilter']
export const EXPORT_DATA_MODE = ['None', 'AllowSummarized', 'AllowSummarizedAndUnderlying']
export const QUERY_LIMIT = ['None', 'Shared', 'Premium', 'SQLServerAS', 'AzureAS', 'Custom', 'Auto']
export const PAGES_POSITION = ['PagesPane', 'Bottom']
export const FILTER_SORT = ['Custom', 'Ascending', 'Descending', 'Custom']
export const PACKAGE_TYPE: Record<number, string> = { 0: 'CustomVisual', 1: 'RegisteredResources', 2: 'SharedResources', 3: 'OrganizationalStoreCustomVisual' }
export const ITEM_TYPE: Record<number, string> = {
  0: 'CustomVisualJavascript',
  1: 'CustomVisualsCss',
  2: 'CustomVisualScreenshot',
  3: 'CustomVisualIcon',
  4: 'CustomVisualWatermark',
  5: 'CustomVisualMetadata',
  100: 'Image',
  200: 'ShapeMap',
  201: 'CustomTheme',
  202: 'BaseTheme'
}
/** Power BI primitive type ids used in legacy `modelExtensions` measures. */
export const PRIMITIVE_TYPE: Record<number, string> = {
  0: 'Null',
  1: 'Text',
  2: 'Decimal',
  3: 'Double',
  4: 'Integer',
  5: 'Boolean',
  6: 'Date',
  7: 'DateTime',
  8: 'DateTimeZone',
  9: 'Time',
  10: 'Duration',
  11: 'Binary',
  12: 'None',
  13: 'Variant'
}
export const SETTINGS_KEYS = new Set([
  'isPersistentUserStateDisabled',
  'hideVisualContainerHeader',
  'useStylableVisualContainerHeader',
  'exportDataMode',
  'isReportAnnotationsDisabled',
  'defaultFilterActionIsDataFilter',
  'defaultDrillFilterOtherVisuals',
  'useCrossReportDrillthrough',
  'allowChangeFilterTypes',
  'allowInlineExploration',
  'useEnhancedTooltips',
  'useScaledTooltips',
  'filterPaneHiddenInEditMode',
  'disableFilterPaneSearch',
  'pagesPosition',
  'allowAutomatedInsightsNotification',
  'useDefaultAggregateDisplayName',
  'enableDeveloperMode',
  'pauseQueries',
  'queryLimitOption',
  'customMemoryLimit',
  'customTimeoutLimit',
  'fieldParameterReportSettings',
  'defaultDataExplorePerspective',
  'locale',
  'defaultDisplayUnitsToNone'
])
export const HANDLED_SINGLE_VISUAL_KEYS = new Set([
  'visualType',
  'autoSelectVisualType',
  'projections',
  'prototypeQuery',
  'columnProperties',
  'drillFilterOtherVisuals',
  'hasDefaultSort',
  'vcObjects',
  'objects',
  'expansionStates',
  'display',
  'syncGroup',
  'queryFieldParametersByRole',
  'showAllRoles',
  'queryOptions',
  'isDrillDisabled',
  'title',
  'background',
  // cached UI state, intentionally dropped
  'cachedFilterDisplayItems',
  'filterSortOrder',
  'activeProjections'
])

function parseField(v: unknown, what: string, diagnostics: string[]): any {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    diagnostics.push(`Legacy layout: invalid JSON in ${what}`)
    return undefined
  }
}

function enumName(list: string[], v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return list[v]
  return undefined
}

function stripUndefined<T extends J>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

/** "5.16" (legacy layout version) -> PBIR reportVersionAtImport (approximation of Desktop's mapping). */
export function themeVersion(v: unknown): J {
  if (v && typeof v === 'object') return { visual: (v as J).visual, report: (v as J).report, page: (v as J).page }
  const m = typeof v === 'string' ? /^5\.(\d+)$/.exec(v) : null
  const n = m ? Number(m[1]) + 36 : 0
  return { visual: `1.8.${n}`, report: `2.0.${n}`, page: `1.3.${n}` }
}

export function convertFilters(list: unknown, diagnostics: string[], where: string): J[] {
  if (!Array.isArray(list)) return []
  return list.map((f: J, i: number) => {
    const how = enumName(HOW_CREATED, f.howCreated)
    if (f.howCreated !== undefined && !how) diagnostics.push(`Legacy layout: unknown filter howCreated ${f.howCreated} (${where})`)
    const out = stripUndefined({
      name: f.name ?? `Filter${i}`,
      displayName: f.displayName,
      ordinal: f.ordinal,
      field: f.expression ?? f.field,
      type: f.type,
      filter: f.filter,
      restatement: f.restatement,
      howCreated: how,
      isHiddenInViewMode: f.isHiddenInViewMode,
      isLockedInViewMode: f.isLockedInViewMode,
      objects: f.objects
    })
    return out
  })
}

function selectField(sel: J, aliases: Record<string, string>): J {
  const out: J = {}
  for (const [k, v] of Object.entries(sel)) if (k !== 'Name' && k !== 'NativeReferenceName') out[k] = v
  return normalizeExpr(out, aliases)
}

function aliasMap(from: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(from)) for (const f of from) if (f?.Name && f.Entity) out[f.Name] = f.Entity
  return out
}

const lit = (v: string): J => ({ expr: { Literal: { Value: v } } })
const litText = (s: unknown): J => lit(`'${String(s).replace(/'/g, "''")}'`)
const litBool = (b: unknown): J => lit(b === false || b === 'false' ? 'false' : 'true')
const litNum = (n: unknown): J => lit(`${Number(n) || 0}D`)
const litColor = (c: unknown): J => ({ solid: { color: litText(c) } })

/**
 * Oldest legacy layouts keep the container title / background as plain `singleVisual.title`
 * (`{ show, text?, fontColor? }`) and `singleVisual.background` (`{ show, color?, transparency? }`).
 * Converted to the PBIR objects unless the visual already has the modern equivalent (slicers too: their
 * old title shows above the list even when the slicer header is off).
 */
function convertOldTitleAndBackground(sv: J, v: J): void {
  const t = sv.title
  if (t && typeof t === 'object') {
    const props: J = { show: litBool(t.show) }
    if (t.text !== undefined) props.text = litText(t.text)
    if (t.fontColor !== undefined) props.fontColor = litColor(t.fontColor)
    v.visualContainerObjects ??= {}
    if (!v.visualContainerObjects.title) v.visualContainerObjects.title = [{ properties: props }]
  }
  const b = sv.background
  if (b && typeof b === 'object') {
    const props: J = { show: litBool(b.show) }
    if (b.color !== undefined) props.color = litColor(b.color)
    if (b.transparency !== undefined) props.transparency = litNum(b.transparency)
    v.visualContainerObjects ??= {}
    if (!v.visualContainerObjects.background) v.visualContainerObjects.background = [{ properties: props }]
  }
}

function convertSingleVisual(sv: J, where: string, diagnostics: string[]): J {
  const v: J = { visualType: sv.visualType }
  if (sv.autoSelectVisualType !== undefined) v.autoSelectVisualType = sv.autoSelectVisualType
  const pq: J | undefined = sv.prototypeQuery
  const aliases = aliasMap(pq?.From)
  const selects = new Map<string, J>()
  for (const s of pq?.Select ?? []) if (s?.Name) selects.set(s.Name, s)
  const queryState: J = {}
  for (const [role, projs] of Object.entries((sv.projections ?? {}) as Record<string, J[]>)) {
    const projections = (projs ?? []).map((p) => {
      const sel = selects.get(p.queryRef)
      if (!sel) diagnostics.push(`Legacy layout: projection ${p.queryRef} has no matching query select (${where})`)
      const out: J = { field: sel ? selectField(sel, aliases) : {}, queryRef: p.queryRef }
      if (sel?.NativeReferenceName !== undefined) out.nativeQueryRef = sel.NativeReferenceName
      if (p.active !== undefined) out.active = p.active
      const cp = sv.columnProperties?.[p.queryRef]
      if (cp?.displayName !== undefined) out.displayName = cp.displayName
      if (cp?.formatString !== undefined) out.format = cp.formatString
      return out
    })
    const state: J = { projections }
    const fps = sv.queryFieldParametersByRole?.[role]
    if (Array.isArray(fps) && fps.length)
      state.fieldParameters = fps.map((fp: J) =>
        stripUndefined({ parameterExpr: normalizeExpr(fp.expr ?? fp.parameterExpr, aliases), index: fp.index, length: fp.length, sortDirection: fp.sortDirection === 2 ? 'Descending' : fp.sortDirection === 1 ? 'Ascending' : fp.sortDirection })
      )
    queryState[role] = state
  }
  for (const role of Array.isArray(sv.showAllRoles) ? sv.showAllRoles : []) (queryState[role] ??= { projections: [] }).showAll = true
  if (Object.keys(queryState).length || pq?.OrderBy?.length) {
    const query: J = { queryState }
    if (Array.isArray(pq?.OrderBy) && pq!.OrderBy.length) {
      query.sortDefinition = {
        sort: pq!.OrderBy.map((o: J) => ({ field: normalizeExpr(o.Expression, aliases), direction: o.Direction === 2 ? 'Descending' : 'Ascending' }))
      }
      if (sv.hasDefaultSort) query.sortDefinition.isDefaultSort = true
    }
    if (sv.queryOptions) query.options = sv.queryOptions
    if (sv.isDrillDisabled !== undefined) query.isDrillDisabled = sv.isDrillDisabled
    v.query = query
  }
  if (sv.expansionStates) v.expansionStates = sv.expansionStates
  if (sv.objects && Object.keys(sv.objects).length) v.objects = sv.objects
  if (sv.vcObjects && Object.keys(sv.vcObjects).length) v.visualContainerObjects = sv.vcObjects
  if (sv.syncGroup) v.syncGroup = sv.syncGroup
  convertOldTitleAndBackground(sv, v)
  if (sv.drillFilterOtherVisuals !== undefined) v.drillFilterOtherVisuals = sv.drillFilterOtherVisuals
  const unknownKeys = Object.keys(sv).filter((k) => !HANDLED_SINGLE_VISUAL_KEYS.has(k))
  if (unknownKeys.length) diagnostics.push(`Legacy layout: dropped visual settings ${unknownKeys.join(', ')} (${where})`)
  return v
}

function position(p: J | undefined, fallback: J): J {
  const src = p ?? fallback
  return stripUndefined({ x: src.x ?? 0, y: src.y ?? 0, z: src.z ?? 0, height: src.height ?? 0, width: src.width ?? 0, tabOrder: src.tabOrder, angle: src.angle })
}

function convertVisual(vc: J, idx: number, pageName: string, diagnostics: string[]): { name: string; json: J; mobile?: J } {
  const cfg: J = parseField(vc.config, `visual ${idx} of page ${pageName}`, diagnostics) ?? {}
  const name: string = cfg.name ?? vc.name ?? `visual${idx}`
  const where = `page ${pageName}, visual ${name}`
  const layouts: J[] = Array.isArray(cfg.layouts) ? cfg.layouts : []
  const main = layouts.find((l) => l.id === 0) ?? layouts[0]
  const json: J = {
    $schema: SCHEMA.visualContainer,
    name,
    position: position(main?.position, { x: vc.x, y: vc.y, z: vc.z, width: vc.width, height: vc.height, tabOrder: vc.tabOrder })
  }
  if (cfg.singleVisual) {
    json.visual = convertSingleVisual(cfg.singleVisual, where, diagnostics)
    if (cfg.singleVisual.display?.mode === 'hidden') json.isHidden = true
  } else if (cfg.singleVisualGroup) {
    const g = cfg.singleVisualGroup
    json.visualGroup = stripUndefined({ displayName: g.displayName ?? name, groupMode: enumName(['ScaleMode', 'ScrollMode'], g.groupMode) ?? 'ScaleMode', objects: g.objects })
    if (g.isHidden) json.isHidden = true
  } else diagnostics.push(`Legacy layout: visual container without visual (${where})`)
  if (cfg.parentGroupName) json.parentGroupName = cfg.parentGroupName
  const filters = convertFilters(parseField(vc.filters, `filters of ${where}`, diagnostics), diagnostics, where)
  if (filters.length) json.filterConfig = { filters }
  if (typeof cfg.howCreated === 'string') json.howCreated = cfg.howCreated
  // move isHidden after filterConfig to follow Desktop's key order
  if (json.isHidden) {
    delete json.isHidden
    json.isHidden = true
  }
  const mobileLayout = layouts.find((l) => l.id === 1)
  const mobile = mobileLayout?.position ? { $schema: SCHEMA.visualContainerMobileState, position: position(mobileLayout.position, {}) } : undefined
  return mobile ? { name, json, mobile } : { name, json }
}

function convertResourcePackages(list: unknown, diagnostics: string[]): J[] | undefined {
  if (!Array.isArray(list) || !list.length) return undefined
  return list.map((entry: J) => {
    const rp: J = entry.resourcePackage ?? entry
    const type = typeof rp.type === 'number' ? PACKAGE_TYPE[rp.type] : rp.type
    if (!type) diagnostics.push(`Legacy layout: unknown resource package type ${rp.type}`)
    const out: J = { name: rp.name, type: type ?? 'RegisteredResources' }
    out.items = (rp.items ?? []).map((it: J) => {
      const itype = typeof it.type === 'number' ? ITEM_TYPE[it.type] : it.type
      if (!itype) diagnostics.push(`Legacy layout: unknown resource item type ${it.type} (${it.path})`)
      return { name: it.name ?? String(it.path ?? '').replace(/^.*\//, ''), path: it.path, type: itype ?? 'Image' }
    })
    if (rp.disabled) out.disabled = true
    return out
  })
}

function convertTheme(t: J | undefined): J | undefined {
  if (!t?.name) return undefined
  return { name: t.name, reportVersionAtImport: themeVersion(t.version), type: t.type === 1 || t.type === 'RegisteredResources' ? 'RegisteredResources' : 'SharedResources' }
}

function convertSettings(cfg: J, diagnostics: string[]): J | undefined {
  const s: J = cfg.settings ?? {}
  const out: J = {}
  for (const [k, v] of Object.entries(s)) {
    if (!SETTINGS_KEYS.has(k)) continue
    if (k === 'exportDataMode') out[k] = enumName(EXPORT_DATA_MODE, v)
    else if (k === 'queryLimitOption') out[k] = enumName(QUERY_LIMIT, v)
    else if (k === 'pagesPosition') out[k] = enumName(PAGES_POSITION, v)
    else out[k] = v
    if (out[k] === undefined) {
      diagnostics.push(`Legacy layout: unknown value ${String(v)} for setting ${k}`)
      delete out[k]
    }
  }
  if (cfg.defaultDrillFilterOtherVisuals !== undefined && out.defaultDrillFilterOtherVisuals === undefined) out.defaultDrillFilterOtherVisuals = cfg.defaultDrillFilterOtherVisuals
  return Object.keys(out).length ? out : undefined
}

function convertReportExtensions(ext: unknown, diagnostics: string[]): J | undefined {
  if (!Array.isArray(ext) || !ext.length) return undefined
  if (ext.length > 1) diagnostics.push('Legacy layout: only the first report extension (report-level measures) was converted')
  const e: J = ext[0]
  const entities = (e.entities ?? []).map((en: J) => ({
    name: en.name,
    measures: (en.measures ?? []).map((m: J) => {
      const dataType = typeof m.dataType === 'number' ? PRIMITIVE_TYPE[m.dataType] : m.dataType
      if (dataType === undefined) diagnostics.push(`Legacy layout: unknown data type ${m.dataType} for report measure ${m.name}`)
      return stripUndefined({
        name: m.name,
        dataType: dataType ?? 'Variant',
        dataCategory: m.dataCategory,
        expression: m.expression,
        hidden: m.hidden,
        formatString: m.formatString ?? m.formatInformation?.formatString,
        description: m.description,
        displayFolder: m.displayFolder,
        references: m.references
      })
    })
  }))
  return { $schema: SCHEMA.reportExtension, name: e.name ?? 'extension', entities }
}

function convertBookmarks(list: unknown, diagnostics: string[]): { meta?: J; files: Array<{ name: string; json: J }> } {
  if (!Array.isArray(list) || !list.length) return { files: [] }
  const files: Array<{ name: string; json: J }> = []
  const toFile = (b: J): string => {
    const es: J = b.explorationState ?? {}
    if (!es.sections) es.sections = {}
    if (!es.version) es.version = '1.3'
    if (es.activeSection === undefined) es.activeSection = ''
    const json = stripUndefined({ $schema: SCHEMA.bookmark, displayName: b.displayName ?? b.name, name: b.name, options: b.options, explorationState: es })
    files.push({ name: b.name, json })
    return b.name
  }
  const items = list.map((b: J) => {
    if (Array.isArray(b.children)) return { name: b.name, displayName: b.displayName ?? b.name, children: b.children.map(toFile) }
    return { name: toFile(b) }
  })
  if (files.some((f) => !f.name)) diagnostics.push('Legacy layout: bookmark without a name')
  return { meta: { $schema: SCHEMA.bookmarksMetadata, items }, files }
}

/** Convert a parsed legacy layout (PBIX `Report/Layout` / PBIR-legacy `report.json`) to PBIR parts. */
export function convertLegacyLayout(layout: J): LegacyConversion {
  const diagnostics: string[] = []
  const cfg: J = parseField(layout.config, 'report config', diagnostics) ?? {}

  // ---- report.json
  const report: J = { $schema: SCHEMA.report }
  const tc = cfg.themeCollection ?? {}
  let base = convertTheme(tc.baseTheme)
  let custom = convertTheme(tc.customTheme)
  const packages = convertResourcePackages(layout.resourcePackages, diagnostics)
  if (!base) {
    const item = packages?.find((p) => p.type === 'SharedResources')?.items.find((i: J) => i.type === 'BaseTheme')
    if (item) base = { name: item.name, reportVersionAtImport: themeVersion(cfg.version), type: 'SharedResources' }
  }
  if (!custom && typeof layout.theme === 'string' && layout.theme)
    custom = { name: layout.theme, reportVersionAtImport: themeVersion(cfg.version), type: 'RegisteredResources' }
  report.themeCollection = stripUndefined({ baseTheme: base, customTheme: custom })
  const reportFilters = convertFilters(parseField(layout.filters, 'report filters', diagnostics), diagnostics, 'report')
  if (reportFilters.length || cfg.filterSortOrder !== undefined) {
    const fc: J = {}
    if (reportFilters.length) fc.filters = reportFilters
    const order = enumName(FILTER_SORT, cfg.filterSortOrder)
    if (order && cfg.filterSortOrder !== 0) fc.filterSortOrder = order
    if (Object.keys(fc).length) report.filterConfig = fc
  }
  if (cfg.objects && Object.keys(cfg.objects).length) report.objects = cfg.objects
  if (Array.isArray(layout.publicCustomVisuals) && layout.publicCustomVisuals.length) report.publicCustomVisuals = layout.publicCustomVisuals
  if (packages) report.resourcePackages = packages
  if (cfg.dataSourceVariables) report.dataSourceVariables = cfg.dataSourceVariables
  const settings = convertSettings(cfg, diagnostics)
  if (settings) report.settings = settings
  if (cfg.slowDataSourceSettings) report.slowDataSourceSettings = cfg.slowDataSourceSettings

  // ---- pages
  const sections: J[] = Array.isArray(layout.sections) ? layout.sections : []
  const pods: J[] = Array.isArray(layout.pods) ? layout.pods : []
  const ordered = sections.map((s, i) => ({ s, i })).sort((a, b) => (a.s.ordinal ?? a.i) - (b.s.ordinal ?? b.i) || a.i - b.i)
  const pages: LegacyConversion['pages'] = []
  for (const { s, i } of ordered) {
    const name: string = s.name ?? `ReportSection${i}`
    const sc: J = parseField(s.config, `config of page ${name}`, diagnostics) ?? {}
    const page: J = {
      $schema: SCHEMA.page,
      name,
      displayName: s.displayName ?? name,
      displayOption: enumName(DISPLAY_OPTION, s.displayOption) ?? 'FitToPage',
      height: s.height ?? 720,
      width: s.width ?? 1280
    }
    const filters = convertFilters(parseField(s.filters, `filters of page ${name}`, diagnostics), diagnostics, `page ${name}`)
    if (filters.length) page.filterConfig = { filters }
    const pageType = sc.type === 1 ? 'Tooltip' : sc.type === 2 ? 'Drillthrough' : undefined
    const pod = pods.find((p) => p.boundSection === name)
    if (pod) {
      const podCfg: J = parseField(pod.config, `pod ${pod.name}`, diagnostics) ?? {}
      const params = parseField(pod.parameters, `pod ${pod.name} parameters`, diagnostics)
      page.pageBinding = stripUndefined({
        name: pod.name,
        type: pageType ?? 'Default',
        referenceScope: podCfg.referenceScope === 1 || pod.referenceScope === 1 ? 'CrossReport' : undefined,
        parameters: Array.isArray(params) && params.length ? params.map((p: J) => stripUndefined({ name: p.name, boundFilter: p.boundFilter, asAggregation: p.asAggregation, fieldExpr: p.fieldExpr })) : undefined,
        acceptsFilterContext: podCfg.acceptsFilterContext === 1 ? 'None' : undefined
      })
    }
    if (sc.objects && Object.keys(sc.objects).length) page.objects = sc.objects
    if (pageType) page.type = pageType
    if (sc.visibility === 1) page.visibility = 'HiddenInViewMode'
    if (Array.isArray(sc.relationships) && sc.relationships.length)
      page.visualInteractions = sc.relationships.map((r: J) => ({ source: r.source, target: r.target, type: enumName(INTERACTION, r.type) ?? 'Default' }))
    const visuals = (Array.isArray(s.visualContainers) ? s.visualContainers : []).map((vc: J, vi: number) => convertVisual(vc, vi, name, diagnostics))
    pages.push({ name, json: page, visuals })
  }
  const active = typeof cfg.activeSectionIndex === 'number' ? sections[cfg.activeSectionIndex]?.name : undefined
  const pagesMeta: LegacyConversion['pagesMeta'] = { $schema: SCHEMA.pagesMetadata, pageOrder: pages.map((p) => p.name) }
  if (active ?? pages[0]?.name) pagesMeta.activePageName = active ?? pages[0].name

  const bm = convertBookmarks(cfg.bookmarks, diagnostics)
  const reportExtensions = convertReportExtensions(cfg.modelExtensions, diagnostics)
  if (sections.some((s) => s.visualContainers?.some((vc: J) => vc.query || vc.dataTransforms)))
    diagnostics.push('Legacy layout: cached visual queries/dataTransforms are not carried over (Power BI regenerates them)')

  return {
    report,
    version: { $schema: SCHEMA.version, version: PBIR_VERSION },
    pagesMeta,
    pages,
    bookmarksMeta: bm.meta,
    bookmarks: bm.files,
    reportExtensions,
    diagnostics
  }
}
