/**
 * TMSL JSON (model.bim in PBIP, `DataModelSchema` in PBIT) <-> SemanticModel.
 *
 * The in-memory representation is TMDL-centric (see write.ts): objects the model types do not cover
 * live in `extra`; TMDL-only generic child nodes (`extra['@children']`) are translated for the few
 * kinds that have a TMSL equivalent (relatedColumnDetails) and otherwise reported as dropped.
 * Multi-line expressions are written as arrays of lines, like Power BI does in model.bim.
 */
import type {
  Annotations,
  CalculationGroupDef,
  ColumnDef,
  CultureDef,
  HierarchyDef,
  MeasureDef,
  NamedExpressionDef,
  PartitionDef,
  PerspectiveDef,
  RelationshipDef,
  RoleDef,
  SemanticModel,
  TableDef
} from '../model/types'
import { parseQualified, qualifiedName, quoteName, unquoteName } from './names'
import { parseTmdlText, type TmdlNode } from './parser'
import { isExtraExpr, type DatabaseInfo, type TmdlGenericNode } from './write'

export interface TmslReadResult {
  model: SemanticModel
  diagnostics: string[]
}

type J = Record<string, any>

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (Array.isArray(v)) return v.join('\n')
  return String(v)
}

function annotationsIn(list: unknown): Annotations | undefined {
  if (!Array.isArray(list) || !list.length) return undefined
  const out: Annotations = {}
  for (const a of list) if (a && typeof a.name === 'string') out[a.name] = str(a.value) ?? ''
  return out
}

function annotationsOut(a: Annotations | undefined): J[] | undefined {
  if (!a || !Object.keys(a).length) return undefined
  return Object.entries(a).map(([name, value]) => ({ name, value: exprOut(value) }))
}

function changedIn(list: unknown): string[] | undefined {
  if (!Array.isArray(list) || !list.length) return undefined
  return list.map((c) => String(c?.property ?? c))
}

function exprOut(v: string): string | string[] {
  return v.includes('\n') ? v.split('\n') : v
}

/** Copy keys of `src` not in `known` into extra. */
function rest(src: J, known: readonly string[], extra?: Record<string, unknown>): Record<string, unknown> | undefined {
  let out = extra
  for (const [k, v] of Object.entries(src)) {
    if (known.includes(k)) continue
    ;(out ??= {})[k] = v
  }
  return out
}

function setIf<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): void {
  if (v !== undefined) o[k] = v
}

// ---------------------------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------------------------

const COLUMN_KEYS = [
  'name',
  'type',
  'dataType',
  'expression',
  'sourceColumn',
  'formatString',
  'isHidden',
  'isKey',
  'isNullable',
  'isAvailableInMdx',
  'sortByColumn',
  'summarizeBy',
  'displayFolder',
  'dataCategory',
  'description',
  'lineageTag',
  'sourceLineageTag',
  'extendedProperties',
  'variations',
  'annotations',
  'changedProperties',
  'relatedColumnDetails'
] as const

function readColumn(c: J): ColumnDef {
  const kind = (c.type ?? 'data') as ColumnDef['kind']
  const col: ColumnDef = { name: c.name, dataType: c.dataType ?? 'unknown', kind }
  if (kind === 'calculated') col.expression = str(c.expression) ?? ''
  setIf(col, 'sourceColumn', c.sourceColumn)
  setIf(col, 'formatString', c.formatString)
  setIf(col, 'isHidden', c.isHidden)
  setIf(col, 'isKey', c.isKey)
  setIf(col, 'isNullable', c.isNullable)
  setIf(col, 'isAvailableInMdx', c.isAvailableInMdx)
  setIf(col, 'sortByColumn', c.sortByColumn)
  setIf(col, 'summarizeBy', c.summarizeBy)
  setIf(col, 'displayFolder', c.displayFolder)
  setIf(col, 'dataCategory', c.dataCategory)
  setIf(col, 'description', str(c.description))
  setIf(col, 'lineageTag', c.lineageTag)
  setIf(col, 'sourceLineageTag', c.sourceLineageTag)
  if (Array.isArray(c.extendedProperties) && c.extendedProperties.length) {
    col.extendedProperties = {}
    for (const ep of c.extendedProperties) col.extendedProperties[ep.name] = ep.value
  }
  if (Array.isArray(c.variations) && c.variations.length) {
    col.variations = c.variations.map((v: J) => {
      const out: NonNullable<ColumnDef['variations']>[number] = {
        name: v.name,
        relationship: v.relationship ?? '',
        defaultHierarchy: v.defaultHierarchy ? qualifiedName(v.defaultHierarchy.table ?? '', v.defaultHierarchy.hierarchy ?? '') : ''
      }
      if (v.isDefault !== undefined) out.isDefault = v.isDefault
      return out
    })
  }
  setIf(col, 'annotations', annotationsIn(c.annotations))
  setIf(col, 'changedProperties', changedIn(c.changedProperties))
  col.extra = rest(c, COLUMN_KEYS)
  if (c.relatedColumnDetails?.groupByColumns?.length) {
    const node: TmdlGenericNode = {
      keyword: 'relatedColumnDetails',
      children: c.relatedColumnDetails.groupByColumns.map((g: J) => ({ keyword: 'groupByColumn', sep: ':' as const, value: quoteName(g.groupingColumn ?? '') }))
    }
    const extra = (col.extra ??= {})
    const list = (extra['@children'] as TmdlGenericNode[] | undefined) ?? []
    list.push(node)
    extra['@children'] = list
  }
  if (col.extra && !Object.keys(col.extra).length) delete col.extra
  return col
}

const MEASURE_KEYS = [
  'name',
  'expression',
  'formatString',
  'formatStringDefinition',
  'displayFolder',
  'isHidden',
  'description',
  'lineageTag',
  'dataType',
  'detailRowsDefinition',
  'kpi',
  'annotations',
  'changedProperties'
] as const

function readMeasure(m: J): MeasureDef {
  const out: MeasureDef = { name: m.name, expression: str(m.expression) ?? '' }
  setIf(out, 'formatString', m.formatString)
  if (m.formatStringDefinition) out.formatStringDefinition = { expression: str(m.formatStringDefinition.expression) ?? '' }
  setIf(out, 'displayFolder', m.displayFolder)
  setIf(out, 'isHidden', m.isHidden)
  setIf(out, 'description', str(m.description))
  setIf(out, 'lineageTag', m.lineageTag)
  setIf(out, 'dataType', m.dataType)
  if (m.detailRowsDefinition) out.detailRowsDefinition = str(m.detailRowsDefinition.expression) ?? ''
  if (m.kpi) {
    const k: NonNullable<MeasureDef['kpi']> = {}
    setIf(k, 'targetExpression', str(m.kpi.targetExpression))
    setIf(k, 'statusExpression', str(m.kpi.statusExpression))
    setIf(k, 'trendExpression', str(m.kpi.trendExpression))
    setIf(k, 'statusGraphic', m.kpi.statusGraphic)
    setIf(k, 'trendGraphic', m.kpi.trendGraphic)
    setIf(k, 'extra', rest(m.kpi, ['targetExpression', 'statusExpression', 'trendExpression', 'statusGraphic', 'trendGraphic']))
    out.kpi = k
  }
  setIf(out, 'annotations', annotationsIn(m.annotations))
  setIf(out, 'changedProperties', changedIn(m.changedProperties))
  setIf(out, 'extra', rest(m, MEASURE_KEYS))
  return out
}

function readHierarchy(h: J): HierarchyDef {
  const out: HierarchyDef = {
    name: h.name,
    levels: (h.levels ?? []).map((l: J, i: number) => {
      const lv: HierarchyDef['levels'][number] = { name: l.name, column: l.column, ordinal: l.ordinal ?? i }
      setIf(lv, 'lineageTag', l.lineageTag)
      setIf(lv, 'annotations', annotationsIn(l.annotations))
      setIf(lv, 'extra', rest(l, ['name', 'column', 'ordinal', 'lineageTag', 'annotations']))
      return lv
    })
  }
  setIf(out, 'isHidden', h.isHidden)
  setIf(out, 'displayFolder', h.displayFolder)
  setIf(out, 'lineageTag', h.lineageTag)
  setIf(out, 'annotations', annotationsIn(h.annotations))
  const extra = rest(h, ['name', 'levels', 'isHidden', 'displayFolder', 'lineageTag', 'annotations', 'description'])
  if (h.description !== undefined) (out.extra = extra ?? {})['@description'] = str(h.description)
  else setIf(out, 'extra', extra)
  return out
}

const SOURCE_TYPES = new Set(['m', 'calculated', 'entity', 'calculationGroup', 'policyRange', 'query'])

function readPartition(p: J): PartitionDef {
  const src: J = p.source ?? {}
  const type = String(src.type ?? 'm')
  const out: PartitionDef = { name: p.name, sourceType: SOURCE_TYPES.has(type) ? (type as PartitionDef['sourceType']) : 'unknown' }
  setIf(out, 'mode', p.mode)
  const expr = str(src.expression ?? src.query)
  if (expr !== undefined) out.expression = expr
  setIf(out, 'entityName', src.entityName)
  setIf(out, 'schemaName', src.schemaName)
  setIf(out, 'expressionSource', src.expressionSource)
  setIf(out, 'queryGroup', p.queryGroup)
  setIf(out, 'annotations', annotationsIn(p.annotations))
  let extra = rest(p, ['name', 'mode', 'source', 'queryGroup', 'annotations', 'description'])
  for (const [k, v] of Object.entries(src)) {
    if (['type', 'expression', 'query', 'entityName', 'schemaName', 'expressionSource'].includes(k)) continue
    ;(extra ??= {})[`source.${k}`] = v
  }
  if (out.sourceType === 'unknown') (extra ??= {})['@sourceType'] = type
  if (p.description !== undefined) (extra ??= {})['@description'] = str(p.description)
  setIf(out, 'extra', extra)
  return out
}

function readCalcGroup(cg: J): CalculationGroupDef {
  const out: CalculationGroupDef = {
    items: (cg.calculationItems ?? []).map((ci: J) => {
      const item: CalculationGroupDef['items'][number] = { name: ci.name, expression: str(ci.expression) ?? '' }
      setIf(item, 'ordinal', ci.ordinal)
      if (ci.formatStringDefinition) item.formatStringDefinition = { expression: str(ci.formatStringDefinition.expression) ?? '' }
      setIf(item, 'description', str(ci.description))
      setIf(item, 'extra', rest(ci, ['name', 'expression', 'ordinal', 'formatStringDefinition', 'description']))
      return item
    })
  }
  setIf(out, 'precedence', cg.precedence)
  if (cg.noSelectionExpression) out.noSelectionExpression = str(cg.noSelectionExpression.expression) ?? ''
  if (cg.multipleOrEmptySelectionExpression) out.multipleOrEmptySelectionExpression = str(cg.multipleOrEmptySelectionExpression.expression) ?? ''
  setIf(out, 'extra', rest(cg, ['precedence', 'calculationItems', 'noSelectionExpression', 'multipleOrEmptySelectionExpression']))
  return out
}

function readTable(t: J): TableDef {
  const out: TableDef = {
    name: t.name,
    columns: (t.columns ?? []).map(readColumn),
    measures: (t.measures ?? []).map(readMeasure),
    hierarchies: (t.hierarchies ?? []).map(readHierarchy),
    partitions: (t.partitions ?? []).map(readPartition)
  }
  if (t.calculationGroup) out.calculationGroup = readCalcGroup(t.calculationGroup)
  setIf(out, 'isHidden', t.isHidden)
  setIf(out, 'isPrivate', t.isPrivate)
  setIf(out, 'dataCategory', t.dataCategory)
  setIf(out, 'description', str(t.description))
  setIf(out, 'lineageTag', t.lineageTag)
  setIf(out, 'sourceLineageTag', t.sourceLineageTag)
  setIf(out, 'showAsVariationsOnly', t.showAsVariationsOnly)
  if (t.refreshPolicy) {
    const rp: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(t.refreshPolicy as J)) rp[k] = Array.isArray(v) ? v.join('\n') : v
    out.refreshPolicy = rp
  }
  setIf(out, 'annotations', annotationsIn(t.annotations))
  setIf(out, 'changedProperties', changedIn(t.changedProperties))
  setIf(
    out,
    'extra',
    rest(t, [
      'name',
      'columns',
      'measures',
      'hierarchies',
      'partitions',
      'calculationGroup',
      'isHidden',
      'isPrivate',
      'dataCategory',
      'description',
      'lineageTag',
      'sourceLineageTag',
      'showAsVariationsOnly',
      'refreshPolicy',
      'annotations',
      'changedProperties'
    ])
  )
  return out
}

function readRelationship(r: J): RelationshipDef {
  const out: RelationshipDef = {
    name: r.name,
    fromTable: r.fromTable,
    fromColumn: r.fromColumn,
    toTable: r.toTable,
    toColumn: r.toColumn,
    fromCardinality: r.fromCardinality ?? 'many',
    toCardinality: r.toCardinality ?? 'one',
    crossFilteringBehavior: r.crossFilteringBehavior ?? 'oneDirection',
    isActive: r.isActive ?? true
  }
  setIf(out, 'securityFilteringBehavior', r.securityFilteringBehavior)
  setIf(out, 'joinOnDateBehavior', r.joinOnDateBehavior)
  setIf(out, 'relyOnReferentialIntegrity', r.relyOnReferentialIntegrity)
  setIf(out, 'annotations', annotationsIn(r.annotations))
  setIf(
    out,
    'extra',
    rest(r, [
      'name',
      'fromTable',
      'fromColumn',
      'toTable',
      'toColumn',
      'fromCardinality',
      'toCardinality',
      'crossFilteringBehavior',
      'isActive',
      'securityFilteringBehavior',
      'joinOnDateBehavior',
      'relyOnReferentialIntegrity',
      'annotations'
    ])
  )
  return out
}

function readExpression(e: J): NamedExpressionDef {
  const out: NamedExpressionDef = { name: e.name, kind: e.kind === 'dax' ? 'dax' : 'm', expression: str(e.expression) ?? '' }
  setIf(out, 'description', str(e.description))
  setIf(out, 'queryGroup', e.queryGroup)
  setIf(out, 'lineageTag', e.lineageTag)
  setIf(out, 'annotations', annotationsIn(e.annotations))
  setIf(out, 'extra', rest(e, ['name', 'kind', 'expression', 'description', 'queryGroup', 'lineageTag', 'annotations']))
  return out
}

function readRole(r: J): RoleDef {
  const out: RoleDef = {
    name: r.name,
    tablePermissions: (r.tablePermissions ?? []).map((tp: J) => {
      const p: RoleDef['tablePermissions'][number] = { table: tp.name }
      setIf(p, 'filterExpression', str(tp.filterExpression))
      setIf(p, 'extra', rest(tp, ['name', 'filterExpression']))
      return p
    })
  }
  setIf(out, 'modelPermission', r.modelPermission)
  if (Array.isArray(r.members) && r.members.length) out.members = r.members.map((m: J) => String(m.memberName ?? m.name ?? ''))
  setIf(out, 'annotations', annotationsIn(r.annotations))
  let extra = rest(r, ['name', 'modelPermission', 'members', 'tablePermissions', 'annotations', 'description'])
  if (r.description !== undefined) (extra ??= {})['@description'] = str(r.description)
  setIf(out, 'extra', extra)
  return out
}

/** Read a TMSL database JSON (`{ name, compatibilityLevel, model: {...} }`) or a bare model object. */
export function readTmsl(json: J): TmslReadResult {
  const diagnostics: string[] = []
  const db: J = json.model ? json : { model: json }
  const m: J = db.model ?? {}
  const model: SemanticModel = {
    name: m.name ?? 'Model',
    tables: (m.tables ?? []).map(readTable),
    relationships: (m.relationships ?? []).map(readRelationship),
    expressions: (m.expressions ?? []).map(readExpression),
    roles: (m.roles ?? []).map(readRole)
  }
  setIf(model, 'culture', m.culture)
  setIf(model, 'compatibilityLevel', db.compatibilityLevel)
  setIf(model, 'defaultPowerBIDataSourceVersion', m.defaultPowerBIDataSourceVersion)
  setIf(model, 'sourceQueryCulture', m.sourceQueryCulture)
  setIf(model, 'discourageImplicitMeasures', m.discourageImplicitMeasures)
  if (m.dataAccessOptions) model.dataAccessOptions = { ...m.dataAccessOptions }
  if (Array.isArray(m.queryGroups) && m.queryGroups.length)
    model.queryGroups = m.queryGroups.map((q: J) => {
      const qg: { name: string; annotations?: Annotations } = { name: q.folder ?? q.name }
      setIf(qg, 'annotations', annotationsIn(q.annotations))
      return qg
    })
  if (Array.isArray(m.perspectives) && m.perspectives.length)
    model.perspectives = m.perspectives.map((p: J): PerspectiveDef => ({ name: p.name, extra: { json: p } }))
  if (Array.isArray(m.cultures) && m.cultures.length)
    model.cultures = m.cultures.map((c: J): CultureDef => {
      const extra = rest(c, ['name'])
      return extra ? { name: c.name, extra } : { name: c.name }
    })
  setIf(model, 'annotations', annotationsIn(m.annotations))
  let extra = rest(m, [
    'name',
    'culture',
    'defaultPowerBIDataSourceVersion',
    'sourceQueryCulture',
    'discourageImplicitMeasures',
    'dataAccessOptions',
    'queryGroups',
    'perspectives',
    'cultures',
    'annotations',
    'tables',
    'relationships',
    'expressions',
    'roles',
    'description'
  ])
  if (m.description !== undefined) (extra ??= {})['@description'] = str(m.description)
  const dbInfo: DatabaseInfo = {}
  if (db.name !== undefined) dbInfo.name = String(db.name)
  const dbExtra = rest(db, ['name', 'compatibilityLevel', 'model'])
  if (dbExtra) dbInfo.extra = dbExtra
  if (dbInfo.name !== undefined || dbInfo.extra) (extra ??= {})['@database'] = dbInfo
  setIf(model, 'extra', extra)
  return { model, diagnostics }
}

// ---------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------

function extrasOut(o: J, extra: Record<string, unknown> | undefined, where: string, diagnostics: string[]): void {
  if (!extra) return
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('@') || k.startsWith('source.')) continue
    if (isExtraExpr(v)) o[k] = exprOut(v.$tmdlExpr)
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) o[k] = Number(v)
    else if (v === 'true' || v === 'false') o[k] = v === 'true'
    else o[k] = v
  }
  const children = extra['@children'] as TmdlGenericNode[] | undefined
  for (const g of children ?? []) {
    if (g.keyword === 'relatedColumnDetails') {
      o.relatedColumnDetails = {
        groupByColumns: (g.children ?? []).filter((c) => c.keyword === 'groupByColumn').map((c) => ({ groupingColumn: unquoteName(c.value ?? '') }))
      }
    } else diagnostics.push(`model.bim: TMDL object '${g.keyword}' of ${where} has no TMSL mapping and was not written`)
  }
}

function writeColumn(c: ColumnDef, t: string, d: string[]): J {
  const o: J = { name: c.name }
  if (c.kind !== 'data') o.type = c.kind
  if (c.dataType !== 'unknown') o.dataType = c.dataType
  if (c.kind === 'calculated' && c.expression !== undefined) o.expression = exprOut(c.expression)
  if (c.formatString !== undefined) o.formatString = c.formatString
  if (c.isHidden !== undefined) o.isHidden = c.isHidden
  if (c.isKey !== undefined) o.isKey = c.isKey
  if (c.isNullable !== undefined) o.isNullable = c.isNullable
  if (c.isAvailableInMdx !== undefined) o.isAvailableInMdx = c.isAvailableInMdx
  if (c.kind !== 'calculated' && c.sourceColumn !== undefined) o.sourceColumn = c.sourceColumn
  if (c.sortByColumn !== undefined) o.sortByColumn = c.sortByColumn
  if (c.displayFolder !== undefined) o.displayFolder = c.displayFolder
  if (c.dataCategory !== undefined) o.dataCategory = c.dataCategory
  if (c.description !== undefined) o.description = c.description
  if (c.lineageTag !== undefined) o.lineageTag = c.lineageTag
  if (c.sourceLineageTag !== undefined) o.sourceLineageTag = c.sourceLineageTag
  if (c.summarizeBy !== undefined) o.summarizeBy = c.summarizeBy
  extrasOut(o, c.extra, `${t}[${c.name}]`, d)
  if (c.extendedProperties)
    o.extendedProperties = Object.entries(c.extendedProperties).map(([name, value]) =>
      value && typeof value === 'object' && '$tmdlRaw' in (value as J) ? { type: 'string', name, value: (value as J).$tmdlRaw } : { type: 'json', name, value }
    )
  if (c.variations)
    o.variations = c.variations.map((v) => {
      const q = parseQualified(v.defaultHierarchy)
      const out: J = { name: v.name, relationship: v.relationship, defaultHierarchy: { table: q.table, hierarchy: q.member } }
      if (v.isDefault !== undefined) out.isDefault = v.isDefault
      return out
    })
  if (c.changedProperties) o.changedProperties = c.changedProperties.map((property) => ({ property }))
  setIf(o, 'annotations', annotationsOut(c.annotations))
  return o
}

function writeMeasure(m: MeasureDef, t: string, d: string[]): J {
  const o: J = { name: m.name, expression: exprOut(m.expression) }
  if (m.formatString !== undefined) o.formatString = m.formatString
  if (m.formatStringDefinition) o.formatStringDefinition = { expression: exprOut(m.formatStringDefinition.expression) }
  if (m.isHidden !== undefined) o.isHidden = m.isHidden
  if (m.displayFolder !== undefined) o.displayFolder = m.displayFolder
  if (m.description !== undefined) o.description = m.description
  if (m.dataType !== undefined) o.dataType = m.dataType
  if (m.lineageTag !== undefined) o.lineageTag = m.lineageTag
  if (m.detailRowsDefinition !== undefined) o.detailRowsDefinition = { expression: exprOut(m.detailRowsDefinition) }
  if (m.kpi) {
    const k: J = {}
    if (m.kpi.targetExpression !== undefined) k.targetExpression = exprOut(m.kpi.targetExpression)
    if (m.kpi.statusExpression !== undefined) k.statusExpression = exprOut(m.kpi.statusExpression)
    if (m.kpi.trendExpression !== undefined) k.trendExpression = exprOut(m.kpi.trendExpression)
    if (m.kpi.statusGraphic !== undefined) k.statusGraphic = m.kpi.statusGraphic
    if (m.kpi.trendGraphic !== undefined) k.trendGraphic = m.kpi.trendGraphic
    extrasOut(k, m.kpi.extra, `${t}[${m.name}].kpi`, d)
    o.kpi = k
  }
  extrasOut(o, m.extra, `${t}[${m.name}]`, d)
  if (m.changedProperties) o.changedProperties = m.changedProperties.map((property) => ({ property }))
  setIf(o, 'annotations', annotationsOut(m.annotations))
  return o
}

function writeTable(t: TableDef, d: string[]): J {
  const o: J = { name: t.name }
  if (t.description !== undefined) o.description = t.description
  if (t.isHidden !== undefined) o.isHidden = t.isHidden
  if (t.isPrivate !== undefined) o.isPrivate = t.isPrivate
  if (t.showAsVariationsOnly !== undefined) o.showAsVariationsOnly = t.showAsVariationsOnly
  if (t.dataCategory !== undefined) o.dataCategory = t.dataCategory
  if (t.lineageTag !== undefined) o.lineageTag = t.lineageTag
  if (t.sourceLineageTag !== undefined) o.sourceLineageTag = t.sourceLineageTag
  if (t.calculationGroup) {
    const cg = t.calculationGroup
    const c: J = {}
    if (cg.precedence !== undefined) c.precedence = cg.precedence
    c.calculationItems = cg.items.map((ci) => {
      const item: J = { name: ci.name, expression: exprOut(ci.expression) }
      if (ci.ordinal !== undefined) item.ordinal = ci.ordinal
      if (ci.description !== undefined) item.description = ci.description
      if (ci.formatStringDefinition) item.formatStringDefinition = { expression: exprOut(ci.formatStringDefinition.expression) }
      extrasOut(item, ci.extra, `${t.name}.${ci.name}`, d)
      return item
    })
    if (cg.noSelectionExpression !== undefined) c.noSelectionExpression = { expression: exprOut(cg.noSelectionExpression) }
    if (cg.multipleOrEmptySelectionExpression !== undefined) c.multipleOrEmptySelectionExpression = { expression: exprOut(cg.multipleOrEmptySelectionExpression) }
    extrasOut(c, cg.extra, `${t.name}.calculationGroup`, d)
    o.calculationGroup = c
  }
  const cols = t.columns.filter((c) => c.kind !== 'rowNumber')
  if (cols.length) o.columns = cols.map((c) => writeColumn(c, t.name, d))
  if (t.partitions.length)
    o.partitions = t.partitions.map((p) => {
      const po: J = { name: p.name }
      if (typeof p.extra?.['@description'] === 'string') po.description = p.extra['@description']
      if (p.mode !== undefined) po.mode = p.mode
      if (p.queryGroup !== undefined) po.queryGroup = p.queryGroup
      const src: J = { type: p.sourceType === 'unknown' ? String(p.extra?.['@sourceType'] ?? 'm') : p.sourceType }
      if (p.expression !== undefined) src[p.sourceType === 'query' ? 'query' : 'expression'] = exprOut(p.expression)
      if (p.entityName !== undefined) src.entityName = p.entityName
      if (p.schemaName !== undefined) src.schemaName = p.schemaName
      if (p.expressionSource !== undefined) src.expressionSource = p.expressionSource
      for (const [k, v] of Object.entries(p.extra ?? {})) if (k.startsWith('source.')) src[k.slice(7)] = isExtraExpr(v) ? exprOut(v.$tmdlExpr) : v
      po.source = src
      extrasOut(po, p.extra, `${t.name} partition ${p.name}`, d)
      setIf(po, 'annotations', annotationsOut(p.annotations))
      return po
    })
  if (t.measures.length) o.measures = t.measures.map((m) => writeMeasure(m, t.name, d))
  if (t.hierarchies.length)
    o.hierarchies = t.hierarchies.map((h) => {
      const ho: J = { name: h.name }
      if (typeof h.extra?.['@description'] === 'string') ho.description = h.extra['@description']
      if (h.isHidden !== undefined) ho.isHidden = h.isHidden
      if (h.displayFolder !== undefined) ho.displayFolder = h.displayFolder
      if (h.lineageTag !== undefined) ho.lineageTag = h.lineageTag
      ho.levels = h.levels.map((l) => {
        const lo: J = { name: l.name, ordinal: l.ordinal, column: l.column }
        if (l.lineageTag !== undefined) lo.lineageTag = l.lineageTag
        extrasOut(lo, l.extra, `${t.name}.${h.name}.${l.name}`, d)
        setIf(lo, 'annotations', annotationsOut(l.annotations))
        return lo
      })
      extrasOut(ho, h.extra, `${t.name}.${h.name}`, d)
      setIf(ho, 'annotations', annotationsOut(h.annotations))
      return ho
    })
  if (t.refreshPolicy) {
    const rp: J = {}
    for (const [k, v] of Object.entries(t.refreshPolicy)) rp[k] = typeof v === 'string' && /Expression$/.test(k) ? exprOut(v) : v
    o.refreshPolicy = rp
  }
  extrasOut(o, t.extra, t.name, d)
  if (t.changedProperties) o.changedProperties = t.changedProperties.map((property) => ({ property }))
  setIf(o, 'annotations', annotationsOut(t.annotations))
  return o
}

function cultureOut(c: CultureDef, d: string[]): J {
  const o: J = { name: c.name }
  if (c.extra) for (const [k, v] of Object.entries(c.extra)) o[k] = v
  if (typeof c.raw === 'string' && !o.linguisticMetadata) {
    const doc = parseTmdlText(c.raw)
    const ci = doc.nodes.find((n) => n.keyword === 'cultureInfo')
    const lm = ci?.children.find((n) => n.keyword === 'linguisticMetadata')
    if (lm?.value !== undefined) {
      const ct = lm.children.find((n) => n.keyword === 'contentType')?.value?.trim() ?? 'json'
      let content: unknown = lm.value
      if (ct === 'json')
        try {
          content = JSON.parse(lm.value)
        } catch {
          /* keep text */
        }
      o.linguisticMetadata = { content, contentType: ct }
    }
    if (ci?.children.some((n) => n.keyword !== 'linguisticMetadata')) d.push(`model.bim: translations of culture ${c.name} were not converted`)
  }
  return o
}

function perspectiveOut(p: PerspectiveDef, d: string[]): J {
  if (p.extra?.json && typeof p.extra.json === 'object') return p.extra.json as J
  const o: J = { name: p.name, tables: [] }
  if (typeof p.extra?.tmdl === 'string') {
    const doc = parseTmdlText(p.extra.tmdl)
    const node = doc.nodes.find((n) => n.keyword === 'perspective')
    const named = (n: TmdlNode, kw: string): J[] => n.children.filter((c) => c.keyword === kw).map((c) => ({ name: c.name ?? '' }))
    for (const pt of node?.children.filter((c) => c.keyword === 'perspectiveTable') ?? []) {
      const t: J = { name: pt.name ?? '' }
      if (pt.children.some((c) => c.keyword === 'includeAll')) t.includeAll = true
      const cols = named(pt, 'perspectiveColumn')
      const ms = named(pt, 'perspectiveMeasure')
      const hs = named(pt, 'perspectiveHierarchy')
      if (cols.length) t.columns = cols
      if (ms.length) t.measures = ms
      if (hs.length) t.hierarchies = hs
      o.tables.push(t)
    }
  } else d.push(`model.bim: perspective ${p.name} has no definition`)
  return o
}

/** SemanticModel -> TMSL database JSON (as found in model.bim). */
export function writeTmsl(model: SemanticModel): { json: J; diagnostics: string[] } {
  const d: string[] = []
  const db = (model.extra?.['@database'] as DatabaseInfo | undefined) ?? {}
  const m: J = {}
  if (model.name && model.name !== 'Model') m.name = model.name
  if (typeof model.extra?.['@description'] === 'string') m.description = model.extra['@description']
  if (model.culture !== undefined) m.culture = model.culture
  if (model.dataAccessOptions) m.dataAccessOptions = { ...model.dataAccessOptions }
  if (model.defaultPowerBIDataSourceVersion !== undefined) m.defaultPowerBIDataSourceVersion = model.defaultPowerBIDataSourceVersion
  if (model.discourageImplicitMeasures !== undefined) m.discourageImplicitMeasures = model.discourageImplicitMeasures
  if (model.sourceQueryCulture !== undefined) m.sourceQueryCulture = model.sourceQueryCulture
  m.tables = model.tables.map((t) => writeTable(t, d))
  if (model.relationships.length)
    m.relationships = model.relationships.map((r) => {
      const o: J = { name: r.name }
      if (!r.isActive) o.isActive = false
      if (r.crossFilteringBehavior !== 'oneDirection') o.crossFilteringBehavior = r.crossFilteringBehavior
      if (r.fromCardinality !== 'many') o.fromCardinality = r.fromCardinality
      if (r.toCardinality !== 'one') o.toCardinality = r.toCardinality
      if (r.joinOnDateBehavior !== undefined) o.joinOnDateBehavior = r.joinOnDateBehavior
      if (r.securityFilteringBehavior !== undefined) o.securityFilteringBehavior = r.securityFilteringBehavior
      if (r.relyOnReferentialIntegrity !== undefined) o.relyOnReferentialIntegrity = r.relyOnReferentialIntegrity
      Object.assign(o, { fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn })
      extrasOut(o, r.extra, `relationship ${r.name}`, d)
      setIf(o, 'annotations', annotationsOut(r.annotations))
      return o
    })
  if (model.roles.length)
    m.roles = model.roles.map((r) => {
      const o: J = { name: r.name }
      if (typeof r.extra?.['@description'] === 'string') o.description = r.extra['@description']
      if (r.modelPermission !== undefined) o.modelPermission = r.modelPermission
      if (r.members?.length) o.members = r.members.map((memberName) => ({ memberName }))
      if (r.tablePermissions.length)
        o.tablePermissions = r.tablePermissions.map((tp) => {
          const p: J = { name: tp.table }
          if (tp.filterExpression !== undefined) p.filterExpression = exprOut(tp.filterExpression)
          extrasOut(p, tp.extra, `role ${r.name}`, d)
          return p
        })
      extrasOut(o, r.extra, `role ${r.name}`, d)
      setIf(o, 'annotations', annotationsOut(r.annotations))
      return o
    })
  if (model.expressions.length)
    m.expressions = model.expressions.map((e) => {
      const o: J = { name: e.name, kind: e.kind, expression: exprOut(e.expression) }
      if (e.description !== undefined) o.description = e.description
      if (e.lineageTag !== undefined) o.lineageTag = e.lineageTag
      if (e.queryGroup !== undefined) o.queryGroup = e.queryGroup
      extrasOut(o, e.extra, `expression ${e.name}`, d)
      setIf(o, 'annotations', annotationsOut(e.annotations))
      return o
    })
  if (model.perspectives?.length) m.perspectives = model.perspectives.map((p) => perspectiveOut(p, d))
  if (model.cultures?.length) m.cultures = model.cultures.map((c) => cultureOut(c, d))
  if (model.queryGroups?.length)
    m.queryGroups = model.queryGroups.map((q) => {
      const o: J = { folder: q.name }
      setIf(o, 'annotations', annotationsOut(q.annotations))
      return o
    })
  extrasOut(m, model.extra, 'model', d)
  setIf(m, 'annotations', annotationsOut(model.annotations))
  const json: J = {}
  json.name = db.name ?? model.name ?? 'SemanticModel'
  if (model.compatibilityLevel !== undefined) json.compatibilityLevel = model.compatibilityLevel
  if (db.extra) for (const [k, v] of Object.entries(db.extra)) json[k] = v
  json.model = m
  return { json, diagnostics: d }
}
