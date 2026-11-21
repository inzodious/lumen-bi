/**
 * Conditional formatting (fx) for every color property of a visual.
 *
 * Visuals evaluate the fx colors they draw per data point themselves (chart data colors and data labels, table and
 * matrix cells, the new card's per-callout colors). Every other color property can be data-bound too (the Format pane
 * offers fx on all of them): such a color has one value for the whole visual, so it is evaluated once in the visual's
 * filter context, like Power BI does for container colors (containerCF.ts), and the visual is rendered with the
 * resulting literal color. A rule that yields no color (blank input, no matching rule) drops the property, so the
 * visual draws its default.
 */
import { isDataBound } from '@core/report/props'
import type { VisualDocument } from '@core/report/types'
import type { VisualHostContext } from '../visuals/contract'
import { evalBoundColor } from './containerCF'

/** Visual types that evaluate every fx color themselves. */
const NATIVE_TYPES = new Set(['cardVisual'])
/** Objects whose fx colors are evaluated per data point by the visuals that have them. */
const NATIVE_OBJECTS = new Set(['dataPoint', 'columnFormatting'])
/** Single properties evaluated per data point (categorical charts' data labels, table / matrix cell elements). */
const NATIVE_PROPS = new Set(['labels.color', 'values.fontColor', 'values.backColor'])

const isColorBound = (raw: any) => !!raw?.solid?.color?.expr && isDataBound(raw)

/** Does the visual have an fx color this module evaluates? */
export function hasVisualBoundColors(visualJson: any): boolean {
  const v = visualJson?.visual
  if (!v?.objects || NATIVE_TYPES.has(v.visualType)) return false
  for (const [object, entries] of Object.entries<any>(v.objects)) {
    if (NATIVE_OBJECTS.has(object) || !Array.isArray(entries)) continue
    for (const e of entries) {
      if (e?.selector?.data) continue
      for (const [prop, raw] of Object.entries<any>(e?.properties ?? {})) if (!NATIVE_PROPS.has(`${object}.${prop}`) && isColorBound(raw)) return true
    }
  }
  return false
}

const literal = (hex: string) => ({ solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } })

/** The visual with its visual-level fx colors replaced by their current values (the same object when it has none). */
export function resolveBoundColors(visual: VisualDocument, ctx: VisualHostContext | null): VisualDocument {
  if (!ctx || !hasVisualBoundColors(visual.json)) return visual
  const v = visual.json.visual
  const objects: Record<string, any[]> = {}
  for (const [object, entries] of Object.entries<any>(v.objects)) {
    if (NATIVE_OBJECTS.has(object) || !Array.isArray(entries)) {
      objects[object] = entries
      continue
    }
    objects[object] = entries.map((e: any) => {
      if (e?.selector?.data || !e?.properties) return e
      let props: Record<string, any> | undefined
      for (const [prop, raw] of Object.entries<any>(e.properties)) {
        if (NATIVE_PROPS.has(`${object}.${prop}`) || !isColorBound(raw)) continue
        const next: Record<string, any> = (props ??= { ...e.properties })
        const c = evalBoundColor(raw, ctx)
        if (c && (/^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]{3,20}$/i.test(c))) next[prop] = literal(c)
        else delete next[prop]
      }
      return props ? { ...e, properties: props } : e
    })
  }
  return { ...visual, json: { ...visual.json, visual: { ...v, objects } } }
}
