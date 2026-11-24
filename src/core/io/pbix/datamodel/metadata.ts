/**
 * `metadata.sqlitedb` (the Tabular Object Model persisted by Power BI Desktop / AS) → SemanticModel,
 * plus the per-column storage map (dictionary / idf files) needed to decode VertiPaq data.
 *
 * Enum values follow Microsoft.AnalysisServices.Tabular (TOM). Table/column naming of the sqlite
 * schema follows the TMSCHEMA_* DMVs; older schemas (SCHEMAVERSION < ~18) used different column
 * names (`BindingType`, `FromEndColumnID`, `Level.Index`) which are handled as fallbacks — the
 * mapping of those legacy names was learned from pbixray (MIT, see THIRD_PARTY.md).
 */

import type {
  Annotations,
  CalculationGroupDef,
  Cardinality,
  ColumnDef,
  CrossFilteringBehavior,
  DataType,
  HierarchyDef,
  MeasureDef,
  NamedExpressionDef,
  PartitionDef,
  PartitionMode,
  RelationshipDef,
  RoleDef,
  SemanticModel,
  SummarizeBy,
  TableDef
} from '../../../model/types'
import type { MetadataDb, Row } from './sqlite'

// ---- TOM enums -------------------------------------------------------------------------------

/** TOM ObjectType (used by Annotation / ExtendedProperty / ChangedProperty / FormatStringDefinition). */
export const ObjectType = {
  Model: 1,
  DataSource: 2,
  Table: 3,
  Column: 4,
  AttributeHierarchy: 5,
  Partition: 6,
  Relationship: 7,
  Measure: 8,
  Hierarchy: 9,
  Level: 10,
  KPI: 12,
  Culture: 13,
  Perspective: 29,
  Role: 34,
  TablePermission: 36,
  Variation: 37,
  Expression: 41,
  CalculationGroup: 46,
  CalculationItem: 47,
  QueryGroup: 51
} as const

export function mapDataType(code: number | null | undefined): DataType {
  switch (code) {
    case 2:
      return 'string'
    case 6:
      return 'int64'
    case 8:
      return 'double'
    case 9:
      return 'dateTime'
    case 10:
      return 'decimal'
    case 11:
      return 'boolean'
    case 17:
      return 'binary'
    case 20:
      return 'variant'
    default:
      return 'unknown'
  }
}

const SUMMARIZE: Record<number, SummarizeBy> = { 1: 'default', 2: 'none', 3: 'sum', 4: 'min', 5: 'max', 6: 'count', 7: 'average', 8: 'distinctCount' }
const COLUMN_KIND: Record<number, ColumnDef['kind']> = { 1: 'data', 2: 'calculated', 3: 'rowNumber', 4: 'calculatedTableColumn' }
const PARTITION_SOURCE: Record<number, PartitionDef['sourceType']> = {
  1: 'query',
  2: 'calculated',
  4: 'm',
  5: 'entity',
  6: 'policyRange',
  7: 'calculationGroup'
}
const PARTITION_MODE: Record<number, PartitionMode> = { 0: 'import', 1: 'directQuery', 2: 'default', 4: 'dual', 5: 'directLake' }
const CROSS_FILTER: Record<number, CrossFilteringBehavior> = { 1: 'oneDirection', 2: 'bothDirections', 3: 'automatic' }
const SECURITY_FILTER: Record<number, NonNullable<RelationshipDef['securityFilteringBehavior']>> = { 1: 'oneDirection', 2: 'bothDirections', 3: 'none' }
const MODEL_PERMISSION: Record<number, NonNullable<RoleDef['modelPermission']>> = { 1: 'none', 2: 'read', 3: 'readRefresh', 4: 'refresh', 5: 'administrator' }

// ---- helpers ---------------------------------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined)
const bool = (v: unknown): boolean => num(v) === 1 || v === true

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) {
    const k = key(r)
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  return m
}

/** TMDL-style object reference quoting (as Power BI writes it): bare unless the name contains
 *  whitespace or one of `. = : ' " [ ]`, else single-quoted with `'` doubled. */
export function tmdlName(name: string): string {
  return /^[^\s.=:'"[\]]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

// ---- storage map -----------------------------------------------------------------------------

export interface ColumnStorageInfo {
  /** Dictionary file name (hash-encoded columns). */
  dictionary?: string
  /** Value-encoding parameters: value = (dataId + baseId) / magnitude. */
  baseId?: number
  magnitude?: number
  /** DictionaryStorage.Type: 1 = hash (dictionary), 2 = value. */
  encoding?: number
  /** DictionaryStorage.DataType: 2 string, 6 long, 8 real (storage type). */
  storageType?: number
  /** `.idf` file names, one per partition, in partition storage order. */
  idfs: string[]
}

export interface MetadataResult {
  model: SemanticModel
  /** table name -> column name -> storage info (for all model columns incl. RowNumber). */
  storage: Map<string, Map<string, ColumnStorageInfo>>
  /** table name -> total record count according to segment maps (when available). */
  recordCounts: Map<string, number>
  diagnostics: string[]
}

export function readMetadata(db: MetadataDb, dbXml?: string): MetadataResult {
  const diagnostics: string[] = []

  const annotationsByObj = new Map<string, Annotations>()
  for (const a of db.all('Annotation')) {
    const key = `${a.ObjectType}:${a.ObjectID}`
    let m = annotationsByObj.get(key)
    if (!m) annotationsByObj.set(key, (m = {}))
    m[String(a.Name)] = String(a.Value ?? '')
  }
  const ann = (type: number, id: unknown): Annotations | undefined => annotationsByObj.get(`${type}:${id}`)

  const extProps = new Map<string, Record<string, unknown>>()
  for (const e of db.all('ExtendedProperty')) {
    const key = `${e.ObjectType}:${e.ObjectID}`
    let m = extProps.get(key)
    if (!m) extProps.set(key, (m = {}))
    let value: unknown = e.Value
    if (num(e.Type) === 1 && typeof e.Value === 'string') {
      try {
        value = JSON.parse(e.Value)
      } catch {
        value = e.Value
      }
    }
    m[String(e.Name)] = value
  }

  const changed = new Map<string, string[]>()
  for (const c of db.all('ChangedProperty')) {
    const key = `${c.ObjectType}:${c.ObjectID}`
    const a = changed.get(key)
    if (a) a.push(String(c.Property))
    else changed.set(key, [String(c.Property)])
  }

  const formatStrings = new Map<unknown, string>()
  for (const f of db.all('FormatStringDefinition')) formatStrings.set(f.ID, String(f.Expression ?? ''))
  const detailRows = new Map<unknown, string>()
  for (const d of db.all('DetailRowsDefinition')) detailRows.set(d.ID, String(d.Expression ?? ''))
  const queryGroups = new Map<unknown, string>()
  for (const q of db.all('QueryGroup')) queryGroups.set(q.ID, String(q.Folder ?? ''))

  // ---- model
  const modelRow: Row = db.all('Model')[0] ?? {}
  const model: SemanticModel = {
    name: str(modelRow.Name) ?? 'Model',
    tables: [],
    relationships: [],
    expressions: [],
    roles: []
  }
  if (str(modelRow.Culture)) model.culture = str(modelRow.Culture)
  if (str(modelRow.SourceQueryCulture)) model.sourceQueryCulture = str(modelRow.SourceQueryCulture)
  if (bool(modelRow.DiscourageImplicitMeasures)) model.discourageImplicitMeasures = true
  const dsv = num(modelRow.DefaultPowerBIDataSourceVersion)
  if (dsv !== undefined && dsv > 0) model.defaultPowerBIDataSourceVersion = `powerBI_V${dsv}`
  if (str(modelRow.DataAccessOptions)) {
    try {
      const o = JSON.parse(String(modelRow.DataAccessOptions)) as Record<string, unknown>
      const dao: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(o)) if (typeof v === 'boolean') dao[k] = v
      if (Object.keys(dao).length) model.dataAccessOptions = dao
    } catch {
      diagnostics.push('Model.DataAccessOptions is not valid JSON')
    }
  }
  const compat = dbXml ? /CompatibilityLevel>(\d+)</.exec(dbXml) : null
  if (compat) model.compatibilityLevel = Number(compat[1])
  const modelAnn = ann(ObjectType.Model, modelRow.ID)
  if (modelAnn) model.annotations = modelAnn
  if (db.hasTable('QueryGroup')) {
    const qg = db.all('QueryGroup').map((q) => {
      const a = ann(ObjectType.QueryGroup, q.ID)
      return a ? { name: String(q.Folder ?? ''), annotations: a } : { name: String(q.Folder ?? '') }
    })
    if (qg.length) model.queryGroups = qg
  }
  const perspectives = db.all('Perspective')
  if (perspectives.length) model.perspectives = perspectives.map((p) => ({ name: String(p.Name) }))
  const cultures = db.all('Culture')
  if (cultures.length) model.cultures = cultures.map((c) => ({ name: String(c.Name) }))

  // ---- tables
  const tableRows = db.all('Table').filter((t) => ((num(t.SystemFlags) ?? 0) & 1) === 0)
  const tableById = new Map<unknown, Row>(tableRows.map((t) => [t.ID, t]))
  const allTables = new Map<unknown, Row>(db.all('Table').map((t) => [t.ID, t]))
  const columnRows = db.all('Column')
  const columnById = new Map<unknown, Row>(columnRows.map((c) => [c.ID, c]))
  const colName = (c: Row | undefined): string => (c ? String(c.ExplicitName ?? c.InferredName ?? '') : '')
  const typeCol = db.columns('Column').has('Type') ? 'Type' : 'BindingType'
  const columnsByTable = groupBy(columnRows, (c) => c.TableID)
  const measuresByTable = groupBy(db.all('Measure'), (m) => m.TableID)
  const hierarchies = db.all('Hierarchy')
  const hierarchyById = new Map<unknown, Row>(hierarchies.map((h) => [h.ID, h]))
  const hierarchiesByTable = groupBy(hierarchies, (h) => h.TableID)
  const levelsByHierarchy = groupBy(db.all('Level'), (l) => l.HierarchyID)
  const partitionsByTable = groupBy(db.all('Partition'), (p) => p.TableID)
  const kpis = new Map<unknown, Row>(db.all('KPI').map((k) => [k.ID, k]))
  const relationshipRows = db.all('Relationship')
  const relationshipById = new Map<unknown, Row>(relationshipRows.map((r) => [r.ID, r]))
  const variationsByColumn = groupBy(db.all('Variation'), (v) => v.ColumnID)
  const calcGroups = new Map<unknown, Row>(db.all('CalculationGroup').map((g) => [g.ID, g]))
  const calcItemsByGroup = groupBy(db.all('CalculationItem'), (i) => i.CalculationGroupID)
  const calcExprByGroup = groupBy(db.all('CalculationExpression'), (i) => i.CalculationGroupID)
  const refreshPolicies = new Map<unknown, Row>(db.all('RefreshPolicy').map((r) => [r.ID, r]))
  const expressionsById = new Map<unknown, Row>(db.all('Expression').map((e) => [e.ID, e]))

  for (const t of tableRows.sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
    const tableName = String(t.Name)
    const td: TableDef = { name: tableName, columns: [], measures: [], hierarchies: [], partitions: [] }
    if (bool(t.IsHidden)) td.isHidden = true
    if (bool(t.IsPrivate)) td.isPrivate = true
    if (bool(t.ShowAsVariationsOnly)) td.showAsVariationsOnly = true
    if (str(t.DataCategory)) td.dataCategory = str(t.DataCategory)
    if (str(t.Description)) td.description = str(t.Description)
    if (str(t.LineageTag)) td.lineageTag = str(t.LineageTag)
    if (str(t.SourceLineageTag)) td.sourceLineageTag = str(t.SourceLineageTag)
    const tAnn = ann(ObjectType.Table, t.ID)
    if (tAnn) td.annotations = tAnn
    const tChanged = changed.get(`${ObjectType.Table}:${t.ID}`)
    if (tChanged) td.changedProperties = tChanged

    // columns
    const cols = (columnsByTable.get(t.ID) ?? []).sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))
    for (const c of cols) {
      const kind = COLUMN_KIND[num(c[typeCol]) ?? 1] ?? 'data'
      const explicitType = num(c.ExplicitDataType)
      const dataType = mapDataType(explicitType === 1 || explicitType === undefined ? num(c.InferredDataType) : explicitType)
      const cd: ColumnDef = { name: colName(c), dataType, kind }
      if (kind === 'rowNumber') cd.isHidden = true
      if (kind === 'calculated' && typeof c.Expression === 'string') cd.expression = c.Expression
      if (str(c.SourceColumn)) cd.sourceColumn = str(c.SourceColumn)
      if (str(c.FormatString)) cd.formatString = str(c.FormatString)
      if (bool(c.IsHidden)) cd.isHidden = true
      if (bool(c.IsKey)) cd.isKey = true
      if (num(c.IsNullable) === 0 && kind !== 'rowNumber') cd.isNullable = false
      if (num(c.IsAvailableInMDX) === 0) cd.isAvailableInMdx = false
      const sortBy = num(c.SortByColumnID)
      if (sortBy) {
        const sc = columnById.get(sortBy)
        if (sc) cd.sortByColumn = colName(sc)
      }
      const sb = num(c.SummarizeBy)
      if (sb !== undefined && SUMMARIZE[sb] && sb !== 1) cd.summarizeBy = SUMMARIZE[sb]
      if (str(c.DisplayFolder)) cd.displayFolder = str(c.DisplayFolder)
      if (str(c.DataCategory)) cd.dataCategory = str(c.DataCategory)
      if (str(c.Description)) cd.description = str(c.Description)
      if (str(c.LineageTag)) cd.lineageTag = str(c.LineageTag)
      if (str(c.SourceLineageTag)) cd.sourceLineageTag = str(c.SourceLineageTag)
      const ep = extProps.get(`${ObjectType.Column}:${c.ID}`)
      if (ep) cd.extendedProperties = ep
      const cAnn = ann(ObjectType.Column, c.ID)
      if (cAnn) cd.annotations = cAnn
      const cChanged = changed.get(`${ObjectType.Column}:${c.ID}`)
      if (cChanged) cd.changedProperties = cChanged
      const encodingHint = num(c.EncodingHint)
      if (encodingHint) cd.extra = { ...(cd.extra ?? {}), encodingHint: encodingHint === 1 ? 'hash' : encodingHint === 2 ? 'value' : encodingHint }
      const vars = variationsByColumn.get(c.ID)
      if (vars?.length) {
        cd.variations = vars.map((v) => {
          const rel = relationshipById.get(v.RelationshipID)
          const h = hierarchyById.get(v.DefaultHierarchyID)
          const ht = h ? allTables.get(h.TableID) : undefined
          const out: NonNullable<ColumnDef['variations']>[number] = {
            name: String(v.Name),
            relationship: rel ? String(rel.Name) : '',
            defaultHierarchy: h && ht ? `${tmdlName(String(ht.Name))}.${tmdlName(String(h.Name))}` : ''
          }
          if (bool(v.IsDefault)) out.isDefault = true
          return out
        })
      }
      td.columns.push(cd)
    }

    // measures
    for (const m of (measuresByTable.get(t.ID) ?? []).sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
      const md: MeasureDef = { name: String(m.Name), expression: String(m.Expression ?? '') }
      if (str(m.FormatString)) md.formatString = str(m.FormatString)
      const fsd = num(m.FormatStringDefinitionID)
      if (fsd && formatStrings.has(fsd)) md.formatStringDefinition = { expression: formatStrings.get(fsd)! }
      if (str(m.DisplayFolder)) md.displayFolder = str(m.DisplayFolder)
      if (bool(m.IsHidden)) md.isHidden = true
      if (str(m.Description)) md.description = str(m.Description)
      if (str(m.LineageTag)) md.lineageTag = str(m.LineageTag)
      const drd = num(m.DetailRowsDefinitionID)
      if (drd && detailRows.has(drd)) md.detailRowsDefinition = detailRows.get(drd)
      const kpi = kpis.get(m.KPIID)
      if (kpi) {
        md.kpi = {}
        if (str(kpi.TargetExpression)) md.kpi.targetExpression = str(kpi.TargetExpression)
        if (str(kpi.StatusExpression)) md.kpi.statusExpression = str(kpi.StatusExpression)
        if (str(kpi.TrendExpression)) md.kpi.trendExpression = str(kpi.TrendExpression)
        if (str(kpi.StatusGraphic)) md.kpi.statusGraphic = str(kpi.StatusGraphic)
        if (str(kpi.TrendGraphic)) md.kpi.trendGraphic = str(kpi.TrendGraphic)
      }
      const mAnn = ann(ObjectType.Measure, m.ID)
      if (mAnn) md.annotations = mAnn
      const mChanged = changed.get(`${ObjectType.Measure}:${m.ID}`)
      if (mChanged) md.changedProperties = mChanged
      td.measures.push(md)
    }

    // hierarchies
    const ordinalCol = db.columns('Level').has('Ordinal') ? 'Ordinal' : 'Index'
    for (const h of (hierarchiesByTable.get(t.ID) ?? []).sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
      const hd: HierarchyDef = {
        name: String(h.Name),
        levels: (levelsByHierarchy.get(h.ID) ?? [])
          .map((l) => {
            const ld: HierarchyDef['levels'][number] = { name: String(l.Name), column: colName(columnById.get(l.ColumnID)), ordinal: num(l[ordinalCol]) ?? 0 }
            if (str(l.LineageTag)) ld.lineageTag = str(l.LineageTag)
            const la = ann(ObjectType.Level, l.ID)
            if (la) ld.annotations = la
            return ld
          })
          .sort((a, b) => a.ordinal - b.ordinal)
      }
      if (bool(h.IsHidden)) hd.isHidden = true
      if (str(h.DisplayFolder)) hd.displayFolder = str(h.DisplayFolder)
      if (str(h.LineageTag)) hd.lineageTag = str(h.LineageTag)
      const ha = ann(ObjectType.Hierarchy, h.ID)
      if (ha) hd.annotations = ha
      td.hierarchies.push(hd)
    }

    // partitions
    for (const p of (partitionsByTable.get(t.ID) ?? []).sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
      const type = num(p.Type)
      const sourceType = type === undefined ? 'unknown' : (PARTITION_SOURCE[type] ?? 'unknown')
      const pd: PartitionDef = { name: String(p.Name), sourceType }
      const mode = num(p.Mode)
      if (mode !== undefined && PARTITION_MODE[mode]) pd.mode = PARTITION_MODE[mode]
      if (typeof p.QueryDefinition === 'string' && sourceType !== 'entity') pd.expression = p.QueryDefinition
      if (sourceType === 'entity') {
        if (str(p.QueryDefinition)) pd.entityName = str(p.QueryDefinition)
        if (str(p.SchemaName)) pd.schemaName = str(p.SchemaName)
        const es = expressionsById.get(p.ExpressionSourceID)
        if (es) pd.expressionSource = String(es.Name)
      }
      const qg = queryGroups.get(p.QueryGroupID)
      if (qg) pd.queryGroup = qg
      const pa = ann(ObjectType.Partition, p.ID)
      if (pa) pd.annotations = pa
      if (type !== undefined && !PARTITION_SOURCE[type]) pd.extra = { partitionType: type }
      // Pre-2019 PBIX files bind import partitions as legacy query partitions
      // (`SELECT * FROM [Query]`, or `SELECT [Query].* FROM [Query]` in 2017 files, against the embedded mashup data
      // source); the M itself lives in the PBIX `DataMashup` part (Section1.m). Record the query name so the PBIX
      // reader can link it.
      if (sourceType === 'query' && typeof p.QueryDefinition === 'string') {
        const mq = /^\s*SELECT (?:\*|\[((?:[^\]]|\]\])+)\]\.\*) FROM \[((?:[^\]]|\]\])+)\]\s*$/i.exec(p.QueryDefinition)
        if (mq && (mq[1] === undefined || mq[1] === mq[2])) pd.extra = { ...(pd.extra ?? {}), mashupQueryName: mq[2].replace(/\]\]/g, ']') }
      }
      td.partitions.push(pd)
    }

    // calculation group
    const cgId = num(t.CalculationGroupID)
    if (cgId && calcGroups.has(cgId)) {
      const cg = calcGroups.get(cgId)!
      const cgd: CalculationGroupDef = {
        items: (calcItemsByGroup.get(cgId) ?? [])
          .sort((a, b) => (num(a.Ordinal) ?? 0) - (num(b.Ordinal) ?? 0) || (num(a.ID) ?? 0) - (num(b.ID) ?? 0))
          .map((i) => {
            const it: CalculationGroupDef['items'][number] = { name: String(i.Name), expression: String(i.Expression ?? '') }
            const o = num(i.Ordinal)
            if (o !== undefined && o >= 0) it.ordinal = o
            const f = num(i.FormatStringDefinitionID)
            if (f && formatStrings.has(f)) it.formatStringDefinition = { expression: formatStrings.get(f)! }
            if (str(i.Description)) it.description = str(i.Description)
            return it
          })
      }
      const prec = num(cg.Precedence)
      if (prec) cgd.precedence = prec
      // CalculationExpression.SelectionMode — TOM CalculationGroupSelectionMode is not publicly
      // documented for the sqlite schema; 1 = multipleOrEmptySelection, 2 = noSelection matches
      // the order the properties were introduced. Unknown modes are kept in `extra`.
      for (const ce of calcExprByGroup.get(cgId) ?? []) {
        const mode = num(ce.SelectionMode)
        if (mode === 1) cgd.multipleOrEmptySelectionExpression = String(ce.Expression ?? '')
        else if (mode === 2) cgd.noSelectionExpression = String(ce.Expression ?? '')
        else cgd.extra = { ...(cgd.extra ?? {}), [`calculationExpression${mode}`]: String(ce.Expression ?? '') }
      }
      td.calculationGroup = cgd
    }

    const rp = refreshPolicies.get(t.RefreshPolicyID)
    if (rp) {
      const policy: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rp)) if (k !== 'ID' && k !== 'TableID' && v !== null) policy[k[0].toLowerCase() + k.slice(1)] = v
      td.refreshPolicy = policy
    }

    model.tables.push(td)
  }

  // ---- relationships
  const relCol = (modern: string): string => {
    if (db.columns('Relationship').has('FromColumnID')) return modern
    if (modern.startsWith('From')) return 'FromEnd' + modern.slice(4)
    if (modern.startsWith('To')) return 'ToEnd' + modern.slice(2)
    return modern
  }
  for (const r of relationshipRows.sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
    const ft = tableById.get(r[relCol('FromTableID')])
    const tt = tableById.get(r[relCol('ToTableID')])
    if (!ft || !tt) continue
    const card = (v: unknown): Cardinality => (num(v) === 2 ? 'many' : 'one')
    const rd: RelationshipDef = {
      name: String(r.Name ?? ''),
      fromTable: String(ft.Name),
      fromColumn: colName(columnById.get(r[relCol('FromColumnID')])),
      toTable: String(tt.Name),
      toColumn: colName(columnById.get(r[relCol('ToColumnID')])),
      fromCardinality: card(r[relCol('FromCardinality')]),
      toCardinality: card(r[relCol('ToCardinality')]),
      crossFilteringBehavior: CROSS_FILTER[num(r.CrossFilteringBehavior) ?? 1] ?? 'oneDirection',
      isActive: num(r.IsActive) !== 0
    }
    const sfb = num(r.SecurityFilteringBehavior)
    if (sfb !== undefined && SECURITY_FILTER[sfb] && sfb !== 1) rd.securityFilteringBehavior = SECURITY_FILTER[sfb]
    const jdb = num(r.JoinOnDateBehavior)
    if (jdb === 2) rd.joinOnDateBehavior = 'datePartOnly'
    if (bool(r.RelyOnReferentialIntegrity)) rd.relyOnReferentialIntegrity = true
    const ra = ann(ObjectType.Relationship, r.ID)
    if (ra) rd.annotations = ra
    model.relationships.push(rd)
  }

  // ---- shared expressions
  for (const e of [...expressionsById.values()].sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
    const ed: NamedExpressionDef = { name: String(e.Name), kind: num(e.Kind) === 1 ? 'dax' : 'm', expression: String(e.Expression ?? '') }
    if (str(e.Description)) ed.description = str(e.Description)
    const qg = queryGroups.get(e.QueryGroupID)
    if (qg) ed.queryGroup = qg
    if (str(e.LineageTag)) ed.lineageTag = str(e.LineageTag)
    const ea = ann(ObjectType.Expression, e.ID)
    if (ea) ed.annotations = ea
    model.expressions.push(ed)
  }

  // ---- roles
  const permsByRole = groupBy(db.all('TablePermission'), (p) => p.RoleID)
  const membersByRole = groupBy(db.all('RoleMembership'), (m) => m.RoleID)
  for (const r of db.all('Role').sort((a, b) => (num(a.ID) ?? 0) - (num(b.ID) ?? 0))) {
    const rd: RoleDef = {
      name: String(r.Name),
      tablePermissions: (permsByRole.get(r.ID) ?? []).flatMap((p) => {
        const t = allTables.get(p.TableID)
        if (!t) return []
        const tp: RoleDef['tablePermissions'][number] = { table: String(t.Name) }
        if (str(p.FilterExpression)) tp.filterExpression = str(p.FilterExpression)
        return [tp]
      })
    }
    const mp = num(r.ModelPermission)
    if (mp !== undefined && MODEL_PERMISSION[mp]) rd.modelPermission = MODEL_PERMISSION[mp]
    const members = (membersByRole.get(r.ID) ?? []).map((m) => String(m.MemberName ?? ''))
    if (members.length) rd.members = members
    const ra = ann(ObjectType.Role, r.ID)
    if (ra) rd.annotations = ra
    model.roles.push(rd)
  }

  // ---- storage map
  const storage = new Map<string, Map<string, ColumnStorageInfo>>()
  const storageFiles = new Map<unknown, string>(db.all('StorageFile').map((f) => [f.ID, String(f.FileName)]))
  const columnStorage = new Map<unknown, Row>(db.all('ColumnStorage').map((c) => [c.ID, c]))
  const dictStorage = new Map<unknown, Row>(db.all('DictionaryStorage').map((d) => [d.ID, d]))
  const partStorage = new Map<unknown, Row>(db.all('PartitionStorage').map((p) => [p.ID, p]))
  const cpsByColumnStorage = groupBy(db.all('ColumnPartitionStorage'), (c) => c.ColumnStorageID)
  for (const t of tableRows) {
    const m = new Map<string, ColumnStorageInfo>()
    for (const c of columnsByTable.get(t.ID) ?? []) {
      const cs = columnStorage.get(c.ColumnStorageID)
      if (!cs) continue
      const info: ColumnStorageInfo = { idfs: [] }
      const ds = dictStorage.get(cs.DictionaryStorageID)
      if (ds) {
        const f = storageFiles.get(ds.StorageFileID)
        if (f) info.dictionary = f
        info.baseId = num(ds.BaseId)
        info.magnitude = num(ds.Magnitude)
        info.encoding = num(ds.Type)
        info.storageType = num(ds.DataType)
      }
      const parts = (cpsByColumnStorage.get(cs.ID) ?? [])
        .map((p) => ({ pos: num(partStorage.get(p.PartitionStorageID)?.StoragePosition) ?? 0, id: num(p.ID) ?? 0, file: storageFiles.get(p.StorageFileID) }))
        .sort((a, b) => a.pos - b.pos || a.id - b.id)
      for (const p of parts) if (p.file) info.idfs.push(p.file)
      m.set(colName(c), info)
    }
    storage.set(String(t.Name), m)
  }

  // record counts from segment maps (partition storage -> partition -> table)
  const recordCounts = new Map<string, number>()
  const partitionById = new Map<unknown, Row>(db.all('Partition').map((p) => [p.ID, p]))
  const psById = new Map<unknown, Row>(db.all('PartitionStorage').map((p) => [p.ID, p]))
  for (const sm of db.all('SegmentMapStorage')) {
    const ps = psById.get(sm.PartitionStorageID)
    const p = ps ? partitionById.get(ps.PartitionID) : undefined
    const t = p ? tableById.get(p.TableID) : undefined
    if (!t) continue
    const name = String(t.Name)
    recordCounts.set(name, (recordCounts.get(name) ?? 0) + (num(sm.RecordCount) ?? 0))
  }

  return { model, storage, recordCounts, diagnostics }
}
