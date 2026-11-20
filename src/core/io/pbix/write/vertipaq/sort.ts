/**
 * Text order of Power BI's default collation (Latin1_General, case-insensitive, accent-sensitive) as far as the
 * attribute hierarchies of the files on hand show it: case is ignored, and hyphens and apostrophes are ignored at first
 * ("word sort"), deciding only between strings otherwise equal. `Intl.Collator` gives the culture-aware base order.
 * Approximation: Windows' sort keys differ from ICU's in rarer cases (some punctuation and symbols); a difference
 * only changes the default display order of a column's values, never which values exist.
 */
const collator = new Intl.Collator('en-US', { sensitivity: 'accent', numeric: false })

function stripWordSortIgnored(s: string): string {
  return s.replace(/[-'’]/g, '')
}

export function compareText(a: string, b: string): number {
  return collator.compare(stripWordSortIgnored(a), stripWordSortIgnored(b)) || collator.compare(a, b)
}
