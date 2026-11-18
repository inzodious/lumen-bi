/**
 * Generates docs/reference/visual-support.md from the renderer's visual registry
 * (src/renderer/src/visuals/registry.ts, loaded through gen-visual-load.mjs) and the
 * Visualizations-pane catalog (src/renderer/src/panes/visualizations/catalog.ts).
 *
 *   node scripts/docs/gen-visual-support.mjs            # writes the file
 *   node scripts/docs/gen-visual-support.mjs --check    # exits 1 when the file is out of date
 *
 * Everything is read from code except the "Status" column and its note: the registry has no notion of
 * fidelity, so STATUS below is assessed by hand from the renderers (does a renderer exist, do its comments or
 * its UI say "approximation") and must be reviewed when a visual changes. The script fails when a registered
 * visual or an unregistered catalog entry has no STATUS entry, so a new visual cannot slip in unassessed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadVisualRegistry, ROOT } from './gen-visual-load.mjs'

const OUT = resolve(ROOT, 'docs/reference/visual-support.md')

/** Hand-assessed status: native | approximate | placeholder | unsupported, plus a short note. */
const STATUS = {
  clusteredColumnChart: ['native', 'Analytics lines, error bars, small multiples, zoom slider.'],
  columnChart: ['native', 'Total labels; analytics lines, error bars, small multiples.'],
  hundredPercentStackedColumnChart: ['native', ''],
  clusteredBarChart: ['native', 'Analytics lines, error bars, small multiples.'],
  barChart: ['native', 'PBIR type of the stacked bar chart. See the duplicate gallery tile below.'],
  hundredPercentStackedBarChart: ['native', ''],
  lineChart: ['native', 'Forecast and Find anomalies are approximations of Power BI\'s algorithms.'],
  areaChart: ['native', 'Find anomalies is an approximation.'],
  stackedAreaChart: ['native', ''],
  hundredPercentStackedAreaChart: ['native', ''],
  lineClusteredColumnComboChart: ['native', ''],
  lineStackedColumnComboChart: ['native', ''],
  ribbonChart: ['native', 'No Analytics tab (as in Power BI).'],
  pieChart: ['native', 'Small multiples supported.'],
  donutChart: ['native', 'Small multiples supported.'],
  funnel: ['native', ''],
  treemap: ['native', ''],
  gauge: ['native', 'Maximum is extended when the target exceeds the default maximum (approximation of Power BI\'s rule).'],
  kpi: ['native', 'No cross-highlight.'],
  waterfallChart: ['native', 'No Analytics tab.'],
  scatterChart: ['native', 'Play axis animates frames; bubble size scaling is an approximation.'],
  map: ['approximate', 'No map tiles: vector country / US-state outlines; offline geocoding of countries, states, regions, about 21,000 cities and places, and US ZIP3 centroids.'],
  filledMap: ['approximate', 'Fills countries, US states and continents only; no tiles.'],
  shapeMap: ['approximate', 'Built-in geometry only (US states or world countries); custom TopoJSON maps are not read.'],
  azureMap: ['approximate', 'Bubble layer only, drawn on the same vector basemap as the Map visual; no tiles.'],
  decompositionTreeVisual: ['approximate', 'AI splits (High value / Low value) are offered for every measure; Power BI hides them for complex measures.'],
  keyDriversVisual: ['approximate', 'Per-field significance tests, not Power BI\'s regression model; the visual says so.'],
  aiNarratives: ['approximate', 'Template sentences over the page\'s data; no Copilot or language model.'],
  qnaVisual: ['approximate', 'Small rule-based grammar instead of the Power BI Q&A service; fails on some models.'],
  tableEx: ['native', 'Data windowing of 500 rows; sparklines render but cannot be added in Lumen.'],
  pivotTable: ['native', 'Data windowing of 500 rows; expand / collapse and drill on rows and columns.'],
  cardVisual: ['native', 'Some default sizes and spacings are measured from screenshots (approximation).'],
  card: ['native', ''],
  multiRowCard: ['native', ''],
  slicer: ['native', 'All styles of the classic slicer, including date picker and relative date / time.'],
  listSlicer: ['native', 'Supports hierarchies (several Field levels) with expand / collapse.'],
  textSlicer: ['native', ''],
  advancedSlicerVisual: ['native', 'Some orientation / overflow encodings are undocumented (approximation).'],
  textbox: ['native', 'Text boxes are inserted from the ribbon, not from the gallery.'],
  shape: ['native', 'Inserted from Insert > Shapes.'],
  image: ['native', 'Inserted from Insert > Image or Insert > Icon.'],
  actionButton: ['native', 'Inserted from Insert > Buttons.'],
  pageNavigator: ['native', 'Inserted from Insert > Buttons > Page navigator.'],
  bookmarkNavigator: ['native', 'Rendered when a report contains one; Lumen has no command to insert it.'],
  htmlContent443BE3AD55E043BF878BED274D3A6865: ['native', 'Re-implementation of the AppSource HTML Content visual; HTML is sanitized.'],
  deneb7E15AEF80B9E4D4F8E12924291ECE89A: ['native', 'Renders Vega and Vega-Lite specifications with the Vega library; no Deneb editor (edit the JSON in the Format pane).'],
  FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A: ['approximate', 'The button renders as formatted; flows cannot run outside the Power BI service.'],
  // Visualizations-pane catalog entries without a registered renderer: the canvas shows a placeholder
  stackedBarChart: ['placeholder', 'Defect: a first "Stacked bar chart" gallery tile inserts this unregistered type. Use the second tile (barChart).'],
  scriptVisual: ['placeholder', 'R script visuals do not run.'],
  pythonVisual: ['placeholder', 'Python visuals do not run.'],
  scorecard: ['placeholder', 'Metrics (scorecard) needs the Power BI service.'],
  paginatedReport: ['placeholder', 'Paginated report visuals need the Power BI service.']
}

const STATUS_LABEL = { native: 'Native', approximate: 'Approximate', placeholder: 'Placeholder', unsupported: 'Unsupported' }
const CATEGORY_LABEL = { chart: 'Chart', table: 'Table', card: 'Card', slicer: 'Slicer', element: 'Element', map: 'Map', custom: 'Custom' }

const esc = (s) => String(s).replace(/\|/g, '\\|')
const yes = (b) => (b ? 'Yes' : '–')

export function render(data) {
  const missing = []
  const statusOf = (type) => {
    const s = STATUS[type]
    if (!s) missing.push(type)
    return s ?? ['unsupported', '']
  }
  const visuals = data.visuals
  const registeredTypes = new Set(visuals.flatMap((v) => [v.type, ...v.aliases].map((t) => t.toLowerCase())))
  const unregistered = data.catalog.filter((c) => !registeredTypes.has(c.type.toLowerCase()))
  const catalogTypes = new Set(data.catalog.map((c) => c.type.toLowerCase()))
  // what the Visualizations pane gallery shows: catalog order, then registered in-gallery visuals not in the catalog
  const inGallery = (v) => catalogTypes.has(v.type.toLowerCase()) || v.aliases.some((a) => catalogTypes.has(a.toLowerCase())) || v.inGallery !== false

  const L = []
  L.push('# Visual support reference')
  L.push('')
  L.push('> **Applies to:** Creators · Analysts · Developers')
  L.push('')
  L.push('This reference lists every visual type Lumen knows: the types it renders, the ones it shows as a placeholder, and what each supports. Use it to check whether a report built in Power BI Desktop will render in Lumen, or which visual to pick.')
  L.push('')
  L.push('> [!NOTE]')
  L.push('> This page is generated by `scripts/docs/gen-visual-support.mjs` from the visual registry (`src/renderer/src/visuals/registry.ts`) and the Visualizations pane catalog (`src/renderer/src/panes/visualizations/catalog.ts`). Run `node scripts/docs/gen-visual-support.mjs` to refresh it. The **Status** column and its notes are **assessed by hand** from the renderers\' code and comments; everything else is read from code.')
  L.push('')
  L.push('## Status values')
  L.push('')
  L.push('| Status | Meaning |')
  L.push('|---|---|')
  L.push('| Native | Lumen has its own renderer that aims to match Power BI Desktop\'s look and behaviour. Small differences are listed in the visual\'s article. |')
  L.push('| Approximate | The visual renders and is interactive, but part of it works differently by design (no map tiles, statistics instead of Microsoft\'s AI models, no cloud service). The visual says so where it matters. |')
  L.push('| Placeholder | The type is offered in the Visualizations pane so field wells can be edited and the file round-trips, but the canvas shows a hatched box that reads "This visual type isn\'t supported yet". |')
  L.push('| Unsupported | Any other type, including AppSource and organizational custom visuals not listed here: the canvas shows a hatched box that reads "This custom visual isn\'t supported in Lumen" (custom visuals) or "This visual type isn\'t supported yet". The visual\'s JSON is kept as it is when you save. |')
  L.push('')
  L.push('## Visual types')
  L.push('')
  L.push(`Lumen registers ${visuals.length} visual types. The type ID is the \`visualType\` value stored in the report (PBIR \`visual.json\`).`)
  L.push('')
  L.push('| Visual | Type ID | Category | Status |')
  L.push('|---|---|---|---|')
  for (const v of visuals) {
    const [st] = statusOf(v.type)
    const ids = [v.type, ...v.aliases].map((t) => `\`${t}\``).join('<br>')
    L.push(`| ${esc(v.displayName)} | ${ids} | ${CATEGORY_LABEL[v.category] ?? v.category} | ${STATUS_LABEL[st]} |`)
  }
  for (const c of unregistered) {
    const [st] = statusOf(c.type)
    L.push(`| ${esc(c.displayName)} | \`${c.type}\` | – | ${STATUS_LABEL[st]} |`)
  }
  L.push('')
  L.push('Custom visuals carry a GUID suffix in their type ID; Lumen also matches a registered custom visual by its name prefix followed by a 32-character GUID (for example any `htmlContent…` type).')
  L.push('')
  L.push('## Notes by visual')
  L.push('')
  L.push('| Visual | Status | Notes |')
  L.push('|---|---|---|')
  for (const v of visuals) {
    const [st, note] = statusOf(v.type)
    if (note) L.push(`| ${esc(v.displayName)} | ${STATUS_LABEL[st]} | ${esc(note)} |`)
  }
  for (const c of unregistered) {
    const [st, note] = statusOf(c.type)
    L.push(`| ${esc(c.displayName)} (\`${c.type}\`) | ${STATUS_LABEL[st]} | ${esc(note)} |`)
  }
  L.push('')
  L.push('## Field wells')
  L.push('')
  L.push('The wells each visual shows in **Visualizations > Build visual**, in order. "(max n)" is the number of fields the well accepts.')
  L.push('')
  L.push('| Visual | Field wells |')
  L.push('|---|---|')
  for (const v of visuals) {
    const wells = v.roles.map((r) => `${r.displayName}${r.max ? ` (max ${r.max})` : ''}`).join(', ')
    L.push(`| ${esc(v.displayName)} | ${esc(wells) || '(no fields)'} |`)
  }
  for (const c of unregistered) {
    const wells = c.roles.map((r) => `${r.displayName}${r.max ? ` (max ${r.max})` : ''}`).join(', ')
    L.push(`| ${esc(c.displayName)} | ${esc(wells) || '(no fields)'} |`)
  }
  L.push('')
  L.push('## Capabilities')
  L.push('')
  L.push('- **In gallery**: the visual has a tile in the Visualizations pane gallery.')
  L.push('- **Highlight**: the visual can be cross-highlighted by a selection in another visual (otherwise it is cross-filtered).')
  L.push('- **Drill**: the visual supports drill down / up on hierarchical wells.')
  L.push('- **Data**: the visual provides its data to **Show as table** and **Export data**.')
  L.push('- **Analytics**: the Visualizations pane shows the **Analytics** tab (reference lines and more) for the visual.')
  L.push('')
  L.push('| Visual | In gallery | Highlight | Drill | Data | Analytics |')
  L.push('|---|---|---|---|---|---|')
  for (const v of visuals) {
    L.push(`| ${esc(v.displayName)} | ${yes(inGallery(v))} | ${yes(v.supportsHighlight)} | ${yes(v.supportsDrill)} | ${yes(v.exportData)} | ${yes(v.analytics)} |`)
  }
  L.push('')
  L.push('## Related content')
  L.push('')
  L.push('- [Visuals in Lumen](../visuals/README.md)')
  L.push('- [Format properties reference](format-properties.md)')
  L.push('- [Add and arrange visuals](../create-reports/add-and-arrange-visuals.md)')
  L.push('- [File format support](file-format-support.md)')
  L.push('')
  if (missing.length) throw new Error(`gen-visual-support: no hand-assessed STATUS for: ${missing.join(', ')}`)
  return L.join('\n')
}

const data = await loadVisualRegistry()
const md = render(data)
if (process.argv.includes('--check')) {
  let cur = ''
  try {
    cur = readFileSync(OUT, 'utf8')
  } catch {}
  if (cur !== md) {
    console.error('docs/reference/visual-support.md is out of date: run node scripts/docs/gen-visual-support.mjs')
    process.exit(1)
  }
} else {
  writeFileSync(OUT, md)
  console.log(`wrote ${OUT}`)
}
