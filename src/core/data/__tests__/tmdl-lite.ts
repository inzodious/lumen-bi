/**
 * TEST-ONLY minimal TMDL + PBIR loader (the real reader lives in src/core/io and belongs to the
 * file-formats workstream). Reads a `*.SemanticModel/definition` folder into a SemanticModel and,
 * optionally, a `*.Report/definition` folder into a ReportDocument — just enough for the synthetic
 * data tests: tables, columns (dataType/kind/sourceColumn/isHidden/isKey/annotations), measures with
 * multi-line expressions, partitions (m / calculated / calculationGroup / entity + source text),
 * calculation groups, relationships, expressions, roles, dataCategory.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CalculationGroupDef,
  Cardinality,
  ColumnDef,
  CrossFilteringBehavior,
  DataType,
  MeasureDef,
  NamedExpressionDef,
  PartitionDef,
  RelationshipDef,
  RoleDef,
  SemanticModel,
  TableDef
} from '../../model/types'
import type { ReportDocument } from '../../report/types'
import { emptyDataStore } from '../../model/data'
import type { ProjectDocument } from '../../project'

interface TNode {
  keyword: string
  name: string
  /** text after ':' (property) or after '=' (expression, possibly multi-line) */
  value?: string
  isExpr: boolean
  children: TNode[]
}

function depthOf(line: string): number {
  let d = 0
  while (d < line.length && line[d] === '\t') d++
  return d
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'")
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).replace(/""/g, '"')
  return t
}

/** Index of the first `ch` outside single quotes. */
function indexOutsideQuotes(s: string, ch: string): number {
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") {
      if (inQ && s[i + 1] === "'") {
        i++
        continue
      }
      inQ = !inQ
    } else if (!inQ && s[i] === ch) return i
  }
  return -1
}

function dedent(lines: string[]): string {
  const nonBlank = lines.filter((l) => l.trim())
  const min = nonBlank.length ? Math.min(...nonBlank.map((l) => depthOf(l))) : 0
  return lines
    .map((l) => l.slice(Math.min(min, depthOf(l))))
    .join('\n')
    .replace(/\s+$/, '')
    .replace(/^\s*\n/, '')
}

export function parseTmdl(text: string): TNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  const parseBlock = (depth: number): TNode[] => {
    const out: TNode[] = []
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim() || line.trim().startsWith('///')) {
        i++
        continue
      }
      const d = depthOf(line)
      if (d < depth) break
      if (d > depth) {
        // stray deeper line (shouldn't happen) — skip
        i++
        continue
      }
      const content = line.slice(d)
      i++
      const node: TNode = { keyword: '', name: '', isExpr: false, children: [] }
      const sp = content.search(/[\s:=]/)
      node.keyword = sp < 0 ? content : content.slice(0, sp)
      let rest = sp < 0 ? '' : content.slice(sp)
      if (rest.startsWith(':')) {
        node.value = rest.slice(1).trim()
      } else {
        rest = rest.trim()
        const eq = indexOutsideQuotes(rest, '=')
        if (eq >= 0) {
          node.name = unquote(rest.slice(0, eq))
          node.isExpr = true
          let first = rest.slice(eq + 1).trim()
          if (first.startsWith('```')) {
            const body: string[] = []
            first = first.slice(3)
            if (first.trim()) body.push(first)
            while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++])
            i++ // closing fence
            node.value = dedent(body)
          } else {
            const body: string[] = []
            while (i < lines.length && (!lines[i].trim() || depthOf(lines[i]) >= depth + 2)) body.push(lines[i++])
            // trailing blank lines belong to nobody
            while (body.length && !body[body.length - 1].trim()) {
              body.pop()
              i--
            }
            const cont = dedent(body)
            node.value = [first, cont].filter((x) => x).join('\n')
          }
        } else node.name = unquote(rest)
      }
      node.children = parseBlock(depth + 1)
      out.push(node)
    }
    return out
  }
  return parseBlock(0)
}

const DATA_TYPES: Record<string, DataType> = {
  string: 'string',
  int64: 'int64',
  double: 'double',
  decimal: 'decimal',
  boolean: 'boolean',
  datetime: 'dateTime',
  binary: 'binary',
  variant: 'variant'
}

function prop(n: TNode, key: string): string | undefined {
  return n.children.find((c) => c.keyword === key && !c.isExpr)?.value
}

function flag(n: TNode, key: string): boolean {
  const c = n.children.find((x) => x.keyword === key)
  return !!c && (c.value === undefined || c.value === 'true')
}

function annotations(n: TNode): Record<string, string> | undefined {
  const a = n.children.filter((c) => c.keyword === 'annotation')
  if (!a.length) return undefined
  return Object.fromEntries(a.map((c) => [c.name, c.value ?? '']))
}

function splitColumnRef(ref: string): { table: string; column: string } {
  // 'tbl name'.'col' | tbl.col | 'tbl'.col
  let inQ = false
  let dot = -1
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === "'") {
      if (inQ && ref[i + 1] === "'") {
        i++
        continue
      }
      inQ = !inQ
    } else if (!inQ && ref[i] === '.') dot = i
  }
  return { table: unquote(ref.slice(0, dot)), column: unquote(ref.slice(dot + 1)) }
}

function readTable(n: TNode): TableDef {
  const partitions: PartitionDef[] = n.children
    .filter((c) => c.keyword === 'partition')
    .map((p) => {
      const kind = (p.value ?? '').trim()
      const src = p.children.find((c) => c.keyword === 'source')
      const sourceType: PartitionDef['sourceType'] =
        kind === 'm' || kind === 'calculated' || kind === 'entity' || kind === 'calculationGroup' || kind === 'policyRange' || kind === 'query' ? kind : 'unknown'
      return { name: p.name, sourceType, mode: prop(p, 'mode') as PartitionDef['mode'], expression: src?.value }
    })
  const isCalcTable = partitions.some((p) => p.sourceType === 'calculated')
  const columns: ColumnDef[] = n.children
    .filter((c) => c.keyword === 'column')
    .map((c) => {
      const dt = prop(c, 'dataType')
      const col: ColumnDef = {
        name: c.name,
        dataType: dt ? (DATA_TYPES[dt.toLowerCase()] ?? 'unknown') : c.isExpr ? 'unknown' : 'string',
        kind: c.isExpr ? 'calculated' : isCalcTable ? 'calculatedTableColumn' : 'data',
        expression: c.isExpr ? c.value : undefined,
        sourceColumn: prop(c, 'sourceColumn'),
        formatString: prop(c, 'formatString'),
        isHidden: flag(c, 'isHidden') || undefined,
        isKey: flag(c, 'isKey') || undefined,
        dataCategory: prop(c, 'dataCategory'),
        sortByColumn: prop(c, 'sortByColumn'),
        annotations: annotations(c)
      }
      return col
    })
  const measures: MeasureDef[] = n.children
    .filter((c) => c.keyword === 'measure')
    .map((m) => {
      const fsd = m.children.find((c) => c.keyword === 'formatStringDefinition')
      return {
        name: m.name,
        expression: m.value ?? '',
        formatString: prop(m, 'formatString'),
        formatStringDefinition: fsd?.value ? { expression: fsd.value } : undefined,
        displayFolder: prop(m, 'displayFolder'),
        isHidden: flag(m, 'isHidden') || undefined
      }
    })
  let calculationGroup: CalculationGroupDef | undefined
  const cg = n.children.find((c) => c.keyword === 'calculationGroup')
  if (cg) {
    calculationGroup = {
      precedence: prop(cg, 'precedence') ? Number(prop(cg, 'precedence')) : undefined,
      items: cg.children
        .filter((c) => c.keyword === 'calculationItem')
        .map((it, i) => {
          const fsd = it.children.find((c) => c.keyword === 'formatStringDefinition')
          return { name: it.name, expression: it.value ?? '', ordinal: i, formatStringDefinition: fsd?.value ? { expression: fsd.value } : undefined }
        })
    }
  }
  return {
    name: n.name,
    columns,
    measures,
    hierarchies: [],
    partitions,
    calculationGroup,
    isHidden: flag(n, 'isHidden') || undefined,
    dataCategory: prop(n, 'dataCategory'),
    annotations: annotations(n)
  }
}

function readRelationship(n: TNode): RelationshipDef | undefined {
  const from = prop(n, 'fromColumn')
  const to = prop(n, 'toColumn')
  if (!from || !to) return undefined
  const f = splitColumnRef(from)
  const t = splitColumnRef(to)
  return {
    name: n.name,
    fromTable: f.table,
    fromColumn: f.column,
    toTable: t.table,
    toColumn: t.column,
    fromCardinality: (prop(n, 'fromCardinality') as Cardinality) ?? 'many',
    toCardinality: (prop(n, 'toCardinality') as Cardinality) ?? 'one',
    crossFilteringBehavior: (prop(n, 'crossFilteringBehavior') as CrossFilteringBehavior) ?? 'oneDirection',
    isActive: prop(n, 'isActive') !== 'false',
    joinOnDateBehavior: prop(n, 'joinOnDateBehavior') as RelationshipDef['joinOnDateBehavior']
  }
}

function read(path: string): string {
  const s = readFileSync(path, 'utf8')
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Load `<X>.SemanticModel` (folder containing `definition/`) into a SemanticModel. */
export function loadTmdlModel(semanticModelDir: string): SemanticModel {
  const def = join(semanticModelDir, 'definition')
  const model: SemanticModel = { name: 'Model', tables: [], relationships: [], expressions: [], roles: [] }
  if (existsSync(join(def, 'model.tmdl'))) {
    for (const n of parseTmdl(read(join(def, 'model.tmdl')))) {
      if (n.keyword === 'model') {
        model.name = n.name || 'Model'
        model.culture = prop(n, 'culture')
      } else if (n.keyword === 'table') model.tables.push(readTable(n))
    }
  }
  const tablesDir = join(def, 'tables')
  if (existsSync(tablesDir)) {
    for (const f of readdirSync(tablesDir).sort()) {
      if (!f.endsWith('.tmdl')) continue
      for (const n of parseTmdl(read(join(tablesDir, f)))) if (n.keyword === 'table') model.tables.push(readTable(n))
    }
  }
  if (existsSync(join(def, 'relationships.tmdl'))) {
    for (const n of parseTmdl(read(join(def, 'relationships.tmdl')))) {
      if (n.keyword !== 'relationship') continue
      const r = readRelationship(n)
      if (r) model.relationships.push(r)
    }
  }
  if (existsSync(join(def, 'expressions.tmdl'))) {
    for (const n of parseTmdl(read(join(def, 'expressions.tmdl')))) {
      if (n.keyword !== 'expression') continue
      const e: NamedExpressionDef = { name: n.name, kind: 'm', expression: n.value ?? '' }
      model.expressions.push(e)
    }
  }
  const rolesDir = join(def, 'roles')
  if (existsSync(rolesDir)) {
    for (const f of readdirSync(rolesDir)) {
      for (const n of parseTmdl(read(join(rolesDir, f)))) {
        if (n.keyword !== 'role') continue
        const role: RoleDef = {
          name: n.name,
          tablePermissions: n.children.filter((c) => c.keyword === 'tablePermission').map((c) => ({ table: c.name, filterExpression: c.value }))
        }
        model.roles.push(role)
      }
    }
  }
  return model
}

function readJson(path: string): any {
  try {
    return JSON.parse(read(path))
  } catch {
    return undefined
  }
}

/** Load `<X>.Report` (PBIR) into a ReportDocument (JSON parts only, no resources). */
export function loadPbirReport(reportDir: string): ReportDocument | undefined {
  const def = join(reportDir, 'definition')
  if (!existsSync(join(def, 'report.json'))) return undefined
  const pagesDir = join(def, 'pages')
  const pagesMeta = readJson(join(pagesDir, 'pages.json')) ?? { pageOrder: [] }
  const pages: ReportDocument['pages'] = []
  if (existsSync(pagesDir)) {
    for (const p of readdirSync(pagesDir).sort()) {
      const pdir = join(pagesDir, p)
      if (!statSync(pdir).isDirectory()) continue
      const json = readJson(join(pdir, 'page.json'))
      if (!json) continue
      const visuals: ReportDocument['pages'][number]['visuals'] = []
      const vdir = join(pdir, 'visuals')
      if (existsSync(vdir)) {
        for (const v of readdirSync(vdir).sort()) {
          const vj = readJson(join(vdir, v, 'visual.json'))
          if (vj) visuals.push({ name: v, json: vj })
        }
      }
      pages.push({ name: p, json, visuals })
    }
  }
  const bookmarks: ReportDocument['bookmarks'] = []
  const bdir = join(def, 'bookmarks')
  if (existsSync(bdir)) {
    for (const b of readdirSync(bdir).sort()) {
      if (!b.endsWith('.bookmark.json')) continue
      const json = readJson(join(bdir, b))
      if (json) bookmarks.push({ name: b.replace(/\.bookmark\.json$/, ''), json })
    }
  }
  return {
    origin: 'pbir',
    report: readJson(join(def, 'report.json')) ?? {},
    pagesMeta,
    pages,
    bookmarks,
    reportExtensions: readJson(join(def, 'reportExtensions.json')),
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics: []
  }
}

/** Build a ProjectDocument from a `<X>.SemanticModel` dir (+ sibling `<X>.Report` when present). */
export function loadPbipLite(semanticModelDir: string): ProjectDocument {
  const model = loadTmdlModel(semanticModelDir)
  const reportDir = semanticModelDir.replace(/\.SemanticModel\/?$/, '.Report')
  const report = existsSync(reportDir) ? loadPbirReport(reportDir) : undefined
  const name = semanticModelDir.replace(/\/$/, '').split('/').pop()!.replace(/\.SemanticModel$/, '')
  return { id: name, name, source: { kind: 'pbip', modelPath: semanticModelDir, reportPath: report ? reportDir : undefined }, model, data: emptyDataStore(), report, diagnostics: [], dirty: false }
}
