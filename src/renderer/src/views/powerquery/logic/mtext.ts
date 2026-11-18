/**
 * Small helpers that write M text the way the Power Query UI does: text literals, lists of column
 * names, field access (`[Col]` / `[#"Col (x)"]`), identifiers (`Source` / `#"Changed Type"`) and type
 * names (`type text`, `Int64.Type`, …).
 */
import { stepRef } from '@core/m/editor.ts'

/** `"text"` with `"` doubled and control characters escaped like PQ (`#(lf)`, `#(cr)`, `#(tab)`). */
export function mText(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '"') out += '""'
    else if (ch === '\n') out += '#(lf)'
    else if (ch === '\r') out += '#(cr)'
    else if (ch === '\t') out += '#(tab)'
    else if (ch === '#' && s[i + 1] === '(') out += '#(#)'
    else out += ch
  }
  return `"${out}"`
}

/** `{"A", "B"}` */
export function mTextList(items: readonly string[]): string {
  return `{${items.map(mText).join(', ')}}`
}

/** Identifier for a query/step name: plain when valid, `#"…"` otherwise (same rule as the engine). */
export function mIdent(name: string): string {
  return stepRef(name)
}

const KEYWORDS = new Set(['and', 'as', 'each', 'else', 'error', 'false', 'if', 'in', 'is', 'let', 'meta', 'not', 'null', 'or', 'otherwise', 'section', 'shared', 'then', 'true', 'try', 'type', 'catch'])
const WORD = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*'
const GENERALIZED = new RegExp(`^${WORD}(?: (?:${WORD}|[0-9]+))*$`)

/**
 * Field access as Power Query writes it in `each` expressions: `[Amount]`, `[Order Date]`, and
 * `[#"Sales (USD)"]` when the name isn't a generalized identifier.
 */
export function fieldRef(name: string): string {
  if (GENERALIZED.test(name) && !KEYWORDS.has(name)) return `[${name}]`
  return `[#${mText(name)}]`
}

/** M number literal (finite numbers only; NaN/∞ use the library constants). */
export function mNumber(n: number): string {
  if (Number.isNaN(n)) return 'Number.NaN'
  if (n === Infinity) return 'Number.PositiveInfinity'
  if (n === -Infinity) return 'Number.NegativeInfinity'
  return String(n)
}

/** Data types offered by the Power Query "Data Type" menu, in menu order. */
export type PqType = 'number' | 'currency' | 'int64' | 'percentage' | 'datetime' | 'date' | 'time' | 'datetimezone' | 'duration' | 'text' | 'logical' | 'binary' | 'any'

export const PQ_TYPES: Array<{ id: PqType; label: string; m: string }> = [
  { id: 'number', label: 'Decimal Number', m: 'type number' },
  { id: 'currency', label: 'Fixed decimal number', m: 'Currency.Type' },
  { id: 'int64', label: 'Whole Number', m: 'Int64.Type' },
  { id: 'percentage', label: 'Percentage', m: 'Percentage.Type' },
  { id: 'datetime', label: 'Date/Time', m: 'type datetime' },
  { id: 'date', label: 'Date', m: 'type date' },
  { id: 'time', label: 'Time', m: 'type time' },
  { id: 'datetimezone', label: 'Date/Time/Timezone', m: 'type datetimezone' },
  { id: 'duration', label: 'Duration', m: 'type duration' },
  { id: 'text', label: 'Text', m: 'type text' },
  { id: 'logical', label: 'True/False', m: 'type logical' },
  { id: 'binary', label: 'Binary', m: 'type binary' }
]

export function pqTypeM(t: PqType): string {
  return PQ_TYPES.find((x) => x.id === t)?.m ?? 'type any'
}

/**
 * Classify a preview column type string (MType.toString(): 'text', 'nullable number', 'Int64.Type', …)
 * into the Data Type menu's categories.
 */
export function pqTypeOf(typeText: string): PqType {
  const t = typeText.replace(/^nullable\s+/, '').trim()
  switch (t) {
    case 'Int64.Type':
    case 'Int32.Type':
    case 'Int16.Type':
    case 'Int8.Type':
    case 'Byte.Type':
      return 'int64'
    case 'Currency.Type':
    case 'Decimal.Type':
      return 'currency'
    case 'Percentage.Type':
      return 'percentage'
    case 'number':
    case 'Double.Type':
    case 'Single.Type':
      return 'number'
    case 'text':
    case 'Text.Type':
      return 'text'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'datetimezone':
      return 'datetimezone'
    case 'time':
      return 'time'
    case 'duration':
      return 'duration'
    case 'logical':
      return 'logical'
    case 'binary':
      return 'binary'
    default:
      return 'any'
  }
}

/** Nested (structured) column types: table / record / list / function. */
export function isStructuredType(typeText: string): boolean {
  return /^(nullable\s+)?(table|record|list|function)\b/.test(typeText.trim())
}

/** The type ascription PQ writes for a nullable column of this kind (`type nullable text`, …). */
export function nullableTypeM(typeText: string): string {
  const k = pqTypeOf(typeText)
  switch (k) {
    case 'int64':
      return 'Int64.Type'
    case 'currency':
      return 'Currency.Type'
    case 'percentage':
      return 'Percentage.Type'
    case 'any':
      return 'type any'
    default:
      return `type nullable ${k}`
  }
}

/** Row-type field as PQ writes inside `type table [...]`: `Name=nullable text`. */
export function rowTypeField(name: string, typeText: string): string {
  const k = pqTypeOf(typeText)
  const key = GENERALIZED.test(name) && !KEYWORDS.has(name) ? name : `#${mText(name)}`
  // row types hold primitive types only: Int64/Currency/Percentage columns are `nullable number`
  const t = k === 'int64' || k === 'currency' || k === 'percentage' ? 'nullable number' : k === 'any' ? 'any' : `nullable ${k}`
  return `${key}=${t}`
}
