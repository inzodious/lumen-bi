# Visual defaults (base theme CY24SU10)

What an **unformatted** visual looks like in Lumen (fields added, nothing set in the format pane) compared with
Power BI Desktop's defaults, property by property. Defaults resolve in this order: `visual.objects` → theme
`visualStyles` (custom theme, then the base theme `src/core/report/themes/CY24SU10.json`) → the fallback in code
(`visuals/common/fmtProps.ts` `PBI`, per-visual format cards).

Sources, in order of preference:
1. **CY24SU10.json**: the base theme Power BI ships (values it sets win over everything else here).
2. **Learn**: Microsoft Learn "Create custom report themes" (text-class and structural-color tables), the
   per-visual format-pane articles, and the report-theme JSON schema (object/property names).
3. **Measured**: pixel measurements of Power BI renders in Learn screenshots or Microsoft sample reports.
   Where Learn's tables and a real render disagree, the render wins and the row says so.

"Unverified" rows have no public source beyond what is noted; they keep the earlier value.
Text sizes are in points (1pt = 4/3 px at 100% zoom).

## Charts (column, bar, line, area, combo, ribbon, waterfall, funnel, scatter, pie, donut, treemap, maps, gauge, KPI)

| Visual | Property | Lumen value | PBI default | Source |
|---|---|---|---|---|
| all charts | Axis titles | shown; `title` text class (DIN 12pt #252423) | `title` class; `categoryAxis/valueAxis.showAxisTitle: true` | CY24SU10.json `visualStyles.*.*.categoryAxis/valueAxis`; Learn text classes ("Category axis title", "Value axis title"); sampled #252423 on a PBI render (Learn column-formatting.png) |
| all charts | Category axis labels | Segoe UI 9pt #605E5C | #605E5C (`lightLabel`); Learn's class table implies 10pt | Learn text classes + structural colors; pixel heights on Learn column-formatting.png match the 9pt value-axis labels (±1px), so 9pt is kept |
| all charts | Value axis labels | Segoe UI 9pt #605E5C | `smallLightLabel` #605E5C 9pt | Learn text classes; sampled #605E5C |
| all charts | Value gridlines | on, dotted, 1px, #C8C6C4 | `gridlineStyle: dotted`; color: Learn's structural table says thirdLevelElements (#F3F2F1) | CY24SU10.json (style); a PBI render (Learn column-formatting.png) samples ≈ #D0CFCD on anti-aliased dots, consistent with #C8C6C4 and not with #F3F2F1, so #C8C6C4 is kept |
| all charts | Category gridlines | off | off | PBI format pane default; CY24SU10 sets only the style |
| all charts | Legend | shown when there is a legend field or > 1 measure; Top, circles, Segoe UI 8pt #605E5C; title = legend field | Top-left; `lightLabel` #605E5C | Learn text classes ("Legend text"); sampled #605E5C. Size 8pt is the format-pane default (Learn's class table implies 10pt; a newer-sample render measures ≈ 9pt with the report's own settings) — unresolved, kept 8pt |
| all charts | Data labels (outside / on lines / stacked totals / funnel, waterfall outside / map category labels) | Segoe UI 9pt **#605E5C** (was #252423) | `smallLightLabel` #605E5C 9pt | Learn text classes ("Data labels"); sampled #605E5C on pie detail labels and scatter category labels in Learn column-formatting.png |
| all charts | Data labels inside bars / slices | contrast color (white on dark fills, #252423 on light) | contrast with the fill | Learn structural colors (label background when inside/outside) + PBI renders |
| all charts | Visual title | DIN 12pt #252423 (`title` text class), regular weight | `title` class | CY24SU10.json text classes; a Power BI Desktop render of the Retail Analysis sample (Learn column-cross.png, scale derived from the selected visual's frame vs its layout size) measures cap height ≈ 12 px and x-height ≈ 8.4 px at 100% = 12pt, not the 14pt Learn's `largeTitle` row implies. Lumen has no DIN face bundled: the title falls back to the Segoe-metric font (glyphs sit ≈ 1 px lower, text runs wider) |
| line / area | Line width / markers | 3px (theme `lineStyles.strokeWidth`), markers off | 3px | CY24SU10.json `visualStyles.*.*.lineStyles` |
| line | Forecast | gray #605E5C solid 2px line, band fill = line color at 80% transparency, 10 points, 95%, automatic seasonality | `forecast.matchSeriesInterpolation: true`; line color = firstLevelElements per Learn structural table | CY24SU10.json `lineChart.forecast`; Learn structural colors ("Line chart forecast line color"); transform parameters from real PBIR (Microsoft BCApps reports). Line color kept gray like the other analytics lines (Learn says foreground #252423; unverified on a render) |
| column / bar | Inner padding / minimum category width | 20% / 20px | 20% / 20px | PBI format pane defaults (`categoryAxis.innerPadding`, `preferredCategoryWidth`) |
| column / bar / line / area / combo | Value axis range | automatic range rounded out to a nice step (≈ one step per 50 px vertical / 90 px horizontal; the step can be finer than the labelled ticks); binary floating-point noise is dropped first (a stack summing to 1.0000000000000002 ends at 1); an explicit `start` **or** `end` switches the rounding off (the automatic end stops at the data); 100% stacked: exactly the stacked range (below 0% when there are negative values) | same | Power BI renders: Retail Analysis sample column chart (range −0.2M…0.3M for data −0.19M…0.21M, labelled every 0.2M); a clustered bar chart with only `start: 0` ends at its longest bar; a 100% stacked bar with negative values runs −7%…100% |
| bar / column | Room for labels | data labels: none reserved (a label that doesn't fit outside its bar goes inside); stacked total labels: the value range is extended past the stacks by the label size on the positive side and, with negative stacks, on the negative side — not rounded out | same for bars | Power BI renders of clustered and stacked bar charts (longest stack + total label fill the plot). Stacked **columns** follow the same rule by analogy — unverified |
| column / bar / line / area / combo / ribbon | Responsive | on | on | CY24SU10.json `general.responsive: true` |
| small multiples | Grid lines / background | inner, solid #E1DFDD 1px / transparent | `gridLineType: inner`, `backgroundTransparency: 0` | CY24SU10.json `smallMultiplesLayout` |
| small multiples | Panel geometry | every panel has the same plot size; first column gets the value-axis width, last row the category-label height (rotated or not) | panels line up | PBI renders (Learn line-charts-small-multiples.png) |
| pie / donut | Legend | shown, Right center | `legend.show: true, position: RightCenter` | CY24SU10.json `pieChart/donutChart.legend` |
| pie / donut | Detail labels | "Data value, percent of total", outside, #605E5C | `labels.labelStyle: "Data value, percent of total"` | CY24SU10.json; sampled #605E5C |
| scatter | Bubble size / fill points | −10 / filled | `bubbles.bubbleSize: -10`, `fillPoint.show: true` | CY24SU10.json `scatterChart` |
| map (Bing) | Bubble size | −10 | `bubbles.bubbleSize: -10` | CY24SU10.json `map` |
| map (Bing / filled) | Auto zoom / saved view | auto zoom on; with it off the view is restored from `mapControls.centerLatitude/centerLongitude/zoomLevel` (Azure: `zoom`) | same keys | Microsoft report-theme schema (`visual-map.mapControls`, `visual-azureMap.mapControls`) |
| Azure map | Bubble radius | 8 / min 8 / max 40 | `bubbleLayer.bubbleRadius 8, minBubbleRadius 8, maxRadius 40` | CY24SU10.json `azureMap` |
| zoom slider | Saved window | `zoom.categoryMin/Max/Size`, `valueMin/Max/Size` (axis values; category indices on categorical axes) | same keys | Microsoft report-theme schema `visual-*.zoom` (semantics undocumented, see `zoomPersist.ts`) |
| gauge | Callout value | `callout` class DIN 45pt #252423 | `callout` / firstLevelElements | Learn text classes + structural colors ("Gauge callout value color") |
| gauge | Target line | **#605E5C** (was #252423) | `lightLabel` "Gauge target"; secondLevelElements "Gauge target and target leader line color" | Learn text classes + structural colors (a Learn render uses a custom theme, not comparable) |
| gauge | Arc background (track) | #E6E6E6 | thirdLevelElements (#F3F2F1) per Learn | Unverified: the only Learn render uses a custom theme (#EAEAEA); kept |
| gauge | Min / max labels | Segoe UI 9pt #605E5C | `largeLightLabel` (12pt) per Learn | Unverified: the Learn render measures ≈ 8pt; kept 9pt |
| kpi | Trend line | transparency 20 | `trendline.transparency: 20` | CY24SU10.json `kpi` |
| waterfall | Increase / decrease / total | theme good / bad / data color 1 | sentiment colors | Learn ("good, neutral, bad … used by the waterfall chart and the KPI visual") |
| treemap / pie / donut | Stroke between tiles / slices | #FFFFFF (treemap: between detail tiles, 0.5px) | `background` structural color | Learn structural colors ("Donut chart stroke color", "Treemap stroke color") |
| funnel | Data labels / conversion-rate labels | 9pt #605E5C outside bars (contrast color inside) / 9pt #605E5C | `lightLabel` ("Funnel chart data labels", "conversion rate labels") | Learn text classes. The conversion-rate stroke (fourthLevelElements) isn't drawn — unverified where PBI draws it |

## Visual container (title, subtitle, divider, spacing, padding)

| Element | Property | Lumen value | PBI default | Source |
|---|---|---|---|---|
| container | Padding | data visuals: top 0, right / bottom / left 5 px; elements (text box, shape, image, buttons, navigators): 5 px all around | not published ("default values vary by visual type") | Measured on the Power BI Desktop render of the Retail Analysis sample (four chart / map visuals without padding settings): title text starts 3.2–3.3 px below the container's top edge and ≈ 6 px from its left edge; Lumen lands within 1 px with 0 / 5. Element padding is **unverified** (kept from before: the text box on the same render sits lower than 0 px would give) |
| title | Font | the stored family decides the face: "Segoe UI Semibold" (also as `'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif`) = weight 600, never bold; Bold / Italic / Underline are separate flags; size in points (also when stored as a string) | same | Format pane font list; PBIR literals |
| title | Line height | the font's own (`normal`; Segoe UI 1.33) | not set by Power BI | Measured: a 9pt Segoe title + 5 px spacing puts the subtitle's line 21 px lower |
| title | Background | spans the full container width and covers the spacing below the text; shared by the subtitle | same | Power BI renders with a title background (title, subtitle and divider on) |
| title card | Toggle | `title.show` off hides subtitle and divider too | same | Format pane: Subtitle / Divider are sub-cards of Title |
| spacing | Vertical spacing | 5 px after each shown element (title, subtitle, divider); `customizeSpacing` → `spaceBelowTitle` / `spaceBelowSubTitle` / `spaceBelowTitleArea`; files saved by the July 2026+ pane: `spaceAboveSubtitle` / `spaceAboveDivider` / `spaceAbovePlotArea` win when present | 5 px ("Vertical spacing") | Format-pane screenshot (Customize spacing off: 5 px); measured title → subtitle → divider distances on a Power BI render; property names from the report-theme JSON schema. Missing "space above" values fall back to the vertical spacing — **unverified** |
| divider | Width / style / color | 1 px, solid, `foregroundNeutralTertiary`; drawn as authored (width in px) | not published | Schema (`style`: solid / dashed / dotted). Defaults **unverified** (kept) |
| divider | Ignore padding | on (edge to edge) when the file doesn't say; off = inset by the left / right padding | not published | Semantics: Learn "Format pane General tab" ("Turn on Ignore padding to extend the divider across the full width of the visual") and a render with it off. The default itself is **unverified** (kept) |


## Tables, matrices and cards

| Visual | Property | Lumen value | PBI default | Source |
|---|---|---|---|---|
| table / matrix | Values font | Segoe UI 10pt `foreground` (#252423) | Segoe UI 10pt #252423 (`label` class) | Learn "Create custom report themes" text-class table (label: table and matrix values / grid) |
| table / matrix | Column header font | Segoe UI 10pt regular, `foreground` | `label` class (regular). Structural table also lists "table and matrix header font color" under secondLevelElements (#605E5C); current-PBI screenshots show headers in the foreground color | Learn text-class + structural-color tables; Learn matrix screenshot (power-bi-matrix-create.png, header text = foreground) |
| matrix | Row header font | Segoe UI 10pt regular, `foreground` | `label` class | Learn text-class table ("Matrix row headers") |
| table | Totals font | Segoe UI Bold 10pt | `boldLabel` (Segoe UI Bold) | Learn text-class table ("Table totals") |
| matrix | Subtotals / grand totals font | bold, values font size/color | `boldLabel` | Learn text-class table ("Matrix subtotals / grand totals") |
| matrix | Column-header parents above the lowest visible level | bold | bold ("Gadgets", "Widgets", "Total") | Learn matrix screenshot (power-bi-matrix-create.png) |
| table | Banding | rows alternate `background` / `backgroundLight` (#FFFFFF / #F3F2F1) | alternating light-gray rows | Learn table screenshot (table-value-goal-status.png) + structural color backgroundLight |
| matrix | Banding | none (all rows `background`) | none | Learn matrix screenshot (power-bi-matrix-create.png) |
| table | Gridlines | horizontal on, vertical off, `backgroundLight` 1px | horizontal on, "table and matrix grid color" = thirdLevelElements (backgroundLight) | Learn structural-color table; Learn table screenshot |
| matrix | Gridlines | off | off | Learn matrix screenshot |
| table / matrix | Grid outline (under headers, above table total, right of matrix row headers) | `tableAccent` (#118DFF), 1px | `tableAccent` "when present", else secondaryBackground | Learn structural-color table; both Learn screenshots show the accent line under the header / above the total, and the matrix row-header separator |
| matrix | Grand total row top border | none | none | Learn matrix screenshot |
| matrix | Subtotal position / label | Top, "Total" | Top (rows above their children, bold), "Total" | Learn matrix screenshot |
| matrix | +/- buttons | rows on (theme `rowHeaders.showExpandCollapseButtons: true`), rounded square, ~0.85 × row-header font px | on in base theme | CY24SU10.json `pivotTable.rowHeaders.showExpandCollapseButtons` |
| table / matrix | Row padding | 3px | not published (measured 1–4px across Learn screenshots at different zooms) | approximation kept from phase 1 |
| table / matrix | KPI status icon size | = value font px (10pt → 13px box, 11px glyph) | ≈ 11–12px circle at 10pt | Learn table screenshot (table-value-goal-status.png) |
| table / matrix / cards | KPI status graphics | PBI's graphic × value table (3-state −1..1; 5-state −2..2; Cylinder/Smiley Face/Thermometer = Shapes; Gauge = Harvey balls; Standard/Status arrows = thin arrows; decimals and unknown graphics show the number) | same | SQLBI "KPI in Tabular models for Power BI and Excel" (Power BI rendering table) |
| icons (CF + KPI) | Green / yellow / red / black | #79C75B / #E8D62E / #C0433A / #252423; empty parts #C7C7C7 | same (sampled) | Pixel samples of the Power BI KPI rendering (SQLBI) and of Learn's table-value-goal-status.png status column |
| icons | Rimmed traffic light | colored lamp in a black square | same | SQLBI Power BI KPI table |
| icons | 5 boxes fill order | 1 = top-left, 2 = bottom row, 3 = top-left + bottom row, 4 = all | same | SQLBI Power BI KPI table |
| card (new) | Callout value | Segoe UI Semibold 28pt `foreground`, left-aligned, vertically centred | Semibold, #252423 (sampled), value ≈ 27–28pt | Learn "Create card visuals" build-card.png (glyph heights / colors measured) |
| card (new) | Category label | Segoe UI 12pt `foregroundNeutralSecondary` below value | #605E5C (sampled) below value | Learn build-card.png |
| card (new) | Tile outline | 1px `backgroundLight` (#F3F2F1), 4px radius | #F4F3F2 1px (sampled), rounded | Learn build-card.png / walkthrough-basic-card.png |
| card (new) | Max tiles / overflow / image area | 3 / 0 (continuous) / 50% | 3 / 0 / 50 | CY24SU10.json `cardVisual` |
| card (new) | Display units (auto) on whole-currency format | "$599K", "8K" | same | Learn walkthrough-basic-card.png |
| card (legacy) | Callout value | `callout` class DIN 45pt `foreground` (auto-shrinks to fit) | `callout` DIN #252423 45pt | Learn text-class table ("Card data labels") |
| card (legacy) | Category label | Segoe UI 12pt `foregroundNeutralSecondary` | `largeLightLabel` #605E5C 12pt (structural table also lists fourthLevelElements for card category labels) | Learn text-class table |
| multi-row card | Card bar / outline | bar on, 2px, data color 0; outline Bottom only, weight 2 (from the base theme via props.ts) | `multiRowCard.card`: outlineWeight 2, barShow true, barWeight 2 | CY24SU10.json `multiRowCard` |
| multi-row card | Data labels / category labels / title | Segoe UI 10pt `foreground` / 9pt `foregroundNeutralSecondary` / Segoe UI Semibold 13pt | Learn text classes say 12pt (largeLabel) / 12pt light (largeLightLabel) / title class; Microsoft sample renders measure 10 / 9pt | Not resolved: kept the sizes measured on real PBI renders of the Store Sales / Competitive Marketing samples |
| kpi (charts/gauge lane) | Indicator / goal / trend | callout DIN; good/bad/neutral from theme; trend transparency 20 | `callout` class; theme good #1AAB40 / bad #D64554 / neutral #D9B300; `kpi.trendline.transparency: 20` | CY24SU10.json + Learn text classes (spot-checked in the KPI gallery; file owned by the charts lane) |

## Slicers

| Visual | Property | Lumen value | PBI default | Source |
|---|---|---|---|---|
| slicer (all styles) | Header font | Segoe UI Semibold 10pt, theme foreground (#252423) | Segoe UI Semibold ≈10pt, #252423 | Learn screenshots (date-picker.png, slider-handles-round.png: cap height ≈9.3 px at 1x, color #242424) + themes doc "firstLevelElements: Slicer header font color". Note: themes doc text-class table lists "Slicer header" under `title` (DIN 12pt); rendered PBI headers don't match that, kept the measured value |
| slicer (Vertical list, Tile) | Item font | Segoe UI 10pt, foregroundNeutralSecondary (#605E5C) | Segoe UI 10pt #605E5C | Learn report-themes-create-custom: `lightLabel` (#605E5C) → "Slicer items"; `secondLevelElements` → "Slicer item font color"; tile screenshot (select-all-is-not-filtering.png) unselected text #616161. Was #252423 |
| slicer (Dropdown) | Item font color | theme foreground (#252423) | #252423 | Learn themes doc: `firstLevelElements` → "Slicer dropdown item font color" |
| slicer (Vertical list, Dropdown) | Check box, checked | solid square in the selection icon color (#252423), no tick | solid #212121 square, no tick | Learn list-eraser.png (pixel check: interior fully dark). Was white tick on dark fill |
| slicer (Vertical list, Dropdown) | Check box / radio, unchecked | 1 px outline in the item color, transparent fill | thin gray outline over the slicer background | Learn list-eraser.png |
| slicer (Vertical list, Dropdown) | Selection icon color (`selectionIcon.color`) | theme foreground (#252423) | #252423 (dark fill) | Learn slicer-visual "Selection icon color" section + list-eraser.png |
| slicer (Tile) | Selected tile | fill = selection icon color (#252423), white text | dark fill (#333333 under the screenshot's theme foreground), white text | Learn select-all-is-not-filtering.png |
| slicer (Tile) | Unselected tile | white fill, item color text, 1 px #C8C6C4 grid | white, #616161 text, light gray border | same screenshot |
| slicer (Between/Before/After) | Numeric / date input text color | theme foreground (#252423) | #252423 | Learn themes doc: `firstLevelElements` → "Slicer numeric input font color". Was inherited from item color |
| slicer (Between/Before/After) | Slider | 2 px #C8C6C4 track, #605E5C selection, 12 px white round handles with 2 px border | round handles when Responsive on | Learn slicer-visual "Slider" section (unchanged) |
| slicer (Between/Before/After/Date picker) | Handles with `general.responsive` = off | rounded bars `handleWidth` × `handleHeight`, default 7 × 17 px, filled with the handle border color | rectangular bars, Width 7 px / Height 17 px | Learn slicer-visual "When Responsive is Off, the handles are rectangular bars" + slider-handles-rectangle.png (format pane shows 7 / 17). New |
| slicer (Date picker) | Style value | `data.mode = 'RelativeDatePicker'` ("Date picker") | 'RelativeDatePicker' | reportThemeSchema-2.159.json `visual-slicer.data.mode` enum. New |
| slicer (Date picker) | Range text (`dateRangeText`) | Segoe UI, header size (10pt), #616161 | ≈10pt #616161 | Learn date-picker.png (measured). New |
| slicer (Date picker) | Restatement (`relativeText`) | Segoe UI 10pt #616161, shown; manual selections show "Selected: <range>" | #616161; "Selected: …" line under manual ranges | Learn date-picker.png, slider-handles-round.png. New |
| slicer (Date picker) | Calendar button (`calendarButton`) | 22 px square, 1 px #C8C6C4 outline, 4 px corners, #616161 Fluent CalendarLtr / CalendarSync icon, no fill | same (33 px at 150 %) | Learn date-picker.png (measured). New |
| slicer (Date picker) | Slider | 2 px #707070 track, #242424 selection, 20 px white round handles, #242424 border | #707070 track, white handles with dark border, "Size 20 px" | Learn date-picker.png, slider-handles-round.png (format pane shows 20 px). Selected-range color isn't visible in any screenshot (approximation) |
| slicer (Date picker) | Flyout | 252 px wide, white, 4 px corners, Fluent shadow; tabs Manual / Relative (2 px #377666 underline); month title + ↑ ↓; 32 px day cells Sun–Sat; selected days #377666 circles, range band #C2D5D1; Apply = #377666, white semibold, 4 px corners | same | Learn date-picker.png and relative-date-range-slicer-filter-01.png (measured colors). Start/end text inputs and Today/First/Last links in the Manual tab are Lumen additions |
| slicer (Date picker) | Relative tab | "<Field> is in the [Last]" / "[N] [Months]" / "From [Today/First date/Last date]" / "Offset by [0]" / Apply | same rows | Learn relative-date-range-slicer-filter-01.png |
| slicer (Relative date) | Range caption | item font −1pt, #605E5C | restated range under the controls | unchanged |
| advancedSlicerVisual (button slicer) | Buttons | white, 1 px #E1DFDD, 4 px corners, Segoe UI Semibold 11pt #252423 value, 9pt #605E5C label | same | Learn button-slicer-highlight-valid-selections.png (re-measured: border #D1D1D1 AA, label #242424, value #616161); unchanged |

## Elements (text box, shapes, buttons, navigators, image, smart narrative)

| Visual | Property | Lumen value | PBI default | Source |
|---|---|---|---|---|
| Text box | visualHeader.show / general.keepLayerOrder | false / true | false / true | CY24SU10.json visualStyles.textbox |
| Text box | Run font (no textStyle) | Segoe UI 10pt #252423 | Segoe UI, theme label class (10pt #252423) | CY24SU10.json textClasses.label; text box default size is not published (unverified beyond the theme class) |
| Text box | Dynamic value (+ Value / smart narrative) | underlined, 1px, theme data color 1, edit mode only | underlined in theme color 1 in Desktop / service edit mode; plain in reading view | Microsoft Learn "Add text boxes, shapes, and smart narratives" ("The smart narrative underlines values found in the data") + its screenshot; Fabric community threads (underline colour = theme colour #1, not shown in reading view) |
| Smart narrative (text box) | Summaries | HighPointLowPoint (10001), AggregateSummary (430xx), KPISummary (560xx) computed from engine.summarize | same transforms / template ids | PBIR of the Microsoft "Regional Sales" sample (values `Transform` + `TemplateIdColumnRole` switches); template selection inferred from template texts |
| Smart narrative (text box) | Paragraph spacing | blank line between summaries | blank line between summaries | Learn smart-narrative screenshot; Regional Sales sample newline switches |
| Shape | background.show / visualHeader.show / keepLayerOrder | false / false / true | false / false / true | CY24SU10.json visualStyles.shape |
| Shape | fill.show | on, theme data color 1 (#118DFF) | on | Microsoft samples: `fill.show=false` written on 64 of 68 shapes, never `true` (PBI writes non-default values) |
| Shape | outline.show | on, theme color 1, 1px | on | Microsoft samples: `outline.show=false` written on 64 of 68 shapes, never `true` |
| Shape (legacy basicShape) | fill.show | on | on | Microsoft samples: `fill.show=false` on 34 of 64 basicShapes, never `true` |
| Button | background.show / visualHeader.show | false / false | false / false | CY24SU10.json visualStyles.actionButton |
| Button | outline.show | on, #B3B0AD 1px | on | Microsoft samples: `outline.show=false` 750×, `true` 4× |
| Button | icon.show | on (#605E5C, 2px stroke) | on | Microsoft samples: `icon.show=false` 736×, never `true`; colour sampled from Learn "Create buttons" Q&A button screenshot |
| Button | text.show | off (Segoe UI 10pt #252423 when on) | off | Microsoft samples: `text.show=true` 123×, `false` 2× |
| Button | fill | on, #FFFFFF | not determinable from samples (`fill.show` false 65× / true 46×) | kept from phase 2 (Learn Q&A button screenshot shows white) — unverified |
| Button | Disabled state (drill-through without selection) | 60% opacity unless a `disabled` fill is set | greyed | Learn "Drillthrough" (button disabled without filter context); exact colours unpublished |
| Page navigator | background.show / visualHeader.show | false / false | false / false | CY24SU10.json visualStyles.pageNavigator |
| Page navigator | Default / selected button | white fill, #333333 1px outline, #252423 text / #333333 fill, white text | same | Learn "Create page and bookmark navigators" example screenshot, sampled (selected fill #333333, default #FFFFFF) |
| Page navigator | pages.showHiddenPages / showTooltipPages | false / false | false / false | Learn navigators article (Pages settings); private-corpus write frequency: `showHiddenPages=true` written on 80 of 83 navigators, never `false` |
| Page navigator | layout.orientation / cellPadding | 0 (horizontal) / 6px | horizontal | Learn navigators example screenshot (horizontal tabs); padding unverified |
| Bookmark navigator | Styling, selected = last applied bookmark, all bookmarks by default | same as page navigator | same | Learn navigators article ("By default, the bookmark navigator shows all bookmarks"; "The selected button corresponds to the last selected bookmark") |
| Image | background.show / visualHeader.show / lockAspect.show | false / false / true | false / false / true | CY24SU10.json visualStyles.image |
| Image | Scaling | Normal | Normal | PBIR `scaling` enum (Normal/Fit/Fill); PBI's format pane starts at Normal — unverified by doc |
| Narrative (aiNarratives) | Text | Segoe UI 11pt #252423, values underlined in theme colour 1 in edit mode | Copilot-generated text with citations | Lumen approximation: template text from the shared insight engine (no Copilot); styling follows smart narrative |

## Known open questions

* Learn's text-class table (category-axis labels and legend = `lightLabel`, inheriting 10pt; gauge labels 12pt;
  multi-row card 12pt) disagrees with measured renders and the format-pane defaults (9pt / 8pt / ≈ 8–9pt / 10pt).
  Lumen keeps the measured values.
* Learn's structural-color table puts axis gridlines and the gauge arc in `thirdLevelElements` (#F3F2F1); renders
  of the base theme show darker dotted gridlines (≈ #C8C6C4). Lumen keeps #C8C6C4.
* Newer base themes ("Classic 2026", "Fluent 2") change many of these defaults (axis titles off, solid gridlines,
  bottom legends, subtitles). Lumen implements the CY24SU10 defaults; reports that embed another base theme use it.
