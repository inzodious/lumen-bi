/**
 * "Business & dashboards": a curated category spanning the four sets, built from the sets' own names and
 * categories (IconPark) with the reviewed keyword lists below — not a hand-typed list of icon names.
 *
 * Matching: an icon belongs to a group when its kebab-case name contains one of the group's keywords as a
 * whole token sequence (`data-bar` matches `data-bar-vertical`, not `database`; `^arrow-up` only at the start
 * of the name, so `cloud-arrow-up` is not a trend), or its IconPark category is one of the group's categories,
 * and none of its tokens is in the group's `exclude` list. Names with a stop token (`off` variants, brand logos,
 * emoji…) are left out.
 *
 * Review notes: generic words that pull in unrelated artwork were dropped after looking at the results
 * (e.g. `star`, `up`, `down`, `line`, `bar` alone, `building` alone for organisations, `book` for documents).
 */
import type { IconSetData } from './types'

export interface CuratedGroup {
  id: string
  label: string
  keywords: string[]
  /** IconPark categories that belong to the group */
  categories?: string[]
  /** name tokens that keep an icon out of the group even when a keyword matched */
  exclude?: string[]
}

export const BUSINESS_GROUPS: CuratedGroup[] = [
  {
    id: 'charts',
    label: 'Charts & graphs',
    keywords: ['chart', 'graph', 'histogram', 'analytics', 'data-bar', 'data-pie', 'data-line', 'data-area', 'data-histogram', 'data-funnel', 'data-scatter', 'data-sunburst', 'data-treemap', 'data-waterfall', 'data-whisker', 'pie', 'donut', 'funnel', 'scatter', 'treemap', 'sunburst', 'waterfall', 'presentation'],
    categories: ['Charts']
  },
  {
    id: 'kpi',
    label: 'KPIs & targets',
    keywords: ['target', 'goal', 'gauge', 'speedometer', 'dashboard', 'trophy', 'award', 'medal', 'bullseye', 'kpi', 'scoreboard', 'rocket', 'flag-checkered', 'podium', 'progress', 'crown']
  },
  {
    id: 'trends',
    label: 'Trends up / down',
    keywords: ['trending', 'trend', 'growth', 'arrow-trending', 'arrow-growth', 'chart-line-up', 'chart-line-down', 'rise', 'decline', '^increase', '^decrease', '^arrow-up', '^arrow-down', '^caret-up', '^caret-down', '^triangle-up', '^triangle-down', '^arrow-big-up', '^arrow-big-down', '^circle-arrow-up', '^circle-arrow-down', 'positive-dynamics'],
    exclude: ['text', 'indent', 'sort', 'from', 'to']
  },
  {
    id: 'money',
    label: 'Money & finance',
    keywords: ['money', 'cash', 'coin', 'coins', 'currency', 'dollar', 'euro', 'pound', 'yen', 'yuan', 'rupee', 'bitcoin', 'wallet', 'bank', 'credit-card', 'receipt', 'invoice', 'calculator', 'piggy-bank', 'savings', 'payment', 'payments', '^pay', 'price', 'discount', 'percent', 'tax', 'budget', 'finance', 'financial', 'shopping-cart', 'basket', 'shopping-bag', 'storefront', '^store', '^tag', 'banknote', 'funds', 'income', 'expenses', 'stock-market', 'transaction'],
    categories: ['Money'],
    exclude: ['microsoft', 'app', 'heart', 'music']
  },
  {
    id: 'people',
    label: 'People & organizations',
    keywords: ['user', 'users', 'person', 'people', 'team', 'organization', 'company', 'briefcase', 'employee', 'customer', 'contact', 'contacts', 'id-card', 'id-badge', 'handshake', 'address-book', 'building-skyscraper', 'buildings', 'office-building', 'peoples', 'identification', 'hierarchy', 'org'],
    categories: ['Peoples'],
    exclude: ['ski', 'snowboard', 'swim', 'bike', 'hike', 'tai', 'throw', 'run', 'walk', 'baby', 'toilet', 'pregnant', 'skiing', 'swimming', 'running', 'walking', 'guest', 'sound', 'voice', 'feedback']
  },
  {
    id: 'time',
    label: 'Calendar & time',
    keywords: ['calendar', 'clock', 'time', 'timer', 'hourglass', 'alarm', 'history', 'schedule', 'stopwatch', 'date', 'calendar-event', 'calendar-month', 'calendar-week', 'deadline', 'countdown'],
    categories: ['Time']
  },
  {
    id: 'documents',
    label: 'Documents & reports',
    keywords: ['document', 'documents', 'file', 'files', 'report', 'reports', 'clipboard', 'notebook', '^note', '^notes', 'notepad', 'paper', 'folder', 'folders', 'invoice', 'contract', 'certificate', 'article', 'newspaper', 'printer', 'checklist', 'list-check', 'list-details', 'license', 'signature', 'table-report', 'file-cabinet'],
    categories: ['Office'],
    exclude: ['music', 'paw', 'animal', 'cpp', 'rs', 'vue', 'tsx', 'ts', 'js', 'jsx', 'css', 'html', 'php', 'py', 'c', 'sharp', 'zip', 'fs', 'endnote', 'svg', 'jpg', 'png', 'plane', 'medical', 'makeup', 'lipstick', 'cut', 'scissors', 'needle']
  },
  {
    id: 'communication',
    label: 'Communication',
    keywords: ['mail', 'email', 'envelope', 'chat', 'message', 'messages', 'comment', 'comments', '^phone', '^call', 'megaphone', 'speakerphone', '^send', 'inbox', '^broadcast', 'conversation', 'chat-bubble', '^video-camera', '^video-conference', '^share', 'mention', 'feedback', 'topic-discussion', 'voice-message'],
    categories: ['Communicate'],
    exclude: ['music', 'game', 'vertical', 'span', 'scroll', 'usb', 'park', 'previous', 'template']
  },
  {
    id: 'status',
    label: 'Status & alerts',
    keywords: ['^alert', 'warning', '^error', '^info', '^information', '^check', 'checkmark', 'circle-check', 'success', 'x-circle', 'dismiss-circle', '^shield', '^bell', '^notification', 'question', '^help', 'exclamation', 'important', 'status', '^ban', 'prohibited', '^flag', '^thumbs', '^thumbs-up', '^thumbs-down', 'thumb-up', 'thumb-down', 'heart-rate', '^lock', '^unlock', 'pending', '^loading', 'spinner', 'caution', 'seal-check', 'seal-warning', 'circle-x', 'circle-dashed-check'],
    categories: ['Safe'],
    exclude: ['pride', 'flame', 'spark', 'music', 'mood', 'kitchen', 'smoke', 'emergency']
  },
  {
    id: 'settings',
    label: 'Filters & settings',
    keywords: ['^filter', '^filters', 'settings', 'setting', '^gear', '^cog', 'options', 'sliders', 'slider', '^adjustments', 'tune', 'preferences', '^sort', '^toggle', '^wrench', '^tool', '^tools', '^search', '^zoom', '^switch', 'equalizer', '^control', 'manual-gear', 'funnel'],
    categories: ['Operate'],
    exclude: ['kitchen', 'nintendo', 'game', 'flame', 'spark', 'mood']
  },
  {
    id: 'data',
    label: 'Data & databases',
    keywords: ['^database', 'databases', '^data', 'server', '^cloud', '^table', '^grid', 'spreadsheet', 'data-sheet', '^storage', '^stack', '^layers', '^api', 'sql', 'hard-drive', 'harddrive', 'cylinder', '^cube', 'dataset', 'warehouse', 'binary', 'json', 'csv', 'file-type-csv', 'file-type-sql', '^network', 'sitemap', 'pivot', 'matrix', 'internal-data', 'data-file', 'data-server'],
    categories: ['Datas'],
    exclude: ['rain', 'snow', 'sun', 'moon', 'fog', 'lightning', 'weather', 'rainbow', 'drizzle', 'hail', 'storm', 'cellular', 'kitchen', 'picnic', 'usage', 'spark', 'flame']
  }
]

const STOP_TOKENS = new Set(['off', 'emoji', 'brand', 'logo', 'face'])

/** Contains `seq` as a whole token sequence. */
function hasSeq(tokens: string[], seq: string[]): boolean {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer
    return true
  }
  return false
}

const cache = new WeakMap<IconSetData, Record<string, string[]>>()

/** Curated icon names of a set, per group id (sorted by name). */
export function curatedIcons(data: IconSetData): Record<string, string[]> {
  const hit = cache.get(data)
  if (hit) return hit
  const groups = BUSINESS_GROUPS.map((g) => ({
    g,
    seqs: g.keywords.map((k) => ({ start: k.startsWith('^'), seq: k.replace(/^\^/, '').split('-') })),
    cats: new Set(g.categories ?? []),
    exclude: new Set(g.exclude ?? [])
  }))
  const out: Record<string, string[]> = Object.fromEntries(BUSINESS_GROUPS.map((g) => [g.id, []]))
  for (const [name, icon] of Object.entries(data.icons)) {
    const tokens = name.split('-')
    if (tokens.some((t) => STOP_TOKENS.has(t))) continue
    for (const { g, seqs, cats, exclude } of groups) {
      if (tokens.some((t) => exclude.has(t))) continue
      const byName = seqs.some((s) => (s.start ? s.seq.every((t, i) => tokens[i] === t) : hasSeq(tokens, s.seq)))
      if (byName || icon.c?.some((c) => cats.has(c))) out[g.id].push(name)
    }
  }
  cache.set(data, out)
  return out
}

/** Every curated name of a set (union of the groups). */
export function curatedAll(data: IconSetData): string[] {
  return [...new Set(Object.values(curatedIcons(data)).flat())].sort()
}
