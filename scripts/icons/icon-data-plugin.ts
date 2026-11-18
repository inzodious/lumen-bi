/**
 * Vite plugin: `virtual:lumen-icons/<set>` → the set's icon data (core/icons/types.ts IconSetData),
 * normalised at build time from the Iconify JSON packages in node_modules (core/icons/normalize.ts).
 *
 * Each set becomes its own lazily imported chunk (core/icons/registry.ts imports them dynamically), so
 * none of the artwork is in the initial renderer bundle. Normalising here (instead of importing the raw
 * Iconify JSON) keeps one size per Fluent icon (the raw package has 7 sizes) and drops the metadata the
 * app does not use.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { ICONIFY_PACKAGES, normalizeIconSet, type IconifySource } from '../../src/core/icons/normalize.ts'
import { isIconSetId, type IconSetData, type IconSetId } from '../../src/core/icons/types.ts'

const PREFIX = 'virtual:lumen-icons/'
const require = createRequire(import.meta.url)

function readIconify(prefix: string): IconifySource {
  const file = (f: string) => require.resolve(`@iconify-json/${prefix}/${f}`)
  const json = (f: string) => JSON.parse(readFileSync(file(f), 'utf8'))
  return { icons: json('icons.json'), metadata: json('metadata.json'), info: json('info.json') }
}

const cache = new Map<IconSetId, string>()

/** Normalised data of a set (also used by tests and scripts outside Vite). */
export function iconSetData(set: IconSetId): IconSetData {
  return normalizeIconSet(set, readIconify)
}

export function lumenIconData(): Plugin {
  return {
    name: 'lumen-icon-data',
    resolveId(id) {
      return id.startsWith(PREFIX) ? '\0' + id : undefined
    },
    load(id) {
      if (!id.startsWith('\0' + PREFIX)) return undefined
      const set = id.slice(PREFIX.length + 1)
      if (!isIconSetId(set)) throw new Error(`Unknown icon set "${set}"`)
      let code = cache.get(set)
      if (!code) {
        // JSON.parse of a string literal parses faster than an object literal of the same size
        code = `export default JSON.parse(${JSON.stringify(JSON.stringify(iconSetData(set)))})`
        cache.set(set, code)
      }
      for (const pkg of ICONIFY_PACKAGES[set]) this.addWatchFile?.(require.resolve(`@iconify-json/${pkg}/icons.json`))
      return code
    }
  }
}
