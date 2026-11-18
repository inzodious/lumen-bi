/**
 * Generates docs/reference/format-properties.md (index) and docs/reference/format-properties/<family>.md (one page per
 * visual family) from the visual registry's format card definitions (VisualDefinition.formatCards) and the built-in
 * General-tab container cards (src/renderer/src/panes/visualizations/containerCards.ts).
 *
 *   node scripts/docs/gen-visual-format-properties.mjs            # writes the files
 *   node scripts/docs/gen-visual-format-properties.mjs --check    # exits 1 when a file is out of date
 *
 * Placement follows FormatTab.tsx: a visual's cards go to the Visual tab unless they are marked `tab: 'general'` or
 * `container`; analytics objects (ANALYTICS_OBJECTS) are never shown in the Format tab; container cards that repeat a
 * built-in General card are dropped. The "Default" column is the definition's `default` only: when it is empty, the
 * Format pane shows the value the visual really draws with (theme `visualStyles` or the renderer's fallback,
 * panes/visualizations/effective.ts), which can depend on the theme and the data.
 *
 * FAMILIES maps every registered visual type to a page; the script fails when a type is not mapped.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadVisualRegistry, ROOT } from './gen-visual-load.mjs'

const OUT_INDEX = resolve(ROOT, 'docs/reference/format-properties.md')
const OUT_DIR = resolve(ROOT, 'docs/reference/format-properties')

const FAMILIES = [
  ['bar-and-column-charts', 'Bar and column charts', ['clusteredColumnChart', 'columnChart', 'hundredPercentStackedColumnChart', 'clusteredBarChart', 'barChart', 'hundredPercentStackedBarChart']],
  ['line-and-area-charts', 'Line and area charts', ['lineChart', 'areaChart', 'stackedAreaChart', 'hundredPercentStackedAreaChart']],
  ['combo-charts', 'Combo charts', ['lineClusteredColumnComboChart', 'lineStackedColumnComboChart']],
  ['ribbon-waterfall-funnel', 'Ribbon, waterfall and funnel charts', ['ribbonChart', 'waterfallChart', 'funnel']],
  ['scatter-charts', 'Scatter charts', ['scatterChart']],
  ['pie-donut-treemap', 'Pie, donut and treemap', ['pieChart', 'donutChart', 'treemap']],
  ['gauge-and-kpi', 'Gauge and KPI', ['gauge', 'kpi']],
  ['cards', 'Cards', ['cardVisual', 'card', 'multiRowCard']],
  ['tables-and-matrices', 'Tables and matrices', ['tableEx', 'pivotTable']],
  ['slicers', 'Slicers', ['slicer', 'listSlicer', 'textSlicer', 'advancedSlicerVisual']],
  ['maps', 'Maps', ['map', 'filledMap', 'shapeMap', 'azureMap']],
  ['ai-visuals', 'AI visuals', ['decompositionTreeVisual', 'keyDriversVisual', 'aiNarratives', 'qnaVisual']],
  ['elements', 'Report elements', ['textbox', 'shape', 'image', 'actionButton', 'pageNavigator', 'bookmarkNavigator']],
  ['custom-visuals', 'Custom visuals', ['htmlContent443BE3AD55E043BF878BED274D3A6865', 'deneb7E15AEF80B9E4D4F8E12924291ECE89A', 'FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A']]
]

const TYPE_LABEL = {
  bool: 'Toggle',
  number: 'Number',
  integer: 'Whole number',
  percent: 'Percent',
  color: 'Color',
  text: 'Text',
  textarea: 'Text (multi-line)',
  enum: 'List',
  fontFamily: 'Font',
  fontSize: 'Font size',
  alignment: 'Alignment',
  displayUnits: 'Display units',
  image: 'Image',
  iconSource: 'Icon'
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, ' ')

/** Type cell: the control, the allowed range and the list options. */
function typeCell(p) {
  let t = TYPE_LABEL[p.type] ?? p.type
  if ((p.type === 'integer' || p.type === 'number' || p.type === 'percent' || p.type === 'fontSize') && (p.min !== undefined || p.max !== undefined)) {
    t += ` (${p.min ?? '…'} to ${p.max ?? '…'})`
  }
  if (p.options?.length && p.type !== 'displayUnits') t += ': ' + p.options.map((o) => esc(o.label)).join(', ')
  return t
}

function defaultCell(p) {
  const d = p.default
  if (d === undefined || d === null) return ''
  if (typeof d === 'boolean') return d ? 'On' : 'Off'
  const opt = p.options?.find((o) => o.value === d)
  if (opt) return esc(opt.label)
  if (p.type === 'displayUnits' && d === 0) return 'Auto'
  return esc(typeof d === 'string' ? d : String(d))
}

/** Marks shown after the display name: per series, conditional formatting (fx). Mirrors cf/target.ts cfKindFor. */
function marks(p, object) {
  const out = []
  if (p.perSeries) out.push('per series')
  const textFx = new Set(['title.text', 'subTitle.text', 'general.altText'])
  if (p.conditional !== false && (p.type === 'color' || ((p.type === 'text' || p.type === 'textarea') && (p.conditional || textFx.has(`${object}.${p.name}`))))) out.push('fx')
  return out.length ? ` <br>_${out.join(' · ')}_` : ''
}

function propTable(card) {
  const rows = ['| Property | PBIR name | Type | Default |', '|---|---|---|---|']
  for (const p of card.properties) rows.push(`| ${esc(p.displayName)}${marks(p, card.object)} | \`${p.name}\` | ${typeCell(p)} | ${defaultCell(p)} |`)
  return rows.join('\n')
}

function cardHeading(card, level) {
  const toggle = card.toggle ? ` The card has an on/off switch (\`${card.toggle}\`).` : ''
  return `${'#'.repeat(level)} ${esc(card.displayName)}\n\nPBIR object \`${card.object}\`${card.container ? ' (visual container)' : ''}.${toggle}`
}

/** Where FormatTab.tsx shows each of a visual's own cards. */
function placeCards(def, builtinObjects, analytics) {
  const own = def.formatCards.filter((c) => !analytics.has(c.object))
  const visual = own.filter((c) => c.tab !== 'general' && !c.container)
  const extra = own.filter((c) => (c.tab === 'general' || c.container) && !(c.container && builtinObjects.has(c.object)))
  const advanced = extra.filter((c) => c.object === 'general' && !c.container).flatMap((c) => c.properties.filter((p) => p.name !== 'responsive').map((p) => ({ ...p, _object: c.object })))
  const general = extra.filter((c) => !(c.object === 'general' && !c.container))
  const analyticsCards = def.formatCards.filter((c) => analytics.has(c.object))
  return { visual, general, advanced, analyticsCards }
}

const sig = (c) => JSON.stringify([c.object, c.displayName, c.toggle, c.properties])

const HEADER = '<!-- Generated by scripts/docs/gen-visual-format-properties.mjs from the visual registry. Do not edit by hand. -->'

function familyPage(slug, title, defs, ctx) {
  const lines = [HEADER, '', `# Format properties: ${title}`, '', '> **Applies to:** Creators · Developers', '']
  lines.push(
    `Every card and property the Format pane offers for the visuals on this page (${defs.map((d) => d.displayName).join(', ')}), generated from the visual definitions in the code. ` +
      `For how to use the Format pane, see [Format a visual](../../create-reports/format-a-visual.md); for what these visuals do, see [the visual article](../../visuals/${slug}.md).`,
    ''
  )
  lines.push(
    'The cards on the **General** tab that every visual shares (title, effects, header icons, tooltips, alt text) are listed once in [General tab](general-tab.md).',
    ''
  )
  const placed = defs.map((d) => ({ def: d, ...placeCards(d, ctx.builtinObjects, ctx.analytics) }))
  // summary table
  lines.push('| Visual | PBIR type | Visual-tab cards | Properties |', '|---|---|---|---|')
  for (const p of placed) {
    const n = p.visual.reduce((a, c) => a + c.properties.length, 0) + p.general.reduce((a, c) => a + c.properties.length, 0) + p.advanced.length
    lines.push(`| ${esc(p.def.displayName)} | \`${p.def.type}\` | ${p.visual.length} | ${n} |`)
  }
  lines.push('')
  // render each visual; when a visual has exactly the same Visual-tab cards as an earlier one, say so instead of repeating
  const seenSets = new Map()
  for (const p of placed) {
    lines.push(`## ${esc(p.def.displayName)}`, '')
    lines.push(`PBIR visual type \`${p.def.type}\`${p.def.aliases.length ? ` (also read as ${p.def.aliases.map((a) => `\`${a}\``).join(', ')})` : ''}.`, '')
    const setKey = JSON.stringify([p.visual.map(sig), p.general.map(sig), p.advanced])
    if (seenSets.has(setKey)) {
      lines.push(`The Format pane offers exactly the same cards and properties as the [${esc(seenSets.get(setKey).displayName)}](#${anchor(seenSets.get(setKey).displayName)}).`, '')
      continue
    }
    seenSets.set(setKey, p.def)
    if (p.visual.length) {
      lines.push('### Visual tab', '')
      if (p.def.type === 'tableEx' || p.def.type === 'pivotTable')
        lines.push('The Visual tab also starts with a **Layout** card (column width: fit to content, grow to fit, fixed width) and ends with **Cell elements** (conditional formatting per series)' + (p.def.type === 'pivotTable' ? ', and the matrix adds a per-level **Subtotals** card' : '') + '. These cards are built by the table code, not from the definitions below.', '')
      for (const c of p.visual) lines.push(cardHeading(c, 4), '', propTable(c), '')
    } else {
      lines.push(p.def.type === 'textbox' ? 'A text box has no Visual-tab cards: its text is edited on the canvas.' : 'This visual has no Visual-tab cards ("This visual has no visual-specific formatting options").', '')
    }
    if (p.general.length || p.advanced.length) {
      lines.push('### General tab (visual-specific)', '')
      if (p.advanced.length) {
        lines.push('Added to **Properties > Advanced options**:', '', '| Property | PBIR name | Type | Default |', '|---|---|---|---|')
        for (const a of p.advanced) lines.push(`| ${esc(a.displayName)} | \`${a.name}\` | ${typeCell(a)} | ${defaultCell(a)} |`)
        lines.push('')
      }
      for (const c of p.general) lines.push(cardHeading(c, 4), '', propTable(c), '')
    }
    if (p.analyticsCards.length) {
      lines.push(`The definition also carries ${p.analyticsCards.length === 1 ? 'an analytics object' : 'analytics objects'} (${p.analyticsCards.map((c) => `\`${c.object}\``).join(', ')}) that the Format tab does not show; analytics lines are edited on the **Analytics** tab where the visual has one.`, '')
    }
  }
  lines.push('## Related content', '')
  lines.push('- [Format properties index](../format-properties.md)')
  lines.push(`- [${title}](../../visuals/${slug}.md)`)
  lines.push('- [Format a visual](../../create-reports/format-a-visual.md)')
  lines.push('- [Conditional formatting](../../create-reports/conditional-formatting.md)')
  lines.push('- [Themes](../../create-reports/themes.md)', '')
  return lines.join('\n')
}

function anchor(text) {
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')
}

function generalPage(containerCards) {
  const lines = [HEADER, '', '# Format properties: General tab', '', '> **Applies to:** Creators · Developers', '']
  lines.push(
    'The cards every visual shows on the **General** tab of the Format pane, generated from `src/renderer/src/panes/visualizations/containerCards.ts`. ' +
      'They format the visual container (PBIR `visualContainerObjects`), not the visual itself. See [Visual titles, borders and backgrounds](../../create-reports/visual-titles-borders-and-backgrounds.md) for how to use them.',
    ''
  )
  lines.push(
    'The General tab starts with a **Properties** card that is built by the Format pane itself, not from these definitions: **Size** (Height, Width, Lock aspect ratio), **Position** (Horizontal, Vertical), **Padding** (Top, Bottom, Left, Right; container object `padding`, 5 px on each side by default) and **Advanced options** (Responsive, Maintain layer order, plus any visual-specific options listed on the family pages).',
    ''
  )
  let group
  for (const c of containerCards) {
    if (c.group !== group) {
      group = c.group
      if (group) lines.push(`## ${group}`, '')
    }
    lines.push(cardHeading(c, group ? 3 : 2), '', propTable(c), '')
  }
  lines.push('## Related content', '', '- [Format properties index](../format-properties.md)', '- [Visual titles, borders and backgrounds](../../create-reports/visual-titles-borders-and-backgrounds.md)', '- [Format a visual](../../create-reports/format-a-visual.md)', '- [Tooltips](../../create-reports/tooltips.md)', '')
  return lines.join('\n')
}

function indexPage(families, containerCards, total) {
  const lines = [HEADER, '', '# Format properties reference', '', '> **Applies to:** Creators · Developers', '']
  lines.push(
    'Every format card and property the Format pane offers, per visual type, with its PBIR name, its control type and the default the definition gives. ' +
      'The pages are generated from the visual registry by `scripts/docs/gen-visual-format-properties.mjs`; run it again after changing a visual definition.',
    ''
  )
  lines.push('## How to read these pages', '')
  lines.push(
    '- **Property** is the label in the Format pane. _fx_ means the property accepts conditional formatting (a color by gradient, rules or field value; a text by field value). _per series_ means the property can be set for each measure or series separately (the pane shows a series picker above the card).',
    '- **PBIR name** is the property name in the visual JSON (`visual.objects.<object>[].properties.<name>`, or `visualContainerObjects` for container cards). Theme files use the same names under `visualStyles`.',
    '- **Type** is the control: Toggle, Number, Whole number, Percent (0 to 100), Color, Text, List (the options in order), Font, Font size, Alignment, Display units (Auto, None, Thousands, Millions, Billions, Trillions), Image, Icon. Ranges are the limits the control accepts.',
    '- **Default** is the default written in the definition. An empty cell does not mean "no value": when nothing is set, the Format pane shows the value the visual really draws with, taken from the theme (`visualStyles`) or from the renderer, and that value can depend on the theme, the data or other properties. See [Format a visual](../create-reports/format-a-visual.md#what-an-unset-property-shows).',
    ''
  )
  lines.push('## Pages', '')
  lines.push('| Page | Visual types | Properties |', '|---|---|---|')
  lines.push(`| [General tab](format-properties/general-tab.md) | every visual | ${containerCards.reduce((a, c) => a + c.properties.length, 0)} |`)
  for (const f of families) lines.push(`| [${f.title}](format-properties/${f.slug}.md) | ${f.defs.map((d) => esc(d.displayName)).join(', ')} | ${f.count} |`)
  lines.push('')
  lines.push(`In total the definitions describe ${total} visual-specific properties across ${families.reduce((a, f) => a + f.defs.length, 0)} visual types, plus the shared General-tab cards.`, '')
  lines.push('## What these pages do not cover', '')
  lines.push(
    '- **Analytics tab**: constant, min, max, average, median and percentile lines, trend line, forecast, error bars, Find anomalies, ratio line and symmetry shading are edited on the Analytics tab of cartesian charts and scatter charts. See the chart articles in [Visuals](../visuals/README.md).',
    '- **Page formatting** (no visual selected): Page information, Canvas settings, Canvas background, Wallpaper, Filter pane and Filter cards. See [Pages](../create-reports/pages.md).',
    '- **Cards built by the table code**: the Layout, Subtotals and Cell elements cards of tables and matrices (mentioned on their page).',
    '- **Properties a file can carry but the pane does not offer**: Lumen reads and keeps properties written by Power BI Desktop that have no card here; they still render where the renderer supports them.',
    ''
  )
  lines.push('## Related content', '', '- [Format a visual](../create-reports/format-a-visual.md)', '- [Visual titles, borders and backgrounds](../create-reports/visual-titles-borders-and-backgrounds.md)', '- [Themes](../create-reports/themes.md)', '- [Visual support](visual-support.md)', '- [Visuals](../visuals/README.md)', '')
  return lines.join('\n')
}

const data = await loadVisualRegistry()
const byType = new Map(data.visuals.map((v) => [v.type, v]))
const mapped = new Set(FAMILIES.flatMap((f) => f[2]))
const unmapped = data.visuals.filter((v) => !mapped.has(v.type)).map((v) => v.type)
const missing = [...mapped].filter((t) => !byType.has(t))
if (unmapped.length || missing.length) {
  console.error(`gen-visual-format-properties: unmapped types ${unmapped.join(', ') || '-'}; mapped but not registered ${missing.join(', ') || '-'}`)
  process.exit(2)
}
const ctx = { builtinObjects: new Set(data.containerCards.map((c) => c.object)), analytics: new Set(data.analyticsObjects) }
const outputs = new Map()
const families = []
let total = 0
for (const [slug, title, types] of FAMILIES) {
  const defs = types.map((t) => byType.get(t))
  const count = defs.reduce((a, d) => {
    const p = placeCards(d, ctx.builtinObjects, ctx.analytics)
    return a + p.visual.reduce((x, c) => x + c.properties.length, 0) + p.general.reduce((x, c) => x + c.properties.length, 0) + p.advanced.length
  }, 0)
  total += count
  families.push({ slug, title, defs, count })
  outputs.set(resolve(OUT_DIR, `${slug}.md`), familyPage(slug, title, defs, ctx))
}
outputs.set(resolve(OUT_DIR, 'general-tab.md'), generalPage(data.containerCards))
outputs.set(OUT_INDEX, indexPage(families, data.containerCards, total))

if (process.argv.includes('--check')) {
  const stale = [...outputs].filter(([f, text]) => !existsSync(f) || readFileSync(f, 'utf8') !== text).map(([f]) => f)
  if (stale.length) {
    console.error('Out of date:\n' + stale.join('\n'))
    process.exit(1)
  }
  console.log('format-properties: up to date')
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [f, text] of outputs) writeFileSync(f, text)
  console.log(`wrote ${outputs.size} files, ${total} visual-specific properties`)
}
