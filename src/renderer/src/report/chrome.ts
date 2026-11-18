/**
 * Visual container chrome resolution (title, subtitle, divider, spacing, background, border, shadow,
 * padding, header, tooltip, link, alt text, lock aspect) from `visual.visualContainerObjects` +
 * theme visualStyles, with Power BI's defaults. Pure — no React.
 */
import { decodeValue, getProp, isDataBound, makePropContext, rawProp, type PropContext } from '@core/report/props'
import { withTransparency, type ResolvedTheme } from '@core/report/theme'

/** PBI font names → CSS stacks. PBI's "DIN" / "Segoe UI" both render as Segoe UI in Desktop. */
export function fontStack(name: string | undefined, fallback = "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"): string {
  if (!name) return fallback
  const n = name.replace(/^'+|'+$/g, '').trim()
  if (/,/.test(name)) return name // already a stack (e.g. "'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica…")
  switch (n) {
    case 'DIN':
    case 'Segoe UI':
    case 'wf_standard-font':
      return "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"
    case 'Segoe UI Semibold':
    case 'wf_segoe-ui_semibold':
      return "'Segoe UI Semibold', 'Segoe UI', 'Selawik', 'Open Sans', sans-serif"
    case 'Segoe UI Bold':
    case 'wf_segoe-ui_bold':
      return "'Segoe UI Bold', 'Segoe UI', 'Selawik', 'Open Sans', sans-serif"
    case 'Segoe UI Light':
    case 'wf_segoe-ui_light':
      return "'Segoe UI Light', 'Segoe UI', 'Selawik', 'Open Sans', sans-serif"
    default:
      return `'${n}', 'Segoe UI', 'Open Sans', sans-serif`
  }
}

/** Font weight implied by a PBI font name (Semibold / Bold / Light faces). */
export function fontWeightOf(name: string | undefined): number | undefined {
  if (!name) return undefined
  if (/semibold/i.test(name)) return 600
  if (/bold/i.test(name)) return 700
  if (/light/i.test(name)) return 300
  return undefined
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

export interface ShadowSpec {
  css: string
  inset: boolean
}

export interface ChromeSpec {
  title: TextSpec
  subTitle: TextSpec
  divider?: { color: string; style: string; width: number; ignorePadding: boolean }
  /** px between title/subtitle area and content */
  spaceBelowTitleArea: number
  spaceBelowTitle: number
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

/** Visual types whose container title is on by default (charts / maps). */
const TITLE_ON_BY_DEFAULT = /Chart$|^map$|^filledMap$|^azureMap$|^shapeMap$|^scatterChart$|^treemap$|^funnel$|^gauge$|^waterfallChart$|^kpi$|^decompositionTreeVisual$|^keyDriversVisual$|^qnaVisual$|^scriptVisual$|^pythonVisual$/

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
  const bold = getProp<boolean>(ctx, object, 'bold', false)
  return {
    show: bool(getProp(ctx, object, 'show', defaults.show), defaults.show),
    text: typeof text === 'string' ? text : undefined,
    boundExpr: bound ? rawText : undefined,
    color: str(getProp(ctx, object, 'fontColor', defaults.color), defaults.color),
    background: typeof bg === 'string' ? withTransparency(bg, bgTransparency) : undefined,
    fontSizePx: ptToPx(num(getProp(ctx, object, 'fontSize', defaults.sizePt), defaults.sizePt)),
    fontFamily: fontStack(fontName),
    fontWeight: bold ? 700 : (fontWeightOf(fontName) ?? 400),
    italic: getProp<boolean>(ctx, object, 'italic', false) === true,
    underline: getProp<boolean>(ctx, object, 'underline', false) === true,
    align: (['left', 'center', 'right'].includes(String(getProp(ctx, object, 'alignment', 'left')).toLowerCase())
      ? String(getProp(ctx, object, 'alignment', 'left')).toLowerCase()
      : 'left') as TextSpec['align'],
    wrap: getProp<boolean>(ctx, object, object === 'title' ? 'titleWrap' : 'titleWrap', true) !== false
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

export function resolveChrome(visualJson: any, theme: ResolvedTheme, opts: { titleOnByDefault?: boolean } = {}): ChromeSpec {
  const ctx = makePropContext(visualJson, theme)
  const vt = ctx.visualType
  const fg = theme.foreground
  const titleClass = theme.textClasses?.title ?? {}
  const titleDefault = opts.titleOnByDefault ?? TITLE_ON_BY_DEFAULT.test(vt)
  const title = textSpec(ctx, 'title', theme, { show: titleDefault, sizePt: titleClass.fontSize ?? 12, color: titleClass.color ?? fg, font: titleClass.fontFace ?? 'DIN' })
  const subTitle = textSpec(ctx, 'subTitle', theme, { show: false, sizePt: 10, color: theme.foregroundNeutralSecondary, font: 'DIN' })

  const dividerOn = getProp<boolean>(ctx, 'divider', 'show', false) === true
  const divider = dividerOn
    ? {
        color: str(getProp(ctx, 'divider', 'color', theme.foregroundNeutralTertiary), theme.foregroundNeutralTertiary),
        style: str(getProp(ctx, 'divider', 'style', 'solid'), 'solid'),
        width: num(getProp(ctx, 'divider', 'width', 1), 1),
        ignorePadding: getProp<boolean>(ctx, 'divider', 'ignorePadding', true) !== false
      }
    : undefined

  const customSpacing = getProp<boolean>(ctx, 'spacing', 'customizeSpacing', false) === true
  const spaceBelowTitleArea = customSpacing ? num(getProp(ctx, 'spacing', 'spaceBelowTitleArea', 0), 0) : title.show || subTitle.show ? 4 : 0
  const spaceBelowTitle = customSpacing ? num(getProp(ctx, 'spacing', 'spaceBelowTitle', 0), 0) : 0

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

  const pad = (side: string) => num(getProp(ctx, 'padding', side, 5), 5)
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
    spaceBelowTitleArea,
    spaceBelowTitle,
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
