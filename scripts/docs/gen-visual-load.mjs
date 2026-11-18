/**
 * Loads the renderer's visual registry in Node (through Vite's SSR module loader, so path aliases, `.tsx` and
 * `import.meta.glob` work as in the app) and returns plain data about every registered visual.
 * Shared by gen-visual-support.mjs and gen-visual-format-properties.mjs.
 */
import { resolve } from 'node:path'
import { createServer } from 'vite'

export const ROOT = resolve(import.meta.dirname, '../..')

export async function loadVisualRegistry() {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      alias: {
        '@core': resolve(ROOT, 'src/core'),
        '@renderer': resolve(ROOT, 'src/renderer/src'),
        '@shared': resolve(ROOT, 'src/shared')
      }
    }
  })
  try {
    await server.ssrLoadModule('/src/renderer/src/visuals/index.ts')
    const registry = await server.ssrLoadModule('/src/renderer/src/visuals/registry.ts')
    const container = await server.ssrLoadModule('/src/renderer/src/panes/visualizations/containerCards.ts')
    const catalog = await server.ssrLoadModule('/src/renderer/src/panes/visualizations/catalog.ts')
    const visuals = registry.allVisuals().map((d) => ({
      type: d.type,
      aliases: d.aliases ?? [],
      displayName: d.displayName,
      category: d.category,
      inGallery: d.inGallery,
      isSlicer: !!d.isSlicer,
      supportsHighlight: !!d.supportsHighlight,
      supportsDrill: !!d.supportsDrill,
      exportData: typeof d.getData === 'function',
      roles: d.roles.map((r) => ({ ...r })),
      formatCards: d.formatCards.map((c) => ({ ...c, properties: c.properties.map((p) => ({ ...p })) })),
      analytics: catalog.supportsAnalytics(d.type)
    }))
    const containerCards = container.CONTAINER_CARDS.map((c) => ({ ...c, properties: c.properties.map((p) => ({ ...p })) }))
    const analyticsObjects = [...container.ANALYTICS_OBJECTS]
    const catalogEntries = catalog.CATALOG.map((c) => ({ type: c.type, displayName: c.displayName, roles: c.roles, analytics: !!c.analytics }))
    return { visuals, containerCards, analyticsObjects, catalog: catalogEntries }
  } finally {
    await server.close()
  }
}

// `node scripts/docs/gen-visual-load.mjs` dumps the data as JSON (debugging aid)
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await loadVisualRegistry()
  process.stdout.write(JSON.stringify(data, null, 1))
}
