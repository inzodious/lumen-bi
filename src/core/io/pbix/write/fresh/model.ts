/**
 * Stage E: a complete `DataModel` written by Lumen from its in-memory model and data, for a model that never came from
 * a `.pbix` (a PBIP project refreshed from its sources, a model built in Lumen, ...).
 *
 * Output: the inner files of the database folder (VertiPaq column files and system tables, see ../vertipaq/) and its
 * `metadata.sqlitedb`, with every object and storage row laid out as the November 2025 Desktop file and the Microsoft
 * samples show them (docs/developer/file-format-io.md, "Writing a DataModel"). `../fresh/abf.ts` packs them into an
 * ABF backup, `../datamodelwrite.ts` compresses it.
 *
 * Every column is hash-encoded; every structure the engine keeps for a processed table is written (attribute
 * hierarchies for each column, user hierarchies, relationship indexes), so the tables are stored as "processed" (State
 * 1) like those of any file saved by Desktop after a refresh. Model features without a writer are refused by
 * `freshModelSupport` with the feature named; `.pbit` / PBIP remain available for those models.
 */
import type { DataStore, Scalar, TableData } from '../../../../model/data'
import type { ColumnDef, DataType, RelationshipDef, SemanticModel, TableDef } from '../../../../model/types'
import { encodeColumn, storedValue, textKey, type EncodedColumn } from '../vertipaq/dictionary'
import { attributeHierarchyStreams, relationshipIndexStreams, userHierarchyStreams } from '../vertipaq/hierarchy'
import { writeColumnStreams, writeRowNumberStreams, type ColumnStreams } from '../vertipaq/idf'

/** Rows per segment: one segment up to this size (the samples hold 1,260,752 rows in one segment). */
export const SEGMENT_ROWS = 8 * 1024 * 1024
export const ROW_NUMBER_NAME = 'RowNumber-2662979B-1795-4F74-8F37-6A1BA8059B61'
/** `RefreshedTime` real files give columns and system partitions (a fixed "never" value). */
export const NEVER_REFRESHED = 31240512000000000

const TOM_DATA_TYPE: Partial<Record<DataType, number>> = { string: 2, int64: 6, double: 8, dateTime: 9, decimal: 10, boolean: 11, binary: 17, variant: 20 }
const SUMMARIZE: Record<string, number> = { default: 1, none: 2, sum: 3, min: 4, max: 5, count: 6, average: 7, distinctCount: 8 }
const CROSS_FILTER: Record<string, number> = { oneDirection: 1, bothDirections: 2, automatic: 3 }
const SECURITY_FILTER: Record<string, number> = { oneDirection: 1, bothDirections: 2, none: 3 }
const MODEL_PERMISSION: Record<string, number> = { none: 1, read: 2, readRefresh: 3, refresh: 4, administrator: 5 }
const OBJ = { Model: 1, Table: 3, Column: 4, Partition: 6, Relationship: 7, Measure: 8, Hierarchy: 9, Level: 10, Role: 34, Expression: 41, CalculationItem: 47, QueryGroup: 51 } as const

/** A row of a `metadata.sqlitedb` table (column name → value). */
export type MetaRow = Record<string, string | number | null>

export interface InnerFile {
  /** folder path relative to the database folder (Windows separators, '' = the folder itself) */
  folder: string
  name: string
  bytes: Uint8Array
}

export interface FreshModelResult {
  rows: Map<string, MetaRow[]>
  files: InnerFile[]
  maxId: number
  diagnostics: string[]
}

export interface FreshModelOptions {
  /** FILETIME of the save (ModifiedTime / RefreshedTime values) */
  fileTime: number
}

// ---------------------------------------------------------------------------------------------
// support check
// ---------------------------------------------------------------------------------------------

/** Features of `model` that the stage E writer cannot write (empty = supported). */
export function freshModelSupport(model: SemanticModel, data: DataStore): string[] {
  const out: string[] = []
  const tableNames = new Set(model.tables.map((t) => t.name.toLowerCase()))
  for (const t of model.tables) {
    const where = `table '${t.name}'`
    if (t.partitions.length > 1) out.push(`${where} has ${t.partitions.length} partitions (Lumen writes one partition per table)`)
    for (const p of t.partitions) {
      if (p.mode && p.mode !== 'import' && p.mode !== 'default') out.push(`${where} uses ${p.mode} storage (only import tables are written)`)
      if (!['m', 'calculated', 'calculationGroup', 'query'].includes(p.sourceType)) out.push(`${where} has a ${p.sourceType} partition`)
    }
    if (t.refreshPolicy) out.push(`${where} has an incremental refresh policy`)
    // a table without columns (a measures table) is written empty; any other table needs its data loaded
    const hasColumns = t.columns.some((c) => c.kind !== 'rowNumber')
    if (!t.calculationGroup && hasColumns && !data.tables.has(t.name)) out.push(`${where} has no data loaded (refresh it first)`)
    for (const c of t.columns) {
      if (c.kind === 'rowNumber') continue
      if (!['string', 'int64', 'double', 'decimal', 'boolean', 'dateTime'].includes(c.dataType)) out.push(`column '${t.name}'[${c.name}] has data type ${c.dataType}`)
      if (c.variations?.length) out.push(`column '${t.name}'[${c.name}] has auto date/time variations`)
      if (c.sortByColumn && !t.columns.some((x) => x.name === c.sortByColumn)) out.push(`column '${t.name}'[${c.name}] sorts by a missing column`)
    }
    for (const m of t.measures) {
      if (m.kpi) out.push(`measure '${t.name}'[${m.name}] has a KPI`)
      if (m.detailRowsDefinition) out.push(`measure '${t.name}'[${m.name}] has a detail rows expression`)
    }
    const td = data.tables.get(t.name)
    if (td) for (const c of t.columns) if (c.kind !== 'rowNumber' && !td.columns.some((x) => x.name === c.name)) out.push(`column '${t.name}'[${c.name}] has no data`)
  }
  for (const r of model.relationships) {
    if (r.fromCardinality === 'many' && r.toCardinality === 'many') out.push(`relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] is many-to-many`)
    else if (r.fromCardinality === 'one' && r.toCardinality === 'one') out.push(`relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] is one-to-one`)
    else if (r.fromCardinality === 'one') out.push(`relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] is one-to-many from the 'from' side`)
    if (!tableNames.has(r.fromTable.toLowerCase()) || !tableNames.has(r.toTable.toLowerCase())) out.push(`relationship ${r.name} refers to a missing table`)
  }
  if (model.perspectives?.length) out.push('perspectives')
  if ((model.cultures ?? []).some((c) => c.name !== (model.culture ?? 'en-US'))) out.push('translations (cultures other than the model culture)')
  if (model.functions?.length) out.push('DAX user-defined functions')
  return [...new Set(out)]
}

// ---------------------------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------------------------

/** Name part of a storage object (`<name> (<id>)`): characters other than letters, digits and spaces become spaces. */
export function storageName(name: string, id: number): string {
  return `${name.replace(/[^\p{L}\p{N} ]/gu, ' ')} (${id})`
}

// ---------------------------------------------------------------------------------------------
// value statistics shown in AttributeHierarchyStorage
// ---------------------------------------------------------------------------------------------

/** OLE days → Date, rounded to the second (the statistics text shows whole seconds) */
function oleToDate(days: number): Date {
  return new Date(Math.round((days - 25569) * 86400) * 1000)
}

/** Min / max as the AttributeHierarchyStorage rows of real files write them (en-US formatting). */
function statText(v: string | number, dataType: DataType): string {
  if (typeof v === 'string') return v
  switch (dataType) {
    case 'boolean':
      return v ? 'TRUE' : 'FALSE'
    case 'decimal':
      return String(v / 10000)
    case 'dateTime': {
      const d = oleToDate(v)
      const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return date
      const h = d.getUTCHours() % 12 || 12
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${date} ${h}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCHours() < 12 ? 'AM' : 'PM'}`
    }
    default:
      return String(v)
  }
}

// ---------------------------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------------------------

interface ColumnBuild {
  def: ColumnDef
  id: number
  storageName: string
  storagePos: number
  enc?: EncodedColumn
  /** sort position by data id (attribute hierarchy) */
  rankOfId?: Int32Array
  csId: number
}

interface TableBuild {
  def: TableDef
  id: number
  tsName: string
  tableFolder: string
  partFolder: string
  partitionId: number
  partitionStorageId: number
  rows: number
  columns: ColumnBuild[]
  data?: TableData
}

/** Build the rows of `metadata.sqlitedb` and the inner files for `model` with `data`. */
export function buildFreshModel(model: SemanticModel, data: DataStore, opts: FreshModelOptions): FreshModelResult {
  const ft = opts.fileTime
  const rows = new Map<string, MetaRow[]>()
  const files: InnerFile[] = []
  const diagnostics: string[] = []
  let maxId = 0
  const nextId = (): number => ++maxId
  const add = (table: string, row: MetaRow): MetaRow => {
    let a = rows.get(table)
    if (!a) rows.set(table, (a = []))
    a.push(row)
    return row
  }
  const annotations = (type: number, id: number, a?: Record<string, string>): void => {
    for (const [name, value] of Object.entries(a ?? {})) add('Annotation', { ID: nextId(), ObjectID: id, ObjectType: type, Name: name, Value: value, ModifiedTime: ft })
  }
  const fileId = (folderId: number, ownerId: number, ownerType: number, name: string, folder: string, bytes: Uint8Array): number => {
    const id = nextId()
    add('StorageFile', { ID: id, OwnerID: ownerId, OwnerType: ownerType, StorageFolderID: folderId, FileName: name })
    files.push({ folder, name, bytes })
    return id
  }
  const folderId = (ownerId: number, ownerType: number, path: string): number => {
    const id = nextId()
    add('StorageFolder', { ID: id, OwnerID: ownerId, OwnerType: ownerType, Path: path })
    return id
  }

  // ---- model
  const modelId = nextId()
  const dao = model.dataAccessOptions ?? { legacyRedirects: true, returnErrorValuesAsNull: true }
  add('Model', {
    ID: modelId,
    Name: model.name || 'Model',
    DefaultMode: 0,
    DefaultDataView: 0,
    Culture: model.culture ?? 'en-US',
    ModifiedTime: ft,
    StructureModifiedTime: ft,
    DataAccessOptions: JSON.stringify(dao, null, 2),
    DefaultMeasureID: 0,
    // Desktop's current models ("powerBI_V3" in TMDL) store 2 (the November 2025 file)
    DefaultPowerBIDataSourceVersion: 2,
    DiscourageImplicitMeasures: model.discourageImplicitMeasures ? 1 : 0,
    DataSourceDefaultMaxConnections: 10,
    SourceQueryCulture: model.sourceQueryCulture ?? model.culture ?? 'en-US',
    DisableAutoExists: -1,
    MaxParallelismPerRefresh: -1,
    MaxParallelismPerQuery: 0
  })
  const modelAnn: Record<string, string> = { ...(model.annotations ?? {}) }
  // no auto date/time tables: Lumen writes none, and this tells Desktop not to add them (absent = on)
  if (!('__PBI_TimeIntelligenceEnabled' in modelAnn)) modelAnn.__PBI_TimeIntelligenceEnabled = '0'
  annotations(OBJ.Model, modelId, modelAnn)
  add('Culture', { ID: nextId(), ModelID: modelId, Name: model.culture ?? 'en-US', LinguisticMetadataID: 0, ModifiedTime: ft, StructureModifiedTime: ft })

  const queryGroupIds = new Map<string, number>()
  for (const qg of model.queryGroups ?? []) {
    const id = nextId()
    queryGroupIds.set(qg.name, id)
    add('QueryGroup', { ID: id, ModelID: modelId, Folder: qg.name, Description: null })
    annotations(OBJ.QueryGroup, id, qg.annotations)
  }
  const qgId = (name?: string): number => {
    if (!name) return 0
    let id = queryGroupIds.get(name)
    if (id === undefined) {
      id = nextId()
      queryGroupIds.set(name, id)
      add('QueryGroup', { ID: id, ModelID: modelId, Folder: name, Description: null })
    }
    return id
  }
  for (const e of model.expressions) {
    const id = nextId()
    add('Expression', {
      ID: id,
      ModelID: modelId,
      Name: e.name,
      Description: e.description ?? null,
      Kind: e.kind === 'dax' ? 1 : 0,
      Expression: e.expression,
      ModifiedTime: ft,
      QueryGroupID: qgId(e.queryGroup),
      ParameterValuesColumnID: 0,
      LineageTag: e.lineageTag ?? null,
      ExpressionSourceID: 0
    })
    annotations(OBJ.Expression, id, e.annotations)
  }

  // ---- tables (ids first, so sort-by columns and relationships can refer to any column)
  const tables: TableBuild[] = []
  for (const t of model.tables) {
    const id = nextId()
    const isCg = !!t.calculationGroup
    const tsName = isCg ? `Calculation group (${id})` : storageName(t.name, id)
    const tb: TableBuild = { def: t, id, tsName, tableFolder: `${tsName}.tbl`, partFolder: '', partitionId: 0, partitionStorageId: 0, rows: 0, columns: [] }
    let pos = 0
    const rn: ColumnDef = { name: ROW_NUMBER_NAME, dataType: 'int64', kind: 'rowNumber', isHidden: true }
    for (const c of [rn, ...t.columns.filter((c) => c.kind !== 'rowNumber')]) {
      const cid = nextId()
      const cgName = isCg && c.kind !== 'rowNumber' && (c.sourceColumn ?? '').toLowerCase() === 'name'
      tb.columns.push({ def: c, id: cid, storageName: cgName ? `Calculation group column (${cid})` : storageName(c.name, cid), storagePos: pos++, csId: 0 })
    }
    tables.push(tb)
  }
  const tableByName = new Map(tables.map((t) => [t.def.name.toLowerCase(), t]))
  // "to" (one-side) columns of relationships: ColumnFlags 11 and usage 0 in real files
  const keyColumns = new Set(model.relationships.map((r) => `${r.toTable.toLowerCase()}\u0000${r.toColumn.toLowerCase()}`))
  const columnOf = (table: string, column: string): { t: TableBuild; c: ColumnBuild } | undefined => {
    const t = tableByName.get(table.toLowerCase())
    const c = t?.columns.find((x) => x.def.name.toLowerCase() === column.toLowerCase())
    return t && c ? { t, c } : undefined
  }

  // ---- data: encode every column
  for (const tb of tables) {
    const t = tb.def
    let td = data.tables.get(t.name)
    if (t.calculationGroup) td = calculationGroupData(t)
    tb.data = td
    tb.rows = td?.rowCount ?? 0
    for (const cb of tb.columns) {
      if (cb.def.kind === 'rowNumber') continue
      const cd = td?.columns.find((x) => x.name === cb.def.name)
      const values: Scalar[] = cd ? cd.values : new Array(tb.rows).fill(null)
      cb.enc = encodeColumn(values, cb.def.dataType)
    }
    // sort keys and ranks (attribute hierarchy order)
    for (const cb of tb.columns) {
      if (!cb.enc) continue
      let keys: Array<string | number | undefined> | undefined
      if (cb.def.sortByColumn) {
        const sb = tb.columns.find((x) => x.def.name === cb.def.sortByColumn)
        if (sb?.enc) {
          keys = new Array(cb.enc.values.length)
          for (let r = 0; r < tb.rows; r++) {
            const id = cb.enc.ids[r]
            if (id >= 3 && keys[id - 3] === undefined) {
              const sid = sb.enc.ids[r]
              keys[id - 3] = sid >= 3 ? sb.enc.values[sid - 3] : undefined
            }
          }
        }
      }
      ;(cb as ColumnBuild & { sortKeys?: typeof keys }).sortKeys = keys
    }
  }

  // ---- table rows
  for (const tb of tables) {
    const t = tb.def
    const tsId = nextId()
    add('Table', {
      ID: tb.id,
      ModelID: modelId,
      Name: t.name,
      DataCategory: t.dataCategory ?? null,
      Description: t.description ?? null,
      IsHidden: t.isHidden ? 1 : 0,
      TableStorageID: tsId,
      ModifiedTime: ft,
      StructureModifiedTime: ft,
      SystemFlags: 0,
      ShowAsVariationsOnly: t.showAsVariationsOnly ? 1 : 0,
      IsPrivate: t.isPrivate ? 1 : 0,
      CalculationGroupID: 0,
      LineageTag: t.lineageTag ?? null,
      SourceLineageTag: t.sourceLineageTag ?? null
    })
    annotations(OBJ.Table, tb.id, t.annotations)
    const tableFolderId = folderId(tsId, 18, tb.tableFolder)
    // Settings: 4353 for most tables of the files on hand, 4097 for empty ones (and one fact table: rule not derived)
    add('TableStorage', { ID: tsId, TableID: tb.id, Name: tb.tsName, Version: 1, Settings: tb.rows ? 4353 : 4097, RIViolationCount: 0, StorageFolderID: tableFolderId })

    // partition (one; a table without partitions gets the one Desktop would give a calculated / query table)
    const p = t.partitions[0]
    const pid = nextId()
    const psId = nextId()
    tb.partitionId = pid
    tb.partitionStorageId = psId
    const pType = t.calculationGroup ? 7 : p?.sourceType === 'calculated' ? 2 : p?.sourceType === 'query' ? 1 : 4
    add('Partition', {
      ID: pid,
      TableID: tb.id,
      Name: p?.name ?? t.name,
      Description: null,
      DataSourceID: 0,
      QueryDefinition: pType === 7 ? null : (p?.expression ?? null),
      State: 1,
      Type: pType,
      PartitionStorageID: psId,
      Mode: 0,
      DataView: 3,
      ModifiedTime: ft,
      RefreshedTime: ft,
      SystemFlags: 0,
      RangeGranularity: -1,
      QueryGroupID: qgId(p?.queryGroup),
      ExpressionSourceID: 0
    })
    if (p) annotations(OBJ.Partition, pid, p.annotations)
    const psName = t.calculationGroup ? `Calculation group (${pid})` : storageName(p?.name ?? t.name, pid)
    tb.partFolder = `${tb.tableFolder}\\${pid}.prt`
    const partFolderId = folderId(psId, 20, tb.partFolder)
    const smsId = nextId()
    add('PartitionStorage', { ID: psId, PartitionID: pid, Name: psName, StoragePosition: 0, SegmentMapStorageID: smsId, DataObjectId: 0, StorageFolderID: partFolderId })
    const segs = Math.max(1, Math.ceil(tb.rows / SEGMENT_ROWS))
    add('SegmentMapStorage', { ID: smsId, PartitionStorageID: psId, Type: 3, RecordCount: tb.rows, SegmentCount: segs, RecordsPerSegment: segs > 1 ? SEGMENT_ROWS : tb.rows })

    // calculation group
    if (t.calculationGroup) {
      const cgId = nextId()
      const tableRow = rows.get('Table')!.find((r) => r.ID === tb.id)!
      tableRow.CalculationGroupID = cgId
      add('CalculationGroup', { ID: cgId, TableID: tb.id, Description: null, ModifiedTime: ft, Precedence: t.calculationGroup.precedence ?? 0 })
      for (const it of t.calculationGroup.items) {
        const iid = nextId()
        let fsd = 0
        if (it.formatStringDefinition) {
          fsd = nextId()
          add('FormatStringDefinition', { ID: fsd, ObjectID: iid, ObjectType: OBJ.CalculationItem, Expression: it.formatStringDefinition.expression, ModifiedTime: ft, State: 1, ErrorMessage: null })
        }
        add('CalculationItem', { ID: iid, CalculationGroupID: cgId, FormatStringDefinitionID: fsd, Name: it.name, Description: it.description ?? null, ModifiedTime: ft, State: 1, ErrorMessage: null, Expression: it.expression, Ordinal: it.ordinal ?? -1 })
      }
      if (t.calculationGroup.noSelectionExpression !== undefined || t.calculationGroup.multipleOrEmptySelectionExpression !== undefined)
        diagnostics.push(`calculation group '${t.name}': selection expressions are not written`)
    }

    // columns
    for (const cb of tb.columns) writeColumn(tb, cb, tableFolderId, partFolderId)

    // measures
    for (const m of t.measures) {
      const mid = nextId()
      let fsd = 0
      if (m.formatStringDefinition) {
        fsd = nextId()
        add('FormatStringDefinition', { ID: fsd, ObjectID: mid, ObjectType: OBJ.Measure, Expression: m.formatStringDefinition.expression, ModifiedTime: ft, State: 1, ErrorMessage: null })
      }
      add('Measure', {
        ID: mid,
        TableID: tb.id,
        Name: m.name,
        Description: m.description ?? null,
        // the result type is not evaluated: Variant, as real files store measures that return several types
        DataType: m.dataType && TOM_DATA_TYPE[m.dataType] ? TOM_DATA_TYPE[m.dataType]! : 20,
        Expression: m.expression,
        FormatString: m.formatString ?? null,
        IsHidden: m.isHidden ? 1 : 0,
        State: 1,
        ModifiedTime: ft,
        StructureModifiedTime: ft,
        KPIID: 0,
        IsSimpleMeasure: 0,
        ErrorMessage: null,
        DisplayFolder: m.displayFolder ?? null,
        DetailRowsDefinitionID: 0,
        DataCategory: null,
        FormatStringDefinitionID: fsd,
        LineageTag: m.lineageTag ?? null
      })
      annotations(OBJ.Measure, mid, m.annotations)
    }

    // user hierarchies
    for (const h of t.hierarchies) writeUserHierarchy(tb, h)
  }

  // ---- relationships
  for (const r of model.relationships) writeRelationship(r)

  // ---- roles
  for (const role of model.roles) {
    const rid = nextId()
    add('Role', { ID: rid, ModelID: modelId, Name: role.name, Description: null, ModelPermission: MODEL_PERMISSION[role.modelPermission ?? 'read'] ?? 2, ModifiedTime: ft })
    annotations(OBJ.Role, rid, role.annotations)
    for (const tp of role.tablePermissions) {
      const t = tableByName.get(tp.table.toLowerCase())
      if (!t) continue
      add('TablePermission', { ID: nextId(), RoleID: rid, TableID: t.id, FilterExpression: tp.filterExpression ?? null, ModifiedTime: ft, State: 1, ErrorMessage: null, MetadataPermission: 0 })
    }
  }

  return { rows, files, maxId, diagnostics }

  // -------------------------------------------------------------------------------------------

  function writeColumn(tb: TableBuild, cb: ColumnBuild, tableFolderId: number, partFolderId: number): void {
    const c = cb.def
    const isRn = c.kind === 'rowNumber'
    const csId = nextId()
    cb.csId = csId
    const dsId = nextId()
    const ahId = nextId()
    const ahsId = nextId()
    const kind = isRn ? 3 : c.kind === 'calculated' ? 2 : c.kind === 'calculatedTableColumn' ? 4 : 1
    // a table has one key: the row number unless a column is the table's key (a date table's date column, ...);
    // the key column carries ColumnFlags bit 4, which the row number then loses (31 → 27), as real files show
    const keyColumn = tb.columns.find((x) => x.def.kind !== 'rowNumber' && x.def.isKey)
    const keyFlag = isRn ? !keyColumn : keyColumn === cb
    const isKeyColumn = keyColumns.has(`${tb.def.name.toLowerCase()}\u0000${c.name.toLowerCase()}`)
    const empty = tb.rows === 0
    const sortBy = c.sortByColumn ? tb.columns.find((x) => x.def.name === c.sortByColumn) : undefined
    add('Column', {
      ID: cb.id,
      TableID: tb.id,
      ExplicitName: c.name,
      InferredName: null,
      ExplicitDataType: TOM_DATA_TYPE[c.dataType] ?? 6,
      // calculated columns: the inferred type is recorded as well (real files)
      InferredDataType: kind === 2 ? (TOM_DATA_TYPE[c.dataType] ?? 19) : 19,
      DataCategory: c.dataCategory ?? null,
      Description: c.description ?? null,
      IsHidden: c.isHidden || isRn ? 1 : 0,
      State: 1,
      IsUnique: isRn ? 1 : 0,
      IsKey: keyFlag ? 1 : 0,
      IsNullable: isRn || c.isNullable === false ? 0 : 1,
      Alignment: 1,
      TableDetailPosition: -1,
      IsDefaultLabel: 0,
      IsDefaultImage: 0,
      SummarizeBy: isRn ? 1 : (SUMMARIZE[c.summarizeBy ?? 'default'] ?? 1),
      ColumnStorageID: csId,
      Type: kind,
      SourceColumn: isRn ? null : kind === 2 ? null : (c.sourceColumn ?? (kind === 4 ? `[${c.name}]` : c.name)),
      ColumnOriginID: 0,
      Expression: kind === 2 ? (c.expression ?? null) : null,
      FormatString: c.formatString ?? null,
      IsAvailableInMDX: 1,
      SortByColumnID: sortBy?.id ?? 0,
      AttributeHierarchyID: ahId,
      ModifiedTime: ft,
      StructureModifiedTime: ft,
      RefreshedTime: NEVER_REFRESHED,
      SystemFlags: 0,
      KeepUniqueRows: 0,
      DisplayOrdinal: 0,
      ErrorMessage: null,
      DisplayFolder: c.displayFolder ?? null,
      EncodingHint: 0,
      LineageTag: c.lineageTag ?? null,
      SourceLineageTag: c.sourceLineageTag ?? null,
      EvaluationBehavior: 1
    })
    annotations(OBJ.Column, cb.id, c.annotations)
    for (const [name, value] of Object.entries(c.extendedProperties ?? {}))
      add('ExtendedProperty', { ID: nextId(), ObjectID: cb.id, ObjectType: OBJ.Column, Name: name, Type: typeof value === 'string' ? 0 : 1, Value: typeof value === 'string' ? value : JSON.stringify(value), ModifiedTime: ft })

    // streams
    const ver = 1
    const base = `${ver}.${tb.tsName}.${cb.storageName}`
    let streams: ColumnStreams
    let dictFileId = 0
    const enc = cb.enc
    if (isRn) streams = writeRowNumberStreams(tb.rows, SEGMENT_ROWS)
    else {
      streams = writeColumnStreams(enc!.ids, SEGMENT_ROWS, { csFlag: kind === 1 ? 1 : 0 })
    }
    const st = aggregateStats(streams)
    add('ColumnStorage', {
      ID: csId,
      ColumnID: cb.id,
      Name: cb.storageName,
      StoragePosition: cb.storagePos,
      DictionaryStorageID: dsId,
      Settings: kind === 2 ? 2049 : 1,
      ColumnFlags: isRn ? (keyFlag ? 31 : 27) : (isKeyColumn ? 11 : 8) | (keyFlag ? 4 : 0),
      Collation: null,
      OrderByColumn: sortBy ? sortBy.storageName : null,
      Locale: 1033,
      BinaryCharacters: 0,
      Statistics_DistinctStates: isRn ? (empty ? 1 : tb.rows) : enc!.values.length,
      Statistics_MinDataID: st.min,
      Statistics_MaxDataID: st.max,
      Statistics_OriginalMinSegmentDataID: st.originalMin,
      Statistics_RLESortOrder: -1,
      Statistics_RowCount: tb.rows,
      Statistics_HasNulls: st.hasNulls ? 1 : 0,
      Statistics_RLERuns: st.rleRuns,
      Statistics_OthersRLERuns: isRn && empty ? 0 : st.othersRleRuns,
      Statistics_Usage: isKeyColumn ? 0 : 3,
      Statistics_DBType: isRn ? 20 : enc!.codes.dbType,
      Statistics_XMType: isRn ? 0 : enc!.codes.xmType,
      Statistics_CompressionType: 0,
      Statistics_CompressionParam: 0,
      Statistics_EncodingHint: isRn && !empty ? 1 : 0,
      IsDeltaPartitionColumn: 0,
      DeltaColumnMappingId: -1,
      DeltaColumnPrimitiveType: 0,
      DeltaTableColumnStorageID: 0
    })
    if (!isRn) dictFileId = fileId(tableFolderId, dsId, 22, `${base}.dictionary`, tb.tableFolder, enc!.dictionary)
    add('DictionaryStorage', {
      ID: dsId,
      ColumnStorageID: csId,
      // row numbers: value-encoded (id = row + 3); an empty table's row number column is an empty hash dictionary
      Type: isRn && !empty ? 2 : 1,
      DataType: isRn ? 6 : enc!.codes.dictDataType,
      DataVersion: ver,
      BaseId: isRn && !empty ? -3 : 2,
      Magnitude: isRn && !empty ? 1 : 0,
      LastId: isRn ? 2 : 2 + enc!.values.length,
      IsNullable: isRn ? 1 : enc!.hasNulls ? 1 : 0,
      IsUnique: isRn && empty ? 1 : 0,
      IsOperatingOn32: (isRn && empty) || (!isRn && enc!.codes.operatingOn32) ? 1 : 0,
      DictionaryFlags: !isRn && enc!.kind === 'string' ? 3 : 0,
      StorageFileID: dictFileId,
      Size: isRn ? (empty ? 352 : 128) : dictionarySize(enc!)
    })
    const cpsId = nextId()
    const ssId = nextId()
    const idfId = fileId(partFolderId, cpsId, 23, `${base}.0.idf`, tb.partFolder, streams.idf)
    add('ColumnPartitionStorage', { ID: cpsId, ColumnStorageID: csId, PartitionStorageID: tb.partitionStorageId, DataVersion: ver, State: 1, SegmentStorageID: ssId, StorageFileID: idfId })
    const metaId = fileId(partFolderId, ssId, 24, `${base}.0.idfmeta`, tb.partFolder, streams.idfmeta)
    add('SegmentStorage', { ID: ssId, ColumnPartitionStorageID: cpsId, SegmentCount: streams.meta.segments.length, StorageFileID: metaId })

    // attribute hierarchy
    add('AttributeHierarchy', { ID: ahId, ColumnID: cb.id, State: 1, AttributeHierarchyStorageID: ahsId, ModifiedTime: ft, RefreshedTime: ft })
    if (isRn) {
      add('AttributeHierarchyStorage', {
        ID: ahsId,
        AttributeHierarchyID: ahId,
        SortOrder: 0,
        OptimizationLevel: 0,
        MaterializationType: empty ? 2 : 3,
        ColumnPositionToData: -1,
        ColumnDataToPosition: -1,
        DistinctDataCount: tb.rows,
        DataVersion: ver,
        StorageFileID: 0,
        SystemTableID: 0,
        HasStatistics: 1,
        MinValue: empty ? null : '0',
        MaxValue: empty ? null : String(tb.rows - 1),
        StringValueMaxLength: 0
      })
      return
    }
    const sortKeys = (cb as ColumnBuild & { sortKeys?: Array<string | number | undefined> }).sortKeys
    const h = attributeHierarchyStreams(enc!.values, enc!.hasNulls, sortKeys)
    const rank = new Int32Array(enc!.values.length + 3)
    h.order.forEach((id, pos) => (rank[id] = pos))
    cb.rankOfId = rank
    const nonNull = h.order.filter((id) => id >= 3)
    const minV = nonNull.length ? enc!.values[nonNull[0] - 3] : undefined
    const maxV = nonNull.length ? enc!.values[nonNull[nonNull.length - 1] - 3] : undefined
    // min / max in attribute-hierarchy order (by the sort-by column when there is one, as real files show)
    const lo = minV
    const hi = maxV
    const sysId = systemTable(`H$${tb.tsName}$${cb.storageName}`, 4, [
      { name: 'POS_TO_ID', streams: h.posToId, settings: 7 },
      { name: 'ID_TO_POS', streams: h.idToPos, settings: 5 }
    ], { type: 2, records: enc!.values.length + 3, perSegment: Math.max(1, h.distinct) })
    let maxLen = 0
    if (enc!.kind === 'string') for (const s of enc!.values as string[]) if (s.length > maxLen) maxLen = s.length
    add('AttributeHierarchyStorage', {
      ID: ahsId,
      AttributeHierarchyID: ahId,
      SortOrder: 0,
      OptimizationLevel: 0,
      MaterializationType: 0,
      ColumnPositionToData: 0,
      ColumnDataToPosition: 1,
      DistinctDataCount: h.distinct,
      DataVersion: ver,
      StorageFileID: 0,
      SystemTableID: sysId,
      HasStatistics: 1,
      MinValue: lo === undefined ? null : statText(lo, c.dataType),
      MaxValue: hi === undefined ? null : statText(hi, c.dataType),
      StringValueMaxLength: maxLen
    })
  }

  /** A system table (H$ / R$ / U$): Table, TableStorage, folders, partition, segment map, columns and files. */
  function systemTable(
    name: string,
    tsSettings: number,
    cols: Array<{ name: string; streams: ColumnStreams; settings: number; binaryCharacters?: number }>,
    map: { type: number; records: number; perSegment: number }
  ): number {
    const id = nextId()
    const tsId = nextId()
    add('Table', {
      ID: id,
      ModelID: 0,
      Name: name,
      IsHidden: 1,
      TableStorageID: tsId,
      ModifiedTime: ft,
      StructureModifiedTime: ft,
      SystemFlags: 1,
      ShowAsVariationsOnly: 0,
      IsPrivate: 0,
      CalculationGroupID: 0
    })
    const folder = `${name}$(${id}).tbl`
    const tFolder = folderId(tsId, 18, folder)
    add('TableStorage', { ID: tsId, TableID: id, Name: name, Version: 1, Settings: tsSettings, RIViolationCount: 0, StorageFolderID: tFolder })
    const pid = nextId()
    const psId = nextId()
    add('Partition', {
      ID: pid,
      TableID: id,
      Name: name,
      DataSourceID: 0,
      QueryDefinition: null,
      State: 1,
      Type: 3,
      PartitionStorageID: psId,
      Mode: 2,
      DataView: 3,
      ModifiedTime: ft,
      RefreshedTime: NEVER_REFRESHED,
      SystemFlags: 1,
      RangeGranularity: -1,
      QueryGroupID: 0,
      ExpressionSourceID: 0
    })
    const pFolderPath = `${folder}\\${pid}.prt`
    const pFolder = folderId(psId, 20, pFolderPath)
    const smsId = nextId()
    add('PartitionStorage', { ID: psId, PartitionID: pid, Name: name, StoragePosition: 0, SegmentMapStorageID: smsId, DataObjectId: 0, StorageFolderID: pFolder })
    add('SegmentMapStorage', { ID: smsId, PartitionStorageID: psId, Type: map.type, RecordCount: map.records, SegmentCount: cols[0].streams.meta.segments.length, RecordsPerSegment: map.perSegment })
    cols.forEach((col, i) => {
      const cid = nextId()
      const csId = nextId()
      const dsId = nextId()
      add('Column', {
        ID: cid,
        TableID: id,
        ExplicitName: col.name,
        ExplicitDataType: 6,
        InferredDataType: 19,
        IsHidden: 0,
        State: 1,
        IsUnique: 0,
        IsKey: 0,
        IsNullable: 1,
        Alignment: 1,
        TableDetailPosition: -1,
        SummarizeBy: 1,
        ColumnStorageID: csId,
        Type: 1,
        IsAvailableInMDX: 1,
        AttributeHierarchyID: 0,
        ModifiedTime: ft,
        StructureModifiedTime: ft,
        RefreshedTime: NEVER_REFRESHED,
        SystemFlags: 1,
        EvaluationBehavior: 1
      })
      add('ColumnStorage', {
        ID: csId,
        ColumnID: cid,
        Name: col.name,
        StoragePosition: i,
        DictionaryStorageID: dsId,
        Settings: col.settings,
        ColumnFlags: 0,
        Locale: 0,
        BinaryCharacters: col.binaryCharacters ?? 0,
        Statistics_DistinctStates: 1,
        Statistics_MinDataID: 2,
        Statistics_MaxDataID: 2,
        Statistics_OriginalMinSegmentDataID: 2,
        Statistics_RLESortOrder: -1,
        Statistics_RowCount: 0,
        Statistics_HasNulls: 0,
        Statistics_RLERuns: 0,
        Statistics_OthersRLERuns: 0,
        Statistics_Usage: 3,
        DeltaColumnMappingId: -1
      })
      add('DictionaryStorage', { ID: dsId, ColumnStorageID: csId, Type: 0, DataType: 19, DataVersion: 0, BaseId: 0, Magnitude: 0, LastId: 0, IsNullable: 0, IsUnique: 0, IsOperatingOn32: 0, DictionaryFlags: 0, StorageFileID: 0, Size: 0 })
      const cpsId = nextId()
      const ssId = nextId()
      const base = `1.${name}.${col.name}`
      const idf = fileId(pFolder, cpsId, 23, `${base}.0.idf`, pFolderPath, col.streams.idf)
      add('ColumnPartitionStorage', { ID: cpsId, ColumnStorageID: csId, PartitionStorageID: psId, DataVersion: 1, State: 3, SegmentStorageID: ssId, StorageFileID: idf })
      const meta = fileId(pFolder, ssId, 24, `${base}.0.idfmeta`, pFolderPath, col.streams.idfmeta)
      add('SegmentStorage', { ID: ssId, ColumnPartitionStorageID: cpsId, SegmentCount: col.streams.meta.segments.length, StorageFileID: meta })
    })
    return id
  }

  function writeUserHierarchy(tb: TableBuild, h: TableDef['hierarchies'][number]): void {
    const hid = nextId()
    const hsId = nextId()
    const levels = [...h.levels].sort((a, b) => a.ordinal - b.ordinal)
    const cols = levels.map((l) => tb.columns.find((c) => c.def.name === l.column))
    if (cols.some((c) => !c?.enc)) {
      diagnostics.push(`hierarchy '${tb.def.name}'[${h.name}] skipped: a level column is missing`)
      return
    }
    add('Hierarchy', {
      ID: hid,
      TableID: tb.id,
      Name: h.name,
      Description: null,
      IsHidden: h.isHidden ? 1 : 0,
      State: 1,
      HierarchyStorageID: hsId,
      ModifiedTime: ft,
      StructureModifiedTime: ft,
      RefreshedTime: ft,
      DisplayFolder: h.displayFolder ?? null,
      HideMembers: 0,
      LineageTag: h.lineageTag ?? null
    })
    annotations(OBJ.Hierarchy, hid, h.annotations)
    levels.forEach((l, i) => {
      const lid = nextId()
      add('Level', { ID: lid, HierarchyID: hid, Ordinal: i, Name: l.name, Description: null, ColumnID: cols[i]!.id, ModifiedTime: ft, LineageTag: l.lineageTag ?? null })
      annotations(OBJ.Level, lid, l.annotations)
    })
    const u = userHierarchyStreams(
      cols.map((c) => c!.enc!.ids),
      cols.map((c) => c!.rankOfId!),
      tb.rows
    )
    const hsName = storageName(h.name, hid)
    const sysId = systemTable(`U$${tb.tsName}$${hsName}`, 5, [
      { name: 'MULTI_LEVEL_ID', streams: u.multiLevelId, settings: 16, binaryCharacters: 10240 },
      { name: 'PARENT_POS', streams: u.parentPos, settings: 8, binaryCharacters: 10240 },
      { name: 'FIRST_CHILD_POS', streams: u.firstChildPos, settings: 9, binaryCharacters: 10240 },
      { name: 'CHILD_COUNT', streams: u.childCount, settings: 17, binaryCharacters: 10240 }
    ], { type: 3, records: u.members, perSegment: u.members })
    const def = cols.map((c, i) => `${c!.storageName}$${u.levelStarts[i]}$`).join('')
    add('HierarchyStorage', { ID: hsId, HierarchyID: hid, Name: hsName, LevelDefinition: `$${def}`, MaterializationType: 0, StructureType: 2, SystemTableID: sysId })
  }

  function writeRelationship(r: RelationshipDef): void {
    // TOM direction: "from" = many side
    const from = columnOf(r.fromTable, r.fromColumn)
    const to = columnOf(r.toTable, r.toColumn)
    if (!from || !to || !from.c.enc || !to.c.enc) {
      diagnostics.push(`relationship ${r.name} skipped: a column is missing`)
      return
    }
    const rid = nextId()
    const rsId = nextId()
    const risId = nextId()
    add('Relationship', {
      ID: rid,
      ModelID: modelId,
      Name: r.name,
      IsActive: r.isActive ? 1 : 0,
      Type: 1,
      CrossFilteringBehavior: CROSS_FILTER[r.crossFilteringBehavior] ?? 1,
      JoinOnDateBehavior: r.joinOnDateBehavior === 'datePartOnly' ? 2 : 1,
      RelyOnReferentialIntegrity: r.relyOnReferentialIntegrity ? 1 : 0,
      FromTableID: from.t.id,
      FromColumnID: from.c.id,
      FromCardinality: 2,
      ToTableID: to.t.id,
      ToColumnID: to.c.id,
      ToCardinality: 1,
      State: 1,
      RelationshipStorageID: rsId,
      RelationshipStorage2ID: 0,
      ModifiedTime: ft,
      RefreshedTime: ft,
      SecurityFilteringBehavior: SECURITY_FILTER[r.securityFilteringBehavior ?? 'oneDirection'] ?? 1
    })
    annotations(OBJ.Relationship, rid, r.annotations)
    // to-side key → row (first row with the key; text compared case-insensitively)
    const fe = from.c.enc
    const te = to.c.enc
    const key = (v: string | number): string | number => (typeof v === 'string' ? textKey(v) : v)
    const toRowOfValue = new Map<string | number, number>()
    for (let row = 0; row < to.t.rows; row++) {
      const id = te.ids[row]
      if (id < 3) continue
      const k = key(te.values[id - 3])
      if (!toRowOfValue.has(k)) toRowOfValue.set(k, row)
    }
    const fromStored = (id: number): string | number => fe.values[id - 3]
    let unmatched = 0
    const streams = relationshipIndexStreams(fe.values.length + 3, (id) => {
      const v = fromStored(id)
      const k = fe.kind === te.kind ? key(v) : key(crossKindValue(v, from.c.def.dataType, to.c.def.dataType))
      const row = toRowOfValue.get(k)
      if (row === undefined) unmatched++
      return row
    })
    if (unmatched) diagnostics.push(`relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]: ${unmatched} key value(s) have no match`)
    const rsName = storageName(r.name, rid)
    const sysId = systemTable(`R$${from.t.tsName}$${rsName}`, 2, [{ name: 'INDEX', streams, settings: 3 }], { type: 3, records: fe.values.length + 3, perSegment: fe.values.length + 3 })
    add('RelationshipStorage', { ID: rsId, RelationshipID: rid, Name: rsName, DefinitionType: 0, Cardinality: 0, Flags: 0, RelationshipIndexStorageID: risId })
    add('RelationshipIndexStorage', {
      ID: risId,
      RelationshipStorageID: rsId,
      IndexType: 1,
      Flags: 0,
      RecordCount: fe.values.length + 3,
      SecondaryRecordCount: 0,
      StorageFolderID: 0,
      StorageFileID: 0,
      SystemTableID: sysId,
      SecondarySystemTableID: 0
    })
  }
}

/** A key of one stored kind compared with a column of another (e.g. whole number ↔ text keys). */
function crossKindValue(v: string | number, fromType: DataType, toType: DataType): string | number {
  if (fromType === toType) return v
  const s = storedValue(typeof v === 'number' && fromType === 'dateTime' ? new Date(Math.round((v - 25569) * 86400000)) : v, toType)
  return s ?? v
}

/** Approximate in-memory size recorded in `DictionaryStorage.Size` (fitted to the November 2025 file; not read back). */
function dictionarySize(enc: EncodedColumn): number {
  const n = enc.values.length
  if (enc.kind === 'string') {
    let chars = 0
    for (const s of enc.values as string[]) chars += s.length + 1
    return 17068 + 12 * n + 2 * chars
  }
  if (enc.kind === 'real') return 2292 + 8 * n
  return enc.codes.operatingOn32 ? 1296 + 4 * n : 1296 + 8 * n
}

function aggregateStats(s: ColumnStreams): { min: number; max: number; originalMin: number; hasNulls: boolean; rleRuns: number; othersRleRuns: number } {
  let min = Infinity
  let max = 0
  let hasNulls = false
  let rleRuns = 0
  let others = 0
  let originalMin = 2
  for (const seg of s.meta.segments) {
    min = Math.min(min, seg.stats.minDataId)
    max = Math.max(max, seg.stats.maxDataId)
    hasNulls ||= seg.stats.hasNulls
    rleRuns += seg.stats.rleRuns
    others += seg.stats.othersRleRuns
    originalMin = seg.stats.originalMinSegmentDataId
  }
  return { min: min === Infinity ? 2 : min, max, originalMin, hasNulls, rleRuns, othersRleRuns: others }
}

/** Rows of a calculation group table: one per item (name, ordinal), in ordinal order. */
function calculationGroupData(t: TableDef): TableData {
  const items = [...(t.calculationGroup?.items ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  const columns = t.columns
    .filter((c) => c.kind !== 'rowNumber')
    .map((c) => {
      const src = (c.sourceColumn ?? c.name).toLowerCase()
      const values: Scalar[] = items.map((it) => (src === 'ordinal' ? (it.ordinal ?? -1) : src === 'name' ? it.name : null))
      return { name: c.name, type: c.dataType, values }
    })
  return { columns, rowCount: items.length }
}
