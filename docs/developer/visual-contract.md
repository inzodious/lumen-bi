# The visual contract

> **Applies to:** Developers

This article describes the interface every Lumen visual implements, `VisualDefinition`, and how the report canvas finds and hosts it. Read it before you change a visual or add one; the [tutorial](tutorial-add-a-visual.md) then walks through a complete example.

## Overview

A Power BI report stores each visual as a PBIR `visual.json` file whose `visual.visualType` names the kind of visual (`clusteredColumnChart`, `tableEx`, `cardVisual` and so on). Lumen implements each visual type as one **visual definition**: a plain object that registers itself in a registry when its module is imported. The definition says which field wells the visual has, which Format pane cards it offers, which React component draws it and a few optional capabilities.

The split of responsibilities is stated at the top of the contract file, `src/renderer/src/visuals/contract.ts`:

```ts
/**
 * Visual plug-in contract. Every PBIR `visualType` is implemented as a VisualDefinition registered
 * in ./registry.ts. The report canvas (shell) owns layout, container chrome (title, background,
 * border, shadow, padding, header icons), interactions state and filter computation; a visual
 * component only renders its content area and talks to the host through `ctx`.
 */
```

So a visual never draws its own title, border or visual header, never computes which filters apply to it and never reads the zustand stores directly. It receives a content-area size and a host context (`ctx`) and renders.

## The registry

`src/renderer/src/visuals/registry.ts` is a map from visual type to definition:

| Function | What it does |
|---|---|
| `registerVisual(def)` | Stores `def` under `def.type` and under every name in `def.aliases`. A later registration of the same type replaces the earlier one. |
| `getVisual(visualType)` | Looks the type up. Custom visuals carry a 32-hex-digit GUID suffix in PBIR (`htmlContent443BE3AD…`), so a miss falls back to a case-insensitive prefix match when the name ends in such a suffix. |
| `allVisuals()` | Every distinct definition (aliases collapsed). |

Visual modules call `registerVisual` at import time. `src/renderer/src/visuals/index.ts` imports every family once:

```ts
import './charts'
import './tables'
import './cards'
import './slicers'
import './elements'
import './custom'
```

`app/App.tsx`, `report/ReportView.tsx` and `report/PrintLayout.tsx` import `../visuals` before rendering anything, and so do the visual tests. A family folder's `index.ts` either calls `registerVisual` directly (`elements/index.ts`) or calls per-subfamily register functions (`charts/index.ts` calls `registerCartesianCharts()`, `registerPieCharts()`, `registerOtherCharts()`, `registerMapVisuals()` and `registerMiscVisuals()`).

A visual type with no registered definition renders the `UnknownVisual` placeholder in `report/VisualContainer.tsx`. The Visualizations pane still lists Power BI's core visuals that have no definition: `panes/visualizations/catalog.ts` holds a fallback catalog (type, display name, icon, field-well roles), and `galleryItems()` in `panes/visualizations/BuildTab.tsx` merges it with the registry, so the gallery and the field wells stay complete while a type is not implemented. Unregistered tiles carry the tooltip "Preview: rendering for this visual is limited."

## `VisualDefinition`

```ts
export interface VisualDefinition {
  type: string
  aliases?: string[]
  displayName: string
  category: 'chart' | 'table' | 'card' | 'slicer' | 'element' | 'map' | 'custom'
  icon: string
  roles: DataRoleDef[]
  formatCards: FormatCardDef[]
  component: ComponentType<VisualProps>
  inGallery?: boolean
  isSlicer?: boolean
  supportsHighlight?: boolean
  supportsDrill?: boolean
  getData?(visual: VisualDocument, ctx: VisualHostContext): { columns: string[]; rows: Scalar[][] } | undefined
  defaultSize?: { width: number; height: number }
  formatDefaults?(visualJson: any, theme: ResolvedTheme): void
}
```

(Doc comments removed; see the file for them.)

| Member | Meaning and who reads it |
|---|---|
| `type`, `aliases` | The PBIR `visualType` and other names that should map to the same implementation (legacy names, for example). |
| `displayName` | The name in the Visualizations pane gallery tooltip and the accessible name of its tile. |
| `category` | Drives container defaults. `report/VisualContainer.tsx` passes `titleOnByDefault: undefined` (decided by the `TITLE_ON_BY_DEFAULT` pattern in `report/chrome.ts`) for `chart` and `map`, and `false` for every other category; `element` gets 5 px padding on every side instead of the data-visual padding. See [Container chrome and text](container-chrome-and-text.md). |
| `icon` | A 20 x 20 SVG markup string for the gallery tile; it should draw with `currentColor`. `EmptyVisual` in `common/VisualState.tsx` also shows it faded when the wells are empty. |
| `roles` | The field wells, in display order (see [Data roles](#data-roles)). |
| `formatCards` | The Format pane cards (see [Format cards](#format-cards-and-properties)). |
| `component` | The React component that renders the content area. It receives `VisualProps`. |
| `inGallery` | `false` hides the type from the gallery (internal or legacy aliases). |
| `isSlicer` | The canvas treats the visual as a slicer: its selection becomes a filter on other visuals, and it receives `setSlicerFilter` / `slicerFilter`. |
| `supportsHighlight` | The canvas sends cross-highlight selections from other visuals as `ctx.highlightFilters` instead of filtering this visual. |
| `supportsDrill` | Enables the drill buttons in the visual header for roles marked `drillable`. |
| `getData` | The data behind the visual, used by the context menu entries **Show as a table**, **Show data point as a table**, **Export data** and (when the visual supplies no `selectionText`) **Copy selection**. Without it **Show as a table** and **Export data** are disabled and **Show data point as a table** is not offered. |
| `defaultSize` | The size `insertVisual()` (`app/commands.ts`) uses; without it a new visual is 480 x 270. |
| `formatDefaults` | Runs the visual's format resolution without data so the Format pane can show the defaults the renderer really uses. See [Format pane internals](format-pane-internals.md#renderer-defaults). |

### Data roles

```ts
export interface DataRoleDef {
  name: string        // PBIR queryState role name: 'Category', 'Y', 'Series', 'Values', 'Rows', ...
  displayName: string // the well title in the Build pane
  kind: DataRoleKind  // 'grouping' | 'measure' | 'both'
  max?: number
  drillable?: boolean
}
```

`name` must be the role name Power BI writes into `visual.query.queryState` for that visual type, otherwise files saved by Power BI Desktop do not bind and files Lumen writes do not open as expected in Power BI. `kind` controls what the well accepts: `canDrop()` in `BuildTab.tsx` refuses a measure in a `grouping` well and a hierarchy in a `measure` well. `rolesFor()` in the same file appends any role that a file uses but the definition does not list, so nothing in a file is hidden.

### Format cards and properties

A `FormatCardDef` is one card of the Format pane. Its `object` is the PBIR object name the properties are stored under (`visual.objects.<object>` or, with `container: true`, `visual.visualContainerObjects.<object>`). `toggle` names the property bound to the switch in the card header (usually `show`). `tab: 'general'` moves a card to the General tab.

A `FormatPropDef` is one row:

| Field | Meaning |
|---|---|
| `name`, `displayName` | PBIR property name and row label. |
| `type` | The control: `bool`, `number`, `integer`, `percent`, `color`, `text`, `textarea`, `enum`, `fontFamily`, `fontSize`, `alignment`, `displayUnits`, `image` or `iconSource`. |
| `options` | Values and labels of an `enum`. |
| `min`, `max` | Bounds of numeric controls. |
| `default` | Shown when the property is set nowhere and no renderer default is known. Prefer `formatDefaults` or the chart tables over this field (see below). |
| `perSeries` | The property can be set per series (`selector.metadata` = the measure's queryRef), for example `dataPoint.fill`. |
| `conditional` | Overrides the default availability of the **fx** (conditional formatting) button. Color properties of visuals have fx by default; title, subtitle and alt text support **Field value**. |
| `icon` | Only for `iconSource`: the image slot an icon is baked into. |

`iconSource` is a Lumen pseudo property: it is never written to PBIR itself. It renders the icon rows (`icons/IconSourceRows.tsx`) for an image slot described by `FormatIconSlot`:

```ts
export interface FormatIconSlot {
  object: string
  property: string
  form: 'resource' | 'dataUri'
  typeProp?: string
}
```

The image visual uses `{ object: 'general', property: 'imageUrl', form: 'resource' }`; the new card uses `{ object: 'image', property: 'imageUrl', form: 'dataUri', typeProp: 'imageType' }`. See [Icons internals](icons-internals.md).

The pane adds the container cards (Title, Effects, Header icons and so on, `panes/visualizations/containerCards.ts`) to every visual, so a definition lists only its own cards.

> [!IMPORTANT]
> Read every property through `core/report/props.ts` (`getProp`, or the typed `FormatReader` in `visuals/common/fmtProps.ts`) and pass the renderer's default as the `fallback` argument. That single rule makes theme `visualStyles` apply as in Power BI and lets the Format pane show the right default. A default applied outside `getProp` (`reader.optStr(...) ?? '#118DFF'`) is invisible to the pane.

### Context menu entries

A visual adds its own entries to the visual context menu through `ctx.showContextMenu(req)`. `ContextMenuRequest` carries the click position, the clicked data point (`identity`), what was clicked (`target`: `dataPoint`, `header`, `total` or `empty`), the cell's display text for **Copy value**, a `selectionText()` callback for **Copy selection**, and `entries`: `ContextMenuEntry` items that only this visual can offer (Expand and Collapse of a hierarchy, Set column width, a slicer's Search). `buildVisualMenu` in `report/Overlays.tsx` shows them as one block after **Include** and **Exclude**.

## `VisualProps` and the host context

The component receives:

```ts
export interface VisualProps {
  visual: VisualDocument
  pageName: string
  width: number   // content area in CSS px, after padding and title
  height: number
  ctx: VisualHostContext
}
```

`VisualHostContext` is built per container by `useVisualHost()` in `report/host.ts` and memoized so a visual re-renders only when something it depends on changes. The members a visual uses most:

| Member | Use |
|---|---|
| `engine` | The `QueryEngine` (`core/engine/api.ts`), wrapped by `cachedEngine` (LRU of identical requests) and the Performance analyzer meter. Synchronous. |
| `theme`, `format`, `locale` | Resolved report theme, value formatter (`.NET` format strings), locale. |
| `mode` | `'view'` or `'edit'`. |
| `filters` | Every filter that applies to this visual, already normalized: report, page, visual, slicers, cross-filters, drill-through, drill path. |
| `highlightFilters` | Cross-highlight filters from another visual (only for `supportsHighlight` visuals). |
| `selection`, `select(ids, { multi })` | This visual's selected data points; selecting cross-filters the page. |
| `drill`, `setDrill` | Drill state of hierarchical roles. |
| `showTooltip`, `showContextMenu` | Default tooltip and context menu. |
| `actions` | Page navigation, bookmarks, back, drill-through, URLs, clear all slicers. |
| `report` | Pages, bookmarks, `resolveImage()` for registered resources, and `pageVisuals` for page-summarizing visuals. |
| `updateVisual(mutator)` | Persists a change to the visual JSON as an undoable edit (a header sort, a slicer search). |
| `setSlicerFilter`, `slicerFilter`, `slicerCleared` | Slicers only. |

A visual identifies data points with `DataPointIdentity` (`core/report/sq.ts`): a list of `{ expr, value }` pairs. The host turns a selection into an SQ `In` filter with `identitiesToFilter()`.

## Considerations and limitations

- The contract is a TypeScript interface, not a plug-in API: visuals are compiled into the app. Lumen does not load Power BI custom visual packages (`.pbiviz`); a few custom visual types (HTML Content, Deneb, Power Automate) are reimplemented under `visuals/custom/`.
- `engine` calls are synchronous and run on the renderer thread. A slow query blocks the UI until the engine's per-call time budget (`queryBudgetMs`, 15 s by default) returns partial results.
- Changing the contract follows the rule in [ARCHITECTURE.md](../ARCHITECTURE.md#contracts-read-these-first--they-are-the-integration-surface): additive changes (new optional members) are fine; anything else is a breaking change for every visual.

## Related content

- [Tutorial: add a visual](tutorial-add-a-visual.md)
- [The visual query pipeline](visual-query-pipeline.md)
- [Format pane internals](format-pane-internals.md)
- [Container chrome and text](container-chrome-and-text.md)
- [The report document model](the-report-document-model.md)
- [Supported visuals (reference)](../reference/visual-support.md)
