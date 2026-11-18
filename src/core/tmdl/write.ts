/**
 * SemanticModel -> TMDL folder (Power BI Desktop canonical style).
 *
 * Layout written (relative to the `definition/` folder):
 *   database.tmdl, model.tmdl, relationships.tmdl, expressions.tmdl, tables/<T>.tmdl,
 *   roles/<R>.tmdl, perspectives/<P>.tmdl, cultures/<C>.tmdl, plus preserved unknown files.
 *
 * Style: TAB indentation; properties in TOM order; every child object preceded by one blank line;
 * every top-level object followed by one blank line; expressions single-line when possible,
 * otherwise on the following lines indented two levels below the declaring object (one level for
 * plain expression properties such as `pollingExpression`), fenced with ``` when the text has
 * trailing whitespace or ends with a line break.
 *
 * Formatting hints captured at parse time (see hints.ts) make unmodified objects byte-identical.
 */
import type {
  CalculationGroupDef,
  CalculationItemDef,
  ColumnDef,
  CultureDef,
  HierarchyDef,
  HierarchyLevelDef,
  MeasureDef,
  NamedExpressionDef,
  PartitionDef,
  PerspectiveDef,
  RelationshipDef,
  RoleDef,
  SemanticModel,
  TableDef
} from '../model/types'
import { getHint, type ObjHint } from './hints'
import { encodeTextValue, fileSafeName, qualifiedName, quoteName } from './names'

export interface Entry {
  key: string
  /** child object (blank line before) vs property */
  child: boolean
  /** child written without a blank line before it (dataAccessOptions, partition source) */
  inline?: boolean
  group: string
  lines: string[]
  /** leaf entries can be substituted by their original source lines */
  leaf: boolean
  refType?: string
}

/** Generic TMDL node kept in `extra['@children']` for child objects we do not model. */
export interface TmdlGenericNode {
  keyword: string
  name?: string
  sep?: ':' | '='
  value?: string
  exprStyle?: 'object' | 'property'
  description?: string
  children?: TmdlGenericNode[]
}

/** Expression-valued unknown property kept in `extra`. */
export interface TmdlExtraExpr {
  $tmdlExpr: string
  style: 'object' | 'property'
}

export function isExtraExpr(v: unknown): v is TmdlExtraExpr {
  return !!v && typeof v === 'object' && typeof (v as TmdlExtraExpr).$tmdlExpr === 'string'
}

const tab = (n: number): string => '\t'.repeat(n)

export function needsFence(expr: string): boolean {
  if (expr.endsWith('\n')) return true
  const lines = expr.split('\n')
  if (lines.some((l) => /[ \t]$/.test(l))) return true
  // a multi-line text whose every non-empty line is indented would lose that indentation unfenced
  const content = lines.filter((l) => l !== '')
  return lines.length > 1 && content.length > 0 && content.every((l) => /^[ \t]/.test(l))
}

/** Declaration line(s) for `<prefix> = <expression>` with content at `contentDepth`. */
export function exprBlock(prefix: string, expr: string, contentDepth: number): string[] {
  // TMDL files use LF; expressions decoded from PBIX DataModels may carry CRLF
  if (expr.includes('\r')) expr = expr.replace(/\r\n?/g, '\n')
  const fence = needsFence(expr)
  if (!fence && !expr.includes('\n')) return expr === '' ? [`${prefix} =`] : [`${prefix} = ${expr}`]
  const ind = tab(contentDepth)
  const body = expr.split('\n').map((l) => ind + l)
  if (fence) return [`${prefix} = \`\`\``, ...body, `${ind}\`\`\``]
  return [`${prefix} =`, ...body]
}

function descLines(d: number, desc?: string): string[] {
  if (desc === undefined) return []
  return desc.split('\n').map((l) => (l === '' ? `${tab(d)}///` : `${tab(d)}/// ${l}`))
}

// ---------------------------------------------------------------------------------------------
// Entry builders
// ---------------------------------------------------------------------------------------------

class Props {
  readonly map = new Map<string, Entry>()
  constructor(private readonly depth: number) {}
  text(key: string, v: string | undefined, encode = true): this {
    if (v !== undefined) this.map.set(key, leafProp(key, [`${tab(this.depth)}${key}: ${encode ? encodeTextValue(v) : v}`]))
    return this
  }
  raw(key: string, v: string | number | undefined): this {
    if (v !== undefined) this.map.set(key, leafProp(key, [`${tab(this.depth)}${key}: ${v}`]))
    return this
  }
  flag(key: string, v: boolean | undefined, defaultValue = false): this {
    if (v === undefined || v === defaultValue) return this
    this.map.set(key, leafProp(key, [v ? `${tab(this.depth)}${key}` : `${tab(this.depth)}${key}: false`]))
    return this
  }
  expr(key: string, v: string | undefined, style: 'object' | 'property' = 'property'): this {
    if (v !== undefined) this.map.set(key, leafProp(key, exprBlock(`${tab(this.depth)}${key}`, v, this.depth + (style === 'object' ? 2 : 1))))
    return this
  }
  entry(e: Entry): this {
    this.map.set(e.key, e)
    return this
  }
  extras(extra: Record<string, unknown> | undefined, skip: (k: string) => boolean = () => false): this {
    if (!extra) return this
    for (const [k, v] of Object.entries(extra)) {
      if (k.startsWith('@') || skip(k) || this.map.has(k)) continue
      if (v === true) this.map.set(k, leafProp(k, [`${tab(this.depth)}${k}`]))
      else if (typeof v === 'string') this.map.set(k, leafProp(k, [`${tab(this.depth)}${k}: ${v}`]))
      else if (typeof v === 'number' || v === false) this.map.set(k, leafProp(k, [`${tab(this.depth)}${k}: ${String(v)}`]))
      else if (isExtraExpr(v)) this.map.set(k, leafProp(k, exprBlock(`${tab(this.depth)}${k}`, v.$tmdlExpr, this.depth + (v.style === 'object' ? 2 : 1))))
      // structured values coming from model.bim have no TMDL property form: dropped (reported by the caller)
    }
    return this
  }
  ordered(order: readonly string[]): Entry[] {
    const out: Entry[] = []
    for (const k of order) {
      const e = this.map.get(k)
      if (e) out.push(e)
    }
    for (const [k, e] of this.map) if (!order.includes(k)) out.push(e)
    return out
  }
}

function leafProp(key: string, lines: string[]): Entry {
  return { key, child: false, group: 'prop', lines, leaf: true }
}

function leafChild(key: string, group: string, lines: string[], inline = false): Entry {
  return { key, child: true, inline, group, lines, leaf: true }
}

function annotationEntries(d: number, ann: Record<string, string> | undefined): Entry[] {
  if (!ann) return []
  return Object.entries(ann).map(([k, v]) => leafChild(`annotation:${k}`, 'annotation', exprBlock(`${tab(d)}annotation ${quoteName(k)}`, v, d + 2)))
}

function changedPropertyEntries(d: number, cp: string[] | undefined): Entry[] {
  return (cp ?? []).map((p) => leafChild(`changedProperty:${p}`, 'changedProperty', [`${tab(d)}changedProperty = ${p}`]))
}

function extendedPropertyEntries(d: number, ep: Record<string, unknown> | undefined): Entry[] {
  if (!ep) return []
  return Object.entries(ep).map(([k, v]) => {
    const text =
      v && typeof v === 'object' && typeof (v as { $tmdlRaw?: unknown }).$tmdlRaw === 'string' ? (v as { $tmdlRaw: string }).$tmdlRaw : JSON.stringify(v, null, 2)
    return leafChild(`extendedProperty:${k}`, 'extendedProperty', exprBlock(`${tab(d)}extendedProperty ${quoteName(k)}`, text, d + 2))
  })
}

export function genericLines(n: TmdlGenericNode, d: number): string[] {
  const out = descLines(d, n.description)
  let head = `${tab(d)}${n.keyword}`
  if (n.name !== undefined) head += ` ${quoteName(n.name)}`
  if (n.sep === ':') out.push(`${head}: ${n.value ?? ''}`)
  else if (n.sep === '=') out.push(...exprBlock(head, n.value ?? '', d + (n.exprStyle === 'property' ? 1 : 2)))
  else out.push(head)
  for (const c of n.children ?? []) {
    const isObj = c.name !== undefined || (c.children?.length ?? 0) > 0
    if (isObj) out.push('')
    out.push(...genericLines(c, d + 1))
  }
  return out
}

function genericChildEntries(d: number, extra: Record<string, unknown> | undefined): Entry[] {
  const nodes = extra?.['@children'] as TmdlGenericNode[] | undefined
  if (!Array.isArray(nodes)) return []
  return nodes.map((n, i) => leafChild(genericKey(n, i), '@child', genericLines(n, d), isInlineKeyword(n.keyword)))
}

export function genericKey(n: { keyword: string; name?: string }, i: number): string {
  return `@${n.keyword}:${n.name ?? '#' + i}`
}

/** Child objects Power BI writes directly below the properties, without a blank line. */
export function isInlineKeyword(k: string): boolean {
  return k === 'dataAccessOptions' || k === 'source'
}

function childObj(key: string, group: string, lines: string[]): Entry {
  return { key, child: true, group, lines, leaf: false }
}

// ---------------------------------------------------------------------------------------------
// Emitter: canonical entries + hints -> lines
// ---------------------------------------------------------------------------------------------

export class Emitter {
  readonly diagnostics: string[] = []
  constructor(readonly capture = false) {}

  emit(obj: object | undefined, header: string[], entries: Entry[]): string[] {
    const h = obj ? getHint(obj) : undefined
    if (this.capture) {
      if (h) {
        h.headerCanon = header.join('\n')
        const byKey = new Map(entries.map((e) => [e.key, e]))
        for (const k of h.keys) {
          if (!h.raw.has(k)) continue
          const e = byKey.get(k)
          h.canon.set(k, e ? e.lines.join('\n') : null)
        }
      }
      return layout(header, entries)
    }
    if (!h) return layout(header, entries)
    const head = h.header && h.headerCanon === header.join('\n') ? h.header : header
    const merged = merge(entries, h).map((e) => {
      if (!e.leaf) return e
      const canon = h.canon.get(e.key)
      const raw = h.raw.get(e.key)
      if (raw && canon !== undefined && canon === e.lines.join('\n')) return { ...e, lines: raw }
      return e
    })
    return layout(head, merged)
  }
}

function layout(header: string[], entries: Entry[]): string[] {
  const out = [...header]
  let prev: Entry | undefined
  for (const e of entries) {
    const sameRefRun = e.group === 'ref' && prev?.group === 'ref' && prev.refType === e.refType
    if (e.child && !e.inline && !sameRefRun) out.push('')
    out.push(...e.lines)
    prev = e
  }
  return out
}

function merge(entries: Entry[], h: ObjHint): Entry[] {
  const byKey = new Map(entries.map((e) => [e.key, e]))
  const out: Entry[] = []
  const used = new Set<string>()
  for (const k of h.keys) {
    const e = byKey.get(k)
    if (e) {
      if (!used.has(k)) out.push(e)
      used.add(k)
    } else if (h.canon.get(k) === null && h.raw.has(k)) {
      // present in the source although the serializer would omit it (explicit default value)
      out.push({ key: k, child: h.child.has(k), group: h.group.get(k) ?? 'prop', lines: h.raw.get(k)!, leaf: false, inline: isInlineKeyword(k) })
    }
  }
  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx]
    if (used.has(e.key)) continue
    let pos = -1
    for (let p = idx - 1; p >= 0 && pos < 0; p--) pos = out.indexOf(entries[p])
    if (pos >= 0) out.splice(pos + 1, 0, e)
    else {
      let ins = out.length
      for (let n = idx + 1; n < entries.length; n++) {
        const q = out.indexOf(entries[n])
        if (q >= 0) {
          ins = q
          break
        }
      }
      out.splice(ins, 0, e)
    }
    used.add(e.key)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Object generators
// ---------------------------------------------------------------------------------------------

const TABLE_ORDER = ['isHidden', 'isPrivate', 'showAsVariationsOnly', 'lineageTag', 'sourceLineageTag', 'dataCategory'] as const
const COLUMN_ORDER = [
  'dataType',
  'isHidden',
  'isUnique',
  'isKey',
  'isNullable',
  'isAvailableInMdx',
  'formatString',
  'displayFolder',
  'lineageTag',
  'sourceLineageTag',
  'dataCategory',
  'summarizeBy',
  'isNameInferred',
  'isDataTypeInferred',
  'sourceColumn',
  'sortByColumn'
] as const
const MEASURE_ORDER = ['dataType', 'isHidden', 'formatString', 'displayFolder', 'lineageTag', 'sourceLineageTag', 'dataCategory'] as const
const RELATIONSHIP_ORDER = [
  'isActive',
  'crossFilteringBehavior',
  'joinOnDateBehavior',
  'relyOnReferentialIntegrity',
  'securityFilteringBehavior',
  'fromCardinality',
  'toCardinality',
  'fromColumn',
  'toColumn'
] as const
const REFRESH_POLICY_ORDER = [
  'policyType',
  'rollingWindowGranularity',
  'rollingWindowPeriods',
  'incrementalGranularity',
  'incrementalPeriods',
  'incrementalPeriodsOffset',
  'mode',
  'pollingExpression',
  'sourceExpression'
]
const REFRESH_POLICY_EXPRS = new Set(['pollingExpression', 'sourceExpression'])

const CHILD_ORDER: Record<string, string[]> = {
  table: ['calculationGroup', 'refreshPolicy', 'measure', 'column', 'hierarchy', 'partition', '@child', 'changedProperty', 'extendedProperty', 'annotation'],
  column: ['@child', 'variation', 'changedProperty', 'extendedProperty', 'annotation'],
  measure: ['kpi', 'formatStringDefinition', 'detailRowsDefinition', '@child', 'changedProperty', 'extendedProperty', 'annotation']
}

function sortChildren(kind: string, entries: Entry[]): Entry[] {
  const order = CHILD_ORDER[kind]
  if (!order) return entries
  const rank = (g: string): number => {
    const i = order.indexOf(g)
    return i < 0 ? order.length : i
  }
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.group) - rank(b.e.group) || a.i - b.i)
    .map((x) => x.e)
}

export function columnLines(em: Emitter, c: ColumnDef, d: number): string[] {
  const head = `${tab(d)}column ${quoteName(c.name)}`
  const header = [...descLines(d, c.description), ...(c.kind === 'calculated' && c.expression !== undefined ? exprBlock(head, c.expression, d + 2) : [head])]
  const p = new Props(d + 1)
  if (c.dataType !== 'unknown') p.raw('dataType', c.dataType)
  p.flag('isHidden', c.isHidden)
    .flag('isKey', c.isKey)
    .flag('isNullable', c.isNullable, true)
    .flag('isAvailableInMdx', c.isAvailableInMdx, true)
    .text('formatString', c.formatString)
    .text('displayFolder', c.displayFolder)
    .raw('lineageTag', c.lineageTag)
    .raw('sourceLineageTag', c.sourceLineageTag)
    .raw('dataCategory', c.dataCategory)
    .raw('summarizeBy', c.summarizeBy)
    .text('sourceColumn', c.kind === 'calculated' ? undefined : c.sourceColumn)
  if (c.sortByColumn !== undefined) p.raw('sortByColumn', quoteName(c.sortByColumn))
  p.extras(c.extra)
  const children: Entry[] = [
    ...genericChildEntries(d + 1, c.extra),
    ...(c.variations ?? []).map((v) => {
      const vp = new Props(d + 2)
        .flag('isDefault', v.isDefault)
        .raw('relationship', quoteName(v.relationship))
        .raw('defaultHierarchy', v.defaultHierarchy)
      return leafChild(`variation:${v.name}`, 'variation', [`${tab(d + 1)}variation ${quoteName(v.name)}`, ...vp.ordered([]).flatMap((e) => e.lines)])
    }),
    ...changedPropertyEntries(d + 1, c.changedProperties),
    ...extendedPropertyEntries(d + 1, c.extendedProperties),
    ...annotationEntries(d + 1, c.annotations)
  ]
  return em.emit(c, header, [...p.ordered(COLUMN_ORDER), ...sortChildren('column', children)])
}

export function measureLines(em: Emitter, m: MeasureDef, d: number): string[] {
  const header = [...descLines(d, m.description), ...exprBlock(`${tab(d)}measure ${quoteName(m.name)}`, m.expression, d + 2)]
  const p = new Props(d + 1)
  if (m.dataType !== undefined && m.dataType !== 'unknown') p.raw('dataType', m.dataType)
  p.flag('isHidden', m.isHidden).text('formatString', m.formatString).text('displayFolder', m.displayFolder).raw('lineageTag', m.lineageTag)
  p.extras(m.extra)
  const children: Entry[] = []
  if (m.kpi) {
    const kp = new Props(d + 2)
      .expr('targetExpression', m.kpi.targetExpression)
      .expr('statusExpression', m.kpi.statusExpression)
      .expr('trendExpression', m.kpi.trendExpression)
      .text('statusGraphic', m.kpi.statusGraphic)
      .text('trendGraphic', m.kpi.trendGraphic)
      .extras(m.kpi.extra)
    children.push(leafChild('kpi', 'kpi', [`${tab(d + 1)}kpi`, ...kp.ordered([]).flatMap((e) => e.lines)]))
  }
  if (m.formatStringDefinition)
    children.push(leafChild('formatStringDefinition', 'formatStringDefinition', exprBlock(`${tab(d + 1)}formatStringDefinition`, m.formatStringDefinition.expression, d + 3)))
  if (m.detailRowsDefinition !== undefined)
    children.push(leafChild('detailRowsDefinition', 'detailRowsDefinition', exprBlock(`${tab(d + 1)}detailRowsDefinition`, m.detailRowsDefinition, d + 3)))
  children.push(...genericChildEntries(d + 1, m.extra), ...changedPropertyEntries(d + 1, m.changedProperties), ...annotationEntries(d + 1, m.annotations))
  return em.emit(m, header, [...p.ordered(MEASURE_ORDER), ...sortChildren('measure', children)])
}

function levelLines(em: Emitter, l: HierarchyLevelDef, d: number): string[] {
  const p = new Props(d + 1).raw('lineageTag', l.lineageTag).raw('column', quoteName(l.column)).extras(l.extra)
  return em.emit(l, [`${tab(d)}level ${quoteName(l.name)}`], [...p.ordered(['lineageTag', 'column']), ...annotationEntries(d + 1, l.annotations)])
}

function hierarchyLines(em: Emitter, h: HierarchyDef, d: number): string[] {
  const p = new Props(d + 1).flag('isHidden', h.isHidden).text('displayFolder', h.displayFolder).raw('lineageTag', h.lineageTag).extras(h.extra)
  const desc = typeof h.extra?.['@description'] === 'string' ? (h.extra['@description'] as string) : undefined
  const children = [
    ...[...h.levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => childObj(`level:${l.name}`, 'level', levelLines(em, l, d + 1))),
    ...genericChildEntries(d + 1, h.extra),
    ...annotationEntries(d + 1, h.annotations)
  ]
  return em.emit(h, [...descLines(d, desc), `${tab(d)}hierarchy ${quoteName(h.name)}`], [...p.ordered(['isHidden', 'displayFolder', 'lineageTag']), ...children])
}

function partitionLines(em: Emitter, pt: PartitionDef, d: number): string[] {
  const sourceType = pt.sourceType === 'unknown' ? String(pt.extra?.['@sourceType'] ?? 'm') : pt.sourceType
  const desc = typeof pt.extra?.['@description'] === 'string' ? (pt.extra['@description'] as string) : undefined
  const header = [...descLines(d, desc), `${tab(d)}partition ${quoteName(pt.name)} = ${sourceType}`]
  const p = new Props(d + 1).raw('mode', pt.mode)
  if (pt.queryGroup !== undefined) p.raw('queryGroup', quoteName(pt.queryGroup))
  p.extras(pt.extra, (k) => k.startsWith('source.'))
  // source sub-object
  const srcExtra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(pt.extra ?? {})) if (k.startsWith('source.')) srcExtra[k.slice(7)] = v
  const hasSrcProps = pt.entityName !== undefined || pt.schemaName !== undefined || pt.expressionSource !== undefined || Object.keys(srcExtra).length > 0
  if (pt.expression !== undefined || hasSrcProps) {
    const head = `${tab(d + 1)}source`
    const lines = pt.expression !== undefined ? exprBlock(head, pt.expression, d + 3) : [head]
    const sp = new Props(d + 2).text('entityName', pt.entityName).text('schemaName', pt.schemaName)
    if (pt.expressionSource !== undefined) sp.raw('expressionSource', quoteName(pt.expressionSource))
    sp.extras(srcExtra)
    lines.push(...sp.ordered(['entityName', 'schemaName', 'expressionSource']).flatMap((e) => e.lines))
    for (const g of (pt.extra?.['@sourceChildren'] as TmdlGenericNode[] | undefined) ?? []) lines.push('', ...genericLines(g, d + 2))
    p.entry({ key: 'source', child: false, group: 'prop', lines, leaf: true })
  }
  const children = [...genericChildEntries(d + 1, pt.extra), ...annotationEntries(d + 1, pt.annotations)]
  return em.emit(pt, header, [...p.ordered(['mode', 'queryGroup', 'dataView', 'source']), ...children])
}

function calcItemLines(em: Emitter, ci: CalculationItemDef, d: number): string[] {
  const header = [...descLines(d, ci.description), ...exprBlock(`${tab(d)}calculationItem ${quoteName(ci.name)}`, ci.expression, d + 2)]
  const p = new Props(d + 1)
  p.raw('ordinal', ci.ordinal)
  p.extras(ci.extra)
  const children: Entry[] = []
  if (ci.formatStringDefinition)
    children.push(leafChild('formatStringDefinition', 'formatStringDefinition', exprBlock(`${tab(d + 1)}formatStringDefinition`, ci.formatStringDefinition.expression, d + 3)))
  children.push(...genericChildEntries(d + 1, ci.extra))
  return em.emit(ci, header, [...p.ordered(['ordinal']), ...children])
}

function calcGroupLines(em: Emitter, cg: CalculationGroupDef, d: number): string[] {
  const p = new Props(d + 1).raw('precedence', cg.precedence).extras(cg.extra)
  const children: Entry[] = cg.items.map((ci) => childObj(`calculationItem:${ci.name}`, 'calculationItem', calcItemLines(em, ci, d + 1)))
  if (cg.noSelectionExpression !== undefined)
    children.push(leafChild('noSelectionExpression', 'noSelectionExpression', exprBlock(`${tab(d + 1)}noSelectionExpression`, cg.noSelectionExpression, d + 3)))
  if (cg.multipleOrEmptySelectionExpression !== undefined)
    children.push(
      leafChild('multipleOrEmptySelectionExpression', 'multipleOrEmptySelectionExpression', exprBlock(`${tab(d + 1)}multipleOrEmptySelectionExpression`, cg.multipleOrEmptySelectionExpression, d + 3))
    )
  children.push(...genericChildEntries(d + 1, cg.extra))
  return em.emit(cg, [`${tab(d)}calculationGroup`], [...p.ordered(['precedence']), ...children])
}

function refreshPolicyLines(rp: Record<string, unknown>, d: number): string[] {
  const p = new Props(d + 1)
  for (const [k, v] of Object.entries(rp)) {
    if (REFRESH_POLICY_EXPRS.has(k) && typeof v === 'string') p.expr(k, v)
    else if (typeof v === 'string' || typeof v === 'number') p.raw(k, v)
    else if (typeof v === 'boolean') p.flag(k, v)
  }
  return [`${tab(d)}refreshPolicy`, ...p.ordered(REFRESH_POLICY_ORDER).flatMap((e) => e.lines)]
}

export function tableLines(em: Emitter, t: TableDef): string[] {
  const header = [...descLines(0, t.description), `table ${quoteName(t.name)}`]
  const p = new Props(1)
    .flag('isHidden', t.isHidden)
    .flag('isPrivate', t.isPrivate)
    .flag('showAsVariationsOnly', t.showAsVariationsOnly)
    .raw('lineageTag', t.lineageTag)
    .raw('sourceLineageTag', t.sourceLineageTag)
    .raw('dataCategory', t.dataCategory)
    .extras(t.extra)
  const children: Entry[] = []
  if (t.calculationGroup) children.push(childObj('calculationGroup', 'calculationGroup', calcGroupLines(em, t.calculationGroup, 1)))
  if (t.refreshPolicy) children.push(leafChild('refreshPolicy', 'refreshPolicy', refreshPolicyLines(t.refreshPolicy, 1)))
  for (const m of t.measures) children.push(childObj(`measure:${m.name}`, 'measure', measureLines(em, m, 1)))
  for (const c of t.columns) if (c.kind !== 'rowNumber') children.push(childObj(`column:${c.name}`, 'column', columnLines(em, c, 1)))
  for (const h of t.hierarchies) children.push(childObj(`hierarchy:${h.name}`, 'hierarchy', hierarchyLines(em, h, 1)))
  for (const pt of t.partitions) children.push(childObj(`partition:${pt.name}`, 'partition', partitionLines(em, pt, 1)))
  children.push(...genericChildEntries(1, t.extra), ...changedPropertyEntries(1, t.changedProperties), ...annotationEntries(1, t.annotations))
  return em.emit(t, header, [...p.ordered(TABLE_ORDER), ...sortChildren('table', children)])
}

export function relationshipLines(em: Emitter, r: RelationshipDef): string[] {
  const p = new Props(1)
    .flag('isActive', r.isActive, true)
    .raw('crossFilteringBehavior', r.crossFilteringBehavior === 'oneDirection' ? undefined : r.crossFilteringBehavior)
    .raw('joinOnDateBehavior', r.joinOnDateBehavior)
    .flag('relyOnReferentialIntegrity', r.relyOnReferentialIntegrity)
    .raw('securityFilteringBehavior', r.securityFilteringBehavior)
    .raw('fromCardinality', r.fromCardinality === 'many' ? undefined : r.fromCardinality)
    .raw('toCardinality', r.toCardinality === 'one' ? undefined : r.toCardinality)
    .raw('fromColumn', qualifiedName(r.fromTable, r.fromColumn))
    .raw('toColumn', qualifiedName(r.toTable, r.toColumn))
    .extras(r.extra)
  return em.emit(r, [`relationship ${quoteName(r.name)}`], [...p.ordered(RELATIONSHIP_ORDER), ...genericChildEntries(1, r.extra), ...annotationEntries(1, r.annotations)])
}

export function expressionLines(em: Emitter, e: NamedExpressionDef): string[] {
  const header = [...descLines(0, e.description), ...exprBlock(`expression ${quoteName(e.name)}`, e.expression, 2)]
  const p = new Props(1)
  if (e.kind !== 'm') p.raw('kind', e.kind)
  p.raw('lineageTag', e.lineageTag)
  if (e.queryGroup !== undefined) p.raw('queryGroup', quoteName(e.queryGroup))
  p.extras(e.extra)
  return em.emit(e, header, [...p.ordered(['kind', 'lineageTag', 'queryGroup']), ...genericChildEntries(1, e.extra), ...annotationEntries(1, e.annotations)])
}

export function roleLines(em: Emitter, r: RoleDef): string[] {
  const desc = typeof r.extra?.['@description'] === 'string' ? (r.extra['@description'] as string) : undefined
  const p = new Props(1).raw('modelPermission', r.modelPermission).extras(r.extra)
  const children: Entry[] = []
  for (const m of r.members ?? []) children.push(leafChild(`member:${m}`, 'member', [`\tmember ${quoteName(m)}`]))
  for (const tp of r.tablePermissions) {
    const head = `\ttablePermission ${quoteName(tp.table)}`
    const lines = tp.filterExpression !== undefined ? exprBlock(head, tp.filterExpression, 3) : [head]
    const tpp = new Props(2).extras(tp.extra)
    lines.push(...tpp.ordered([]).flatMap((e) => e.lines))
    for (const g of (tp.extra?.['@children'] as TmdlGenericNode[] | undefined) ?? []) lines.push('', ...genericLines(g, 2))
    children.push(leafChild(`tablePermission:${tp.table}`, 'tablePermission', lines))
  }
  children.push(...genericChildEntries(1, r.extra), ...annotationEntries(1, r.annotations))
  return em.emit(r, [...descLines(0, desc), `role ${quoteName(r.name)}`], [...p.ordered(['modelPermission']), ...children])
}

function perspectiveText(p: PerspectiveDef): string {
  const raw = p.extra?.tmdl
  if (typeof raw === 'string') return raw
  return `perspective ${quoteName(p.name)}\n\n`
}

function cultureText(c: CultureDef): string {
  if (typeof c.raw === 'string') return c.raw
  const lm = c.extra?.linguisticMetadata as { content?: unknown; contentType?: string } | undefined
  const lines = [`cultureInfo ${quoteName(c.name)}`]
  if (lm && lm.content !== undefined) {
    const text = typeof lm.content === 'string' ? lm.content : JSON.stringify(lm.content, null, 2)
    lines.push('', ...exprBlock('\tlinguisticMetadata', text, 3))
    lines.push(`\t\tcontentType: ${lm.contentType ?? 'json'}`)
  }
  return lines.join('\n') + '\n\n'
}

/** Database object kept in `model.extra['@database']`. */
export interface DatabaseInfo {
  name?: string
  extra?: Record<string, unknown>
}

function modelFile(em: Emitter, model: SemanticModel): string {
  const desc = typeof model.extra?.['@description'] === 'string' ? (model.extra['@description'] as string) : undefined
  const header = [...descLines(0, desc), `model ${quoteName(model.name)}`]
  const p = new Props(1)
    .raw('culture', model.culture)
    .raw('defaultPowerBIDataSourceVersion', model.defaultPowerBIDataSourceVersion)
    .flag('discourageImplicitMeasures', model.discourageImplicitMeasures)
    .raw('sourceQueryCulture', model.sourceQueryCulture)
    .extras(model.extra)
  if (model.dataAccessOptions) {
    const lines = ['\tdataAccessOptions', ...Object.entries(model.dataAccessOptions).map(([k, v]) => (v ? `\t\t${k}` : `\t\t${k}: false`))]
    p.entry({ key: 'dataAccessOptions', child: true, inline: true, group: 'dataAccessOptions', lines, leaf: true })
  }
  const children: Entry[] = []
  for (const qg of model.queryGroups ?? []) {
    const lines = em.emit(qg, [`queryGroup ${quoteName(qg.name)}`], annotationEntries(1, qg.annotations))
    children.push(childObj(`queryGroup:${qg.name}`, 'queryGroup', lines))
  }
  children.push(...annotationEntries(0, model.annotations))
  children.push(...genericChildEntries(0, model.extra))
  const ref = (refType: string, name: string): Entry => ({ key: `ref:${refType}:${name}`, child: true, group: 'ref', refType, lines: [`ref ${refType} ${quoteName(name)}`], leaf: false })
  for (const t of model.tables) children.push(ref('table', t.name))
  const h = getHint(model)
  const hintedRefTypes = new Set((h?.keys ?? []).filter((k) => k.startsWith('ref:')).map((k) => k.split(':')[1]))
  if (hintedRefTypes.has('role')) for (const r of model.roles) children.push(ref('role', r.name))
  if (hintedRefTypes.has('perspective')) for (const x of model.perspectives ?? []) children.push(ref('perspective', x.name))
  for (const c of model.cultures ?? []) children.push(ref('cultureInfo', c.name))
  return em.emit(model, header, [...p.ordered(['culture', 'defaultPowerBIDataSourceVersion', 'discourageImplicitMeasures', 'sourceQueryCulture']), ...children]).join('\n') + '\n\n'
}

function databaseFile(em: Emitter, model: SemanticModel): string {
  const db = (model.extra?.['@database'] as DatabaseInfo | undefined) ?? {}
  const header = [db.name !== undefined ? `database ${quoteName(db.name)}` : 'database']
  const p = new Props(1).raw('compatibilityLevel', model.compatibilityLevel).extras(db.extra)
  return em.emit(db, header, p.ordered(['compatibilityLevel'])).join('\n') + '\n\n'
}

function block(lines: string[]): string {
  return lines.join('\n') + '\n\n'
}

/** Unknown top-level TMDL objects preserved verbatim: relative file -> raw blocks. */
export type TmdlRawFiles = Record<string, string[]>

/**
 * Serialize a model to TMDL files (paths relative to `definition/`).
 * @param capture internal: compute canonical texts for hints instead of producing output
 */
export function writeTmdlFiles(model: SemanticModel, capture = false): { files: Record<string, string>; diagnostics: string[] } {
  const em = new Emitter(capture)
  const files: Record<string, string> = {}
  files['database.tmdl'] = databaseFile(em, model)
  files['model.tmdl'] = modelFile(em, model)
  const used = new Set<string>()
  const uniquePath = (dir: string, name: string, hinted?: string): string => {
    let p = hinted ?? `${dir}/${fileSafeName(name)}.tmdl`
    let i = 2
    while (used.has(p.toLowerCase())) p = `${dir}/${fileSafeName(name)} (${i++}).tmdl`
    used.add(p.toLowerCase())
    return p
  }
  for (const t of model.tables) {
    const h = getHint(t)
    const hinted = h?.file && h.file.startsWith('tables/') && h.fileFor === t.name ? h.file : undefined
    files[uniquePath('tables', t.name, hinted)] = block(tableLines(em, t))
  }
  if (model.relationships.length) files['relationships.tmdl'] = model.relationships.map((r) => block(relationshipLines(em, r))).join('')
  if (model.expressions.length) files['expressions.tmdl'] = model.expressions.map((e) => block(expressionLines(em, e))).join('')
  for (const r of model.roles) {
    const h = getHint(r)
    files[uniquePath('roles', r.name, h?.file && h.fileFor === r.name ? h.file : undefined)] = block(roleLines(em, r))
  }
  for (const p of model.perspectives ?? []) files[uniquePath('perspectives', p.name)] = perspectiveText(p)
  for (const c of model.cultures ?? []) files[uniquePath('cultures', c.name)] = cultureText(c)
  const rawFiles = model.extra?.['@tmdlRaw'] as TmdlRawFiles | undefined
  for (const [file, blocks] of Object.entries(rawFiles ?? {})) files[file] = (files[file] ?? '') + blocks.map((b) => b + '\n\n').join('')
  const tails = getHint(model)?.fileTails
  if (tails && !capture) for (const [path, text] of Object.entries(files)) if (tails[path] !== undefined) files[path] = text.replace(/\s*$/, tails[path])
  for (const t of model.tables) {
    for (const c of t.columns) if (c.extra) reportDropped(em, `${t.name}[${c.name}]`, c.extra)
    for (const m of t.measures) if (m.extra) reportDropped(em, `${t.name}[${m.name}]`, m.extra)
    if (t.extra) reportDropped(em, t.name, t.extra)
  }
  return { files, diagnostics: em.diagnostics }
}

function reportDropped(em: Emitter, where: string, extra: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('@')) continue
    if (v !== null && typeof v === 'object' && !isExtraExpr(v)) em.diagnostics.push(`TMDL: property '${k}' of ${where} has no TMDL form and was not written`)
  }
}
