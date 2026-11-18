/**
 * Effective values for the Format pane: what a control shows when the property is neither set on the visual nor in
 * the theme. Power BI never shows an empty box there — it shows the value the visual is actually using.
 *
 * Order: explicit value → theme visualStyles (both resolved by the BagTarget) → the renderer's own default (this
 * file) → the card definition's `default` → nothing, which the controls render as "Auto" (numbers, dropdowns) or as
 * the "no color" swatch.
 *
 * The tables below mirror the fallbacks of the code that draws the thing (report/chrome.ts for the container cards,
 * visuals/elements for shapes and buttons); effective.test.ts checks the container ones against resolveChrome so they
 * cannot drift apart silently. Visuals without a table rely on their card definitions' `default`.
 */
import type { Scalar } from '@core/model/data'
import type { ResolvedTheme } from '@core/report/theme'
import { getVisual } from '../../visuals/registry'
import { SHAPE_DEFAULTS, shapeDefaultFill } from '../../visuals/elements/Shape'
import { BUTTON_DEFAULTS } from '../../visuals/elements/ActionButton'

type DefaultValue = Scalar | undefined
type DefaultTable = Record<string, DefaultValue | ((theme: ResolvedTheme) => DefaultValue)>

/** Visual types whose container title is on by default — same rule as report/chrome.ts (TITLE_ON_BY_DEFAULT). */
const TITLE_ON_BY_DEFAULT = /Chart$|^map$|^filledMap$|^azureMap$|^shapeMap$|^scatterChart$|^treemap$|^funnel$|^gauge$|^waterfallChart$|^kpi$|^decompositionTreeVisual$|^keyDriversVisual$|^qnaVisual$|^scriptVisual$|^pythonVisual$/

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
    case 'padding.top':
    case 'padding.bottom':
    case 'padding.left':
    case 'padding.right':
      return 5
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

/** Visual cards (Visual tab): the renderer default of `object.prop` for a visual type, when this file knows it. */
export function visualDefault(object: string, prop: string, theme: ResolvedTheme, visualType: string): DefaultValue {
  const v = VISUAL_TABLES[visualType]?.[`${object}.${prop}`]
  return typeof v === 'function' ? v(theme) : v
}

/** The renderer default for a property of a visual (container or visual objects), or undefined when unknown. */
export function rendererDefault(object: string, prop: string, theme: ResolvedTheme, visualType: string, container: boolean): DefaultValue {
  return container ? containerDefault(object, prop, theme, visualType) : visualDefault(object, prop, theme, visualType)
}
