/**
 * Button / shape / image actions (`visualContainerObjects.visualLink`):
 *   show, type: 'Back' | 'Bookmark' | 'Drillthrough' | 'PageNavigation' | 'QnA' | 'WebUrl' | 'ClearAllSlicers' | 'ApplyAllSlicers',
 *   bookmark, drillthroughSection, navigationSection, webUrl, tooltip, disabledTooltip, tooltipPlaceholderText.
 * Destinations can be conditional (data-bound to a measure returning the page/bookmark name or URL).
 */
import { decodeLiteral } from '@core/report/literal'
import { fieldInfo, fieldKey, type DataPointIdentity, type SQExpr } from '@core/report/sq'
import type { ReportInfo, VisualActions } from '../contract'

export type ActionType = 'Back' | 'Bookmark' | 'Drillthrough' | 'PageNavigation' | 'QnA' | 'WebUrl' | 'ClearAllSlicers' | 'ApplyAllSlicers'

export interface ActionSpec {
  type: ActionType
  /** literal destination (page name, bookmark name, URL) */
  target?: string
  /** data-bound destination (measure) — evaluated by the caller */
  targetExpr?: SQExpr
  tooltip?: string
  /** tooltip of the disabled state (`disabledTooltip`) */
  disabledTooltip?: string
}

const TYPES: Record<string, ActionType> = {
  back: 'Back',
  bookmark: 'Bookmark',
  drillthrough: 'Drillthrough',
  pagenavigation: 'PageNavigation',
  qna: 'QnA',
  weburl: 'WebUrl',
  clearallslicers: 'ClearAllSlicers',
  applyallslicers: 'ApplyAllSlicers'
}

function lit(raw: any): any {
  if (raw && typeof raw === 'object' && raw.expr?.Literal) return decodeLiteral(raw.expr.Literal.Value)
  return undefined
}

function fieldOf(raw: any): SQExpr | undefined {
  const e = raw?.expr
  return e && (e.Measure || e.Aggregation || e.Column) ? e : undefined
}

const TARGET_PROP: Partial<Record<ActionType, string>> = {
  Bookmark: 'bookmark',
  Drillthrough: 'drillthroughSection',
  PageNavigation: 'navigationSection',
  WebUrl: 'webUrl'
}

/** Read the action from a visual.json (`visual.visualContainerObjects.visualLink`). undefined when off. */
export function readAction(visualJson: any): ActionSpec | undefined {
  const entries: any[] = visualJson?.visual?.visualContainerObjects?.visualLink ?? visualJson?.visual?.objects?.visualLink ?? []
  const props: Record<string, any> = {}
  for (const e of entries) if (!e.selector || e.selector.id === 'default') Object.assign(props, e.properties)
  if (lit(props.show) === false) return undefined
  const t = TYPES[String(lit(props.type) ?? '').toLowerCase()]
  if (!t) return undefined
  const tp = TARGET_PROP[t]
  const raw = tp ? props[tp] : undefined
  const target = lit(raw)
  const tooltip = lit(props.tooltip) ?? lit(props.tooltipPlaceholderText)
  const disabledTooltip = lit(props.disabledTooltip)
  return {
    type: t,
    target: typeof target === 'string' && target ? target : undefined,
    targetExpr: fieldOf(raw),
    tooltip: typeof tooltip === 'string' && tooltip ? tooltip : undefined,
    disabledTooltip: typeof disabledTooltip === 'string' && disabledTooltip ? disabledTooltip : undefined
  }
}

/** Page name for a navigation target that may be a page display name (measure-bound destinations return display names). */
export function resolvePageName(target: string, report: ReportInfo): string | undefined {
  const byName = report.pages.find((p) => p.name === target)
  if (byName) return byName.name
  const byDisplay = report.pages.find((p) => p.displayName === target) ?? report.pages.find((p) => p.displayName.toLowerCase() === target.toLowerCase())
  return byDisplay?.name
}

export function resolveBookmarkName(target: string, report: ReportInfo): string | undefined {
  return (report.bookmarks.find((b) => b.name === target) ?? report.bookmarks.find((b) => b.displayName === target))?.name
}

export interface DrillthroughButtonState {
  enabled: boolean
  /** identity to drill through with (the page's selected data point) */
  identity?: DataPointIdentity
  /** Power BI's default tooltip for the state */
  tooltip: string
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Drill-through button state (Power BI semantics): enabled only when exactly one data point is selected on
 * the page and it carries at least one of the destination page's drill-through fields. Default tooltips:
 *   enabled  "Click to drill through to <page>"
 *   disabled "To drill through to <page>, select a data point from <field(s)>"  /  multi-select:
 *            "Select a single data point to drill through" (multi-point drill through isn't supported here
 *            because the host drill-through API takes one identity — disabled rather than silently using one).
 * Hosts that don't report the destination's fields (`pages[].drillthroughFields` undefined) keep the
 * previous behavior: enabled whenever the page exists, drilling with the selection if any.
 */
export function drillthroughState(target: string | undefined, report: ReportInfo, pageSelection: DataPointIdentity[] | undefined): DrillthroughButtonState {
  const name = target ? resolvePageName(target, report) : undefined
  const page = name ? report.pages.find((p) => p.name === name) : undefined
  if (!page) return { enabled: false, tooltip: target ? `The page "${target}" doesn't exist` : 'Choose a drillthrough destination' }
  const sel = pageSelection ?? []
  const fields = page.drillthroughFields
  if (!fields) return { enabled: true, identity: sel[0], tooltip: `Click to drill through to ${page.displayName}` }
  const names = [...new Set(fields.map((f) => fieldInfo(f).property ?? fieldKey(f)))]
  const needs = `To drill through to ${page.displayName}, select a data point from ${joinNames(names)}`
  if (!fields.length || !sel.length) return { enabled: false, tooltip: needs }
  if (sel.length > 1) return { enabled: false, tooltip: 'Select a single data point to drill through' }
  const keys = new Set(fields.map((f) => fieldKey(f)))
  if (!sel[0].fields.some((f) => keys.has(fieldKey(f.expr)))) return { enabled: false, tooltip: needs }
  return { enabled: true, identity: sel[0], tooltip: `Click to drill through to ${page.displayName}` }
}

/** Is the action executable (disabled buttons render their "disabled" state)? */
export function actionEnabled(a: ActionSpec | undefined, target: string | undefined, report: ReportInfo): boolean {
  if (!a) return false
  switch (a.type) {
    case 'PageNavigation':
    case 'Drillthrough':
      return !!target && !!resolvePageName(target, report)
    case 'Bookmark':
      return !!target && !!resolveBookmarkName(target, report)
    case 'WebUrl':
      return !!target
    default:
      return true
  }
}

/** Execute an action. `target` = resolved destination (literal or evaluated measure). Returns what ran. */
export function runAction(a: ActionSpec, target: string | undefined, actions: VisualActions, report: ReportInfo, identity?: DataPointIdentity): string | undefined {
  switch (a.type) {
    case 'Back':
      actions.back()
      return 'back'
    case 'PageNavigation': {
      const p = target ? resolvePageName(target, report) : undefined
      if (!p) return undefined
      actions.navigatePage(p)
      return `page:${p}`
    }
    case 'Drillthrough': {
      const p = target ? resolvePageName(target, report) : undefined
      if (!p) return undefined
      // Buttons drill through with the page's selected data point; the canvas adds the context filters.
      actions.drillthrough(p, identity ?? { fields: [] })
      return `drillthrough:${p}`
    }
    case 'Bookmark': {
      const b = target ? resolveBookmarkName(target, report) : undefined
      if (!b) return undefined
      actions.applyBookmark(b)
      return `bookmark:${b}`
    }
    case 'WebUrl':
      if (!target) return undefined
      actions.openUrl(target)
      return `url:${target}`
    case 'ClearAllSlicers':
      actions.clearAllSlicers()
      return 'clearAllSlicers'
    case 'ApplyAllSlicers':
      // Slicers in Lumen apply immediately, so "Apply all slicers" has nothing pending to apply.
      return 'applyAllSlicers'
    case 'QnA':
      // Q&A is not available offline.
      return undefined
  }
}
