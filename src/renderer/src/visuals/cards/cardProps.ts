/**
 * Scoped formatting-property resolution for the card visuals.
 *
 * The new card (`cardVisual`) stores per-callout overrides with `selector.metadata = <queryRef>`,
 * "all callouts" with `selector.id = 'default'` (or no selector), and per-reference-label
 * overrides with `selector = { metadata: <callout queryRef>, id: 'field-<guid>' }`.
 * Resolution order for a property at a scope:
 *   1. entry with the same metadata AND id (reference-label scope)
 *   2. entry with the same metadata and no (or 'default') id (callout scope)
 *   3. default entry (no selector / `id: 'default'` only)
 *   4. theme visualStyles (via core props) → caller fallback
 */
import type { Scalar } from '@core/model/data'
import { decodeValue, isDataBound, noteFallback, rawProp as coreRawProp, makePropContext, type ObjectEntry, type PropContext } from '@core/report/props'
import { DEFAULT_BASE_THEME, type ResolvedTheme } from '@core/report/theme'
import { formatDecimals } from '../common/displayUnits'

/** Interaction state of a card (format pane "States" dropdown). */
export type CardState = 'default' | 'hover' | 'selected'

export interface CardScope {
  metadata?: string
  /** reference label id ('field-…') */
  id?: string
  /** interaction state: entries with a state selector id win over the stateless ones */
  state?: CardState
}

/**
 * Selector ids PBI writes for interaction states (new-format visuals use `interaction:hover` /
 * `selection:selected`; older/other builds write bare names). Both are accepted.
 */
export const STATE_SELECTOR_IDS: Record<Exclude<CardState, 'default'>, string[]> = {
  hover: ['interaction:hover', 'hover'],
  selected: ['selection:selected', 'selected']
}

function isDefaultSelector(sel: any): boolean {
  return !sel || (!sel.metadata && !sel.data && (!sel.id || sel.id === 'default'))
}

export class CardProps {
  readonly pc: PropContext
  constructor(
    readonly visualJson: any,
    readonly theme: ResolvedTheme
  ) {
    this.pc = makePropContext(visualJson, theme)
  }

  entries(object: string): ObjectEntry[] {
    return (this.pc.objects?.[object] ?? []) as ObjectEntry[]
  }

  /** Raw (undecoded) property at a scope. */
  raw(object: string, prop: string, scope: CardScope = {}): any {
    const own = this.ownRaw(object, prop, scope)
    return own !== undefined ? own : this.themeRaw(object, prop)
  }

  /** Raw property written in the visual itself (no theme fallback, except a state-specific theme entry). */
  ownRaw(object: string, prop: string, scope: CardScope = {}): any {
    const entries = this.entries(object)
    const has = (e: ObjectEntry) => e.properties && prop in e.properties
    if (scope.state && scope.state !== 'default') {
      const ids = STATE_SELECTOR_IDS[scope.state]
      const isState = (e: ObjectEntry) => typeof e.selector?.id === 'string' && ids.includes(e.selector.id)
      if (scope.metadata) {
        const hit = entries.find((e) => has(e) && isState(e) && e.selector?.metadata === scope.metadata)
        if (hit) return hit.properties[prop]
      }
      const hit = entries.find((e) => has(e) && isState(e) && !e.selector?.metadata)
      if (hit) return hit.properties[prop]
      const themed = this.themeRaw(object, prop, ids[0])
      if (themed !== undefined && scope.metadata === undefined) return themed
    }
    if (scope.metadata && scope.id) {
      const hit = entries.find((e) => has(e) && e.selector?.metadata === scope.metadata && e.selector?.id === scope.id)
      if (hit) return hit.properties[prop]
    }
    if (scope.metadata) {
      const hit = entries.find((e) => has(e) && e.selector?.metadata === scope.metadata && (!e.selector?.id || e.selector.id === 'default'))
      if (hit) return hit.properties[prop]
    }
    const def = entries.find((e) => has(e) && isDefaultSelector(e.selector))
    if (def) return def.properties[prop]
    return undefined
  }

  /**
   * theme visualStyles only (container objects share names like "padding" but mean something else).
   * Also honours the per-visual `"*"` object wildcard (`visualStyles.cardVisual["*"]["*"]`), which
   * Microsoft documents for card defaults such as `paddingUniform` / `backgroundTransparency`.
   */
  private themeRaw(object: string, prop: string, stateId?: string): any {
    const vs = (this.theme as any).visualStyles?.[this.pc.visualType]?.['*']
    if (stateId) {
      const bag = (vs?.[object] as any[] | undefined)?.find((b) => b?.$id === stateId)
      return bag && prop in bag ? bag[prop] : undefined
    }
    const direct = coreRawProp({ ...this.pc, objects: undefined, containerObjects: undefined }, object, prop)
    if (direct !== undefined) return direct
    const wild = (vs?.['*'] as any[] | undefined)?.find((b) => b && (!b.$id || b.$id === 'default') && prop in b)
    return wild ? wild[prop] : undefined
  }

  get<T = any>(object: string, prop: string, fallback: T, scope?: CardScope): T {
    noteFallback(object, prop, fallback, scope?.metadata ? { metadata: scope.metadata } : undefined)
    const r = this.raw(object, prop, scope)
    if (r === undefined) return fallback
    if (isDataBound(r)) return fallback
    const v = decodeValue(r, this.theme)
    return (v === undefined || v === null || (typeof v === 'object' && !(v instanceof Date)) ? fallback : v) as T
  }

  bool(object: string, prop: string, fallback: boolean, scope?: CardScope): boolean {
    const v = this.get<any>(object, prop, fallback, scope)
    if (typeof v === 'boolean') return v
    if (v === 'true') return true
    if (v === 'false') return false
    return fallback
  }

  num(object: string, prop: string, fallback: number, scope?: CardScope): number {
    const v = this.get<any>(object, prop, fallback, scope)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  /** Optional number: undefined when unset. */
  optNum(object: string, prop: string, scope?: CardScope): number | undefined {
    const v = this.get<any>(object, prop, undefined, scope)
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? n : undefined
  }

  str(object: string, prop: string, fallback: string, scope?: CardScope): string {
    const v = this.get<any>(object, prop, fallback, scope)
    return v === undefined || v === null ? fallback : String(v)
  }

  /** Static color (literal / theme); data-bound colors return the fallback — use `boundColor`. */
  color(object: string, prop: string, fallback: string, scope?: CardScope): string {
    const v = this.get<any>(object, prop, fallback, scope)
    return typeof v === 'string' ? v : fallback
  }

  /** The raw value when it is data-bound (Measure / FillRule / Conditional), else undefined. */
  bound(object: string, prop: string, scope?: CardScope): any {
    const r = this.raw(object, prop, scope)
    return r !== undefined && isDataBound(r) ? r : undefined
  }
}

export interface CardTextDefaults {
  value: { family: string; size: number }
  label: { family: string; size: number; color: string }
  refTitle: { family: string; size: number; color: string }
  refValue: { family: string; size: number }
}

/**
 * Default fonts of the card texts from the theme's text classes (Learn "Create custom report themes" >
 * "Set formatted text defaults": cards and KPIs use `callout`; card category labels the "large and
 * light" label class; see the cardVisualModel header for the evidence).
 * `largeLightLabel` is a derived class: Power BI computes it from `label` (+2pt) unless the theme spells
 * it out.
 *
 * Colours of the "light" texts (category label, reference-label titles): the theme's second-level colour
 * (#605E5C) — unless the report theme gives the `label` class a colour of its own, which Power BI then
 * uses for them too (a Power BI Desktop render of a theme with a dark-blue `label` class draws both in
 * that colour, as dark as the value; approximation: the derivation rule itself is not published).
 * Reference-label values use the regular label face: on the same render they are no heavier than
 * their titles.
 */
export function cardTextDefaults(theme: ResolvedTheme): CardTextDefaults {
  const tc = theme.textClasses ?? {}
  const callout = tc.callout ?? {}
  const label = tc.label ?? {}
  const labelFace = label.fontFace ?? 'Segoe UI'
  const labelSize = label.fontSize ?? 10
  const baseLabel = DEFAULT_BASE_THEME?.textClasses?.label?.color
  const ownLabelColor = typeof label.color === 'string' && (!baseLabel || label.color.toUpperCase() !== String(baseLabel).toUpperCase()) ? label.color : undefined
  const light = ownLabelColor ?? theme.foregroundNeutralSecondary
  return {
    value: { family: callout.fontFace ?? 'DIN', size: callout.fontSize ?? 45 },
    label: { family: tc.largeLightLabel?.fontFace ?? labelFace, size: tc.largeLightLabel?.fontSize ?? labelSize + 2, color: tc.largeLightLabel?.color ?? light },
    refTitle: { family: labelFace, size: labelSize, color: light },
    refValue: { family: labelFace, size: labelSize }
  }
}

/** PBI font size property value → points (accepts '14', 14, '14pt'). */
export function toPt(v: Scalar | undefined, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** Turn an image field value into an <img src>: data URIs, URLs, inline SVG markup, base64 or binary. */
export function imageSrc(v: Scalar | undefined): string | undefined {
  if (v === null || v === undefined) return undefined
  if (v instanceof Uint8Array) {
    let s = ''
    for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i])
    const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(v).toString('base64')
    const isSvg = s.trimStart().startsWith('<')
    return `data:${isSvg ? 'image/svg+xml' : 'image/png'};base64,${b64}`
  }
  const t = String(v).trim()
  if (!t) return undefined
  if (/^data:/i.test(t) || /^https?:\/\//i.test(t) || /^blob:/i.test(t) || /^file:/i.test(t)) return t
  if (t.startsWith('<svg') || t.startsWith('<?xml')) return `data:image/svg+xml;utf8,${encodeURIComponent(t)}`
  if (/^[A-Za-z0-9+/=\s]+$/.test(t) && t.length > 32) {
    const head = t.slice(0, 8)
    const mime = head.startsWith('PHN2') || head.startsWith('PD94') ? 'image/svg+xml' : head.startsWith('/9j/') ? 'image/jpeg' : head.startsWith('R0lG') ? 'image/gif' : 'image/png'
    return `data:${mime};base64,${t.replace(/\s+/g, '')}`
  }
  return undefined
}

/**
 * Decimal places of a card value shown with display units when "Value decimal places" is unset.
 * Power BI cards keep the format string's decimals: an integer format scales to "8K" / "$22M"
 * (Learn GA card walkthrough: 7,550 units → "8K"; Store Sales sample legacy card "$22M"), while
 * formats with decimals or General keep the default 2 ("101.83M").
 */
export function cardPrecision(units: number | null | undefined, precision: number | null | undefined, formatString: string | undefined): number | undefined {
  if (precision !== undefined && precision !== null) return precision
  if (Number(units) === 1) return undefined
  return formatDecimals(formatString) === 0 ? 0 : undefined
}

/**
 * "Auto" display unit of the legacy card callout: values below 10,000 are shown in full, larger
 * values use the regular magnitude unit (Competitive Marketing sample in PBI: 9,262 → "$9,262",
 * 31,9xx → "$32K"; Store Sales: 22,xxx,xxx → "$22M"). The new card scales from 1,000 ("8K" for 7,550).
 */
export function legacyAutoUnit(value: Scalar): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  const a = Math.abs(value)
  if (a < 1e4) return 1
  return a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : 1e3
}
