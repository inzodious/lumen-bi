/**
 * Text normalization for Q&A: tokenizing questions and splitting model names into words, with a light
 * English stemmer (plural → singular) so "products" matches `Product` and "categories" matches `Category`.
 */

export interface Token {
  /** text as typed */
  raw: string
  /** lower-cased, apostrophes removed */
  norm: string
  /** singular stem used for matching */
  stem: string
  /** character offsets in the question (for underlining) */
  start: number
  end: number
  /** numeric value when the token is a number (digits, "1,000", "2.5") */
  num?: number
}

const IRREGULAR: Record<string, string> = {
  people: 'person',
  men: 'man',
  women: 'woman',
  children: 'child',
  mice: 'mouse',
  geese: 'goose',
  feet: 'foot',
  teeth: 'tooth',
  data: 'data',
  series: 'series',
  species: 'species',
  news: 'news',
  analyses: 'analysis',
  indices: 'index',
  criteria: 'criterion'
}

/** Singular stem of a lower-case word ("categories" → "category", "boxes" → "box", "sales" → "sale"). */
export function stem(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w]
  if (w.length <= 3 || /\d/.test(w)) return w
  if (/(ss|us|is)$/.test(w)) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w)) return w.slice(0, -1)
  return w
}

const TOKEN_RE = /\d[\d,]*(?:\.\d+)?|[A-Za-zÀ-ɏ0-9]+(?:['’][A-Za-z]+)*|>=|<=|[<>=%$#]/g

export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0]
    const start = m.index ?? 0
    let norm = raw.toLowerCase().replace(/['’]/g, '')
    let num: number | undefined
    if (/^\d[\d,]*(?:\.\d+)?$/.test(raw)) {
      num = Number(raw.replace(/,/g, ''))
      norm = String(num)
    }
    out.push({ raw, norm, stem: num !== undefined ? norm : stem(norm), start, end: start + raw.length, num })
  }
  return out
}

/** Split a model name into lower-case words: "TotalSales_LY" → ["total", "sales", "ly"], "Margin %" → ["margin", "%"]. */
export function splitName(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./\\()[\]{}:,;|]+/g, ' ')
  return tokenize(spaced).map((t) => t.norm)
}

/** Matching key of a phrase: stems joined by spaces. */
export function phraseKey(words: string[]): string {
  return words.map((w) => (/^\d/.test(w) ? w : stem(w))).join(' ')
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  fifty: 50,
  hundred: 100
}

export function numberWord(w: string): number | undefined {
  return NUMBER_WORDS[w]
}
