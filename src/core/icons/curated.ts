/**
 * "Business & dashboards": a curated category across the sets, built from the icons' own names with the reviewed
 * keyword lists below — not a hand-typed list of icon names, so it follows library updates.
 *
 * Matching: an icon belongs to a group when its kebab-case name contains one of the group's keywords as a whole
 * token sequence (`chart-bar` matches `chart-bar-stacked`, not `bar-chart-ish`; `^arrow-up` only at the start of the
 * name, so `cloud-arrow-up` is not a trend), and none of the group's `exclude` entries (a token or a token sequence)
 * occurs in it. Names with a stop token (`off` variants, brands…) or ending in a number (Lucide's alternate drawings
 * `file-check-2`, the twelve `clock-1`… faces) are left out.
 *
 * Review notes (looked at every group for both sets): weather `cloud-*`, food (`donut`, `cake`), audio / video / code
 * file types, table-editing commands (`table-cells-merge`), sort-order arrows (`arrow-down-az`), text-indent arrows
 * and line-edge arrows (`arrow-up-from-line`) were pulled in by generic words and are excluded; `book` alone was
 * dropped (Lucide's `book-headphones`, `book-heart`…), `star` and `bar` alone were never used.
 */

export interface CuratedGroup {
  id: string
  label: string
  keywords: string[]
  /** tokens or token sequences (`a-b`) that keep an icon out of the group even when a keyword matched */
  exclude?: string[]
}

export const BUSINESS_GROUPS: CuratedGroup[] = [
  {
    id: 'charts',
    label: 'Charts & graphs',
    keywords: ['chart', 'graph', 'data-bar', 'data-pie', 'data-line', 'data-area', 'data-scatter', 'data-trending', 'pie', 'presentation', 'poll', '^activity', 'square-activity', 'calendar-data-bar', 'file-chart-column', 'file-chart-line', 'file-chart-pie'],
    exclude: ['git']
  },
  {
    id: 'kpi',
    label: 'KPIs & targets',
    keywords: ['target', 'goal', 'gauge', 'trophy', 'award', 'medal', 'crown', 'rocket', 'milestone', 'reward', 'premium', 'ribbon-star', 'badge-check', 'flag-triangle-right']
  },
  {
    id: 'trends',
    label: 'Trends up / down',
    keywords: ['trending', 'arrow-trending', 'chart-column-increasing', 'chart-column-decreasing', 'chart-bar-increasing', 'chart-bar-decreasing', 'chart-no-axes-column-increasing', 'chart-no-axes-column-decreasing', '^arrow-up', '^arrow-down', '^arrow-big-up', '^arrow-big-down', '^circle-arrow-up', '^circle-arrow-down', '^square-arrow-up', '^square-arrow-down', 'circle-fading-arrow-up', '^move-up', '^move-down', '^chevrons-up', '^chevrons-down'],
    exclude: ['az', 'za', '01', '10', 'narrow', 'wide', 'from', 'to', 'dot', 'left', 'dash', 'out', 'arrow-down-up', 'arrow-up-down', 'chevrons-up-down', 'chevrons-down-up']
  },
  {
    id: 'money',
    label: 'Money & finance',
    keywords: ['money', 'cash', 'coin', 'coins', 'coin-multiple', 'currency', 'dollar', 'dollar-sign', 'euro', 'sterling', 'yen', 'rupee', 'ruble', 'franc', 'peso', 'cent', 'bitcoin', 'wallet', 'banknote', 'credit-card', 'receipt', 'calculator', 'piggy-bank', 'savings', 'percent', 'hand-coins', 'landmark', 'vault', 'shopping-cart', 'shopping-bag', 'shopping-basket', 'store', 'building-store', '^tag', '^tags', 'gift-card', 'scale'],
    exclude: ['ticket', 'diamond', 'scale-3', 'equal']
  },
  {
    id: 'people',
    label: 'People & organizations',
    keywords: ['user', 'users', 'person', 'people', 'contact', 'contact-card', 'id-card', 'handshake', 'briefcase', 'building', 'factory', 'org', 'book-user', 'book-contacts', 'guest', 'diversity', 'heart-handshake', 'person-standing'],
    exclude: ['medical', 'conveyor', 'pen', 'cog', 'search', 'home']
  },
  {
    id: 'time',
    label: 'Calendar & time',
    keywords: ['calendar', 'clock', 'alarm-clock', 'timer', 'hourglass', 'history', 'watch', 'shifts'],
    exclude: ['heart', 'fold', 'mail', 'send', 'folder', 'file']
  },
  {
    id: 'documents',
    label: 'Documents & reports',
    keywords: ['file', 'files', 'document', 'clipboard', 'notebook', 'notepad', 'sticky-note', 'folder', 'folders', 'newspaper', 'news', 'printer', 'book-open', 'book-text', 'book-marked', 'library', 'scroll-text', 'certificate', 'signature', 'form', 'drafts', 'text-bullet-list-square', 'list-check', 'list-checks', 'list-todo', 'archive', 'sheet', 'receipt-text'],
    exclude: ['audio', 'video', 'music', 'code', 'json', 'terminal', 'volume', 'image', 'heart', 'git', 'symlink', 'type', 'digit', 'axis', 'box', 'stack', 'diff', 'sliders', 'input', 'output', 'root', 'dot', 'kanban', 'question', 'paste', 'copy', 'tree', 'restore', 'lightbulb']
  },
  {
    id: 'communication',
    label: 'Communication',
    keywords: ['mail', 'mails', 'mailbox', 'inbox', 'message', 'messages', 'chat', 'comment', 'phone', 'megaphone', 'megaphone-loud', '^send', 'at-sign', 'voicemail', '^video', 'webcam', 'headset', '^share', 'rss', 'speech', '^reply'],
    exclude: ['code', 'diff', 'dashed', 'heart', 'lock', 'dot', 'game', 'laptop', 'horizontal', 'to', 'back', 'forwarded', 'incoming', 'missed', 'outgoing', 'bot']
  },
  {
    id: 'status',
    label: 'Status & alerts',
    keywords: ['^alert', 'alert-badge', 'alert-urgent', 'warning', 'triangle-alert', 'octagon-alert', 'circle-alert', 'badge-alert', 'shield-alert', '^info', 'badge-info', '^check', 'check-check', 'circle-check', 'circle-check-big', 'square-check', 'square-check-big', 'checkmark-circle', 'checkbox', 'shield-check', 'shield-checkmark', '^shield', '^bell', '^ban', 'circle-x', 'square-x', 'octagon-x', 'badge-x', 'dismiss-circle', 'error-circle', 'cloud-dismiss', '^x', 'circle-help', 'badge-help', 'question-circle', 'thumbs-up', 'thumbs-down', '^flag', '^lock', 'lock-closed', 'lock-shield', 'lock-open', '^loader', 'siren', 'circle-pause', 'circle-stop', 'circle-slash'],
    exclude: ['electric', 'half', 'ellipsis', 'keyhole', 'person', 'wifi', 'battery']
  },
  {
    id: 'settings',
    label: 'Filters & settings',
    keywords: ['settings', '^cog', 'sliders-horizontal', 'sliders-vertical', '^filter', 'list-filter', 'funnel', '^wrench', 'wrench-screwdriver', 'toolbox', 'options', '^search', 'search-visual', 'search-sparkle', 'zoom-in', 'zoom-out', 'toggle-left', 'toggle-right', 'arrow-down-wide-narrow', 'arrow-up-narrow-wide', 'arrow-down-az', 'arrow-up-az', 'arrow-up-down', 'refresh-cw', 'refresh-ccw', 'arrow-sync', 'arrow-clockwise-dashes-settings', 'star-settings'],
    exclude: ['code', 'slash', 'x', 'dot']
  },
  {
    id: 'data',
    label: 'Data & databases',
    keywords: ['database', 'book-database', 'server', 'hard-drive', 'cylinder', '^table', 'sheet', 'file-spreadsheet', '^layers', '^cloud', 'network', 'binary', 'braces', 'container', 'workflow', 'waypoints', 'warehouse', 'blocks', 'boxes', 'layout-dashboard', 'layout-grid', 'kanban', 'sigma', 'variable', 'square-function', 'webhook', 'cpu'],
    exclude: ['drizzle', 'fog', 'hail', 'lightning', 'moon', 'rain', 'snow', 'sun', 'wind', 'crash', 'properties', 'cells', 'columns', 'rows', 'merge', 'split', 'contents', 'words', 'dashed', 'dismiss']
  },
  {
    id: 'places',
    label: 'Places & logistics',
    keywords: ['^map', 'map-pin', 'map-pinned', 'globe', 'earth', '^locate', 'location-ripple', '^navigation', 'compass', '^route', 'truck', '^plane', '^package', 'warehouse', 'ship', '^pin', 'building-government', 'house', 'home'],
    exclude: ['inside', 'minus', 'plus', 'x', 'off', 'search', 'plug', 'people', 'person', 'drafting', 'lock', 'wheel']
  }
]

const STOP_TOKENS = new Set(['off', 'brand', 'logo', 'emoji', 'github', 'gitlab', 'facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'twitch', 'dribbble', 'figma', 'framer', 'slack', 'trello', 'codepen', 'codesandbox', 'chrome'])

/** Contains `seq` as a whole token sequence. */
function hasSeq(tokens: string[], seq: string[]): boolean {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer
    return true
  }
  return false
}

const compiled = BUSINESS_GROUPS.map((g) => ({
  g,
  seqs: g.keywords.map((k) => ({ start: k.startsWith('^'), seq: k.replace(/^\^/, '').split('-') })),
  exclude: (g.exclude ?? []).map((e) => e.split('-'))
}))

/** The curated groups an icon name belongs to (empty when none). */
export function curatedGroupsOf(name: string): string[] {
  const tokens = name.split('-')
  if (tokens.some((t) => STOP_TOKENS.has(t)) || /^\d+$/.test(tokens[tokens.length - 1])) return []
  const out: string[] = []
  for (const { g, seqs, exclude } of compiled) {
    if (exclude.some((e) => hasSeq(tokens, e))) continue
    if (seqs.some((s) => (s.start ? s.seq.every((t, i) => tokens[i] === t) : hasSeq(tokens, s.seq)))) out.push(g.id)
  }
  return out
}

const cache = new WeakMap<readonly string[], Record<string, string[]>>()

/** Curated icon names of a set (given its names), per group id, sorted by name. */
export function curatedIcons(names: readonly string[]): Record<string, string[]> {
  const hit = cache.get(names)
  if (hit) return hit
  const out: Record<string, string[]> = Object.fromEntries(BUSINESS_GROUPS.map((g) => [g.id, []]))
  for (const name of [...names].sort()) for (const g of curatedGroupsOf(name)) out[g].push(name)
  cache.set(names, out)
  return out
}

/** Every curated name of a set (union of the groups, sorted). */
export function curatedAll(names: readonly string[]): string[] {
  return [...new Set(Object.values(curatedIcons(names)).flat())].sort()
}

/** Every curated name of a set in display order: group by group (charts first), each icon once. */
export function curatedInGroupOrder(names: readonly string[]): string[] {
  const g = curatedIcons(names)
  return [...new Set(BUSINESS_GROUPS.flatMap((x) => g[x.id]))]
}
