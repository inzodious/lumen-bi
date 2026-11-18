/**
 * Visual container chrome resolution (title, subtitle, divider, spacing, background, border, shadow,
 * padding, header, tooltip, link, alt text, lock aspect) from `visual.visualContainerObjects` +
 * theme visualStyles, with Power BI's defaults. Pure — no React.
 */
import { decodeValue, getProp, isDataBound, makePropContext, rawProp, type PropContext } from '@core/report/props'
import { withTransparency, type ResolvedTheme } from '@core/report/theme'
import { fontWeightOf as sharedFontWeightOf, resolveFont } from '../visuals/common/text'
import { parseFontSize } from '../visuals/common/textStyle'

/**
 * PBI font value → CSS stack (see `resolveFont` in visuals/common/text.ts — one mapping for the container chrome and
 * the visuals). The stack keeps the named face first ("'Segoe UI Semibold', 'Segoe UI', …"), so it can be used where
 * only a family can be set (CSS variables of the filter pane).
 */
export function fontStack(name: string | undefined, fallback = "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"): string {
  if (!name) return fallback
  return resolveFont(name).fontFamily
}

/** Font weight implied by a PBI font name (Semibold / Bold / Light faces); undefined for regular faces. */
export function fontWeightOf(name: string | undefined): number | undefined {
  if (!name) return undefined
  const w = sharedFontWeightOf(name)
  return w === 400 ? undefined : w
}

export const ptToPx = (pt: number) => (pt * 4) / 3

export interface TextSpec {
  show: boolean
  /** literal text, or undefined when auto / data-bound */
  text?: string
  /** raw data-bound expression (Measure etc.) to evaluate */
  boundExpr?: any
  color: string
  background?: string
  fontSizePx: number
  fontFamily: string
  fontWeight: number
  italic: boolean
  underline: boolean
  align: 'left' | 'center' | 'right'
  wrap: boolean
}

/**
 * Title-area spacing. Power BI has had two models (both occur in files):
 *  - "below" (until mid-2026): `verticalSpacing` (one value, default 5 px) or, with `customizeSpacing`, a space below
 *    each element — `spaceBelowTitle`, `spaceBelowSubTitle`, `spaceBelowTitleArea` (= below the divider);
 *  - "above" (July 2026 format pane): `spaceAboveSubtitle`, `spaceAboveDivider`, `spaceAbovePlotArea`.
 */
export interface SpacingSpec {
  model: 'below' | 'above'
  belowTitle: number
  belowSubTitle: number
  belowDivider: number
  aboveSubTitle: number
  aboveDivider: number
  abovePlotArea: number
}

/** Gaps (px) between the title-area elements that are actually shown and the visual content. */
export function titleAreaGaps(sp: SpacingSpec, shown: { title: boolean; subTitle: boolean; divider: boolean }): { titleToSubTitle: number; aboveDivider: number; aboveContent: number } {
  const anyText = shown.title || shown.subTitle
  if (sp.model === 'above') {
    return {
      titleToSubTitle: shown.title && shown.subTitle ? sp.aboveSubTitle : 0,
      aboveDivider: shown.divider && anyText ? sp.aboveDivider : 0,
      aboveContent: anyText || shown.divider ? sp.abovePlotArea : 0
    }
  }
  // every shown element is followed by its own space (measured on Power BI renders: title, 5, subtitle, 5, divider, 5)
  const belowText = shown.subTitle ? sp.belowSubTitle : shown.title ? sp.belowTitle : 0
  return {
    titleToSubTitle: shown.title && shown.subTitle ? sp.belowTitle : 0,
    aboveDivider: shown.divider ? belowText : 0,
    aboveContent: shown.divider ? sp.belowDivider : belowText
  }
}

export interface ShadowSpec {
  css: string
  inset: boolean
}

export interface ChromeSpec {
  title: TextSpec
  subTitle: TextSpec
  divider?: { color: string; style: string; width: number; ignorePadding: boolean }
  /** vertical gaps of the title area (px), see `titleAreaGaps` */
  spacing: SpacingSpec
  background?: string
  border?: { color: string; width: number; radius: number }
  radius: number
  shadow?: ShadowSpec
  padding: { top: number; right: number; bottom: number; left: number }
  header: {
    show: boolean
    background?: string
    foreground: string
    border?: string
    showFilter: boolean
    showFocus: boolean
    showMore: boolean
    showDrill: boolean
    showInfo: boolean
    /** individual drill buttons (PBI visualHeader showDrillUpButton / showDrillDownLevelButton / showDrillDownExpandButton / showDrillRoleSelector) */
    showDrillUp: boolean
    showDrillLevel: boolean
    showDrillExpand: boolean
    showDrillRoleSelector: boolean
    /** help tooltip icon ("?") with visualHeaderTooltip text */
    helpTooltip?: { text: string; title?: string; color?: string; background?: string }
  }
  tooltip: {
    show: boolean
    type: 'Default' | 'Canvas'
    section?: string
    /** default tooltip styling (visualTooltip / theme): label + value colors, background, font */
    labelColor?: string
    valueColor?: string
    background?: string
    fontSizePx?: number
    fontFamily?: string
  }
  link?: { type: string; bookmark?: string; navigationSection?: string; drillthroughSection?: string; webUrl?: string; tooltip?: string; disabledTooltip?: string }
  altText?: string
  lockAspect: boolean
}

/** Visual types whose container title is on by default (charts / maps). Also read by the Format pane (effective.ts). */
export const TITLE_ON_BY_DEFAULT = /Chart$|^map$|^filledMap$|^azureMap$|^shapeMap$|^scatterChart$|^treemap$|^funnel$|^gauge$|^waterfallChart$|^kpi$|^decompositionTreeVisual$|^keyDriversVisual$|^qnaVisual$|^scriptVisual$|^pythonVisual$/

const num = (v: any, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: any, d: string) => (typeof v === 'string' && v ? v : d)
const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d)

function textSpec(ctx: PropContext, object: string, theme: ResolvedTheme, defaults: { show: boolean; sizePt: number; color: string; font: string }): TextSpec {
  const rawText = rawProp(ctx, object, 'text')
  const bound = rawText !== undefined && isDataBound(rawText)
  const text = bound ? undefined : (decodeValue(rawText, theme) as string | undefined)
  const fontName = getProp<string>(ctx, object, 'fontFamily', defaults.font)
  const bg = getProp<any>(ctx, object, 'background', undefined)
  const bgTransparency = getProp<number>(ctx, object, 'transparency', 0)
  const font = resolveFont(fontName, { bold: getProp<boolean>(ctx, object, 'bold', false) === true })
  return {
    show: bool(getProp(ctx, object, 'show', defaults.show), defaults.show),
    text: typeof text === 'string' ? text : undefined,
    boundExpr: bound ? rawText : undefined,
    color: str(getProp(ctx, object, 'fontColor', defaults.color), defaults.color),
    background: typeof bg === 'string' ? withTransparency(bg, bgTransparency) : undefined,
    // points; files also carry the size as a string literal ('14') or with a unit
    fontSizePx: parseFontSize(getProp(ctx, object, 'fontSize', defaults.sizePt), defaults.sizePt),
    fontFamily: font.fontFamily,
    fontWeight: font.fontWeight,
    italic: getProp<boolean>(ctx, object, 'italic', false) === true,
    underline: getProp<boolean>(ctx, object, 'underline', false) === true,
    align: (['left', 'center', 'right'].includes(String(getProp(ctx, object, 'alignment', 'left')).toLowerCase())
      ? String(getProp(ctx, object, 'alignment', 'left')).toLowerCase()
      : 'left') as TextSpec['align'],
    wrap: getProp<boolean>(ctx, object, 'titleWrap', true) !== false
  }
}

/**
 * Power BI's default container padding for data visuals: none at the top, 5 px on the other sides. Measured on a
 * Power BI Desktop render of a default-theme Microsoft sample (four chart / map visuals without any padding setting):
 * the title's line box starts at the container's top edge and its text 5 px from the left edge (Lumen's titles then
 * land within 1 px of Power BI's). Microsoft doesn't publish the values; format-pane screenshots of the Padding card
 * (top 0 px, bottom 5 px on otherwise customised visuals) agree.
 */
export const DEFAULT_PADDING = { top: 0, right: 5, bottom: 5, left: 5 } as const
/**
 * Elements (text box, shape, image, buttons, navigators) keep 5 px on every side. Unverified: Power BI's defaults vary
 * by visual type and aren't published; on the same render a text box's text sits lower than a 0 px top padding gives.
 */
export const ELEMENT_PADDING = { top: 5, right: 5, bottom: 5, left: 5 } as const
/** Power BI's "Vertical spacing" default (format pane ▸ Title ▸ Spacing, Customize spacing off). */
export const DEFAULT_VERTICAL_SPACING = 5

function spacingSpec(ctx: PropContext): SpacingSpec {
  const n = (prop: string): number | undefined => {
    const v = getProp<any>(ctx, 'spacing', prop, undefined)
    const x = typeof v === 'string' ? Number(v) : v
    return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : undefined
  }
  const custom = getProp<boolean>(ctx, 'spacing', 'customizeSpacing', false) === true
  const vertical = n('verticalSpacing') ?? DEFAULT_VERTICAL_SPACING
  const above = { sub: n('spaceAboveSubtitle'), divider: n('spaceAboveDivider'), plot: n('spaceAbovePlotArea') }
  const hasAbove = above.sub !== undefined || above.divider !== undefined || above.plot !== undefined
  return {
    // files saved by the July 2026+ format pane carry the "above" properties (older ones may linger next to them)
    model: hasAbove ? 'above' : 'below',
    belowTitle: custom ? (n('spaceBelowTitle') ?? vertical) : vertical,
    belowSubTitle: custom ? (n('spaceBelowSubTitle') ?? vertical) : vertical,
    belowDivider: custom ? (n('spaceBelowTitleArea') ?? vertical) : vertical,
    // a missing "above" value falls back to the single vertical spacing (approximation: the new defaults aren't documented)
    aboveSubTitle: above.sub ?? vertical,
    aboveDivider: above.divider ?? vertical,
    abovePlotArea: above.plot ?? vertical
  }
}

const SHADOW_PRESETS: Record<string, { angle: number; distance: number; blur: number; spread: number; inset?: boolean }> = {
  BottomRight: { angle: 45, distance: 10, blur: 10, spread: 3 },
  Bottom: { angle: 90, distance: 10, blur: 10, spread: 3 },
  BottomLeft: { angle: 135, distance: 10, blur: 10, spread: 3 },
  Right: { angle: 0, distance: 10, blur: 10, spread: 3 },
  Center: { angle: 0, distance: 0, blur: 10, spread: 3 },
  Left: { angle: 180, distance: 10, blur: 10, spread: 3 },
  TopRight: { angle: -45, distance: 10, blur: 10, spread: 3 },
  Top: { angle: -90, distance: 10, blur: 10, spread: 3 },
  TopLeft: { angle: -135, distance: 10, blur: 10, spread: 3 },
  InsideBottomRight: { angle: 45, distance: 5, blur: 5, spread: 0, inset: true },
  InsideCenter: { angle: 0, distance: 0, blur: 10, spread: 3, inset: true },
  InsideTopLeft: { angle: -135, distance: 5, blur: 5, spread: 0, inset: true }
}

export interface ChromeOptions {
  titleOnByDefault?: boolean
  /** text box / shape / image / button / navigator: see `ELEMENT_PADDING` */
  element?: boolean
}

export function resolveChrome(visualJson: any, theme: ResolvedTheme, opts: ChromeOptions = {}): ChromeSpec {
  // container formatting lives in `visualContainerObjects` only: a visual's own `objects` can use the same names for
  // something else (the card visual's `divider` / `padding`, a slicer's `header`…) and must not leak into the chrome
  const ctx: PropContext = { ...makePropContext(visualJson, theme), objects: undefined }
  const vt = ctx.visualType
  const fg = theme.foreground
  const titleClass = theme.textClasses?.title ?? {}
  const titleDefault = opts.titleOnByDefault ?? TITLE_ON_BY_DEFAULT.test(vt)
  const title = textSpec(ctx, 'title', theme, { show: titleDefault, sizePt: titleClass.fontSize ?? 12, color: titleClass.color ?? fg, font: titleClass.fontFace ?? 'DIN' })
  const subTitle = textSpec(ctx, 'subTitle', theme, { show: false, sizePt: 10, color: theme.foregroundNeutralSecondary, font: 'DIN' })
  // Power BI has one background for the whole title block (the subtitle has no background of its own)
  subTitle.background = title.background
  // The format pane's Title card toggle (`title.show`) switches the whole card: title, subtitle and divider
  if (!title.show) subTitle.show = false

  const dividerOn = title.show && getProp<boolean>(ctx, 'divider', 'show', false) === true
  const divider = dividerOn
    ? {
        color: str(getProp(ctx, 'divider', 'color', theme.foregroundNeutralTertiary), theme.foregroundNeutralTertiary),
        style: str(getProp(ctx, 'divider', 'style', 'solid'), 'solid'),
        width: num(getProp(ctx, 'divider', 'width', 1), 1),
        ignorePadding: getProp<boolean>(ctx, 'divider', 'ignorePadding', true) !== false
      }
    : undefined

  const spacing = spacingSpec(ctx)

  const bgShow = getProp<boolean>(ctx, 'background', 'show', true) !== false
  const bgColor = str(getProp(ctx, 'background', 'color', theme.background), theme.background)
  const bgTransparency = num(getProp(ctx, 'background', 'transparency', 0), 0)

  const borderShow = getProp<boolean>(ctx, 'border', 'show', false) === true
  const radius = num(getProp(ctx, 'border', 'radius', 0), 0)
  const border = borderShow
    ? { color: str(getProp(ctx, 'border', 'color', '#CCCCCC'), '#CCCCCC'), width: num(getProp(ctx, 'border', 'width', 1), 1), radius }
    : undefined

  let shadow: ShadowSpec | undefined
  if (getProp<boolean>(ctx, 'dropShadow', 'show', false) === true) {
    const preset = SHADOW_PRESETS[str(getProp(ctx, 'dropShadow', 'preset', 'BottomRight'), 'BottomRight')] ?? SHADOW_PRESETS.BottomRight
    const custom = str(getProp(ctx, 'dropShadow', 'preset', 'BottomRight'), '') === 'Custom'
    const color = str(getProp(ctx, 'dropShadow', 'color', '#000000'), '#000000')
    const transparency = num(getProp(ctx, 'dropShadow', 'transparency', 70), 70)
    const angle = custom ? num(getProp(ctx, 'dropShadow', 'angle', preset.angle), preset.angle) : preset.angle
    const distance = custom ? num(getProp(ctx, 'dropShadow', 'shadowDistance', preset.distance), preset.distance) : preset.distance
    const blur = custom ? num(getProp(ctx, 'dropShadow', 'shadowBlur', preset.blur), preset.blur) : preset.blur
    const spread = custom ? num(getProp(ctx, 'dropShadow', 'shadowSpread', preset.spread), preset.spread) : preset.spread
    const inset = custom ? getProp<string>(ctx, 'dropShadow', 'position', 'Outer') === 'Inner' : !!preset.inset
    const rad = (angle * Math.PI) / 180
    const dx = Math.round(Math.cos(rad) * distance * 100) / 100
    const dy = Math.round(Math.sin(rad) * distance * 100) / 100
    shadow = { css: `${inset ? 'inset ' : ''}${dx}px ${dy}px ${blur}px ${spread}px ${withTransparency(color, transparency)}`, inset }
  }

  const padDefaults = opts.element ? ELEMENT_PADDING : DEFAULT_PADDING
  const pad = (side: 'top' | 'right' | 'bottom' | 'left') => Math.max(0, num(getProp(ctx, 'padding', side, padDefaults[side]), padDefaults[side]))
  const headerShow = getProp<boolean>(ctx, 'visualHeader', 'show', true) !== false
  const hb = getProp<any>(ctx, 'visualHeader', 'background', undefined)
  const hbo = getProp<any>(ctx, 'visualHeader', 'border', undefined)

  const tooltipType = str(getProp(ctx, 'visualTooltip', 'type', 'Default'), 'Default')
  const linkShow = getProp<boolean>(ctx, 'visualLink', 'show', false) === true
  const link = linkShow
    ? {
        type: str(getProp(ctx, 'visualLink', 'type', 'Back'), 'Back'),
        bookmark: getProp<string | undefined>(ctx, 'visualLink', 'bookmark', undefined),
        navigationSection: getProp<string | undefined>(ctx, 'visualLink', 'navigationSection', undefined),
        drillthroughSection: getProp<string | undefined>(ctx, 'visualLink', 'drillthroughSection', undefined),
        webUrl: getProp<string | undefined>(ctx, 'visualLink', 'webUrl', undefined),
        tooltip: getProp<string | undefined>(ctx, 'visualLink', 'tooltip', undefined) ?? getProp<string | undefined>(ctx, 'visualLink', 'tooltipPlaceholderText', undefined),
        disabledTooltip: getProp<string | undefined>(ctx, 'visualLink', 'disabledTooltip', undefined)
      }
    : undefined

  return {
    title,
    subTitle,
    divider,
    spacing,
    background: bgShow ? withTransparency(bgColor, bgTransparency) : undefined,
    border,
    radius,
    shadow,
    padding: { top: pad('top'), right: pad('right'), bottom: pad('bottom'), left: pad('left') },
    header: {
      show: headerShow,
      background: typeof hb === 'string' ? withTransparency(hb, num(getProp(ctx, 'visualHeader', 'transparency', 0), 0)) : undefined,
      foreground: str(getProp(ctx, 'visualHeader', 'foreground', '#252423'), '#252423'),
      border: typeof hbo === 'string' ? hbo : undefined,
      showFilter: getProp<boolean>(ctx, 'visualHeader', 'showFilterRestatementButton', true) !== false,
      showFocus: getProp<boolean>(ctx, 'visualHeader', 'showFocusModeButton', true) !== false,
      showMore: getProp<boolean>(ctx, 'visualHeader', 'showOptionsMenu', true) !== false,
      showDrill: getProp<boolean>(ctx, 'visualHeader', 'showDrillToggleButton', true) !== false,
      showInfo: getProp<boolean>(ctx, 'visualHeader', 'showVisualInformationButton', true) !== false,
      showDrillUp: getProp<boolean>(ctx, 'visualHeader', 'showDrillUpButton', true) !== false,
      showDrillLevel: getProp<boolean>(ctx, 'visualHeader', 'showDrillDownLevelButton', true) !== false,
      showDrillExpand: getProp<boolean>(ctx, 'visualHeader', 'showDrillDownExpandButton', true) !== false,
      showDrillRoleSelector: getProp<boolean>(ctx, 'visualHeader', 'showDrillRoleSelector', true) !== false,
      helpTooltip: helpTooltipOf(ctx)
    },
    tooltip: {
      show: getProp<boolean>(ctx, 'visualTooltip', 'show', true) !== false,
      type: tooltipType === 'Canvas' || tooltipType === 'ReportPage' ? 'Canvas' : 'Default',
      section: getProp<string | undefined>(ctx, 'visualTooltip', 'section', undefined),
      ...tooltipStyle(ctx)
    },
    link,
    altText: getProp<string | undefined>(ctx, 'general', 'altText', undefined),
    lockAspect: getProp<boolean>(ctx, 'lockAspect', 'show', false) === true
  }
}

/** Visual header help tooltip (PBI: header "Help tooltip" icon + `visualHeaderTooltip` text / title / colors). */
function helpTooltipOf(ctx: PropContext): ChromeSpec['header']['helpTooltip'] {
  if (getProp<boolean>(ctx, 'visualHeader', 'showTooltipButton', false) !== true) return undefined
  const text = getProp<any>(ctx, 'visualHeaderTooltip', 'text', undefined)
  if (typeof text !== 'string' || !text.trim()) return undefined
  const title = getProp<any>(ctx, 'visualHeaderTooltip', 'title', undefined)
  const color = getProp<any>(ctx, 'visualHeaderTooltip', 'fontColor', undefined)
  const bg = getProp<any>(ctx, 'visualHeaderTooltip', 'background', undefined)
  return { text, title: typeof title === 'string' && title ? title : undefined, color: typeof color === 'string' ? color : undefined, background: typeof bg === 'string' ? bg : undefined }
}

/** Default tooltip styling from `visualTooltip` (visual or theme): PBI labels use titleFontColor, values valueFontColor. */
function tooltipStyle(ctx: PropContext): Partial<ChromeSpec['tooltip']> {
  const out: Partial<ChromeSpec['tooltip']> = {}
  const label = getProp<any>(ctx, 'visualTooltip', 'titleFontColor', undefined)
  const value = getProp<any>(ctx, 'visualTooltip', 'valueFontColor', undefined)
  const bg = getProp<any>(ctx, 'visualTooltip', 'background', undefined)
  const transparency = num(getProp(ctx, 'visualTooltip', 'transparency', 0), 0)
  const size = getProp<any>(ctx, 'visualTooltip', 'fontSize', undefined)
  const family = getProp<any>(ctx, 'visualTooltip', 'fontFamily', undefined)
  if (typeof label === 'string') out.labelColor = label
  if (typeof value === 'string') out.valueColor = value
  if (typeof bg === 'string') out.background = withTransparency(bg, transparency)
  if (typeof size === 'number' && size > 0) out.fontSizePx = ptToPx(size)
  if (typeof family === 'string' && family) out.fontFamily = fontStack(family)
  return out
}

/** Group container chrome (visualGroup.objects: background / border / dropShadow …). */
export function resolveGroupChrome(groupJson: any, theme: ResolvedTheme): { background?: string; border?: ChromeSpec['border']; shadow?: ShadowSpec; radius: number } {
  const c = resolveChrome({ visual: { visualType: 'group', visualContainerObjects: groupJson?.visualGroup?.objects ?? {} } }, theme, { titleOnByDefault: false })
  return { background: c.background, border: c.border, shadow: c.shadow, radius: c.radius }
}
