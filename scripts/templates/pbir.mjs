/** PBIR report files shared by the template build (scripts/templates/build.mjs) and the live dashboards (scripts/dashboards). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hex, objects, c, literal } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outRoot = join(here, '..', '..', 'src', 'core', 'templates')
// the base theme every template references (the same file Power BI Desktop ships; taken from the 1st Edition template)
const baseTheme = readFileSync(join(outRoot, 'first-edition', '1st Edition.Report', 'StaticResources', 'SharedResources', 'BaseThemes', 'CY24SU10.json'), 'utf8')

export const json = (o) => JSON.stringify(o, null, 2) + '\n'

export function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** The PBIR name of a design's page (page navigation buttons and bookmarks refer to it). */
export const pageId = (seed, pageName) => hex(`${seed}/page/${pageName}`)

/** The PBIR name of a design's bookmark. */
export const bookmarkId = (seed, bookmarkName) => hex(`${seed}/bookmark/${bookmarkName}`)

export function pageJson(id, page, name) {
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
  if (page.filters) out.filterConfig = { filters: page.filters }
  // a drill-through page: { entity, prop } of the column the page is filtered on (PBIR pageBinding + filter card)
  if (page.drillthrough) {
    const field = { Column: { Expression: { SourceRef: { Entity: page.drillthrough.entity } }, Property: page.drillthrough.prop } }
    const card = hex(`${id}/page/${page.name}/drillthrough`)
    out.filterConfig = { filters: [...(out.filterConfig?.filters ?? []), { name: card, field, type: 'Categorical', howCreated: 'Drillthrough' }] }
    out.pageBinding = { name: hex(`${id}/page/${page.name}/binding`), type: 'Drillthrough', referenceScope: 'Default', parameters: [{ name: hex(`${id}/page/${page.name}/parameter`), boundFilter: card, fieldExpr: field }] }
  }
  if (page.hidden) out.visibility = 'HiddenInViewMode'
  // Lumen-only page transition (src/core/report/motion.ts), e.g. { transition: 'circle' }
  if (page.motion) out.annotations = [{ name: 'Lumen_Motion', value: JSON.stringify(page.motion) }]
  return out
}

/**
 * The report half of a PBIP project: definition.pbir, report.json, theme and images, pages and visuals.
 * sampleData: the report draws samples on empty visuals (templates); off for the live dashboards.
 * motion: the report's Lumen_Motion settings (src/core/report/motion.ts), e.g. { transition: 'slide', stagger: 40 }.
 */
export function writeReport(design, rp, { sampleData = false, motion } = {}) {
  const seed = design.id
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
    ...(sampleData || motion
      ? { annotations: [...(sampleData ? [{ name: 'Lumen_SampleData', value: 'on' }] : []), ...(motion ? [{ name: 'Lumen_Motion', value: JSON.stringify(motion) }] : [])] }
      : {}),
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
    const pid = pageId(seed, page.name)
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
  // display-only bookmarks: { name, page, show: [visual names], hide: [visual names] } (visual names as built)
  if (design.bookmarks?.length) {
    const items = []
    for (const b of design.bookmarks) {
      const bid = bookmarkId(seed, b.name)
      items.push({ name: bid })
      const containers = {}
      for (const v of b.show) containers[v] = { singleVisual: { visualType: b.types?.[v] ?? 'unknown' } }
      for (const v of b.hide) containers[v] = { singleVisual: { visualType: b.types?.[v] ?? 'unknown', display: { mode: 'hidden' } } }
      write(
        join(rp, 'definition', 'bookmarks', `${bid}.bookmark.json`),
        json({
          $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmark/1.4.0/schema.json',
          displayName: b.name,
          name: bid,
          options: { targetVisualNames: [...b.show, ...b.hide], applyOnlyToTargetVisuals: true, suppressData: true, suppressActiveSection: true },
          explorationState: { version: '1.3', activeSection: pageId(seed, b.page), sections: { [pageId(seed, b.page)]: { visualContainers: containers } } }
        })
      )
    }
    write(join(rp, 'definition', 'bookmarks', 'bookmarks.json'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmarksMetadata/1.0.0/schema.json', items }))
  }
  write(join(rp, 'definition', 'pages', 'pages.json'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json', pageOrder: order, activePageName: order[0] }))
}
