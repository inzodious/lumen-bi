/**
 * Icon registry: the one module that owns icons. Lists the sets and their variants, loads a set's
 * artwork on demand (dynamic import of a per-set chunk, so nothing of it is in the initial bundle),
 * enumerates icons with stable ids (`set:name`), searches by name / keyword / category, and builds
 * standalone SVG strings (svg.ts). React glyphs live in the renderer (renderer/src/icons).
 *
 * The set data modules are virtual (`virtual:lumen-icons/<set>`), produced at build time from the Iconify
 * JSON packages by scripts/icons/icon-data-plugin.ts (registered in electron.vite.config.ts and
 * vitest.config.ts).
 */
import { ICON_SETS } from './sets'
import { iconVariants } from './svg'
import { ICON_SET_IDS, type IconSetData, type IconSetId } from './types'

export { ICON_SETS, variantSpec } from './sets'
export { BUSINESS_GROUPS, curatedIcons, curatedAll } from './curated'

const LOADERS: Record<IconSetId, () => Promise<{ default: IconSetData }>> = {
  fluent: () => import('virtual:lumen-icons/fluent'),
  phosphor: () => import('virtual:lumen-icons/phosphor'),
  tabler: () => import('virtual:lumen-icons/tabler'),
  iconpark: () => import('virtual:lumen-icons/iconpark')
}

const loaded = new Map<IconSetId, IconSetData>()
const pending = new Map<IconSetId, Promise<IconSetData>>()

/** Load a set's artwork (cached; concurrent calls share one import). */
export function loadIconSet(set: IconSetId): Promise<IconSetData> {
  const hit = loaded.get(set)
  if (hit) return Promise.resolve(hit)
  let p = pending.get(set)
  if (!p) {
    p = LOADERS[set]().then((m) => {
      loaded.set(set, m.default)
      pending.delete(set)
      return m.default
    })
    p.catch(() => pending.delete(set))
    pending.set(set, p)
  }
  return p
}

export function loadIconSets(sets: Iterable<IconSetId>): Promise<IconSetData[]> {
  return Promise.all([...new Set(sets)].map(loadIconSet))
}

/** The set's data when already loaded (synchronous paths: re-baking inside an edit). */
export function getLoadedIconSet(set: IconSetId): IconSetData | undefined {
  return loaded.get(set)
}

/** Test / tooling hook: provide set data directly. */
export function provideIconSet(data: IconSetData): void {
  loaded.set(data.set, data)
}

export function iconSetIds(): readonly IconSetId[] {
  return ICON_SET_IDS
}

export interface IconListItem {
  /** stable id `set:name` */
  id: string
  set: IconSetId
  name: string
}

/** Every icon of a set (optionally only those drawn in `variant`), sorted by name. */
export function listIcons(data: IconSetData, variant?: string): IconListItem[] {
  const all = ICON_SETS[data.set].variants.map((v) => v.id)
  const out: IconListItem[] = []
  for (const name of Object.keys(data.icons)) {
    if (variant && !iconVariants(data, name, all).includes(variant)) continue
    out.push({ id: `${data.set}:${name}`, set: data.set, name })
  }
  return out
}

/** Variants a given icon exists in. */
export function variantsOf(data: IconSetData, name: string): string[] {
  return iconVariants(
    data,
    name,
    ICON_SETS[data.set].variants.map((v) => v.id)
  )
}

/** Set categories (IconPark ships its own) with their icon names. */
export function setCategories(data: IconSetData): Array<{ id: string; label: string; names: string[] }> {
  const m = new Map<string, string[]>()
  for (const [name, icon] of Object.entries(data.icons)) for (const c of icon.c ?? []) m.set(c, [...(m.get(c) ?? []), name])
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([c, names]) => ({ id: `cat:${c}`, label: c, names }))
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

/**
 * Search synonyms (query word → name tokens). Iconify's data carries names and (IconPark) categories but
 * no tags, so common business words are mapped onto the words the libraries use in their names.
 */
export const SYNONYMS: Record<string, string[]> = {
  money: ['cash', 'coin', 'coins', 'currency', 'dollar', 'wallet', 'banknote', 'payment', 'money'],
  finance: ['bank', 'money', 'cash', 'coin', 'currency', 'wallet', 'receipt', 'calculator'],
  revenue: ['money', 'cash', 'dollar', 'currency', 'coin', 'trending', 'chart'],
  sales: ['shopping', 'cart', 'basket', 'store', 'tag', 'receipt', 'money'],
  profit: ['money', 'trending', 'growth', 'coin'],
  kpi: ['target', 'gauge', 'goal', 'trophy', 'dashboard', 'speedometer'],
  goal: ['target', 'flag', 'trophy', 'goal'],
  growth: ['trending', 'growth', 'arrow', 'rise', 'increase'],
  increase: ['trending', 'arrow', 'growth', 'increase', 'rise'],
  decrease: ['trending', 'arrow', 'decline', 'decrease'],
  trend: ['trending', 'trend', 'chart'],
  graph: ['chart', 'graph', 'data', 'analytics'],
  chart: ['chart', 'graph', 'data', 'analytics', 'pie', 'histogram'],
  analytics: ['chart', 'analytics', 'data', 'graph'],
  customer: ['user', 'person', 'people', 'customer', 'contact'],
  employee: ['user', 'person', 'people', 'badge', 'employee'],
  team: ['users', 'people', 'team', 'group', 'peoples'],
  people: ['users', 'people', 'person', 'team', 'peoples', 'user'],
  company: ['building', 'buildings', 'office', 'company', 'organization'],
  date: ['calendar', 'date'],
  time: ['clock', 'time', 'timer', 'hourglass', 'stopwatch'],
  report: ['document', 'file', 'report', 'clipboard', 'notes'],
  document: ['document', 'file', 'page', 'paper'],
  email: ['mail', 'envelope', 'email'],
  message: ['chat', 'message', 'comment', 'bubble'],
  warning: ['alert', 'warning', 'exclamation', 'error'],
  error: ['error', 'alert', 'warning', 'dismiss', 'x'],
  success: ['check', 'checkmark', 'success', 'done'],
  ok: ['check', 'checkmark'],
  settings: ['settings', 'gear', 'cog', 'options', 'adjustments', 'sliders'],
  filter: ['filter', 'funnel'],
  database: ['database', 'server', 'data', 'storage', 'cylinder'],
  data: ['data', 'database', 'table', 'chart'],
  location: ['map', 'pin', 'location', 'globe', 'marker'],
  delete: ['delete', 'trash', 'bin', 'remove'],
  home: ['home', 'house']
}

interface IndexEntry {
  name: string
  tokens: string[]
  cats: string[]
}

const indexCache = new WeakMap<IconSetData, IndexEntry[]>()

function indexOf(data: IconSetData): IndexEntry[] {
  let idx = indexCache.get(data)
  if (!idx) {
    idx = Object.entries(data.icons).map(([name, icon]) => ({ name, tokens: name.split('-'), cats: (icon.c ?? []).map((c) => c.toLowerCase()) }))
    indexCache.set(data, idx)
  }
  return idx
}

/** Relevance of one query word against an icon (0 = no match). */
function wordScore(e: IndexEntry, w: string): number {
  if (e.tokens.includes(w)) return 10
  if (e.tokens.some((t) => t.startsWith(w))) return 6
  if (e.cats.includes(w)) return 4
  const syn = SYNONYMS[w]
  if (syn && e.tokens.some((t) => syn.includes(t))) return 3
  if (w.length >= 3 && e.name.includes(w)) return 2
  return 0
}

/**
 * Search a set by name and keyword. Every query word must match (name token, token prefix, IconPark category,
 * synonym, or substring); results are ranked by relevance, then shorter names, then name.
 */
export function searchIcons(data: IconSetData, query: string, opts: { variant?: string; limit?: number } = {}): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,-]+/)
    .filter(Boolean)
  if (!words.length) return listIcons(data, opts.variant).map((i) => i.name)
  const all = ICON_SETS[data.set].variants.map((v) => v.id)
  const scored: Array<{ name: string; score: number }> = []
  const q = words.join('-')
  for (const e of indexOf(data)) {
    let score = 0
    let ok = true
    for (const w of words) {
      const s = wordScore(e, w)
      if (!s) {
        ok = false
        break
      }
      score += s
    }
    if (!ok) continue
    if (e.name === q) score += 50
    else if (e.name.startsWith(q)) score += 15
    if (opts.variant && !iconVariants(data, e.name, all).includes(opts.variant)) continue
    scored.push({ name: e.name, score })
  }
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
  const names = scored.map((s) => s.name)
  return opts.limit ? names.slice(0, opts.limit) : names
}
