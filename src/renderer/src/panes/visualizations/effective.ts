/**
 * Effective values for the Format pane: what a control shows when the property is neither set on the visual nor in
 * the theme. Power BI never shows an empty box there — it shows the value the visual is actually using.
 *
 * Order: explicit value → theme visualStyles (both resolved by the BagTarget) → the renderer's own default (this
 * file) → the card definition's `default` → nothing, which the controls render as "Auto" (numbers, dropdowns) or as
 * the "no color" swatch.
 *
 * Where the renderer's default comes from, so it is never a second copy that can drift:
 *  - visuals whose formatting is resolved by pure functions (card visual, legacy / multi-row card, table, matrix,
 *    slicers) implement `VisualDefinition.formatDefaults`: it is run over the visual's own json under
 *    core/report/props `recordFallbacks`, and each property shows the fallback its reader passed (`probedDefaults`).
 *    A second run with every switch of the Visual tab turned on fills in the properties a renderer reads only when
 *    their card is on (shadow color while the shadow is off…).
 *  - the container cards (General tab), shapes, buttons and charts: the tables below, built on the constants /
 *    resolvers the renderers use (report/chrome.ts, visuals/elements, visuals/common/fmtProps.ts).
 * effectiveDefaults.test.tsx renders every gallery fixture with an empty format definition while recording the
 * renderer's fallbacks and checks that every Visual-tab control shows exactly that value; propModel.test.ts checks
 * the container table against resolveChrome.
 */
import type { Scalar } from '@core/model/data'
import { recordFallbacks } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import type { FormatPropDef, VisualDefinition } from '../../visuals/contract'
import { getVisual } from '../../visuals/registry'
import { SHAPE_DEFAULTS, shapeDefaultFill } from '../../visuals/elements/Shape'
import { BUTTON_DEFAULTS } from '../../visuals/elements/ActionButton'
import { DEFAULT_PADDING, DEFAULT_VERTICAL_SPACING, ELEMENT_PADDING, TITLE_ON_BY_DEFAULT } from '../../report/chrome'
import { CHART_DEFAULTS, type ChartDefaultTable } from './chartDefaults'

type DefaultValue = Scalar | undefined
type DefaultTable = ChartDefaultTable

/** Is the container title shown when `title.show` is unset? (VisualContainer: registered non-chart visuals default to off.) */
export function titleOnByDefault(visualType: string): boolean {
  const def = getVisual(visualType)
  if (def && def.category !== 'chart' && def.category !== 'map') return false
  return TITLE_ON_BY_DEFAULT.test(visualType)
}

/** Container cards (General tab) — the defaults of report/chrome.ts `resolveChrome`. */
export function containerDefault(object: string, prop: string, theme: ResolvedTheme, visualType: string): DefaultValue {
  const titleClass = theme.textClasses?.title ?? {}
  switch (`${object}.${prop}`) {
    case 'title.show':
      return titleOnByDefault(visualType)
    case 'title.fontColor':
      return titleClass.color ?? theme.foreground
    case 'title.fontSize':
      return titleClass.fontSize ?? 12
    case 'title.fontFamily':
      return titleClass.fontFace ?? 'DIN'
    case 'subTitle.fontColor':
      return theme.foregroundNeutralSecondary
    case 'subTitle.fontSize':
      return 10
    case 'subTitle.fontFamily':
      return 'DIN'
    case 'divider.color':
      return theme.foregroundNeutralTertiary
    case 'divider.width':
      return 1
    case 'background.color':
      return theme.background
    case 'border.color':
      return '#CCCCCC'
    case 'border.width':
      return 1
    case 'border.radius':
      return 0
    // custom shadow: the values of the default preset (bottom right)
    case 'dropShadow.shadowSpread':
      return 3
    case 'dropShadow.shadowBlur':
    case 'dropShadow.shadowDistance':
      return 10
    case 'dropShadow.angle':
      return 45
    // data visuals: 0 / 5 / 5 / 5; elements (text box, shape, image, buttons…): 5 all around — as VisualContainer resolves them
    case 'padding.top':
    case 'padding.bottom':
    case 'padding.left':
    case 'padding.right':
      return (getVisual(visualType)?.category === 'element' ? ELEMENT_PADDING : DEFAULT_PADDING)[prop as keyof typeof DEFAULT_PADDING]
    case 'spacing.verticalSpacing':
      return DEFAULT_VERTICAL_SPACING
    case 'visualHeader.foreground':
      return '#252423'
    default:
      return undefined
  }
}

/** `text` card shared by shapes and buttons (visuals/elements/Shape.tsx readShapeText). */
const elementText = (size: number, color: string): DefaultTable => ({
  'text.show': false,
  'text.fontFamily': 'Segoe UI',
  'text.fontSize': size,
  'text.fontColor': color,
  'text.transparency': 0,
  'text.horizontalAlignment': 'center',
  'text.verticalAlignment': 'middle',
  'text.leftMargin': 10,
  'text.rightMargin': 10,
  'text.topMargin': 4,
  'text.bottomMargin': 4
})

/** Shadow / glow cards of the elements (readShadow / readGlow). */
const ELEMENT_EFFECTS: DefaultTable = {
  'shadow.show': false,
  'shadow.color': '#000000',
  'shadow.transparency': 70,
  'shadow.angle': 45,
  'shadow.shadowDistance': 10,
  'shadow.shadowBlur': 10,
  'glow.show': false,
  'glow.color': '#000000',
  'glow.transparency': 70,
  'glow.glowBlur': 10
}

const SHAPE_TABLE: DefaultTable = {
  'shape.tileShape': 'rectangle',
  'shape.rectangleRoundedCurve': SHAPE_DEFAULTS.roundedCurve,
  'rotation.shapeAngle': 0,
  'rotation.textAngle': 0,
  'fill.show': true,
  'fill.fillColor': (theme) => shapeDefaultFill(theme),
  'fill.transparency': 0,
  'outline.show': true,
  // the outline follows the fill color by default (see Shape.tsx)
  'outline.lineColor': (theme) => shapeDefaultFill(theme),
  'outline.weight': SHAPE_DEFAULTS.weight,
  'outline.transparency': 0,
  ...elementText(SHAPE_DEFAULTS.textSize, SHAPE_DEFAULTS.textColor),
  ...ELEMENT_EFFECTS
}

const BUTTON_TABLE: DefaultTable = {
  'shape.tileShape': 'rectangle',
  'shape.rectangleRoundedCurve': 0,
  'fill.show': true,
  'fill.fillColor': BUTTON_DEFAULTS.fill,
  'fill.transparency': 0,
  'outline.show': true,
  'outline.lineColor': BUTTON_DEFAULTS.outline,
  'outline.weight': 1,
  'outline.transparency': 0,
  'icon.transparency': 0,
  'icon.show': true,
  'icon.placement': 'left',
  'icon.lineColor': BUTTON_DEFAULTS.icon,
  'icon.lineWeight': BUTTON_DEFAULTS.iconWeight,
  'icon.horizontalAlignment': 'center',
  'icon.verticalAlignment': 'middle',
  ...elementText(BUTTON_DEFAULTS.textSize, BUTTON_DEFAULTS.textColor),
  ...ELEMENT_EFFECTS
}

const VISUAL_TABLES: Record<string, DefaultTable> = {
  shape: SHAPE_TABLE,
  basicShape: SHAPE_TABLE,
  actionButton: BUTTON_TABLE
}

/** Visual cards (Visual tab): the default of `object.prop` from the static tables (shapes, buttons, charts). */
export function visualDefault(object: string, prop: string, theme: ResolvedTheme, visualType: string, visualJson?: any): DefaultValue {
  const v = (VISUAL_TABLES[visualType] ?? CHART_DEFAULTS[visualType])?.[`${object}.${prop}`]
  return typeof v === 'function' ? v(theme, visualJson ?? { visual: { visualType } }) : v
}

const TRUE = { expr: { Literal: { Value: 'true' } } }

/** A copy of the visual with every unset Visual-tab switch turned on (so readers behind a switch run too). */
export function withSwitchesOn(visualJson: any, def: VisualDefinition): any {
  const v = visualJson?.visual ?? {}
  const objects: Record<string, any[]> = { ...(v.objects ?? {}) }
  for (const card of def.formatCards) {
    if (card.container || card.tab === 'general') continue
    const switches = [...new Set([...(card.toggle ? [card.toggle] : []), ...card.properties.filter((p) => p.type === 'bool').map((p) => p.name)])]
    if (!switches.length) continue
    const entries = [...(objects[card.object] ?? [])]
    const i = entries.findIndex((e) => !e?.selector || (!e.selector.metadata && !e.selector.data && (!e.selector.id || e.selector.id === 'default')))
    const base = i >= 0 ? entries[i] : { properties: {} }
    const properties = { ...base.properties }
    for (const name of switches) if (!(name in properties)) properties[name] = TRUE
    if (i >= 0) entries[i] = { ...base, properties }
    else entries.push({ properties })
    objects[card.object] = entries
  }
  return { ...visualJson, visual: { ...v, objects } }
}

type Probed = Map<string, unknown[]>
const probeCache = new WeakMap<object, { theme: ResolvedTheme; map: Probed }>()

/**
 * The fallbacks a visual's own format resolution uses for its properties (`VisualDefinition.formatDefaults`), keyed
 * `object.prop`, in reading order. Undefined for visuals without a pure format resolver. Cached per visual json
 * (report edits produce new objects) and theme.
 */
export function probedDefaults(visualJson: any, theme: ResolvedTheme): Probed | undefined {
  const def = getVisual(visualJson?.visual?.visualType ?? '')
  if (!def?.formatDefaults || !visualJson || typeof visualJson !== 'object') return undefined
  const hit = probeCache.get(visualJson)
  if (hit && hit.theme === theme) return hit.map
  const map: Probed = new Map()
  const run = (json: any, fillOnly: Set<string> | undefined) =>
    recordFallbacks(
      (object, prop, fallback) => {
        const key = `${object}.${prop}`
        if (fillOnly?.has(key)) return
        const list = map.get(key)
        if (list) list.push(fallback)
        else map.set(key, [fallback])
      },
      () => {
        try {
          def.formatDefaults!(json, theme)
        } catch {
          // a probe that cannot run leaves the properties automatic
        }
      }
    )
  run(visualJson, undefined)
  run(withSwitchesOn(visualJson, def), new Set(map.keys()))
  probeCache.set(visualJson, { theme, map })
  return map
}

const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()

/** A recorded fallback as a value of the control (undefined when it is not one: wrong type, not among the options). */
export function asControlValue(def: Pick<FormatPropDef, 'type' | 'options'> | undefined, v: unknown): DefaultValue {
  if (v === undefined || v === null) return undefined
  if (!def) return typeof v === 'object' ? undefined : (v as Scalar)
  switch (def.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined
    case 'number':
    case 'integer':
    case 'percent':
    case 'fontSize':
    case 'displayUnits': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case 'color':
      return typeof v === 'string' && /^(#|rgb)/i.test(v) ? v : undefined
    case 'enum': {
      if (!def.options?.length) return typeof v === 'string' || typeof v === 'number' ? v : undefined
      const exact = def.options.find((o) => o.value === v)
      if (exact) return exact.value
      if (typeof v !== 'string' && typeof v !== 'number') return undefined
      const k = norm(String(v))
      return def.options.find((o) => norm(String(o.value)) === k || norm(o.label) === k)?.value
    }
    case 'alignment': {
      const s = typeof v === 'string' ? v.toLowerCase() : ''
      return s === 'left' || s === 'center' || s === 'right' ? s : s === 'middle' ? 'center' : undefined
    }
    case 'fontFamily':
    case 'text':
      return typeof v === 'string' ? v : undefined
    default:
      return undefined
  }
}

/**
 * The renderer default for a property of a visual (container or visual objects), or undefined when unknown / computed
 * per render. `def` lets a recorded fallback be matched to the control (enum option, number, color).
 */
export function rendererDefault(object: string, prop: string, theme: ResolvedTheme, visualJson: any, container: boolean, def?: Pick<FormatPropDef, 'type' | 'options'>): DefaultValue {
  const visualType: string = visualJson?.visual?.visualType ?? ''
  if (container) return containerDefault(object, prop, theme, visualType)
  const probed = probedDefaults(visualJson, theme)?.get(`${object}.${prop}`)
  if (probed)
    for (const v of probed) {
      const c = asControlValue(def, v)
      if (c !== undefined) return c
    }
  const fixed = visualDefault(object, prop, theme, visualType, visualJson)
  return def ? asControlValue(def, fixed) : fixed
}
