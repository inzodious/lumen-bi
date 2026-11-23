#!/usr/bin/env node
/**
 * Generate the gallery report templates: node scripts/templates/build.mjs [id…]
 *
 * Each design in scripts/templates/designs/<id>.mjs becomes a PBIP project under src/core/templates/<id>/
 * (`<Name>.Report` + `<Name>.SemanticModel`), and src/core/templates/catalog.ts lists them for the gallery.
 * The output is checked in; rerun this after changing a design. Previews (the gallery thumbnails) are
 * made from Lumen's own render: scripts/templates/previews.sh.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hex, measureTable, objects, sampleDataset, c, literal } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outRoot = join(root, 'src', 'core', 'templates')
// the base theme every template references (the same file Power BI Desktop ships; taken from the 1st Edition template)
const baseTheme = readFileSync(join(outRoot, 'first-edition', '1st Edition.Report', 'StaticResources', 'SharedResources', 'BaseThemes', 'CY24SU10.json'), 'utf8')

const json = (o) => JSON.stringify(o, null, 2) + '\n'

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function pageJson(id, page, name) {
  const bg = {}
  if (page.background?.color) bg.color = c(page.background.color)
  bg.transparency = 0
  const o = objects({ background: bg, outspace: { color: c(page.wallpaper ?? page.background?.color ?? '#FFFFFF'), transparency: 0 } })
  if (page.background?.image) {
    o.background[0].properties.image = {
      image: {
        name: literal(page.background.image),
        url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: page.background.image } } },
        scaling: literal('Fit')
      }
    }
  }
  const out = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
    name,
    displayName: page.name,
    displayOption: 'FitToPage',
    height: page.height ?? 720,
    width: page.width ?? 1280,
    objects: o
  }
  return out
}

function build(design) {
  const seed = design.id
  const dir = join(outRoot, design.id)
  rmSync(dir, { recursive: true, force: true })
  const sm = join(dir, `${design.name}.SemanticModel`)
  const rp = join(dir, `${design.name}.Report`)

  // --- semantic model
  write(join(sm, 'definition.pbism'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.2', settings: {} }))
  write(join(sm, 'definition', 'database.tmdl'), 'database\n\tcompatibilityLevel: 1606\n\n')
  // no data tables: the model holds the two default measure tables, and the design's tables become the sample
  // dataset the empty visuals draw (sampleData.lumen.json, Lumen-only, never loaded into the model)
  const tables = ['_measures_kpi', '_measures_format']
  write(join(sm, 'definition', 'tables', '_measures_kpi.tmdl'), measureTable(seed, '_measures_kpi', 'kpi_blank'))
  write(join(sm, 'definition', 'tables', '_measures_format.tmdl'), measureTable(seed, '_measures_format', 'fmt_blank'))
  write(join(sm, 'sampleData.lumen.json'), JSON.stringify(sampleDataset(design)) + '\n')
  const model = [
    'model Model',
    '\tculture: en-US',
    '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
    '\tsourceQueryCulture: en-US',
    '\tdataAccessOptions',
    '\t\tlegacyRedirects',
    '\t\treturnErrorValuesAsNull',
    '',
    'queryGroup Measures',
    '',
    '\tannotation PBI_QueryGroupOrder = 0',
    '',
    `annotation PBI_QueryOrder = ${JSON.stringify(tables)}`,
    '',
    'annotation __PBI_TimeIntelligenceEnabled = 0',
    '',
    `annotation Lumen_Template = ${design.id}`,
    '',
    ...tables.map((t) => `ref table ${t}`),
    ''
  ]
  write(join(sm, 'definition', 'model.tmdl'), model.join('\n'))

  // --- report
  write(join(rp, 'definition.pbir'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json', version: '4.0', datasetReference: { byPath: { path: `../${design.name}.SemanticModel` } } }))
  write(join(rp, 'definition', 'version.json'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json', version: '2.0.0' }))
  const themeFile = `${design.id}.json`
  const images = Object.keys(design.resources ?? {})
  const report = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json',
    themeCollection: {
      baseTheme: { name: 'CY24SU10', reportVersionAtImport: { visual: '1.8.97', report: '2.0.97', page: '1.3.97' }, type: 'SharedResources' },
      customTheme: { name: themeFile, reportVersionAtImport: { visual: '1.8.101', report: '2.0.101', page: '1.3.101' }, type: 'RegisteredResources' }
    },
    objects: {
      section: [{ properties: { verticalAlignment: literal('Middle') } }],
      outspacePane: [{ properties: { expanded: literal(false) } }]
    },
    resourcePackages: [
      {
        name: 'RegisteredResources',
        type: 'RegisteredResources',
        items: [{ name: themeFile, path: themeFile, type: 'CustomTheme' }, ...images.map((n) => ({ name: n, path: n, type: 'Image' }))]
      },
      { name: 'SharedResources', type: 'SharedResources', items: [{ name: 'CY24SU10', path: 'BaseThemes/CY24SU10.json', type: 'BaseTheme' }] }
    ],
    annotations: [{ name: 'Lumen_SampleData', value: 'on' }],
    settings: {
      useStylableVisualContainerHeader: true,
      exportDataMode: 'AllowSummarized',
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      useEnhancedTooltips: true,
      useDefaultAggregateDisplayName: true
    }
  }
  write(join(rp, 'definition', 'report.json'), json(report))
  write(join(rp, 'StaticResources', 'SharedResources', 'BaseThemes', 'CY24SU10.json'), baseTheme)
  write(join(rp, 'StaticResources', 'RegisteredResources', themeFile), json({ name: design.name, ...design.theme }))
  for (const [n, svg] of Object.entries(design.resources ?? {})) write(join(rp, 'StaticResources', 'RegisteredResources', n), svg.trim() + '\n')

  const order = []
  design.pages.forEach((page, i) => {
    const pid = hex(`${seed}/page/${page.name}`)
    order.push(pid)
    write(join(rp, 'definition', 'pages', pid, 'page.json'), json(pageJson(design.id, page, pid)))
    const vs = page.visuals(`${seed}/${page.name}`)
    let z = 1000
    for (const v of vs) {
      if (!v) continue
      // z order: the order of the list (later = in front), unless the design set one
      if (v.position.z === 1000) {
        v.position.z = z
        v.position.tabOrder = z
      }
      z += 1000
      write(join(rp, 'definition', 'pages', pid, 'visuals', v.name, 'visual.json'), json(v))
    }
  })
  write(join(rp, 'definition', 'pages', 'pages.json'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json', pageOrder: order, activePageName: order[0] }))
}

const designDir = join(here, 'designs')
const only = process.argv.slice(2)
const designs = []
for (const f of readdirSync(designDir).filter((f) => f.endsWith('.mjs')).sort()) {
  const d = (await import(pathToFileURL(join(designDir, f)).href)).default
  designs.push(d)
}
designs.sort((a, b) => a.order - b.order)
for (const d of designs) {
  if (only.length && !only.includes(d.id)) continue
  build(d)
  console.log(`built ${d.id}`)
}

// catalog for the gallery (all designs, whatever was rebuilt)
const catalog = designs.map((d) => ({
  id: d.id,
  name: d.name,
  summary: d.summary,
  description: d.description,
  style: d.style,
  compatibility: d.compatibility,
  ...(d.lumenFeatures?.length ? { lumenFeatures: d.lumenFeatures } : {}),
  swatch: d.swatch
}))
write(
  join(outRoot, 'catalog.ts'),
  `/** Generated by scripts/templates/build.mjs from scripts/templates/designs/*.mjs: do not edit by hand. */\nimport type { ReportTemplate } from './index'\n\nexport const GALLERY_TEMPLATES: ReportTemplate[] = ${JSON.stringify(catalog, null, 2)}\n`
)
