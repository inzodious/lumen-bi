/**
 * Icon search over a set's names (pure: the names come from the loaded component module, renderer/src/icons/registry.ts).
 * The libraries ship names only (no tags), so common business words are mapped onto the words the libraries use.
 */
import { curatedGroupsOf } from './curated'

/** Search synonyms (query word → name tokens). */
export const SYNONYMS: Record<string, string[]> = {
  money: ['cash', 'coin', 'coins', 'currency', 'dollar', 'wallet', 'banknote', 'payment', 'money', 'savings', 'vault'],
  finance: ['bank', 'landmark', 'money', 'cash', 'coin', 'coins', 'currency', 'wallet', 'receipt', 'calculator', 'savings', 'vault'],
  revenue: ['money', 'cash', 'dollar', 'currency', 'coin', 'coins', 'trending', 'chart', 'banknote'],
  sales: ['shopping', 'cart', 'basket', 'store', 'tag', 'receipt', 'money'],
  profit: ['money', 'trending', 'coins', 'piggy'],
  kpi: ['target', 'gauge', 'goal', 'trophy', 'dashboard', 'award'],
  goal: ['target', 'flag', 'trophy', 'goal', 'milestone'],
  growth: ['trending', 'arrow', 'increasing', 'rocket'],
  increase: ['trending', 'arrow', 'increasing', 'up'],
  decrease: ['trending', 'arrow', 'decreasing', 'down'],
  trend: ['trending', 'chart'],
  graph: ['chart', 'graph', 'data'],
  chart: ['chart', 'graph', 'data', 'pie', 'poll'],
  analytics: ['chart', 'data', 'graph', 'activity'],
  customer: ['user', 'person', 'people', 'users', 'contact'],
  employee: ['user', 'person', 'people', 'badge', 'id'],
  team: ['users', 'people', 'team', 'group'],
  people: ['users', 'people', 'person', 'team', 'user'],
  company: ['building', 'factory', 'briefcase', 'org', 'landmark'],
  organization: ['building', 'org', 'people', 'users'],
  date: ['calendar'],
  time: ['clock', 'timer', 'hourglass', 'history', 'watch'],
  report: ['document', 'file', 'clipboard', 'notebook', 'newspaper', 'presentation'],
  document: ['document', 'file', 'files', 'clipboard'],
  email: ['mail', 'mails', 'inbox'],
  message: ['chat', 'message', 'comment', 'messages'],
  warning: ['alert', 'warning', 'triangle'],
  error: ['error', 'alert', 'dismiss', 'x', 'octagon'],
  success: ['check', 'checkmark', 'badge'],
  ok: ['check', 'checkmark'],
  settings: ['settings', 'cog', 'options', 'sliders', 'wrench'],
  filter: ['filter', 'funnel'],
  database: ['database', 'server', 'cylinder', 'hard'],
  data: ['data', 'database', 'table', 'chart', 'sheet'],
  location: ['map', 'pin', 'location', 'globe', 'earth', 'navigation'],
  delete: ['trash', 'delete', 'dismiss', 'x'],
  home: ['home', 'house']
}

interface IndexEntry {
  name: string
  tokens: string[]
  groups: string[]
}

const indexCache = new WeakMap<readonly string[], IndexEntry[]>()

function indexOf(names: readonly string[]): IndexEntry[] {
  let idx = indexCache.get(names)
  if (!idx) {
    idx = names.map((name) => ({ name, tokens: name.split('-'), groups: curatedGroupsOf(name) }))
    indexCache.set(names, idx)
  }
  return idx
}

/** Relevance of one query word against an icon (0 = no match). */
function wordScore(e: IndexEntry, w: string): number {
  if (e.tokens.includes(w)) return 10
  if (e.tokens.some((t) => t.startsWith(w))) return 6
  const syn = SYNONYMS[w]
  if (syn && e.tokens.some((t) => syn.includes(t))) return 3
  if (w.length >= 3 && e.name.includes(w)) return 2
  return 0
}

/**
 * Search icon names. Every query word must match (name token, token prefix, synonym or substring); results are
 * ranked by relevance (exact and prefix name matches first, curated business icons before others), then shorter
 * names, then name.
 */
export function searchIconNames(names: readonly string[], query: string, opts: { limit?: number } = {}): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,-]+/)
    .filter(Boolean)
  if (!words.length) return [...names]
  const q = words.join('-')
  const scored: Array<{ name: string; score: number }> = []
  for (const e of indexOf(names)) {
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
    if (e.groups.length) score += 2
    scored.push({ name: e.name, score })
  }
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
  const out = scored.map((s) => s.name)
  return opts.limit ? out.slice(0, opts.limit) : out
}
