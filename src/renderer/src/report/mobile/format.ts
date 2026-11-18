/**
 * Mobile-only formatting (View ▸ Mobile layout ▸ Format pane), like Power BI Desktop: while the phone layout is shown,
 * formatting a visual selected on the phone canvas writes to its `mobile.json` (`objects` / `visualContainerObjects`)
 * instead of visual.json, so the desktop layout is untouched.
 *
 * Merge semantics (report/mobile/layout.ts `mobileVisualJson`): a mobile object (e.g. `title`) replaces the desktop
 * object of the same name as a whole. So the first mobile edit of an object seeds the override with a copy of the
 * desktop entries, then changes the one property — the other properties keep showing their desktop values. "Reset
 * to desktop" removes the override object (and `objects` / `visualContainerObjects` / formatting keys that became
 * empty), so a visual without mobile edits keeps a byte-identical mobile.json.
 */
import type { ObjectsBag } from '@core/report/props'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { makePropContext, rawProp } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { findPage, findVisual } from '../pbir'
import { mobileVisualJson } from './layout'
import type { BagTarget } from '../../panes/visualizations/PropEditor'

type MobileKey = 'objects' | 'visualContainerObjects'

const keyOf = (container: boolean): MobileKey => (container ? 'visualContainerObjects' : 'objects')

function desktopBag(v: VisualDocument, container: boolean): ObjectsBag | undefined {
  const inner = v.json?.visual ?? v.json?.visualGroup
  return inner?.[keyOf(container)]
}

/** The visual's mobile override bag inside a draft (created on demand; the visual must be placed on the phone). */
export function mobileBag(v: VisualDocument | undefined, container: boolean, create = false): ObjectsBag | undefined {
  // not placed in the mobile layout (no mobile.json): nothing to format
  if (!v?.mobile) return undefined
  const k = keyOf(container)
  if (!v.mobile[k]) {
    if (!create) return undefined
    v.mobile[k] = {}
  }
  return v.mobile[k]
}

/** Seed a mobile override object from the desktop entries (first mobile edit of that object). */
export function seedMobileObject(v: VisualDocument, container: boolean, object: string): void {
  const bag = mobileBag(v, container, true)
  if (!bag || bag[object]) return
  const desk = desktopBag(v, container)?.[object]
  // JSON copy, not structuredClone: inside an edit `desk` is an immer draft (a Proxy), which can't be cloned structurally
  bag[object] = desk ? JSON.parse(JSON.stringify(desk)) : []
}

/** Objects of a visual that have a mobile override. */
export function mobileOverrides(v: VisualDocument | undefined): Array<{ container: boolean; object: string }> {
  const out: Array<{ container: boolean; object: string }> = []
  for (const container of [false, true]) for (const object of Object.keys(v?.mobile?.[keyOf(container)] ?? {})) out.push({ container, object })
  return out
}

/** Remove one mobile override object (or all of them when `object` is omitted): back to the desktop formatting. */
export function resetMobileFormatting(v: VisualDocument, opts: { container?: boolean; object?: string } = {}): boolean {
  if (!v.mobile) return false
  let changed = false
  for (const container of opts.container === undefined ? [false, true] : [opts.container]) {
    const k = keyOf(container)
    const bag = v.mobile[k]
    if (!bag) continue
    if (opts.object === undefined) {
      delete v.mobile[k]
      changed = true
      continue
    }
    if (opts.object in bag) {
      delete bag[opts.object]
      changed = true
    }
    if (!Object.keys(bag).length) delete v.mobile[k]
  }
  return changed
}

/** Format-pane target editing a visual's mobile formatting (see the module comment). */
export function mobileTarget(pageName: string, visual: VisualDocument, container: boolean, theme: ResolvedTheme): BagTarget {
  const merged = mobileVisualJson(visual)
  const pc = makePropContext(merged, theme)
  const locateVisual = (r: ReportDocument) => findVisual(findPage(r, pageName), visual.name)
  return {
    bag: (merged?.visual ?? merged?.visualGroup)?.[keyOf(container)],
    locate: (r) => mobileBag(locateVisual(r), container, true),
    beforeWrite: (r, _bag, object) => {
      const v = locateVisual(r)
      if (v) seedMobileObject(v, container, object)
    },
    resolveRaw: (object, prop, sel) => rawProp(pc, object, prop, sel),
    theme,
    label: 'Format visual (mobile)',
    // conditional formatting stays a desktop (visual.json) feature: the fx dialogs edit visual.json
    cf: undefined
  }
}

/** The visual a mobile-layout Format pane edits: the single visual selected on the phone canvas. */
export function mobileFormatVisual(page: PageDocument | undefined, selected: string[]): VisualDocument | undefined {
  if (!page || selected.length !== 1) return undefined
  const v = findVisual(page, selected[0])
  return v?.mobile ? v : undefined
}
