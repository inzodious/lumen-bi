/**
 * Page / bookmark navigator item lists and grid layout (pure, unit-testable).
 *
 * pageNavigator objects: `pages.showHiddenPages` (default false), `pages.showTooltipPages` (default false),
 * `pages.showByDefault` (default true), per-page `pages.showPage` with `selector.id = <page name>`.
 * bookmarkNavigator: `bookmarks.bookmarkGroup` (group name or '' = all), `bookmarks.allowDeselection`.
 * layout: `orientation` 0 = horizontal, 1 = vertical, 2 = grid; `rowCount`/`columnCount`; `cellPadding` (px gap).
 */
import { decodeLiteral } from '@core/report/literal'
import type { ReportInfo } from '../contract'

export interface NavItem {
  key: string
  label: string
  selected: boolean
}

function lit(raw: any): any {
  return raw?.expr?.Literal ? decodeLiteral(raw.expr.Literal.Value) : undefined
}

export function buildPageItems(visualJson: any, report: ReportInfo): NavItem[] {
  const entries: any[] = visualJson?.visual?.objects?.pages ?? []
  let showHidden = false
  let showTooltip = false
  let showByDefault = true
  const perPage = new Map<string, boolean>()
  for (const e of entries) {
    const p = e.properties ?? {}
    const id = e.selector?.id
    if (id && id !== 'default') {
      const v = lit(p.showPage)
      if (typeof v === 'boolean') perPage.set(id, v)
      continue
    }
    if (typeof lit(p.showHiddenPages) === 'boolean') showHidden = lit(p.showHiddenPages)
    if (typeof lit(p.showTooltipPages) === 'boolean') showTooltip = lit(p.showTooltipPages)
    if (typeof lit(p.showByDefault) === 'boolean') showByDefault = lit(p.showByDefault)
  }
  return report.pages
    .filter((pg) => {
      if (pg.isTooltip && !showTooltip) return false
      if (pg.hidden && !showHidden) return false
      return perPage.get(pg.name) ?? showByDefault
    })
    .map((pg) => ({ key: pg.name, label: pg.displayName, selected: pg.name === report.activePage }))
}

export function buildBookmarkItems(visualJson: any, report: ReportInfo, selectedBookmark?: string): NavItem[] {
  const p = visualJson?.visual?.objects?.bookmarks?.[0]?.properties ?? {}
  const group = lit(p.bookmarkGroup)
  return report.bookmarks
    .filter((b) => !group || b.group === group)
    .map((b) => ({ key: b.name, label: b.displayName, selected: b.name === selectedBookmark }))
}

/**
 * Local navigator pick (click / deselect) recorded against the host's active bookmark at that moment.
 * `name: null` = deselected ("Allow deselection").
 */
export interface BookmarkPick {
  name: string | null
  basis: string | undefined
}

/**
 * Which bookmark the navigator shows as selected. Power BI: "the selected button corresponds to the last
 * selected bookmark", and with several navigators "each navigator displays the last bookmark selected within
 * that specific navigator" (Microsoft Learn, Create page and bookmark navigators). So: the report's applied
 * bookmark (`ReportInfo.activeBookmark`) when it belongs to this navigator, unless the user picked/deselected
 * in this navigator since it became active; otherwise this navigator's own last pick.
 */
export function resolveSelectedBookmark(active: string | undefined, pick: BookmarkPick | undefined, inNavigator: (name: string) => boolean = () => true): string | undefined {
  const activeHere = active !== undefined && inNavigator(active)
  if (pick && (pick.basis === active || !activeHere)) return pick.name ?? undefined
  return activeHere ? active : undefined
}

export interface NavCell {
  x: number
  y: number
  w: number
  h: number
}

/** Lay out n buttons inside w×h. Horizontal with columnCount wraps into rows (PBI grid behavior). */
export function navLayout(n: number, width: number, height: number, opts: { orientation: number; rowCount?: number; columnCount?: number; gap: number }): NavCell[] {
  if (n <= 0) return []
  const gap = Math.max(0, opts.gap)
  let cols: number
  let rows: number
  if (opts.orientation === 1) {
    cols = 1
    rows = n
  } else if (opts.orientation === 2 || (opts.columnCount && opts.columnCount > 0) || (opts.rowCount && opts.rowCount > 0)) {
    if (opts.columnCount && opts.columnCount > 0) {
      cols = Math.min(n, opts.columnCount)
      rows = Math.ceil(n / cols)
    } else if (opts.rowCount && opts.rowCount > 0) {
      rows = Math.min(n, opts.rowCount)
      cols = Math.ceil(n / rows)
    } else {
      cols = Math.ceil(Math.sqrt(n))
      rows = Math.ceil(n / cols)
    }
  } else {
    cols = n
    rows = 1
  }
  const cw = Math.max(0, (width - gap * (cols - 1)) / cols)
  const ch = Math.max(0, (height - gap * (rows - 1)) / rows)
  const out: NavCell[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    out.push({ x: c * (cw + gap), y: r * (ch + gap), w: cw, h: ch })
  }
  return out
}
