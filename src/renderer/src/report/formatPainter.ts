/**
 * Format painter (Home ▸ Clipboard ▸ Format painter): copy the formatting of one visual and paint it onto another.
 *
 * Power BI semantics (approximated where undocumented):
 *  - same visual type: every formatting object (`visual.objects`) and container object (`visualContainerObjects`:
 *    title, subtitle, background, border, shadow, header, tooltips, padding…) is copied, replacing the target's;
 *  - different types: container objects are copied; visual objects are copied only for object names both types
 *    understand (shared chart cards like legend / axes / data labels / plot area), and series-specific entries
 *    (selectors with `metadata` / `data`) are dropped because they reference the source's fields;
 *  - content is not formatting: the target keeps its own title / subtitle text, alt text and button/link actions.
 * Pure functions + a tiny zustand store for the armed state; the canvas applies it on the next visual click.
 */
import { create } from 'zustand'
import { useApp } from '../state/store'
import { findPage, findVisual, isGroup, visualTypeOf } from './pbir'
import type { PageDocument } from '@core/report/types'
import { cloneDeep } from '@core/clone'

export interface CopiedFormat {
  visualType: string
  objects?: Record<string, any[]>
  containerObjects?: Record<string, any[]>
}

/** Object names shared by Power BI's cartesian / categorical charts (safe to paint across chart types). */
const CHART_OBJECTS = new Set(['legend', 'categoryAxis', 'valueAxis', 'labels', 'plotArea', 'zoom', 'smallMultiplesLayout', 'subheader', 'totals'])
const CHART_FAMILY = /(chart|Chart|area|Area|line|Line|scatter|ribbon|waterfall|funnel|pie|donut|treemap|combo)/

/** Content-bearing properties the painter must not overwrite (per container object). */
const CONTENT_PROPS: Record<string, string[]> = {
  title: ['text'],
  subTitle: ['text'],
  general: ['altText'],
  visualLink: ['type', 'bookmark', 'navigationSection', 'drillthroughSection', 'webUrl', 'tooltip', 'show']
}

/** Copies format entries; inside a mutation the target's entries are immer drafts (cloneDeep unwraps them). */
const clone = cloneDeep

export function copyFormat(visualJson: any): CopiedFormat | null {
  const v = visualJson?.visual ?? visualJson?.visualGroup
  if (!v) return null
  return { visualType: visualTypeOf({ name: '', json: visualJson }), objects: clone(v.objects), containerObjects: clone(v.visualContainerObjects) }
}

/** Can `fmt` be painted on a visual of `targetType`? (anything but groups can receive container formatting) */
export function canPaint(fmt: CopiedFormat | null, targetType: string): boolean {
  return !!fmt && targetType !== 'group'
}

function sharedObject(fromType: string, toType: string, object: string): boolean {
  return CHART_OBJECTS.has(object) && CHART_FAMILY.test(fromType) && CHART_FAMILY.test(toType)
}

const seriesSpecific = (entry: any) => !!(entry?.selector?.metadata || entry?.selector?.data)

/** Merge content props of the target back into painted container objects. */
function keepContent(painted: Record<string, any[]>, original: Record<string, any[]> | undefined): void {
  for (const [obj, props] of Object.entries(CONTENT_PROPS)) {
    const orig = original?.[obj]?.find((e) => !e.selector)?.properties
    const keep = orig ? props.filter((p) => p in orig) : []
    const entries = painted[obj]
    // drop the source's content values
    for (const e of entries ?? []) for (const p of props) if (!e.selector && e.properties) delete e.properties[p]
    if (!keep.length) {
      if (entries) painted[obj] = entries.filter((e) => e.selector || Object.keys(e.properties ?? {}).length)
      if (painted[obj] && !painted[obj].length) delete painted[obj]
      continue
    }
    const list = (painted[obj] ??= [])
    let base = list.find((e) => !e.selector)
    if (!base) list.unshift((base = { properties: {} }))
    base.properties ??= {}
    for (const p of keep) base.properties[p] = clone(orig![p])
  }
}

/** Paint `fmt` onto a visual.json (mutates). Returns false when nothing applies. */
export function applyFormat(targetJson: any, fmt: CopiedFormat): boolean {
  const v = targetJson?.visual
  if (!v) return false
  const toType = String(v.visualType ?? '')
  const sameType = toType === fmt.visualType
  const container: Record<string, any[]> = clone(fmt.containerObjects) ?? {}
  keepContent(container, v.visualContainerObjects)
  if (Object.keys(container).length) v.visualContainerObjects = container
  else delete v.visualContainerObjects
  if (sameType) {
    if (fmt.objects && Object.keys(fmt.objects).length) v.objects = clone(fmt.objects)
    else delete v.objects
  } else if (fmt.objects) {
    const next: Record<string, any[]> = { ...(v.objects ?? {}) }
    for (const [obj, entries] of Object.entries(fmt.objects)) {
      if (!sharedObject(fmt.visualType, toType, obj)) continue
      const generic = entries.filter((e) => !seriesSpecific(e))
      if (generic.length) next[obj] = clone(generic)
    }
    if (Object.keys(next).length) v.objects = next
  }
  return true
}

// ---------------------------------------------------------------------------------------------
// Armed state + commands
// ---------------------------------------------------------------------------------------------

interface PainterState {
  format: CopiedFormat | null
  /** source visual (to ignore clicks on itself) */
  source: string | null
  arm(format: CopiedFormat | null, source?: string | null): void
}

export const useFormatPainter = create<PainterState>()((set) => ({
  format: null,
  source: null,
  arm: (format, source = null) => set({ format, source })
}))

/** Toggle the painter from the current single selection (Home ▸ Format painter). */
export function toggleFormatPainter(): void {
  const st = useFormatPainter.getState()
  if (st.format) return st.arm(null)
  const app = useApp.getState()
  const page = findPage(app.project?.report, app.activePage)
  const name = app.selectedVisuals.length === 1 ? app.selectedVisuals[0] : null
  const v = name ? findVisual(page, name) : undefined
  if (!v || isGroup(v)) return
  const fmt = copyFormat(v.json)
  if (fmt) st.arm(fmt, v.name)
}

/** Paint onto a visual of `page` (undoable). Disarms the painter. Returns true when applied. */
export function paintOnto(page: PageDocument, visualName: string): boolean {
  const { format, source } = useFormatPainter.getState()
  if (!format || visualName === source) return false
  const v = findVisual(page, visualName)
  if (!v || !canPaint(format, visualTypeOf(v))) return false
  useApp.getState().mutateReport('Format painter', (r) => {
    const t = findVisual(findPage(r, page.name), visualName)
    if (t) applyFormat(t.json, format)
  })
  useFormatPainter.getState().arm(null)
  useApp.getState().selectVisuals([visualName])
  return true
}
