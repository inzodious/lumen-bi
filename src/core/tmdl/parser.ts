/**
 * Generic TMDL (Tabular Model Definition Language) parser: text -> tree of declarations.
 *
 * Grammar (as written by Power BI Desktop / Fabric / Tabular Editor):
 *   - indentation with TABs defines nesting (object at depth d, its properties/children at d+1)
 *   - `/// text` lines before a declaration are its description
 *   - declarations:  `keyword`                       (bare: boolean property or unnamed object)
 *                    `keyword: value`                (property)
 *                    `keyword = expression`          (expression property / unnamed object default property)
 *                    `keyword Name`                  (named object; Name may be 'quoted')
 *                    `keyword Name = expression`     (named object with default property)
 *                    `ref keyword Name`              (ordering reference)
 *   - expressions: single line after `=`; or multi-line on the following, deeper-indented lines; or
 *     fenced with ``` ... ``` (used when the text has trailing whitespace / trailing blank lines).
 *     Multi-line expression content of an *object* at depth d is indented at d+2; that of a plain
 *     *property* at depth p is indented at p+1 (e.g. `pollingExpression`). Indentation is stripped.
 *
 * The tree is semantic-agnostic; `read.ts` maps it onto `SemanticModel`.
 */

export interface TmdlNode {
  keyword: string
  /** object name (unquoted) */
  name?: string
  /** for `ref <refType> <name>` */
  refType?: string
  /** ':' property, '=' expression */
  sep?: ':' | '='
  /** raw text after ': ' for properties; de-indented expression text for '=' */
  value?: string
  /** expression was multi-line */
  multiline?: boolean
  /** expression was fenced with ``` */
  fenced?: boolean
  description?: string
  children: TmdlNode[]
  depth: number
  /** 1-based source line of the declaration */
  line: number
  /** expression indentation style: object default property (content at depth+2) or plain property (depth+1) */
  exprStyle?: 'object' | 'property'
  /** exact source lines of description + declaration + expression (no children, no trailing blanks) */
  raw: string[]
  /** 0-based index of the first source line (description included) */
  start: number
  /** 0-based index of the last non-blank source line of the node including its children */
  end: number
}

export interface TmdlError {
  file?: string
  line: number
  message: string
}

/** Unnamed keywords that are objects whose default property is an expression (content at depth+2). */
const OBJECT_EXPR_KEYWORDS = new Set([
  'source',
  'formatStringDefinition',
  'detailRowsDefinition',
  'defaultDetailRowsDefinition',
  'linguisticMetadata',
  'noSelectionExpression',
  'multipleOrEmptySelectionExpression',
  'changedProperty'
])

/** Plain expression-valued properties (content at depth+1). */
const PROPERTY_EXPR_KEYWORDS = new Set([
  'pollingExpression',
  'sourceExpression',
  'targetExpression',
  'statusExpression',
  'trendExpression',
  'mExpression',
  'queryDefinition'
])

const KEYWORD = /^[A-Za-z_][A-Za-z0-9_]*/

function tabs(line: string): number {
  let n = 0
  while (n < line.length && line.charCodeAt(n) === 9) n++
  return n
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function stripTabs(line: string, n: number): string {
  let i = 0
  while (i < n && i < line.length && line.charCodeAt(i) === 9) i++
  return line.slice(i)
}

export interface TmdlDocument {
  nodes: TmdlNode[]
  errors: TmdlError[]
  /** normalized source lines (LF) */
  lines: string[]
}

export function parseTmdlText(text: string, file?: string): TmdlDocument {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const errors: TmdlError[] = []
  const root: TmdlNode = { keyword: '#root', children: [], depth: -1, line: 0, raw: [], start: 0, end: 0 }
  const stack: TmdlNode[] = [root]
  let desc: string[] = []
  let descRaw: string[] = []

  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (isBlank(ln)) {
      i++
      continue
    }
    let depth = tabs(ln)
    let content = ln.slice(depth)
    if (content.startsWith(' ')) {
      // Space indentation (hand-written TMDL): 4 spaces = one level.
      const sp = /^ +/.exec(content)![0].length
      depth += Math.floor(sp / 4)
      content = content.slice(sp)
    }
    if (content.startsWith('///')) {
      desc.push(content.slice(3).replace(/^ /, ''))
      descRaw.push(ln)
      i++
      continue
    }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (depth > parent.depth + 1) {
      errors.push({ file, line: i + 1, message: `Unexpected indentation (depth ${depth} under depth ${parent.depth})` })
    }
    const node = parseDecl(content, depth, i + 1, file, errors)
    node.start = desc.length ? i - descRaw.length : i
    if (desc.length) {
      node.description = desc.join('\n')
      node.raw.push(...descRaw)
      desc = []
      descRaw = []
    }
    node.raw.push(ln)
    i++

    if (node.sep === '=') {
      const first = node.value ?? ''
      const objectStyle = !PROPERTY_EXPR_KEYWORDS.has(node.keyword) && (node.name !== undefined || OBJECT_EXPR_KEYWORDS.has(node.keyword))
      if (first.trim().startsWith('```')) {
        // fenced block
        const after = first.trim().slice(3)
        const body: string[] = []
        let closed = false
        let closeDepth = -1
        while (i < lines.length) {
          const l = lines[i]
          node.raw.push(l)
          i++
          if (l.trim() === '```') {
            closed = true
            closeDepth = tabs(l)
            break
          }
          body.push(l)
        }
        if (!closed) errors.push({ file, line: node.line, message: 'Unterminated ``` expression block' })
        const strip = closeDepth >= 0 ? closeDepth : depth + (objectStyle ? 2 : 1)
        const content = body.map((l) => stripTabs(l, strip))
        if (after.trim()) content.unshift(after)
        node.value = content.join('\n')
        node.fenced = true
        node.multiline = true
        node.exprStyle = objectStyle ? 'object' : 'property'
      } else if (first.trim() !== '') {
        // single line, possibly with deeper continuation lines (hand-written TMDL)
        const threshold = objectStyle ? depth + 2 : depth + 1
        const cont = collect(lines, i, (l) => tabs(l) >= threshold)
        if (cont.length) {
          node.value = [first, ...cont.map((l) => stripTabs(l, threshold))].join('\n')
          node.raw.push(...cont)
          i += cont.length
          node.multiline = true
        }
        node.exprStyle = objectStyle ? 'object' : 'property'
      } else {
        // multi-line expression on the following lines
        let style: 'object' | 'property'
        if (PROPERTY_EXPR_KEYWORDS.has(node.keyword)) style = 'property'
        else if (objectStyle) style = 'object'
        else {
          // unknown keyword: decide from the indentation of the first content line
          let j = i
          while (j < lines.length && isBlank(lines[j])) j++
          style = j < lines.length && tabs(lines[j]) >= depth + 2 ? 'object' : 'property'
        }
        const endAt = style === 'object' ? depth + 1 : depth
        const strip = style === 'object' ? depth + 2 : depth + 1
        const body = collect(lines, i, (l) => tabs(l) > endAt)
        node.raw.push(...body)
        i += body.length
        node.value = body.map((l) => stripTabs(l, strip)).join('\n')
        node.multiline = true
        node.exprStyle = style
      }
    }

    node.end = node.start + node.raw.length - 1
    parent.children.push(node)
    stack.push(node)
  }
  const fixEnd = (n: TmdlNode): number => {
    for (const c of n.children) n.end = Math.max(n.end, fixEnd(c))
    return n.end
  }
  for (const n of root.children) fixEnd(n)
  if (desc.length) errors.push({ file, line: lines.length, message: 'Description (///) not followed by a declaration' })
  return { nodes: root.children, errors, lines }
}

/** Exact source text of a node including its children (no trailing blank lines). */
export function nodeSource(doc: TmdlDocument, node: TmdlNode): string[] {
  return doc.lines.slice(node.start, node.end + 1)
}

/** Lines from `start` while blank or matching `deeper`; trailing blank lines excluded. */
function collect(lines: string[], start: number, deeper: (l: string) => boolean): string[] {
  let end = start
  let lastContent = start - 1
  while (end < lines.length) {
    const l = lines[end]
    if (isBlank(l)) {
      end++
      continue
    }
    if (!deeper(l)) break
    lastContent = end
    end++
  }
  return lines.slice(start, lastContent + 1)
}

function parseDecl(content: string, depth: number, line: number, file: string | undefined, errors: TmdlError[]): TmdlNode {
  const node: TmdlNode = { keyword: '', children: [], depth, line, raw: [], start: line - 1, end: line - 1 }
  const m = KEYWORD.exec(content)
  if (!m) {
    errors.push({ file, line, message: `Cannot parse line: ${content.slice(0, 60)}` })
    node.keyword = '#invalid'
    node.value = content
    return node
  }
  node.keyword = m[0]
  let rest = content.slice(m[0].length)
  if (rest === '' || rest.trim() === '') return node
  if (rest.startsWith(':')) {
    node.sep = ':'
    node.value = rest.slice(1).replace(/^ /, '')
    return node
  }
  if (/^\s*=/.test(rest)) {
    node.sep = '='
    node.value = rest.replace(/^\s*=/, '').replace(/^ /, '')
    return node
  }
  rest = rest.trimStart()
  if (node.keyword === 'ref') {
    const rm = KEYWORD.exec(rest)
    if (rm) {
      node.refType = rm[0]
      rest = rest.slice(rm[0].length).trimStart()
    }
  }
  const { name, rest: after } = readNameToken(rest)
  node.name = name
  const r = after.trimStart()
  if (r.startsWith('=')) {
    node.sep = '='
    node.value = r.slice(1).replace(/^ /, '')
  } else if (r.startsWith(':')) {
    node.sep = ':'
    node.value = r.slice(1).replace(/^ /, '')
  } else if (r !== '') {
    errors.push({ file, line, message: `Unexpected text after name: ${r.slice(0, 40)}` })
  }
  return node
}

function readNameToken(s: string): { name: string; rest: string } {
  if (s.startsWith("'")) {
    let out = ''
    let i = 1
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        return { name: out, rest: s.slice(i + 1) }
      }
      out += s[i++]
    }
    return { name: out, rest: '' }
  }
  const m = /^[^\s=]+/.exec(s)
  return m ? { name: m[0], rest: s.slice(m[0].length) } : { name: '', rest: s }
}
