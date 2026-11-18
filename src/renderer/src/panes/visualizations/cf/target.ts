/**
 * Where a conditional-formatting value lives in a visual (object / property / selector) and pure
 * helpers to find, write and remove it. Kept free of React so it can be unit-tested.
 */
import type { ObjectEntry, ObjectsBag, Selector } from '@core/report/props'
import { isDataBound } from '@core/report/props'
import { sameEntryGroup } from '@core/report/entries'
import type { FormatPropDef } from '../../../visuals/contract'
import { applyToOf, cfSelector, sameTargetSelector, type ApplyTo } from './rules'

export type CFKind = 'color' | 'text' | 'icon' | 'webURL' | 'dataBars'

export interface CFTarget {
  pageName: string
  visualName: string
  /** visualContainerObjects (title, background, …) instead of visual objects */
  container: boolean
  object: string
  prop: string
  /** the property's own selector (e.g. `{ metadata: queryRef }` for a series); undefined = default entry */
  baseSelector?: Selector
  /** the CF entry selector carries `data: [dataViewWildcard]` (per data point formatting) */
  scoped: boolean
  /** offer "Apply to" (values / totals) — table & matrix cell elements */
  applyTo?: boolean
  kind: CFKind
  /** dialog title, e.g. "Background color" */
  title: string
  /** series label shown after the title ("Background color - Sales Amount") */
  series?: string
}

/** Objects whose fx entries are per data point (`dataViewWildcard` selector), like PBI charts' Colors card. */
const DATA_POINT_OBJECTS = new Set(['dataPoint'])
/** Text props that accept field-value formatting. */
const TEXT_FX = new Set(['title.text', 'subTitle.text', 'general.altText'])

export interface CFContext {
  pageName: string
  visualName: string
  visualType: string
  container: boolean
}

/** Which kind of fx a format property supports (undefined = none). */
export function cfKindFor(def: FormatPropDef, object: string, ctx: CFContext | undefined): CFKind | undefined {
  if (!ctx) return undefined
  const flag = def.conditional
  if (flag === false) return undefined
  if (def.type === 'color') return 'color'
  if ((def.type === 'text' || def.type === 'textarea') && (flag || TEXT_FX.has(`${object}.${def.name}`))) return 'text'
  return undefined
}

export function propTarget(ctx: CFContext, object: string, def: FormatPropDef, kind: CFKind, selector?: Selector): CFTarget {
  return {
    pageName: ctx.pageName,
    visualName: ctx.visualName,
    container: ctx.container,
    object,
    prop: def.name,
    baseSelector: selector && Object.keys(selector).length ? selector : undefined,
    scoped: !ctx.container && DATA_POINT_OBJECTS.has(object),
    kind,
    title: def.displayName
  }
}

/** Cell elements (table / matrix) targets for one series. */
export function cellTarget(pageName: string, visualName: string, queryRef: string, series: string, kind: 'backColor' | 'fontColor' | 'dataBars' | 'icon' | 'webURL'): CFTarget {
  const base = { pageName, visualName, container: false, baseSelector: { metadata: queryRef }, series }
  switch (kind) {
    case 'dataBars':
      return { ...base, object: 'columnFormatting', prop: 'dataBars', scoped: false, kind: 'dataBars', title: 'Data bars' }
    case 'icon':
      return { ...base, object: 'values', prop: 'icon', scoped: true, applyTo: true, kind: 'icon', title: 'Icons' }
    case 'webURL':
      return { ...base, object: 'values', prop: 'webURL', scoped: true, applyTo: true, kind: 'webURL', title: 'Web URL' }
    case 'backColor':
      return { ...base, object: 'values', prop: 'backColor', scoped: true, applyTo: true, kind: 'color', title: 'Background color' }
    case 'fontColor':
      return { ...base, object: 'values', prop: 'fontColor', scoped: true, applyTo: true, kind: 'color', title: 'Font color' }
  }
}

function entryMatches(t: CFTarget, sel: Selector | undefined): boolean {
  if (t.scoped) return sameTargetSelector(sel, t.baseSelector) && (sel?.data ?? []).some((d: any) => d?.dataViewWildcard)
  // `{ id: 'default' }` and no selector are the same entry group (core/report/entries.ts)
  return sameEntryGroup(sel, t.baseSelector)
}

function isCFValue(t: CFTarget, raw: any): boolean {
  if (raw === undefined) return false
  if (t.kind === 'dataBars' || t.kind === 'icon') return typeof raw === 'object'
  return isDataBound(raw)
}

/** The current CF value of a target (and the selector it was found under). */
export function findCF(bag: ObjectsBag | undefined, t: CFTarget): { raw: any; selector?: Selector; applyTo: ApplyTo } | undefined {
  for (const e of bag?.[t.object] ?? []) {
    const raw = e.properties?.[t.prop]
    if (!entryMatches(t, e.selector) || !isCFValue(t, raw)) continue
    return { raw, selector: e.selector, applyTo: t.scoped ? applyToOf(e.selector) : 'values' }
  }
  return undefined
}

/**
 * Write (or with `raw === undefined` remove) a target's CF value. Removes the property from every entry
 * of the same target first (a change of "Apply to" moves it to another selector), dropping empty entries.
 */
export function writeCF(bag: ObjectsBag, t: CFTarget, raw: any, applyTo: ApplyTo = 'values'): void {
  const entries: ObjectEntry[] = bag[t.object] ?? []
  for (const e of entries.slice()) {
    if (!entryMatches(t, e.selector) || !isCFValue(t, e.properties?.[t.prop])) continue
    delete e.properties[t.prop]
    if (!Object.keys(e.properties).length) entries.splice(entries.indexOf(e), 1)
  }
  if (raw !== undefined) {
    const selector = t.scoped ? cfSelector(t.baseSelector, applyTo) : t.baseSelector
    let entry = entries.find((e) => sameEntryGroup(e.selector, selector))
    if (!entry) {
      entry = { properties: {}, ...(selector ? { selector } : {}) }
      entries.push(entry)
    }
    entry.properties ??= {}
    entry.properties[t.prop] = raw
  }
  if (entries.length) bag[t.object] = entries
  else delete bag[t.object]
}

/** Container properties whose fx value report/containerCF.ts evaluates (plus data-bound title/subtitle text). */
const CONTAINER_CF = new Set([
  'title.text', 'title.fontColor', 'title.background',
  'subTitle.text', 'subTitle.fontColor', 'subTitle.background',
  'background.color', 'border.color', 'divider.color',
  'visualHeader.background', 'visualHeader.foreground'
])

/** Chart visuals whose renderer evaluates fx on dataPoint.fill and labels.color per data point (visuals/common/categorical.ts). */
const CHART_TYPES = new Set([
  'clusteredColumnChart', 'columnChart', 'hundredPercentStackedColumnChart',
  'clusteredBarChart', 'barChart', 'hundredPercentStackedBarChart',
  'lineChart', 'areaChart', 'stackedAreaChart', 'hundredPercentStackedAreaChart',
  'lineClusteredColumnComboChart', 'lineStackedColumnComboChart', 'ribbonChart',
  'pieChart', 'donutChart'
])

/** Does Lumen's renderer evaluate CF on this property? (Otherwise it's saved for Power BI only.) */
export function cfRendered(visualType: string, t: CFTarget): boolean {
  if (t.container) return CONTAINER_CF.has(`${t.object}.${t.prop}`)
  if (visualType === 'tableEx' || visualType === 'pivotTable') return (t.object === 'values' && ['backColor', 'fontColor', 'icon', 'webURL'].includes(t.prop)) || (t.object === 'columnFormatting' && t.prop === 'dataBars')
  if (t.object === 'dataPoint' && t.prop === 'fill') return true
  if (t.object === 'labels' && t.prop === 'color' && CHART_TYPES.has(visualType)) return true
  if (visualType === 'cardVisual') return ['value.fontColor', 'label.fontColor', 'fillCustom.fillColor', 'referenceLabelValue.valueFontColor', 'referenceLabelTitle.titleFontColor'].includes(`${t.object}.${t.prop}`)
  return false
}
