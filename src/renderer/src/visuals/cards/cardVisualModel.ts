/**
 * Model for the card visual (`cardVisual`, the "new card", GA in Power BI Desktop Nov 2025): query
 * planning + formatting resolution into a render-ready description of card tiles. Pure (no React)
 * so it is unit-testable.
 *
 * Object / property names follow Microsoft's report-theme JSON schema (reportThemeSchema-2.15x,
 * `visualStyles.cardVisual`) and real PBIR files. Defaults:
 *   - theme (CY24SU10): layout.maxTiles 3, overflow type 0, image.imageAreaSize 50 — read through props.
 *   - Microsoft Learn "Create a card visual" (GA notes): card padding 12px ("Normal"), reference
 *     labels get their own area that takes 50% of the card with a default background, an area used
 *     by one card is reserved on every card, "Fit to space" (autoGrid) on.
 *   - Measured from the Learn GA screenshot (classic theme): value left-aligned, 1px card outline
 *     in the theme's backgroundLight, ~4px corner radius, ~8px between cards.
 *   - Text defaults come from the report theme's text classes, like every Power BI visual (Learn
 *     "Create custom report themes" > "Set formatted text defaults": "Cards and KPIs: callout";
 *     card category labels use the "large and light" label class):
 *       callout value   = `callout` class font face + size (classic base theme: DIN 45pt), theme foreground;
 *       category label  = `label` class font face, label size + 2pt (the derived `largeLightLabel`
 *                         class), second-level colour (foregroundNeutralSecondary) unless the theme
 *                         colours the `label` class (see cardTextDefaults);
 *       reference label = `label` class face + size, regular weight for the value too.
 *     A custom theme that redefines `textClasses.callout` / `label` therefore restyles every card.
 *     The category label sits ABOVE the value by default (Learn card walkthrough screenshots and the
 *     preview "build a new card" screenshots on a classic-theme report); "Below value" is the option.
 *   - Approximations (not verifiable from public docs, closest observed look): the +2pt of the
 *     category label and the reference-label size are read off Learn screenshots; padding presets
 *     Narrow 4 / Wide 20 (see PADDING_PRESET); overflow style 0 = continuous scroll / 1 = paginate; reference labels in
 *     the "tabular" style put titles in a left-aligned column and values in a right-aligned column
 *     spanning the reference-label area (`valueArea`% wide when set).
 *
 * Each card has up to three areas — callout (value + label + optional callout image), reference
 * labels, card image — ordered by `layout.contentOrder` and arranged along
 * `referenceLabelLayout.position` (below = vertical, right = horizontal), the callout taking
 * `layout.calloutSize`% (collage: the first area takes its share, the other two stack across).
 * The shares are fixed: content that does not fit its area is clipped at the area's edge (Learn
 * FAQ "Why is the reference label obscuring the text in the callout?" — the reference-label area
 * keeps its share and covers what overflows the callout).
 *
 * Categories (multi-category layout, "small multiples" of cards): one section per category tuple
 * with a selectable header; each section lays out its cards with the multi-card layout.
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { SummarizeRequest, SummarizeResult, ValueFormatter, ValueExpr } from '@core/engine/api'
import { fieldKey, type DataPointIdentity, type SQExpr, type SQFilter } from '@core/report/sq'
import { kpiIconFor } from '../tables/iconSet'
import type { ResolvedTheme } from '@core/report/theme'
import { compileColorRule, evalColorRule, ruleInputs, type ColorRule } from '../common/conditionalFormatting'
import { formatWithUnits } from '../common/displayUnits'
import type { FontSpec } from '../common/textStyle'
import { CardProps, cardPrecision, cardTextDefaults, imageSrc, toPt, type CardScope, type CardState } from './cardProps'

export { cardTextDefaults, type CardTextDefaults } from './cardProps'

export interface Box {
  top: number
  right: number
  bottom: number
  left: number
}

/** Corner radii in px: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [number, number, number, number]

export interface CardFieldInfo {
  queryRef: string
  expr: SQExpr
  /** display name (visual rename > field display name) */
  label: string
  isMeasure: boolean
}

export interface RefLabelModel {
  id: string
  order: number
  title: { show: boolean; text: string; font: FontSpec; wrap: boolean }
  value: { show: boolean; text: string; raw: Scalar; font: FontSpec; wrap: boolean }
  detail?: { text: string; raw: Scalar; font: FontSpec; background?: string; wrap: boolean }
}

export type ImageFit = 'fit' | 'stretch' | 'fill' | 'center'

export interface ImageModel {
  /** undefined: the image is switched on but its source resolves to nothing — the area stays reserved */
  src?: string
  fit: ImageFit
  radius: Corners
  /** 0..1 */
  opacity: number
}

/** Image inside the callout area, next to the value ("Callout > Image"; PBIR object `image`). */
export interface CalloutImageModel extends ImageModel {
  position: 'left' | 'right' | 'top' | 'bottom'
  /** % of the callout area along the image axis (when not fixed size) */
  areaSize: number
  /** fixed size in px (fixedSize on) */
  size?: number
  /** space between image and callout text, px */
  gap: number
  verticalAlignment: 'top' | 'middle' | 'bottom'
  horizontalAlignment: 'left' | 'center' | 'right'
}

/** Card-level image area ("Image"; PBIR object `cardImage`). */
export interface CardImageModel extends ImageModel {
  src: string
  padding: Box
  background?: string
  /** fixed image height in px (0 = fill the area) */
  height: number
}

export interface ShadowModel {
  css: string
}

export interface TileStyle {
  fill?: string
  backgroundImage?: { src: string; fit: ImageFit; opacity: number }
  outline?: { color: string; width: number }
  radius: Corners
  padding: Box
  accentBar?: { color: string; width: number; position: 'left' | 'right' | 'top' | 'bottom' }
  shadow?: ShadowModel
}

export interface CalloutModel {
  queryRef: string
  raw: Scalar
  value: { show: boolean; text: string; font: FontSpec; align: 'left' | 'center' | 'right'; wrap: boolean }
  label: { show: boolean; text: string; font: FontSpec; position: 'above' | 'below'; align: 'left' | 'center' | 'right'; wrap: boolean }
  /** px between label and value (`spacing.verticalSpacing`) */
  labelGap: number
  refLabels: RefLabelModel[]
  /** callout image (default state) and its hover variant when one is configured */
  image?: CalloutImageModel
  imageHover?: CalloutImageModel
  cardImage?: CardImageModel
  cardImageHover?: CardImageModel
  tile: TileStyle
  /** hover-state tile style (only when the visual defines hover-state entries) */
  tileHover?: TileStyle
  calloutArea: { padding: Box; background?: string; radius: Corners }
  divider?: { color: string; width: number; style: string; ignorePadding: boolean }
  refArea: { background?: string; padding: Box; radius: Corners }
  /** KPI status / trend field: render this icon (cfIcons name) instead of the value text, like PBI */
  kpiIcon?: string
}

export type CardArea = 'callout' | 'image' | 'referenceLabel'

export interface CardLayoutModel {
  arrangement: 'horizontal' | 'vertical' | 'grid'
  /** columns of the card grid (reserved columns when "Fit to space" is off) */
  columns: number
  /** rows needed for all cards */
  rows: number
  /** rows that fit the viewport (explicit row count) — more rows overflow */
  fixedRows?: number
  /** fixed card size in px ("Fixed size") */
  fixedSize?: { width: number; height: number }
  gap: number
  rowGap: number
  columnGap: number
  /** 'table': cards share borders (gridlines between cells), no gaps */
  style: 'cards' | 'table'
  lines?: { color: string; width: number; style: string }
  outerMargin: Box
  background?: string
  border?: { color: string; width: number; style: string }
  radius: Corners
  overflow: { style: 'scroll' | 'paginate'; direction: 'vertical' | 'horizontal' }
  /**
   * vertical alignment of the callout content (label + value) in the callout area: always centred.
   * `layout.alignment` does not drive it — see readCardLayout.
   */
  alignment: 'top' | 'middle' | 'bottom'
  /** horizontal alignment of the card grid when cards don't fill the width */
  justify: 'left' | 'center' | 'right'
  /** % of the card for the callout area when other areas exist */
  calloutSize: number
  /** areas reserved on every card (an area used by one card is kept on all of them) */
  areas: { referenceLabel: boolean; image: boolean }
  contentOrder: CardArea[]
  collage: 'none' | 'default' | 'reverse'
  refLayout: {
    position: 'below' | 'right'
    arrangement: 'rows' | 'columns'
    style: 'tabular' | 'compact'
    labelSpace: number
    valueArea?: number
    horizontalAlignment?: 'left' | 'center' | 'right'
    verticalAlignment: 'top' | 'middle' | 'bottom'
    paddingBeforeDivider: number
    paddingAfterDivider: number
  }
}

export interface CategorySectionModel {
  key: string
  /** header text (category values concatenated) */
  title: string
  /** individual category value texts (when not concatenated) */
  parts: string[]
  identity: DataPointIdentity
  callouts: CalloutModel[]
}

export interface MultiCategoryLayoutModel {
  columns: number
  rows: number
  fixedRows?: number
  rowGap: number
  columnGap: number
  style: 'cards' | 'table'
  overflow: { style: 'scroll' | 'paginate'; direction: 'vertical' | 'horizontal' }
  header: {
    position: 'top' | 'bottom' | 'left' | 'right'
    /** rotate the text 90° (left/right headers) */
    rotate: boolean
    font: FontSpec
    background?: string
    align: 'left' | 'center' | 'right'
    verticalAlign: 'top' | 'middle' | 'bottom'
    padding: Box
    maxSize?: number
    wrap: boolean
    concatenate: boolean
  }
  cell: { background?: string; border?: { color: string; width: number; style: string }; radius: Corners }
  grid?: { color: string; width: number; style: string; region: 'all' | 'inner' | 'innerHorizontal' | 'innerVertical' }
  accentBar?: { color: string; width: number; position: 'left' | 'right' | 'top' | 'bottom' }
}

export interface CardVisualModel {
  /** callouts of the first (or only) section */
  callouts: CalloutModel[]
  layout: CardLayoutModel
  /** multi-category layout: one section per category value tuple */
  sections?: CategorySectionModel[]
  categoryLayout?: MultiCategoryLayoutModel
  /** text when there is nothing to show */
  empty?: string
}

interface PlannedValue {
  id: string
  expr: SQExpr
}

export interface CardQueryPlan {
  fields: CardFieldInfo[]
  categories: CardFieldInfo[]
  values: PlannedValue[]
  /** reference labels per callout queryRef */
  refs: Map<string, Array<{ id: string; order: number; valueId: string; expr: SQExpr; detailValueId?: string; detailExpr?: SQExpr }>>
  /** compiled data-bound color rules (keyed `${object}.${prop}|${scope}`) */
  rules: Map<string, ColorRule>
  /** first data-bound image value (kept for compatibility; per-scope images use `boundId`) */
  imageValueId?: string
}

const SCOPE_KEY = (s: CardScope) => `${s.metadata ?? ''}#${s.id ?? ''}#${s.state ?? ''}`

/** Value id of a data-bound property expression (images, detail values). */
export function boundId(expr: SQExpr): string {
  return `b|${fieldKey(expr)}`
}

const CATEGORY_ROLES = ['Rows', 'Category', 'Categories', 'SmallMultiple', 'Group']

/** Describe the Data role projections. `labelOf` resolves display names (engine-backed in the app). */
export function cardFields(visualJson: any, labelOf: (p: any) => string, isMeasureOf: (p: any) => boolean): CardFieldInfo[] {
  const projs: any[] = visualJson?.visual?.query?.queryState?.Data?.projections ?? visualJson?.visual?.query?.queryState?.Values?.projections ?? []
  return projs.map((p) => ({ queryRef: p.queryRef, expr: p.field, label: p.displayName ?? labelOf(p), isMeasure: isMeasureOf(p) }))
}

/**
 * Category fields of the multi-category layout ("Categories" well). The PBIR role name of that
 * well isn't documented publicly; the usual grouping role names are accepted.
 */
export function cardCategoryFields(visualJson: any, labelOf: (p: any) => string): CardFieldInfo[] {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  for (const r of CATEGORY_ROLES) {
    const projs: any[] = qs[r]?.projections ?? []
    if (projs.length) return projs.map((p) => ({ queryRef: p.queryRef, expr: p.field, label: p.displayName ?? labelOf(p), isMeasure: false }))
  }
  return []
}

const IMAGE_OBJECTS = ['image', 'cardImage', 'fillCustom', 'layout', 'smallMultiplesHeader', 'smallMultiplesCellBackGround']

function isValueExpr(e: any): boolean {
  return !!(e && (e.Measure || e.Aggregation || e.Column || e.HierarchyLevel))
}

/** Plan the summarize: callouts, reference-label values/details, CF inputs, bound images. */
export function planCardQuery(visualJson: any, theme: ResolvedTheme, fields: CardFieldInfo[], categories: CardFieldInfo[] = []): CardQueryPlan {
  const props = new CardProps(visualJson, theme)
  const values: PlannedValue[] = []
  const seen = new Set<string>()
  const add = (id: string, expr: SQExpr) => {
    if (seen.has(id)) return
    seen.add(id)
    values.push({ id, expr })
  }
  fields.forEach((f, i) => add(`v${i}|${f.queryRef}`, f.expr))
  const refs: CardQueryPlan['refs'] = new Map()
  const known = new Set(fields.map((f) => f.queryRef))
  for (const e of props.entries('referenceLabel')) {
    const sel = e.selector
    const valExpr = e.properties?.value?.expr
    if (!sel?.metadata || !valExpr || !known.has(sel.metadata)) continue
    const id = String(sel.id ?? `ref${refs.get(sel.metadata)?.length ?? 0}`)
    const valueId = `ref|${sel.metadata}|${id}`
    add(valueId, valExpr)
    const list = refs.get(sel.metadata) ?? []
    list.push({ id, order: typeof sel.order === 'number' ? sel.order : list.length, valueId, expr: valExpr })
    refs.set(sel.metadata, list)
  }
  for (const [qr, list] of refs) {
    list.sort((a, b) => a.order - b.order)
    for (const r of list) {
      const raw = props.raw('referenceLabelDetail', 'detailValue', { metadata: qr, id: r.id })
      const expr = raw?.expr
      if (isValueExpr(expr)) {
        r.detailExpr = expr
        r.detailValueId = `det|${qr}|${r.id}`
        add(r.detailValueId, expr)
      }
    }
  }

  const rules = new Map<string, ColorRule>()
  const addRule = (object: string, prop: string, scope: CardScope) => {
    const raw = props.bound(object, prop, scope)
    if (!raw) return
    const rule = compileColorRule(raw, theme)
    if (!rule) return
    rules.set(`${object}.${prop}|${SCOPE_KEY(scope)}`, rule)
    for (const input of ruleInputs(rule)) add(`cf|${fieldKey(input)}`, input)
  }
  for (const f of fields) {
    for (const state of [undefined, 'hover'] as const) {
      const s: CardScope = { metadata: f.queryRef, state }
      addRule('value', 'fontColor', s)
      addRule('label', 'fontColor', s)
      addRule('fillCustom', 'fillColor', s)
      addRule('outline', 'lineColor', s)
      addRule('accentBar', 'color', s)
    }
    for (const r of refs.get(f.queryRef) ?? []) {
      const rs = { metadata: f.queryRef, id: r.id }
      addRule('referenceLabelValue', 'valueFontColor', rs)
      addRule('referenceLabelTitle', 'titleFontColor', rs)
      addRule('referenceLabelDetail', 'detailFontColor', rs)
    }
  }

  // every data-bound image source (any scope / state) becomes a query value keyed by its field
  let imageValueId: string | undefined
  for (const obj of IMAGE_OBJECTS) {
    for (const e of props.entries(obj)) {
      for (const [k, v] of Object.entries(e.properties ?? {})) {
        if (!/image(Data|Url)$/i.test(k)) continue
        const expr = (v as any)?.expr
        if (!isValueExpr(expr)) continue
        const id = boundId(expr)
        add(id, expr)
        imageValueId ??= id
      }
    }
  }
  return { fields, categories, values, refs, rules, imageValueId }
}

export function cardSummarizeRequest(plan: CardQueryPlan, filters: SQFilter[]): SummarizeRequest {
  return {
    groupBy: plan.categories.map((c) => ({ kind: 'sq' as const, expr: c.expr })),
    values: plan.values.map((v) => ({ id: v.id, expr: { kind: 'sq', expr: v.expr } as ValueExpr })),
    filters,
    keepBlankRows: plan.categories.length === 0,
    limit: plan.categories.length ? 1000 : undefined
  }
}

export interface CardValues {
  get(id: string): { value: Scalar; formatString?: string; dataType?: DataType } | undefined
}

/** Adapt one row of a summarize result (default: the first) to a CardValues lookup. */
export function cardValuesFromResult(result: Pick<SummarizeResult, 'columns' | 'rows' | 'formats'>, rowIndex = 0): CardValues {
  const row = result.rows[rowIndex] ?? []
  const valueCols = result.columns.filter((c) => c.kind === 'value')
  const map = new Map<string, { value: Scalar; formatString?: string; dataType?: DataType }>()
  const groupCount = result.columns.length - valueCols.length
  valueCols.forEach((c, i) => {
    map.set(c.id, { value: row[groupCount + i] ?? null, formatString: result.formats?.[rowIndex]?.[i] ?? c.formatString, dataType: c.dataType })
  })
  return { get: (id) => map.get(id) }
}

function box(v: number): Box {
  return { top: v, right: v, bottom: v, left: v }
}

/** `paddingUniform` / `paddingIndividual` + per-side props (names differ per object). */
function readPadding(props: CardProps, object: string, scope: CardScope, uniformDefault: number, sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']): Box {
  const individual = props.bool(object, 'paddingIndividual', false, scope)
  const uniform = props.num(object, 'paddingUniform', uniformDefault, scope)
  if (!individual) return box(uniform)
  return {
    top: props.num(object, sides[0], uniform, scope),
    right: props.num(object, sides[1], uniform, scope),
    bottom: props.num(object, sides[2], uniform, scope),
    left: props.num(object, sides[3], uniform, scope)
  }
}

/** Corner radius with "Individual corners" (`rectangleRoundedCurveCustomStyle`). */
function readCorners(props: CardProps, object: string, scope: CardScope, fallback: number): Corners {
  const r = props.num(object, 'rectangleRoundedCurve', fallback, scope)
  if (!props.bool(object, 'rectangleRoundedCurveCustomStyle', false, scope)) return [r, r, r, r]
  return [
    props.num(object, 'rectangleRoundedCurveLeftTop', r, scope),
    props.num(object, 'rectangleRoundedCurveRightTop', r, scope),
    props.num(object, 'rectangleRoundedCurveRightBottom', r, scope),
    props.num(object, 'rectangleRoundedCurveLeftBottom', r, scope)
  ]
}

/**
 * Default space between the category label and the value (`spacing.verticalSpacing`), px. Approximation:
 * the default is not published; on a Power BI Desktop render (14pt label above a 16pt value, nothing set)
 * the baselines are ≈ 38px apart, which this gap reproduces with the card's 1.2 line height.
 */
export const DEFAULT_LABEL_SPACING = 12

/**
 * Card padding presets (format pane "Cards > Padding > Size"). Normal = 12px per Microsoft Learn ("the new default
 * is 12px"). Narrow is measured on a Power BI Desktop render (a right-aligned 10pt value on a "Narrow" card ends
 * ≈ 8px from the container edge, 5px of which is the container padding): about 4px, i.e. the 8px step below Normal.
 * Wide is that step above Normal. Approximation: Microsoft doesn't publish the Narrow / Wide values.
 */
export const PADDING_PRESET: Record<string, number> = { narrow: 4, normal: 12, wide: 20 }

/**
 * The card tile's padding (`padding` object). Since the GA release the format pane's "Size" (`paddingSelection`)
 * decides: Narrow / Normal / Wide use the preset and ignore the stored `paddingUniform`; only "Custom" uses
 * `paddingUniform` (and the per-side margins when `paddingIndividual` is on). Without a stored size the card is at
 * the "Normal" default, so a `paddingUniform` written by a preview-era build is not used (Learn: "During preview,
 * the default settings had less padding in the cards. After the November 2025 release, more padding and padding
 * options were added … The new default is 12px"; on a Power BI Desktop render a card storing `paddingUniform` 5
 * without a size has its content inset like a 12px card). Two exceptions keep documented paths working: per-side
 * margins with `paddingIndividual` on (Learn: "toggling on individual padding can restore previous padding
 * settings") and a report theme's `paddingUniform` (Learn's theme example `cardVisual.*.*.paddingUniform`).
 */
export function readCardPadding(props: CardProps, s: CardScope): Box {
  const sides = ['topMargin', 'rightMargin', 'bottomMargin', 'leftMargin']
  const stored = props.get<any>('padding', 'paddingSelection', undefined, s)
  const selection = typeof stored === 'string' ? stored.toLowerCase() : undefined
  if (selection && selection !== 'custom') return box(PADDING_PRESET[selection] ?? PADDING_PRESET.normal)
  if (selection === 'custom' || props.bool('padding', 'paddingIndividual', false, s)) return readPadding(props, 'padding', s, PADDING_PRESET.normal, sides)
  const ownUniform = props.ownRaw('padding', 'paddingUniform', s) !== undefined
  return ownUniform ? box(PADDING_PRESET.normal) : readPadding(props, 'padding', s, PADDING_PRESET.normal, sides)
}

function alignOf(v: string, fallback: 'left' | 'center' | 'right'): 'left' | 'center' | 'right' {
  const s = v.toLowerCase()
  return s === 'left' ? 'left' : s === 'right' ? 'right' : s === 'center' || s === 'middle' ? 'center' : fallback
}

function vAlignOf(v: string, fallback: 'top' | 'middle' | 'bottom'): 'top' | 'middle' | 'bottom' {
  const s = v.toLowerCase()
  return s === 'top' ? 'top' : s === 'bottom' ? 'bottom' : s === 'middle' || s === 'center' ? 'middle' : fallback
}

function sideOf(v: string, fallback: 'left' | 'right' | 'top' | 'bottom'): 'left' | 'right' | 'top' | 'bottom' {
  const s = v.toLowerCase()
  return s === 'left' || s === 'right' || s === 'top' || s === 'bottom' ? s : fallback
}

function fitOf(v: string | undefined, fallback: ImageFit): ImageFit {
  const s = String(v ?? '').toLowerCase()
  return s === 'fit' ? 'fit' : s === 'stretch' ? 'stretch' : s === 'fill' ? 'fill' : s === 'normal' || s === 'center' ? 'center' : fallback
}

/** Overflow style/direction: enum values 0/1 or names. 0 = continuous scroll (theme default `type: 0`). */
function readOverflow(props: CardProps, object: string, legacyObject?: string): CardLayoutModel['overflow'] {
  const raw = props.get<any>(object, 'overFlowStyle', legacyObject ? props.get<any>(legacyObject, 'type', 0) : 0)
  const s = String(raw).toLowerCase()
  const style = s === '1' || s.startsWith('pag') ? 'paginate' : 'scroll'
  const d = String(props.get<any>(object, 'overFlowDirection', 0)).toLowerCase()
  return { style, direction: d === '1' || d.startsWith('hor') ? 'horizontal' : 'vertical' }
}

function lineStyleOf(v: string): string {
  const s = v.toLowerCase()
  return s === 'dashed' || s === 'dotted' ? s : 'solid'
}

function arrangementOf(v: any): 'horizontal' | 'vertical' | 'grid' {
  const s = String(v ?? '0').toLowerCase()
  return s === '1' || s === 'vertical' ? 'vertical' : s === '2' || s === 'grid' ? 'grid' : 'horizontal'
}

/** CSS box-shadow for `shadowCustom` / `glowCustom` (outer or inner). */
function readShadow(props: CardProps, scope: CardScope, theme: ResolvedTheme): ShadowModel | undefined {
  const parts: string[] = []
  if (props.bool('shadowCustom', 'show', false, scope)) {
    const color = withAlpha(props.color('shadowCustom', 'color', '#000000', scope), props.num('shadowCustom', 'transparency', 70, scope))
    const blur = props.num('shadowCustom', 'shadowBlur', 10, scope)
    const dist = props.num('shadowCustom', 'shadowDistance', 10, scope)
    const spread = props.num('shadowCustom', 'shadowSpread', 3, scope)
    const preset = props.str('shadowCustom', 'shadowPositionPreset', 'bottomRight', scope)
    const customAngle = props.num('shadowCustom', 'angle', 45, scope)
    const angle = preset === 'custom' ? customAngle : PRESET_ANGLE[preset] ?? 45
    const rad = (angle * Math.PI) / 180
    const dx = preset === 'center' ? 0 : Math.round(Math.cos(rad) * dist)
    const dy = preset === 'center' ? 0 : Math.round(Math.sin(rad) * dist)
    const inner = props.str('shadowCustom', 'position', 'Outer', scope).toLowerCase() === 'inner'
    parts.push(`${inner ? 'inset ' : ''}${dx}px ${dy}px ${blur}px ${spread}px ${color}`)
  }
  if (props.bool('glowCustom', 'show', false, scope)) {
    const color = withAlpha(props.color('glowCustom', 'color', theme.dataColors[0], scope), props.num('glowCustom', 'transparency', 50, scope))
    const blur = props.num('glowCustom', 'shadowBlur', 10, scope)
    const spread = props.num('glowCustom', 'glowSpread', 3, scope)
    const inner = props.str('glowCustom', 'position', 'Outer', scope).toLowerCase() === 'inner'
    parts.push(`${inner ? 'inset ' : ''}0 0 ${blur}px ${spread}px ${color}`)
  }
  return parts.length ? { css: parts.join(', ') } : undefined
}

/** Screen-space angles (y down) of PBI's shadow position presets. */
const PRESET_ANGLE: Record<string, number> = { bottomRight: 45, bottom: 90, bottomLeft: 135, centerLeft: 180, left: 180, topLeft: 225, top: 270, topRight: 315, centerRight: 0, right: 0 }

/** Build the multi-card layout model (shared by all sections). */
export function readCardLayout(props: CardProps, n: number, anyRefs: boolean, anyCardImage: boolean): CardLayoutModel {
  const maxTiles = Math.max(1, props.num('layout', 'maxTiles', 3))
  const arrangement = arrangementOf(props.get<any>('layout', 'orientation', 0))
  const fitToSpace = props.bool('layout', 'autoGrid', true)
  const columnCount = Math.max(1, props.num('layout', 'columnCount', maxTiles))
  const rowCount = props.optNum('layout', 'rowCount')
  let columns: number
  let fixedRows: number | undefined
  if (arrangement === 'vertical') {
    columns = 1
    fixedRows = !fitToSpace && rowCount ? rowCount : undefined
  } else if (arrangement === 'grid' || !fitToSpace) {
    // "Fit to space" off reserves the configured columns even when fewer cards exist
    columns = fitToSpace ? Math.min(columnCount, Math.max(1, n)) : columnCount
    fixedRows = !fitToSpace && rowCount ? rowCount : undefined
  } else columns = Math.max(1, Math.min(n, maxTiles))
  const rows = Math.max(1, Math.ceil(n / columns))
  const fixedSize = props.bool('layout', 'showFixedSize', false) ? { width: Math.max(20, props.num('layout', 'fixedWidth', 200)), height: Math.max(20, props.num('layout', 'fixedHeight', 120)) } : undefined
  const gap = props.num('layout', 'cellPadding', 8)
  const customSpacing = props.bool('layout', 'customizePadding', false)
  const style = props.str('layout', 'style', 'Cards').toLowerCase() === 'table' ? 'table' : 'cards'
  // `layout.alignment` is the horizontal alignment of the cards in the GA schema (left/center/right).
  // Power BI writes 'top' there on nearly every card it saves, and a Power BI Desktop render of such a
  // card still centres the label + value block in the callout area (the label sits well below the
  // top-aligned callout image), so top/middle/bottom do not align the callout content: it is centred.
  const align = props.str('layout', 'alignment', 'middle').toLowerCase()
  const isH = align === 'left' || align === 'center' || align === 'right'
  const order = props.str('layout', 'contentOrder', 'callout_referenceLabel_image').split('_') as CardArea[]
  const contentOrder = (['callout', 'referenceLabel', 'image'] as CardArea[]).every((a) => order.includes(a)) ? order : (['callout', 'referenceLabel', 'image'] as CardArea[])
  const collage = props.str('layout', 'collage', 'None').toLowerCase()
  const refStyle = props.str('referenceLabelLayout', 'style', 'tabular').toLowerCase()
  const refH = props.get<any>('referenceLabelLayout', 'horizontalAlignment', undefined)
  return {
    arrangement,
    columns,
    rows,
    fixedRows,
    fixedSize,
    gap,
    rowGap: customSpacing ? props.num('layout', 'rowPadding', gap) : gap,
    columnGap: customSpacing ? props.num('layout', 'columnPadding', gap) : gap,
    style,
    lines:
      style === 'table' || props.bool('layout', 'customizeLines', false)
        ? { color: props.color('layout', 'lineColor', props.color('layout', 'gridlineColor', '#E1DFDD')), width: props.num('layout', 'lineWidth', props.num('layout', 'gridlineWidth', 1)), style: lineStyleOf(props.str('layout', 'lineStyle', 'solid')) }
        : undefined,
    outerMargin: {
      top: props.num('layout', 'topOuterMargin', 0),
      right: props.num('layout', 'rightOuterMargin', 0),
      bottom: props.num('layout', 'bottomOuterMargin', 0),
      left: props.num('layout', 'leftOuterMargin', 0)
    },
    background: props.bool('layout', 'backgroundShow', false) ? withAlpha(props.color('layout', 'backgroundFillColor', '#FFFFFF'), props.num('layout', 'backgroundTransparency', 0)) : undefined,
    border: props.optNum('layout', 'borderWidth') ? { color: props.color('layout', 'borderColor', '#E1DFDD'), width: props.num('layout', 'borderWidth', 1), style: lineStyleOf(props.str('layout', 'borderStyle', 'solid')) } : undefined,
    radius: readCorners(props, 'layout', {}, 0),
    overflow: readOverflow(props, 'overFlow', 'overflow'),
    alignment: 'middle',
    justify: isH ? alignOf(align, 'left') : 'left',
    calloutSize: Math.max(5, Math.min(100, props.num('layout', 'calloutSize', 50))),
    areas: { referenceLabel: anyRefs, image: anyCardImage },
    contentOrder,
    collage: collage === 'default' ? 'default' : collage === 'reverse' ? 'reverse' : 'none',
    refLayout: {
      position: props.str('referenceLabelLayout', 'position', 'below').toLowerCase() === 'right' ? 'right' : 'below',
      arrangement: props.str('referenceLabelLayout', 'arrangement', 'rows').toLowerCase() === 'columns' ? 'columns' : 'rows',
      style: refStyle === 'compact' || refStyle === 'sentence' ? 'compact' : 'tabular',
      labelSpace: props.num('referenceLabelLayout', 'labelSpace', 0),
      valueArea: props.optNum('referenceLabelLayout', 'valueArea'),
      horizontalAlignment: typeof refH === 'string' ? alignOf(refH, 'left') : undefined,
      verticalAlignment: vAlignOf(props.str('referenceLabelLayout', 'verticalAlignment', 'middle'), 'middle'),
      paddingBeforeDivider: props.num('referenceLabelLayout', 'paddingBeforeDivider', 0),
      paddingAfterDivider: props.num('referenceLabelLayout', 'paddingAfterDivider', 0)
    }
  }
}

/** Multi-category ("Categories" well) layout: sections stacked vertically, headers on the left (Learn screenshot). */
export function readCategoryLayout(props: CardProps, sectionCount: number, theme: ResolvedTheme): MultiCategoryLayoutModel {
  const arrangement = arrangementOf(props.get<any>('smallMultiplesLayout', 'orientation', 1))
  const fitToSpace = props.bool('smallMultiplesLayout', 'autoGrid', props.bool('smallMultiplesLayout', 'fixNumberOfTiles', true))
  const columnCount = Math.max(1, props.num('smallMultiplesLayout', 'columnCount', arrangement === 'vertical' ? 1 : 3))
  // Learn: "When Fit to space is on, the maximum number of rows is 4."
  const rowCount = props.optNum('smallMultiplesLayout', 'rowCount') ?? props.optNum('smallMultiplesLayout', 'maxSmallMultiples')
  let columns = arrangement === 'vertical' ? 1 : arrangement === 'horizontal' ? Math.max(1, sectionCount) : Math.min(columnCount, Math.max(1, sectionCount))
  if (!fitToSpace && arrangement === 'grid') columns = columnCount
  const rows = Math.max(1, Math.ceil(sectionCount / columns))
  const visible = fitToSpace ? Math.min(4, rowCount ?? 4) : rowCount ?? rows
  const gap = props.num('smallMultiplesLayout', 'cellPadding', 8)
  const custom = props.bool('smallMultiplesLayout', 'customizePadding', false)
  const pos = sideOf(props.str('smallMultiplesLayout', 'headerPosition', 'Left'), 'left')
  const orient = props.optNum('smallMultiplesLayout', 'titleOrientation')
  const rotate = orient === undefined ? pos === 'left' || pos === 'right' : orient === 1 || orient === 2
  const style = props.str('smallMultiplesLayout', 'style', 'Cards').toLowerCase() === 'table' ? 'table' : 'cards'
  const H = 'smallMultiplesHeader'
  const gridShow = props.bool('smallMultiplesGrid', 'gridlineShow', style === 'table')
  const borderShow = props.bool('smallMultiplesBorder', 'gridlineShow', false)
  return {
    columns,
    rows,
    fixedRows: rows > visible ? visible : undefined,
    rowGap: style === 'table' ? 0 : custom ? props.num('smallMultiplesLayout', 'rowPadding', gap) : gap,
    columnGap: style === 'table' ? 0 : custom ? props.num('smallMultiplesLayout', 'columnPadding', gap) : gap,
    style,
    overflow: readOverflow(props, 'smallMultiplesOverFlow'),
    header: {
      position: pos,
      rotate,
      font: {
        family: props.str(H, 'fontFamily', 'Segoe UI Semibold'),
        size: toPt(props.get(H, 'fontSize', 10), 10),
        color: props.color(H, 'fontColor', theme.foreground),
        bold: props.bool(H, 'bold', false),
        italic: props.bool(H, 'italic', false),
        underline: props.bool(H, 'underline', false)
      },
      background: props.bool(H, 'backgroundShow', false) ? withAlpha(props.color(H, 'backgroundColor', theme.backgroundLight), props.num(H, 'backgroundTransparency', 0)) : undefined,
      align: alignOf(props.str(H, 'horizontalAlignment', 'center'), 'center'),
      verticalAlign: vAlignOf(props.str(H, 'verticalAlignment', 'middle'), 'middle'),
      padding: readPadding(props, H, {}, 4, ['topMargin', 'rightMargin', 'bottomMargin', 'leftMargin']),
      maxSize: props.optNum('smallMultiplesLayout', 'maxHeaderSize'),
      wrap: props.bool(H, 'textWrap', true),
      concatenate: props.bool('smallMultiplesLayout', 'concatenateCategories', true)
    },
    cell: {
      background: props.bool('smallMultiplesCellBackGround', 'backgroundShow', false)
        ? withAlpha(props.color('smallMultiplesCellBackGround', 'backgroundFillColor', theme.backgroundLight), props.num('smallMultiplesCellBackGround', 'backgroundTransparency', 0))
        : undefined,
      border: borderShow
        ? { color: props.color('smallMultiplesBorder', 'gridlineColor', '#E1DFDD'), width: props.num('smallMultiplesBorder', 'gridlineWidth', 1), style: lineStyleOf(props.str('smallMultiplesBorder', 'gridlineStyle', 'solid')) }
        : undefined,
      radius: readCorners(props, 'smallMultiplesOuterShape', {}, 0)
    },
    grid: gridShow
      ? {
          color: props.color('smallMultiplesGrid', 'gridlineColor', '#E1DFDD'),
          width: props.num('smallMultiplesGrid', 'gridlineWidth', 1),
          style: lineStyleOf(props.str('smallMultiplesGrid', 'gridlineStyle', 'solid')),
          region: ((r) => (r === 'inner' || r === 'innerhorizontal' || r === 'innervertical' ? (r === 'inner' ? 'inner' : r === 'innerhorizontal' ? 'innerHorizontal' : 'innerVertical') : 'all'))(props.str('smallMultiplesGrid', 'gridlineRegion', 'all').toLowerCase())
        }
      : undefined,
    accentBar: props.bool('smallMultiplesAccentBar', 'show', false)
      ? {
          color: withAlpha(props.color('smallMultiplesAccentBar', 'color', theme.dataColors[0]), props.num('smallMultiplesAccentBar', 'transparency', 0)),
          width: props.num('smallMultiplesAccentBar', 'width', 4),
          position: sideOf(props.str('smallMultiplesAccentBar', 'position', 'Left'), 'left')
        }
      : undefined
  }
}

export interface BuildOptions {
  /** display name of a reference-label field (engine describeField) */
  fieldLabel?: (expr: SQExpr) => string | undefined
}

/** Build the render model of one set of cards (the whole visual, or one category section). */
export function buildCallouts(visualJson: any, theme: ResolvedTheme, format: ValueFormatter, plan: CardQueryPlan, vals: CardValues, fieldLabel: (expr: SQExpr) => string | undefined = () => undefined): CalloutModel[] {
  const props = new CardProps(visualJson, theme)
  const get = (key: string): Scalar | undefined => vals.get(`cf|${key}`)?.value
  const ruleColor = (object: string, prop: string, scope: CardScope): string | undefined => {
    const rule = plan.rules.get(`${object}.${prop}|${SCOPE_KEY(scope)}`)
    return rule ? evalColorRule(rule, (k) => get(k), {}, theme) : undefined
  }
  const boundValue = (object: string, prop: string, scope: CardScope): Scalar | undefined => {
    const raw = props.raw(object, prop, scope)
    const expr = raw?.expr
    return isValueExpr(expr) ? vals.get(boundId(expr))?.value ?? undefined : undefined
  }
  const hasStateEntries = (state: CardState) =>
    Object.values(props.pc.objects ?? {}).some((entries: any[]) => entries.some((e) => typeof e?.selector?.id === 'string' && (state === 'hover' ? /hover$/.test(e.selector.id) : /selected$/.test(e.selector.id))))
  const hoverDefined = hasStateEntries('hover')
  const text = cardTextDefaults(theme)

  const fmtValue = (raw: Scalar, v: { formatString?: string; dataType?: DataType } | undefined, units: number, precision: number | undefined, custom: string, blankAs: string | undefined) => {
    if (raw === null || raw === undefined) return blankAs ?? '(Blank)'
    const formatString = custom || v?.formatString
    return formatWithUnits(raw, format, { formatString, dataType: v?.dataType, units, precision: cardPrecision(units, precision, formatString) })
  }

  const calloutImage = (s: CardScope): CalloutImageModel | undefined => {
    if (!props.bool('image', 'show', false, s)) return undefined
    const type = props.str('image', 'imageType', 'imageData', s).toLowerCase()
    const urlLit = props.get<any>('image', 'imageUrl', undefined, s)
    const bound = boundValue('image', 'imageData', s) ?? boundValue('image', 'imageUrl', s)
    // No usable source (blank / non-image field value): the image area is kept empty so the callout
    // text keeps its place. Approximation — not verified against Power BI, which sizes the area from
    // the settings (`imageAreaSize` / `size`), not from the picture.
    const src = imageSrc(type === 'imageurl' && typeof urlLit === 'string' ? urlLit : bound ?? (typeof urlLit === 'string' ? urlLit : undefined))
    const fixed = props.bool('image', 'fixedSize', false, s)
    return {
      src,
      fit: fitOf(props.get<any>('image', 'fit', 'fit', s), 'fit'),
      radius: readCorners(props, 'image', s, 0),
      opacity: 1 - props.num('image', 'transparency', 0, s) / 100,
      // Default "Right": real Power BI draws a callout image whose position was never set at the right edge
      // of the callout, next to the label + value (measured on a Power BI Desktop render; reports in the
      // wild never write `position`, so the default is what they show).
      position: sideOf(props.str('image', 'position', 'Right', s), 'right'),
      areaSize: props.num('image', 'imageAreaSize', 50, s),
      size: fixed ? props.num('image', 'size', 40, s) : undefined,
      gap: props.num('image', 'padding', 8, s),
      verticalAlignment: vAlignOf(props.str('image', 'verticalAlignment', 'middle', s), 'middle'),
      horizontalAlignment: alignOf(props.str('image', 'horizontalAlignment', 'center', s), 'center')
    }
  }

  const cardImage = (s: CardScope): CardImageModel | undefined => {
    if (!props.bool('cardImage', 'show', false, s)) return undefined
    const type = props.str('cardImage', 'imageType', 'imageUrl', s).toLowerCase()
    const urlLit = props.get<any>('cardImage', 'imageUrl', undefined, s)
    const bound = boundValue('cardImage', 'imageData', s) ?? boundValue('cardImage', 'imageUrl', s)
    const src = imageSrc(type === 'imageurl' && typeof urlLit === 'string' ? urlLit : bound ?? (typeof urlLit === 'string' ? urlLit : undefined))
    // formatting read before the source check, so its defaults are known without a picture (Format pane)
    const fits = { imageData: fitOf(props.get<any>('cardImage', 'imageDataFit', 'fit', s), 'fit'), imageUrl: fitOf(props.get<any>('cardImage', 'imageUrlFit', 'fit', s), 'fit') }
    const model: CardImageModel = {
      src: src ?? '',
      fit: type === 'imagedata' ? fits.imageData : fits.imageUrl,
      radius: readCorners(props, 'cardImage', s, 0),
      opacity: 1 - props.num('cardImage', 'imageTransparency', 0, s) / 100,
      padding: readPadding(props, 'cardImage', s, 0),
      background: props.bool('cardImage', 'addBackground', false, s) ? withAlpha(props.color('cardImage', 'backgroundFillColor', theme.backgroundLight, s), props.num('cardImage', 'backgroundTransparency', 0, s)) : undefined,
      height: props.num('cardImage', 'imageHeight', 0, s)
    }
    return src ? model : undefined
  }

  const tileStyle = (s: CardScope): TileStyle => {
    const fillShow = props.bool('fillCustom', 'show', true, s)
    const fillColor = ruleColor('fillCustom', 'fillColor', s) ?? props.color('fillCustom', 'fillColor', theme.background, s)
    const fillTransparency = props.num('fillCustom', 'transparency', 0, s)
    let backgroundImage: TileStyle['backgroundImage']
    if (props.bool('fillCustom', 'imageShow', false, s)) {
      const lit = props.get<any>('fillCustom', 'imageUrl', undefined, s)
      const src = imageSrc(boundValue('fillCustom', 'imageData', s) ?? boundValue('fillCustom', 'imageUrl', s) ?? (typeof lit === 'string' ? lit : undefined))
      const fit = fitOf(props.get<any>('fillCustom', 'imageFit', 'fill', s), 'fill')
      const opacity = 1 - props.num('fillCustom', 'imageTransparency', 0, s) / 100
      if (src) backgroundImage = { src, fit, opacity }
    }
    // GA classic look: 1px outline in the theme's backgroundLight (measured on the Learn screenshot)
    const outlineShow = props.bool('outline', 'show', true, s)
    const outlineColor = ruleColor('outline', 'lineColor', s) ?? props.color('outline', 'lineColor', props.color('outline', 'color', theme.backgroundLight, s), s)
    const tileShape = props.str('shapeCustomRectangle', 'tileShape', 'rectangleRoundedByPixel', s)
    const padding = readCardPadding(props, s)
    const accentShow = props.bool('accentBar', 'show', false, s)
    return {
      fill: fillShow ? withAlpha(fillColor, fillTransparency) : undefined,
      backgroundImage,
      outline: outlineShow
        ? {
            color: withAlpha(outlineColor, props.num('outline', 'transparency', 0, s)),
            width: props.num('outline', 'weight', props.num('outline', 'width', props.num('outline', 'lineWeight', 1, s), s), s)
          }
        : undefined,
      radius: tileShape === 'rectangle' ? [0, 0, 0, 0] : readCorners(props, 'shapeCustomRectangle', s, 4),
      padding,
      accentBar: accentShow
        ? {
            color: withAlpha(ruleColor('accentBar', 'color', s) ?? props.color('accentBar', 'color', theme.dataColors[0], s), props.num('accentBar', 'transparency', 0, s)),
            width: props.num('accentBar', 'width', 6, s),
            position: sideOf(props.str('accentBar', 'position', 'Left', s), 'left')
          }
        : undefined,
      shadow: readShadow(props, s, theme)
    }
  }

  return plan.fields.map((f, i) => {
    const s: CardScope = { metadata: f.queryRef }
    const v = vals.get(`v${i}|${f.queryRef}`)
    const raw = v?.value ?? null
    const units = props.num('value', 'labelDisplayUnits', 0, s)
    const precision = props.optNum('value', 'labelPrecision', s)
    const blankAs = props.get<any>('value', 'showBlankAs', undefined, s)
    const valueText = fmtValue(raw, v, units, precision, props.str('value', 'customFormatString', '', s), typeof blankAs === 'string' && blankAs !== '' ? blankAs : undefined)
    const valueFont: FontSpec = {
      family: props.str('value', 'fontFamily', text.value.family, s),
      size: toPt(props.get('value', 'fontSize', text.value.size, s), text.value.size),
      color: withAlpha(ruleColor('value', 'fontColor', s) ?? props.color('value', 'fontColor', theme.foreground, s), props.num('value', 'transparency', 0, s)),
      bold: props.bool('value', 'bold', false, s),
      italic: props.bool('value', 'italic', false, s),
      underline: props.bool('value', 'underline', false, s)
    }
    const valueAlign = alignOf(props.str('value', 'horizontalAlignment', 'left', s), 'left')
    const labelFont: FontSpec = {
      family: props.str('label', 'fontFamily', text.label.family, s),
      size: toPt(props.get('label', 'fontSize', text.label.size, s), text.label.size),
      color: withAlpha(ruleColor('label', 'fontColor', s) ?? props.color('label', 'fontColor', text.label.color, s), props.num('label', 'transparency', 0, s)),
      bold: props.bool('label', 'bold', false, s),
      italic: props.bool('label', 'italic', false, s),
      underline: props.bool('label', 'underline', false, s)
    }
    const labelPos = props.str('label', 'position', 'aboveValue', s).toLowerCase()
    const customLabel = props.str('label', 'text', '', s)
    const matchAlign = props.bool('label', 'matchValueAlignment', true, s)
    const labelAlign = alignOf(props.str('label', 'horizontalAlignment', valueAlign, s), valueAlign)

    // ---- reference labels
    const refLabels: RefLabelModel[] = (plan.refs.get(f.queryRef) ?? []).map((r) => {
      const rs: CardScope = { metadata: f.queryRef, id: r.id }
      const rv = vals.get(r.valueId)
      const rraw = rv?.value ?? null
      const contentType = props.str('referenceLabelTitle', 'titleContentType', 'fieldName', rs).toLowerCase()
      const customText = props.str('referenceLabelTitle', 'titleText', '', rs)
      const titleText = contentType === 'custom' ? customText : fieldLabel(r.expr) ?? refFieldLabel(r.expr)
      const vUnits = props.num('referenceLabelValue', 'valueDisplayUnits', 0, rs)
      const vPrec = props.optNum('referenceLabelValue', 'valuePrecision', rs)
      const vBlank = props.get<any>('referenceLabelValue', 'showBlankAs', undefined, rs)
      let detail: RefLabelModel['detail']
      if (r.detailValueId && props.bool('referenceLabelDetail', 'show', true, rs)) {
        const dv = vals.get(r.detailValueId)
        const draw = dv?.value ?? null
        const dBlank = props.get<any>('referenceLabelDetail', 'showBlankAs', undefined, rs)
        detail = {
          raw: draw,
          text: fmtValue(
            draw,
            dv,
            props.num('referenceLabelDetail', 'detailDisplayUnits', 0, rs),
            props.optNum('referenceLabelDetail', 'detailPrecision', rs),
            props.str('referenceLabelDetail', 'customFormatString', '', rs),
            typeof dBlank === 'string' && dBlank !== '' ? dBlank : undefined
          ),
          font: {
            family: props.str('referenceLabelDetail', 'detailFontFamily', text.refTitle.family, rs),
            size: toPt(props.get('referenceLabelDetail', 'detailFontSize', text.refTitle.size, rs), text.refTitle.size),
            color: withAlpha(ruleColor('referenceLabelDetail', 'detailFontColor', rs) ?? props.color('referenceLabelDetail', 'detailFontColor', theme.foregroundNeutralSecondary, rs), props.num('referenceLabelDetail', 'detailTransparency', 0, rs)),
            bold: props.bool('referenceLabelDetail', 'detailBold', false, rs),
            italic: props.bool('referenceLabelDetail', 'detailItalic', false, rs),
            underline: props.bool('referenceLabelDetail', 'detailUnderline', false, rs)
          },
          // Learn walkthrough screenshot: details render on a light-grey chip
          background: props.color('referenceLabelDetail', 'detailBackgroundColor', theme.backgroundLight, rs),
          wrap: props.bool('referenceLabelDetail', 'textWrap', false, rs)
        }
      }
      return {
        id: r.id,
        order: r.order,
        title: {
          show: props.bool('referenceLabelTitle', 'show', true, rs) && titleText !== '',
          text: titleText,
          wrap: props.bool('referenceLabelTitle', 'textWrap', false, rs),
          font: {
            family: props.str('referenceLabelTitle', 'titleFontFamily', text.refTitle.family, rs),
            size: toPt(props.get('referenceLabelTitle', 'titleFontSize', text.refTitle.size, rs), text.refTitle.size),
            color: withAlpha(ruleColor('referenceLabelTitle', 'titleFontColor', rs) ?? props.color('referenceLabelTitle', 'titleFontColor', text.refTitle.color, rs), props.num('referenceLabelTitle', 'titleTransparency', 0, rs)),
            bold: props.bool('referenceLabelTitle', 'titleBold', false, rs),
            italic: props.bool('referenceLabelTitle', 'titleItalic', false, rs),
            underline: props.bool('referenceLabelTitle', 'titleUnderline', false, rs)
          }
        },
        value: {
          show: props.bool('referenceLabelValue', 'show', true, rs),
          raw: rraw,
          wrap: props.bool('referenceLabelValue', 'textWrap', false, rs),
          text: fmtValue(rraw, rv, vUnits, vPrec, props.str('referenceLabelValue', 'customFormatString', '', rs), typeof vBlank === 'string' && vBlank !== '' ? vBlank : undefined),
          font: {
            family: props.str('referenceLabelValue', 'valueFontFamily', text.refValue.family, rs),
            size: toPt(props.get('referenceLabelValue', 'valueFontSize', text.refValue.size, rs), text.refValue.size),
            color: withAlpha(ruleColor('referenceLabelValue', 'valueFontColor', rs) ?? props.color('referenceLabelValue', 'valueFontColor', theme.foreground, rs), props.num('referenceLabelValue', 'valueTransparency', 0, rs)),
            bold: props.bool('referenceLabelValue', 'valueBold', false, rs),
            italic: props.bool('referenceLabelValue', 'valueItalic', false, rs),
            underline: props.bool('referenceLabelValue', 'valueUnderline', false, rs)
          }
        },
        detail
      }
    })

    const hover: CardScope = { ...s, state: 'hover' }
    const image = calloutImage(s)
    const imageHover = hoverDefined ? calloutImage(hover) : undefined
    const cImage = cardImage(s)
    const cImageHover = hoverDefined ? cardImage(hover) : undefined
    const tile = tileStyle(s)
    const tileHover = hoverDefined ? tileStyle(hover) : undefined

    // divider: show / color / width / line style (GA names `dividerColor`… with preview `color`… fallbacks)
    const dividerShow = props.bool('divider', 'show', true, s) && refLabels.length > 0
    const refBgShow = props.bool('referenceLabel', 'backgroundShow', true, s)
    const calloutBgShow = props.bool('cardCalloutArea', 'show', props.bool('cardCalloutArea', 'backgroundShow', false, s), s)

    return {
      queryRef: f.queryRef,
      raw,
      // "Text wrap" defaults to off for the value (assumed from Learn's card format-pane screenshot, where it is off)
      value: { show: props.bool('value', 'show', true, s), text: valueText, font: valueFont, align: valueAlign, wrap: props.bool('value', 'textWrap', false, s) },
      label: {
        show: props.bool('label', 'show', true, s),
        text: customLabel || f.label,
        font: labelFont,
        position: labelPos.startsWith('below') ? 'below' : 'above',
        align: matchAlign ? valueAlign : labelAlign,
        wrap: props.bool('label', 'textWrap', true, s)
      },
      labelGap: props.num('spacing', 'verticalSpacing', DEFAULT_LABEL_SPACING, s),
      refLabels,
      image,
      imageHover: imageHover && JSON.stringify(imageHover) !== JSON.stringify(image) ? imageHover : undefined,
      cardImage: cImage,
      cardImageHover: cImageHover && JSON.stringify(cImageHover) !== JSON.stringify(cImage) ? cImageHover : undefined,
      tile,
      tileHover: tileHover && JSON.stringify(tileHover) !== JSON.stringify(tile) ? tileHover : undefined,
      calloutArea: {
        padding: readPadding(props, 'cardCalloutArea', s, 0),
        background: calloutBgShow ? withAlpha(props.color('cardCalloutArea', 'backgroundFillColor', props.color('cardCalloutArea', 'backgroundColor', theme.backgroundLight, s), s), props.num('cardCalloutArea', 'backgroundTransparency', 0, s)) : undefined,
        radius: readCorners(props, 'cardCalloutArea', s, 0)
      },
      divider: dividerShow
        ? {
            color: withAlpha(props.color('divider', 'dividerColor', props.color('divider', 'color', '#E1DFDD', s), s), props.num('divider', 'dividerTransparency', 0, s)),
            width: props.num('divider', 'dividerWidth', props.num('divider', 'width', 1, s), s),
            style: lineStyleOf(props.str('divider', 'dividerLineStyle', props.str('divider', 'style', 'solid', s), s)),
            ignorePadding: props.bool('divider', 'dividerIgnorePadding', false, s)
          }
        : undefined,
      refArea: {
        // Learn (GA): "reference labels always have their own area ... and a default background is used"
        background: refBgShow ? withAlpha(props.color('referenceLabel', 'backgroundColor', theme.backgroundLight, s), props.num('referenceLabel', 'backgroundTransparency', 0, s)) : undefined,
        padding: readPadding(props, 'referenceLabel', s, refBgShow ? 8 : 0),
        radius: readCorners(props, 'referenceLabel', s, 0)
      }
    }
  })
}

/** Build the render model from resolved values (single section). */
export function buildCardVisualModel(
  visualJson: any,
  theme: ResolvedTheme,
  format: ValueFormatter,
  plan: CardQueryPlan,
  vals: CardValues,
  /** display name of a reference-label field (engine describeField) */
  fieldLabel: (expr: SQExpr) => string | undefined = () => undefined
): CardVisualModel {
  const props = new CardProps(visualJson, theme)
  const callouts = buildCallouts(visualJson, theme, format, plan, vals, fieldLabel)
  const layout = readCardLayout(props, plan.fields.length, callouts.some((c) => c.refLabels.length > 0), callouts.some((c) => !!c.cardImage))
  return { callouts, layout, empty: plan.fields.length === 0 ? 'Add data fields to this card' : undefined }
}

/** Format a category value for a section header. */
function categoryText(v: Scalar, format: ValueFormatter, formatString?: string, dataType?: DataType): string {
  if (v === null || v === undefined || v === '') return '(Blank)'
  return format(v, formatString, dataType)
}

/** Build the multi-category model from a grouped summarize result (one row per category tuple). */
export function buildCategorizedModel(
  visualJson: any,
  theme: ResolvedTheme,
  format: ValueFormatter,
  plan: CardQueryPlan,
  result: Pick<SummarizeResult, 'columns' | 'rows' | 'formats'>,
  fieldLabel: (expr: SQExpr) => string | undefined = () => undefined
): CardVisualModel {
  const props = new CardProps(visualJson, theme)
  const sections: CategorySectionModel[] = result.rows.map((row, r) => {
    const vals = cardValuesFromResult(result, r)
    const parts = plan.categories.map((c, i) => categoryText(row[i], format, result.columns[i]?.formatString, result.columns[i]?.dataType))
    return {
      key: parts.join('\u0001') + '#' + r,
      title: parts.join(' '),
      parts,
      identity: { fields: plan.categories.map((c, i) => ({ expr: c.expr, value: row[i] ?? null })) },
      callouts: buildCallouts(visualJson, theme, format, plan, vals, fieldLabel)
    }
  })
  const all = sections.flatMap((s) => s.callouts)
  const layout = readCardLayout(props, plan.fields.length, all.some((c) => c.refLabels.length > 0), all.some((c) => !!c.cardImage))
  return {
    callouts: sections[0]?.callouts ?? [],
    layout,
    sections,
    categoryLayout: readCategoryLayout(props, sections.length, theme),
    empty: plan.fields.length === 0 ? 'Add data fields to this card' : sections.length === 0 ? 'No data' : undefined
  }
}

/**
 * Mark callouts whose field is an AS-style KPI status / trend measure (`_<m> Status` / `_<m> Trend`)
 * so they render the KPI graphic instead of the number (Power BI behavior).
 */
export function applyKpiIcons(model: CardVisualModel, fields: Array<{ queryRef: string; expr: SQExpr }>, kpiOf: (expr: SQExpr) => { part: string; statusGraphic?: string } | undefined): CardVisualModel {
  const byRef = new Map(fields.map((f) => [f.queryRef, f.expr]))
  const mark = (c: CalloutModel) => {
    const e = byRef.get(c.queryRef)
    const icon = e ? kpiIconFor(kpiOf(e), c.raw) : undefined
    if (icon) c.kpiIcon = icon
  }
  model.callouts.forEach(mark)
  model.sections?.forEach((s) => s.callouts.forEach(mark))
  return model
}

function refFieldLabel(expr: SQExpr): string {
  return expr?.Measure?.Property ?? expr?.Column?.Property ?? expr?.Aggregation?.Expression?.Column?.Property ?? ''
}

export function withAlpha(color: string, transparency: number): string {
  if (!transparency || !color.startsWith('#')) return color
  const h = color.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, 1 - transparency / 100)})`
}

// ---------------------------------------------------------------------------------------------
// Pagination / grid geometry (pure, shared by the renderer and tests)
// ---------------------------------------------------------------------------------------------

export interface GridGeometry {
  columns: number
  /** rows per page / viewport */
  rowsPerPage: number
  /** cards per page */
  pageSize: number
  pages: number
  cellWidth: number
  cellHeight: number
  /** true when cards overflow the viewport (scroll or paginate) */
  overflow: boolean
}

/** Compute the card grid geometry for a viewport of `width` × `height` px holding `count` cards. */
export function gridGeometry(L: Pick<CardLayoutModel, 'columns' | 'rows' | 'fixedRows' | 'fixedSize' | 'rowGap' | 'columnGap' | 'overflow'>, count: number, width: number, height: number, navHeight = 0): GridGeometry {
  if (L.fixedSize) {
    const columns = L.overflow.direction === 'horizontal' ? Math.max(1, count) : Math.max(1, Math.floor((width + L.columnGap) / (L.fixedSize.width + L.columnGap)))
    const rowsFit = Math.max(1, Math.floor((height - navHeight + L.rowGap) / (L.fixedSize.height + L.rowGap)))
    const rows = Math.ceil(count / columns)
    const pageSize = columns * rowsFit
    return { columns, rowsPerPage: rowsFit, pageSize, pages: Math.max(1, Math.ceil(count / pageSize)), cellWidth: L.fixedSize.width, cellHeight: L.fixedSize.height, overflow: rows > rowsFit }
  }
  const columns = Math.max(1, L.columns)
  const rows = Math.max(1, Math.ceil(count / columns))
  const rowsPerPage = L.fixedRows ? Math.max(1, L.fixedRows) : rows
  const overflow = rows > rowsPerPage
  const pageSize = columns * rowsPerPage
  const h = height - (overflow && L.overflow.style === 'paginate' ? navHeight : 0)
  return {
    columns,
    rowsPerPage,
    pageSize,
    pages: Math.max(1, Math.ceil(count / pageSize)),
    cellWidth: Math.max(1, (width - L.columnGap * (columns - 1)) / columns),
    cellHeight: Math.max(1, (h - L.rowGap * (rowsPerPage - 1)) / rowsPerPage),
    overflow
  }
}

/**
 * Format resolution without data, for the Format pane's effective values (VisualDefinition.formatDefaults): one
 * callout with one reference label (title, value, detail) and one category section, so every format reader of the
 * card runs with its own fallback.
 */
export function cardVisualFormatDefaults(visualJson: any, theme: ResolvedTheme): void {
  const expr: SQExpr = { Measure: { Expression: { SourceRef: { Entity: '_' } }, Property: '_' } } as SQExpr
  const field: CardFieldInfo = { queryRef: '\u0000probe', expr, label: '', isMeasure: true }
  const plan: CardQueryPlan = {
    fields: [field],
    categories: [field],
    values: [],
    refs: new Map([[field.queryRef, [{ id: '\u0000ref', order: 0, valueId: 'ref', expr, detailValueId: 'det', detailExpr: expr }]]]),
    rules: new Map()
  }
  const format: ValueFormatter = (v) => String(v)
  // one category row (group column only): buildCallouts + readCardLayout + readCategoryLayout
  buildCategorizedModel(visualJson, theme, format, plan, { columns: [{ kind: 'group' } as SummarizeResult['columns'][number]], rows: [[1]] }, () => '')
}
