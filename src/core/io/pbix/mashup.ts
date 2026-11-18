/**
 * PBIX/PBIT `DataMashup` part: the Power Query package.
 *
 * Layout (MS-QDEFF): uint32 version (0) | uint32 packagePartsLength | package parts (OPC zip with
 * `Formulas/Section1.m`) | uint32 permissionsLength | permissions | uint32 metadataLength | metadata | ...
 * Older PBIX files keep their M queries only here (model partitions are `SELECT * FROM [Query]`).
 */
import { unzipSync } from 'fflate'
import { tokenize, type Token } from '../../m/index'

export interface MashupQuery {
  name: string
  /** M expression text (everything between `shared Name =` and the closing `;`) */
  expression: string
}

export interface Mashup {
  /** full Section1.m text */
  section: string
  queries: MashupQuery[]
}

/** Extract `Formulas/Section1.m` from a DataMashup blob. Throws on malformed input. */
export function readMashup(bytes: Uint8Array): Mashup {
  if (bytes.length < 8) throw new Error('DataMashup too short')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const len = dv.getUint32(4, true)
  if (8 + len > bytes.length) throw new Error('DataMashup package length out of range')
  const pkg = unzipSync(bytes.subarray(8, 8 + len), { filter: (f) => f.name.startsWith('Formulas/') })
  const key = Object.keys(pkg).find((k) => /^Formulas\/Section1\.m$/i.test(k)) ?? Object.keys(pkg).find((k) => k.endsWith('.m'))
  if (!key) throw new Error('DataMashup has no Formulas/Section1.m')
  let section = new TextDecoder('utf-8').decode(pkg[key])
  if (section.charCodeAt(0) === 0xfeff) section = section.slice(1)
  // Section1.m uses CRLF line breaks; models (TMDL/TOM) keep LF
  return { section, queries: splitSection(section).map((q) => ({ name: q.name, expression: q.expression.replace(/\r\n?/g, '\n') })) }
}

/** Split a `section Section1; shared A = ...; shared B = ...;` document into its members. */
export function splitSection(src: string): MashupQuery[] {
  let tokens: Token[]
  try {
    tokens = tokenize(src)
  } catch {
    return splitSectionByText(src)
  }
  const out: MashupQuery[] = []
  let depth = 0
  let i = 0
  const isOpen = (t: Token): boolean => t.kind === 'op' && (t.value === '(' || t.value === '[' || t.value === '{')
  const isClose = (t: Token): boolean => t.kind === 'op' && (t.value === ')' || t.value === ']' || t.value === '}')
  while (i < tokens.length && tokens[i].kind !== 'eof') {
    const t = tokens[i]
    if (isOpen(t)) depth++
    else if (isClose(t)) depth--
    else if (depth === 0 && t.kind === 'keyword' && t.value === 'shared') {
      const nameTok = tokens[i + 1]
      const eq = tokens[i + 2]
      if (nameTok && eq && eq.kind === 'op' && eq.value === '=') {
        let j = i + 3
        let d = 0
        const start = tokens[j]?.start ?? eq.end
        let end = start
        while (j < tokens.length && tokens[j].kind !== 'eof') {
          const tj = tokens[j]
          if (isOpen(tj)) d++
          else if (isClose(tj)) d--
          else if (d === 0 && tj.kind === 'op' && tj.value === ';') break
          end = tj.end
          j++
        }
        out.push({ name: nameTok.value, expression: src.slice(start, end) })
        i = j + 1
        continue
      }
    }
    i++
  }
  return out
}

/** Fallback when the lexer rejects the text: line-based split on `shared X =` at column 0. */
function splitSectionByText(src: string): MashupQuery[] {
  const out: MashupQuery[] = []
  const re = /^shared\s+(#"(?:[^"]|"")*"|[A-Za-z_][\w.]*)\s*=\s*/gm
  const matches = [...src.matchAll(re)]
  matches.forEach((m, k) => {
    const start = m.index! + m[0].length
    const end = k + 1 < matches.length ? matches[k + 1].index! : src.length
    const body = src.slice(start, end).replace(/;\s*$/, '')
    const raw = m[1]
    const name = raw.startsWith('#"') ? raw.slice(2, -1).replace(/""/g, '"') : raw
    out.push({ name, expression: body })
  })
  return out
}
