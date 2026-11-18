/**
 * TMDL name / value quoting rules.
 *
 * Object names are wrapped in single quotes when they contain anything other than letters, digits,
 * `_` and `-` (Power BI quotes on whitespace, `.`, `=`, `:`, `'`; we are slightly more conservative,
 * which is still valid TMDL). A single quote inside a quoted name is doubled.
 *
 * Text property values (`formatString: ...`) are written raw unless that would be ambiguous: empty,
 * leading/trailing whitespace, line breaks, or a value that itself starts and ends with `"` — then the
 * value is written as a double-quoted string with `""` escapes (e.g. `"""TRUE"";""FALSE"""`).
 */

const PLAIN_NAME = /^[\p{L}\p{N}_-]+$/u

export function quoteName(name: string): string {
  if (PLAIN_NAME.test(name)) return name
  return `'${name.replace(/'/g, "''")}'`
}

/** `Table.Column` reference with each part quoted as needed. */
export function qualifiedName(table: string, member: string): string {
  return `${quoteName(table)}.${quoteName(member)}`
}

/**
 * Read a (possibly quoted) name at the start of `s`. Returns the name and the remaining text.
 * Unquoted names end at whitespace, `=`, `:` or `.` (when `stopAtDot`).
 */
export function readName(s: string, stopAtDot = false): { name: string; rest: string } {
  if (s.startsWith("'")) {
    let out = ''
    let i = 1
    while (i < s.length) {
      const ch = s[i]
      if (ch === "'") {
        if (s[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        return { name: out, rest: s.slice(i + 1) }
      }
      out += ch
      i++
    }
    // unterminated: take everything
    return { name: out, rest: '' }
  }
  const re = stopAtDot ? /^[^\s=:.]+/ : /^[^\s=:]+/
  const m = re.exec(s)
  if (!m) return { name: '', rest: s }
  return { name: m[0], rest: s.slice(m[0].length) }
}

export function unquoteName(s: string): string {
  return readName(s.trim()).name
}

/** Split `'A b'.'C'` / `T.C` / `T.'C d'` into its parts. */
export function splitQualified(s: string): string[] {
  const parts: string[] = []
  let rest = s.trim()
  while (rest.length) {
    const { name, rest: r } = readName(rest, true)
    parts.push(name)
    rest = r.trimStart()
    if (rest.startsWith('.')) rest = rest.slice(1).trimStart()
    else break
  }
  return parts
}

/** Parse `Table.Member` (the last part is the member; table names containing dots must be quoted). */
export function parseQualified(s: string): { table: string; member: string } {
  const parts = splitQualified(s)
  if (parts.length <= 1) return { table: '', member: parts[0] ?? '' }
  return { table: parts.slice(0, -1).join('.'), member: parts[parts.length - 1] }
}

const QUOTED_VALUE = /^"((?:[^"]|"")*)"$/

/** Decode a raw `prop: value` text value. */
export function decodeTextValue(raw: string): string {
  const m = QUOTED_VALUE.exec(raw)
  if (m) return m[1].replace(/""/g, '"')
  return raw
}

export function encodeTextValue(v: string): string {
  const needsQuotes =
    v === '' || /^\s|\s$/.test(v) || /[\r\n]/.test(v) || (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) || v === '"'
  return needsQuotes ? `"${v.replace(/"/g, '""')}"` : v
}

/** File name for a table/role/culture TMDL file (characters invalid in file names replaced). */
export function fileSafeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
}
