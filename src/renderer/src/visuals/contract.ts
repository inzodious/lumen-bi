/**
 * Visual plug-in contract. Every PBIR `visualType` is implemented as a VisualDefinition registered
 * in ./registry.ts. The report canvas (shell) owns layout, container chrome (title, background,
 * border, shadow, padding, header icons), interactions state and filter computation; a visual
 * component only renders its content area and talks to the host through `ctx`.
 */
import type { ComponentType, ReactNode } from 'react'
import type { QueryEngine, ValueFormatter } from '@core/engine/api'
import type { DataPointIdentity, SQExpr, SQFilter } from '@core/report/sq'
import type { ResolvedTheme } from '@core/report/theme'
import type { VisualDocument } from '@core/report/types'
import type { Scalar } from '@core/model/data'

export interface DrillState {
  /** index of the active level within hierarchical roles (Category / Rows / Columns) */
  level: number
  /** identities drilled into (each adds a filter at the next level) */
  path: DataPointIdentity[]
  /** matrix: expanded row paths keys / expand-all-down level */
  expandedLevel?: number
  /** 'drillDown' mode toggled from the visual header (click = drill instead of select) */
  drillMode?: boolean
  /** matrix: PBI visual-header "Drill on" target (default 'rows') */
  target?: 'rows' | 'columns'
  /** matrix: first visible Columns level (drill down/up on columns) */
  columnLevel?: number
  /** matrix: "Expand all down one level" applied to Columns */
  columnExpandedLevel?: number
}

export interface TooltipItem {
  label: string
  value: string
  color?: string
}

export interface TooltipRequest {
  /** screen coords (clientX/Y) */
  x: number
  y: number
  items: TooltipItem[]
  /** identity of the hovered point (used for report-page tooltips) */
  identity?: DataPointIdentity
}

/** One entry of the visual context menu supplied by the visual itself (see ContextMenuRequest.entries). */
export interface ContextMenuEntry {
  label?: string
  onClick?(): void
  disabled?: boolean
  /** shows a check mark (toggle entries such as a slicer's Search) */
  checked?: boolean
  /** sub-menu */
  items?: ContextMenuEntry[]
  separator?: boolean
}

export interface ContextMenuRequest {
  x: number
  y: number
  identity?: DataPointIdentity
  /**
   * What was right-clicked. Default: a data point when `identity` is set, else the visual's empty area.
   * 'header' = a row / column / item header (a label, not a value); 'total' = a total or subtotal.
   */
  target?: 'dataPoint' | 'header' | 'total' | 'empty'
  /** display text of the clicked cell / label (Copy ▸ Copy value) */
  value?: string
  /** the visual's current selection as tab-separated text (Copy ▸ Copy selection); default: the visual's data */
  selectionText?(): string | undefined
  /**
   * Entries only this visual can offer for what was clicked (Expand ▸ / Collapse ▸ of a hierarchy, Set column
   * width, a slicer's Search / Clear selections…). The host shows them as one block after Include / Exclude.
   */
  entries?: ContextMenuEntry[]
}

export interface VisualActions {
  navigatePage(pageName: string): void
  applyBookmark(bookmarkName: string): void
  back(): void
  drillthrough(targetPage: string, identity: DataPointIdentity): void
  openUrl(url: string): void
  /** clear all slicers on the page */
  clearAllSlicers(): void
}

export interface ReportInfo {
  pages: Array<{
    name: string
    displayName: string
    hidden: boolean
    isTooltip?: boolean
    isDrillthrough?: boolean
    /** drillthrough pages: the page's drill-through fields (filter cards with howCreated 'Drillthrough' / pageBinding), as SQ field exprs */
    drillthroughFields?: SQExpr[]
  }>
  activePage: string
  bookmarks: Array<{ name: string; displayName: string; group?: string }>
  /**
   * Name of the bookmark applied most recently (bookmarks pane, bookmark navigator, button) — the bookmark
   * navigator shows it as selected. Undefined when none has been applied this session.
   */
  activeBookmark?: string
  /** resolve a ResourcePackageItem / image name to a URL usable in <img src> */
  resolveImage(ref: { resource: string; package?: string; packageType?: number } | string): string | undefined
  /**
   * The visuals of the page this visual is on (including itself), each with its effective filter context
   * when the host computed it. Used by page-summarizing visuals (Narrative / smart narrative). Optional:
   * when absent, those visuals read the page from the document store and apply their own filters plus each
   * visual's visual-level filters.
   */
  pageVisuals?: PageVisualInfo[]
}

/** A visual on the current page, for page-level summaries (see ReportInfo.pageVisuals). */
export interface PageVisualInfo {
  visual: VisualDocument
  /** effective filters of that visual (what VisualHostContext.filters would be for it) */
  filters?: SQFilter[]
}

export interface VisualHostContext {
  engine: QueryEngine
  theme: ResolvedTheme
  format: ValueFormatter
  locale: string
  mode: 'view' | 'edit'
  /** All filters that apply to this visual (report + page + visual-level + slicers + cross-filters + drill-through + drill path). Already normalized (Entity refs). */
  filters: SQFilter[]
  /** Cross-highlight filters from another visual (when interaction = highlight). Visuals that support highlighting compute `highlights` with them. */
  highlightFilters?: SQFilter[]
  /** This visual's own data point selection. */
  selection: DataPointIdentity[]
  /**
   * The page's current data point selection made in any visual (cross-filter source selection), used by
   * drill-through buttons ("select a data point, then click the button"). Undefined/empty when nothing is selected.
   */
  pageSelection?: DataPointIdentity[]
  /** Select data points (cross-filters other visuals). Empty array clears. */
  select(ids: DataPointIdentity[], opts?: { multi?: boolean }): void
  /** Slicers only: replace this slicer's filter (undefined clears). Also persisted into visual.json objects.general.filter. */
  setSlicerFilter(filter: SQFilter | undefined): void
  /** Slicers only: current filter of this slicer (from runtime state or saved visual.json). */
  slicerFilter?: SQFilter
  /** Slicers only: the user cleared a saved selection in this session (the saved visual.json filter no longer applies). */
  slicerCleared?: boolean
  drill: DrillState
  setDrill(next: DrillState): void
  showTooltip(req: TooltipRequest | null): void
  showContextMenu(req: ContextMenuRequest): void
  actions: VisualActions
  report: ReportInfo
  /** Persist a change to the visual JSON (e.g. a sort clicked in a table header, a slicer search). Undoable; `label` names the undo step (default "Edit visual"). */
  updateVisual(mutator: (visualJson: any) => void, label?: string): void
}

export interface VisualProps {
  visual: VisualDocument
  pageName: string
  /** content area size in CSS px (after container padding/title) */
  width: number
  height: number
  ctx: VisualHostContext
}

export type DataRoleKind = 'grouping' | 'measure' | 'both'

export interface DataRoleDef {
  /** PBIR queryState role name, e.g. 'Category', 'Y', 'Series', 'Values', 'Rows', 'Columns', 'Tooltips' */
  name: string
  displayName: string
  kind: DataRoleKind
  max?: number
  /** role participates in drill (hierarchy) */
  drillable?: boolean
}

export type FormatPropType =
  | 'bool'
  | 'number'
  | 'integer'
  | 'percent'
  | 'color'
  | 'text'
  | 'textarea'
  | 'enum'
  | 'fontFamily'
  | 'fontSize'
  | 'alignment'
  | 'displayUnits'
  | 'image'
  /** Lumen icon source for an image slot (`FormatPropDef.icon`); a pseudo property, never written to PBIR itself */
  | 'iconSource'

export interface FormatPropDef {
  name: string
  displayName: string
  type: FormatPropType
  options?: Array<{ value: string | number | boolean; label: string }>
  min?: number
  max?: number
  /** shown when the property isn't set and the theme has no value */
  default?: Scalar
  /** apply per series (selector.metadata = queryRef) — e.g. dataPoint.fill */
  perSeries?: boolean
  /**
   * Conditional formatting (fx) in the format pane. Default: color properties of visuals support fx
   * (Gradient / Rules / Field value), title/subtitle text and alt text support Field value. `true` enables
   * Field value fx on another text property; `false` hides the fx button.
   */
  conditional?: boolean
  /** type 'iconSource': the image slot the icon is baked into (see core/icons/bake.ts, docs/ICONS.md) */
  icon?: FormatIconSlot
}

/** Where an `iconSource` row bakes its icon. */
export interface FormatIconSlot {
  /** PBIR object + property that hold the image */
  object: string
  property: string
  /** 'resource' = registered SVG resource (image visual), 'dataUri' = SVG data URI in a URL property (cards) */
  form: 'resource' | 'dataUri'
  /**
   * The slot's "Image source" enum property in the same card (cards: `imageType`): its dropdown gains an "Icon"
   * entry and the URL row is hidden while an icon is shown. Without one, the icon row offers Image / Icon itself.
   */
  typeProp?: string
}

export interface FormatCardDef {
  /** PBIR object name (e.g. 'categoryAxis', 'labels', 'legend', 'dataPoint') */
  object: string
  displayName: string
  /** container-level (visualContainerObjects) card, e.g. title/background/border */
  container?: boolean
  /** the object's on/off toggle property (usually 'show') */
  toggle?: string
  properties: FormatPropDef[]
  /** group under "Visual" or "General" tab in the format pane */
  tab?: 'visual' | 'general'
}

export interface VisualDefinition {
  /** PBIR visualType (e.g. 'clusteredColumnChart') — may register several aliases */
  type: string
  aliases?: string[]
  displayName: string
  category: 'chart' | 'table' | 'card' | 'slicer' | 'element' | 'map' | 'custom'
  /** 20x20 icon (SVG markup string) for the visualizations pane */
  icon: string
  roles: DataRoleDef[]
  formatCards: FormatCardDef[]
  /**
   * Format cards that depend on the visual's JSON (the code visual's Parameters card, built from the parameters its
   * code declares). When present, the Format pane uses it instead of `formatCards`.
   */
  formatCardsFor?(visualJson: any): FormatCardDef[]
  component: ComponentType<VisualProps>
  /** shown in the visualizations gallery (false for internal/legacy aliases) */
  inGallery?: boolean
  isSlicer?: boolean
  supportsHighlight?: boolean
  /**
   * Per-visual answer to `supportsHighlight` (the code visual highlights when it has Rows, and is filtered like a card
   * when it shows measures only). Overrides `supportsHighlight` where the visual's JSON is known.
   */
  highlightsFor?(visualJson: any): boolean
  supportsDrill?: boolean
  /** Data behind the visual for "Show as table", "Export data", and accessibility. */
  getData?(visual: VisualDocument, ctx: VisualHostContext): { columns: string[]; rows: Scalar[][] } | undefined
  /** default size when inserted */
  defaultSize?: { width: number; height: number }
  /**
   * Run this visual's format resolution over `visualJson` without data (for visuals whose formatting is resolved by
   * pure functions). The Format pane calls it under core/report/props `recordFallbacks`, so every property shows the
   * default the renderer really falls back to (panes/visualizations/effective.ts) without a copied table.
   */
  formatDefaults?(visualJson: any, theme: ResolvedTheme): void
}

/** Convenience: an unknown visual type renders this placeholder. */
export interface PlaceholderInfo {
  visualType: string
  reason: string
  extra?: ReactNode
}
