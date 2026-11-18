/**
 * Icon registry: the icon sets as lazily imported modules of React components (plus core/icons/sets.ts metadata).
 *
 *   lucide        react-icons/lu (react-icons' Lucide build)        `LuChartBar`            → `chart-bar`
 *   fluent-color  ./sets/fluentColor.generated (the `*Color` components of @fluentui/react-icons, generated barrel)
 *                                                                    `DataPieColor`          → `data-pie`
 *
 * A set's module is imported the first time something needs it (picker tab, a canvas icon, a report that uses it), so
 * none of the artwork is in the initial renderer chunk. Loading a set also loads `react-dom/server`, which renders the
 * picture copy saved for Power BI (picture.ts) synchronously inside document edits.
 *
 * Adding a react-icons set (e.g. Tabler): an id in core/icons/types.ts, its metadata in core/icons/sets.ts, and one
 * line here: `tabler: { load: () => import('react-icons/tb'), prefix: 'Tb', kind: 'react-icons' }`.
 */
import type { ComponentType } from 'react'
import { componentIconName } from '@core/icons/ref'
import { searchIconNames } from '@core/icons/search'
import { ICON_SET_IDS, type IconSetId } from '@core/icons/types'

/** How a set's components take size, colour and ids (icon.tsx draws both kinds). */
export type IconComponentKind = 'react-icons' | 'fluent'

interface SetLoader {
  load(): Promise<Record<string, unknown>>
  /** export-name prefix / suffix removed to form the icon name */
  prefix?: string
  suffix?: string
  kind: IconComponentKind
}

const LOADERS: Record<IconSetId, SetLoader> = {
  lucide: { load: () => import('react-icons/lu'), prefix: 'Lu', kind: 'react-icons' },
  'fluent-color': { load: () => import('./sets/fluentColor.generated'), suffix: 'Color', kind: 'fluent' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = ComponentType<any>

export interface LoadedIconSet {
  id: IconSetId
  kind: IconComponentKind
  /** every icon name, sorted (stable ids: `set:name`) */
  names: readonly string[]
  components: ReadonlyMap<string, IconComponent>
}

type ServerModule = typeof import('react-dom/server')

const loaded = new Map<IconSetId, LoadedIconSet>()
const pending = new Map<IconSetId, Promise<LoadedIconSet>>()
let server: ServerModule | undefined

/** Build a set from its component module (exports that are not components of the set are ignored). */
export function setFromModule(id: IconSetId, mod: Record<string, unknown>): LoadedIconSet {
  const { prefix = '', suffix = '', kind } = LOADERS[id]
  const components = new Map<string, IconComponent>()
  for (const [key, value] of Object.entries(mod)) {
    if (!/^[A-Z]/.test(key) || (prefix && !key.startsWith(prefix)) || (suffix && !key.endsWith(suffix))) continue
    if (typeof value !== 'function' && !(value && typeof value === 'object' && '$$typeof' in value)) continue
    components.set(componentIconName(key, prefix, suffix), value as IconComponent)
  }
  return { id, kind, names: [...components.keys()].sort(), components }
}

/** Load a set (cached; concurrent calls share one import). */
export function loadIconSet(id: IconSetId): Promise<LoadedIconSet> {
  const hit = loaded.get(id)
  if (hit && server) return Promise.resolve(hit)
  let p = pending.get(id)
  if (!p) {
    p = Promise.all([LOADERS[id].load(), server ? Promise.resolve(server) : import('react-dom/server')]).then(([mod, srv]) => {
      server = srv
      const set = loaded.get(id) ?? setFromModule(id, mod)
      loaded.set(id, set)
      pending.delete(id)
      return set
    })
    p.catch(() => pending.delete(id))
    pending.set(id, p)
  }
  return p
}

export function loadIconSets(ids: Iterable<IconSetId>): Promise<LoadedIconSet[]> {
  return Promise.all([...new Set(ids)].map(loadIconSet))
}

/** The set when already loaded (synchronous paths: rendering, re-baking inside an edit). */
export function getLoadedIconSet(id: IconSetId): LoadedIconSet | undefined {
  return loaded.get(id)
}

/** `react-dom/server`, once any set has loaded (picture.ts). */
export function loadedServer(): ServerModule | undefined {
  return server
}

export function iconSetIds(): readonly IconSetId[] {
  return ICON_SET_IDS
}

/** The component of an icon, when its set is loaded and it exists. */
export function iconComponent(id: IconSetId, name: string): IconComponent | undefined {
  return loaded.get(id)?.components.get(name)
}

/** Search a loaded set by name and keyword (core/icons/search.ts). */
export function searchIcons(set: LoadedIconSet, query: string, opts: { limit?: number } = {}): string[] {
  return searchIconNames(set.names, query, opts)
}
