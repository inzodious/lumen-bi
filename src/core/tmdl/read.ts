/**
 * TMDL folder -> SemanticModel.
 *
 * Accepts the files of a `definition/` folder (relative path -> text). Any file layout is accepted
 * (single-file TMDL too); Power BI's layout is database.tmdl, model.tmdl, tables/*.tmdl,
 * relationships.tmdl, expressions.tmdl, roles/*, perspectives/*, cultures/*, dataSources.tmdl.
 * Defaults follow TOM: relationships many->one, single direction, active; expressions kind `m`.
 * Everything we do not model goes to `extra` (see write.ts for the representation) and formatting
 * hints are captured so that writing an unmodified model reproduces the input text.
 */
import type { FunctionDef,
  CalculationGroupDef,
  CalculationItemDef,
  Cardinality,
  ColumnDef,
  CrossFilteringBehavior,
  CultureDef,
  DataType,
  HierarchyDef,
  HierarchyLevelDef,
  MeasureDef,
  NamedExpressionDef,
  PartitionDef,
  PartitionMode,
  PerspectiveDef,
  RelationshipDef,
  RoleDef,
  SemanticModel,
  SummarizeBy,
  TableDef
} from '../model/types'
import { hintEntry, newHint, type ObjHint } from './hints'
import { decodeTextValue, parseQualified, unquoteName } from './names'
import { nodeSource, parseTmdlText, type TmdlDocument, type TmdlError, type TmdlNode } from './parser'
import { genericKey, writeTmdlFiles, type DatabaseInfo, type TmdlGenericNode, type TmdlRawFiles } from './write'

export interface TmdlReadResult {
  model: SemanticModel
  /** syntax errors (file + line) */
  errors: TmdlError[]
  /** non-fatal notes */
  diagnostics: string[]
}

const DATA_TYPES = new Set<DataType>(['string', 'int64', 'double', 'decimal', 'boolean', 'dateTime', 'binary', 'variant', 'unknown'])
const PARTITION_SOURCES = new Set(['m', 'calculated', 'entity', 'calculationGroup', 'policyRange', 'query'])

type Extra = Record<string, unknown>

class Ctx {
  constructor(
    readonly doc: TmdlDocument,
    readonly file: string
  ) {}
  src(n: TmdlNode): string[] {
    return nodeSource(this.doc, n)
  }
}

function bool(n: TmdlNode): boolean {
  if (n.sep !== ':') return true
  return (n.value ?? '').trim().toLowerCase() !== 'false'
}

function num(n: TmdlNode): number | undefined {
  const v = Number((n.value ?? '').trim())
  return Number.isFinite(v) ? v : undefined
}

function text(n: TmdlNode): string {
  return decodeTextValue(n.value ?? '')
}

function ref(n: TmdlNode): string {
  return unquoteName(n.value ?? '')
}

function toGeneric(n: TmdlNode): TmdlGenericNode {
  const g: TmdlGenericNode = { keyword: n.keyword }
  if (n.name !== undefined) g.name = n.name
  if (n.sep !== undefined) g.sep = n.sep
  if (n.value !== undefined) g.value = n.value
  if (n.sep === '=' && n.exprStyle) g.exprStyle = n.exprStyle
  if (n.description !== undefined) g.description = n.description
  if (n.children.length) g.children = n.children.map(toGeneric)
  return g
}

/** Store an unmodeled property / child object in `extra` and record its hint. */
function unknown(ctx: Ctx, holder: { extra?: Extra }, n: TmdlNode, h: ObjHint | undefined): void {
  const extra = (holder.extra ??= {})
  if (n.children.length || n.name !== undefined || n.description !== undefined) {
    const list = ((extra['@children'] as TmdlGenericNode[] | undefined) ??= [])
    const g = toGeneric(n)
    const key = genericKey(g, list.length)
    list.push(g)
    hintEntry(h, key, ctx.src(n), true, '@child')
    return
  }
  if (n.sep === ':') extra[n.keyword] = n.value ?? ''
  else if (n.sep === '=') extra[n.keyword] = { $tmdlExpr: n.value ?? '', style: n.exprStyle ?? 'property' }
  else extra[n.keyword] = true
  hintEntry(h, n.keyword, ctx.src(n), false, 'prop')
}

function prop(h: ObjHint | undefined, ctx: Ctx, n: TmdlNode): void {
  hintEntry(h, n.keyword, ctx.src(n), false, 'prop')
}

function annotation(ctx: Ctx, holder: { annotations?: Record<string, string> }, n: TmdlNode, h: ObjHint | undefined): void {
  const name = n.name ?? ''
  ;(holder.annotations ??= {})[name] = n.value ?? ''
  hintEntry(h, `annotation:${name}`, ctx.src(n), true, 'annotation')
}

function changedProperty(ctx: Ctx, holder: { changedProperties?: string[] }, n: TmdlNode, h: ObjHint | undefined): void {
  const p = (n.value ?? n.name ?? '').trim()
  ;(holder.changedProperties ??= []).push(p)
  hintEntry(h, `changedProperty:${p}`, ctx.src(n), true, 'changedProperty')
}

// ---------------------------------------------------------------------------------------------

function readColumn(ctx: Ctx, n: TmdlNode): ColumnDef {
  const c: ColumnDef = { name: n.name ?? '', dataType: 'unknown', kind: n.sep === '=' ? 'calculated' : 'data' }
  if (n.sep === '=') c.expression = n.value ?? ''
  if (n.description !== undefined) c.description = n.description
  const h = newHint(c, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'dataType': {
        const v = (ch.value ?? '').trim()
        if (DATA_TYPES.has(v as DataType)) c.dataType = v as DataType
        else (c.extra ??= {}).dataType = v
        prop(h, ctx, ch)
        break
      }
      case 'isHidden':
        c.isHidden = bool(ch)
        prop(h, ctx, ch)
        break
      case 'isKey':
        c.isKey = bool(ch)
        prop(h, ctx, ch)
        break
      case 'isNullable':
        c.isNullable = bool(ch)
        prop(h, ctx, ch)
        break
      case 'isAvailableInMdx':
        c.isAvailableInMdx = bool(ch)
        prop(h, ctx, ch)
        break
      case 'formatString':
        c.formatString = text(ch)
        prop(h, ctx, ch)
        break
      case 'displayFolder':
        c.displayFolder = text(ch)
        prop(h, ctx, ch)
        break
      case 'lineageTag':
        c.lineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'sourceLineageTag':
        c.sourceLineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'dataCategory':
        c.dataCategory = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'summarizeBy':
        c.summarizeBy = (ch.value ?? '').trim() as SummarizeBy
        prop(h, ctx, ch)
        break
      case 'sourceColumn':
        if (ch.sep === ':') {
          c.sourceColumn = text(ch)
          prop(h, ctx, ch)
        } else unknown(ctx, c, ch, h)
        break
      case 'sortByColumn':
        c.sortByColumn = ref(ch)
        prop(h, ctx, ch)
        break
      case 'variation': {
        const v: NonNullable<ColumnDef['variations']>[number] = { name: ch.name ?? '', relationship: '', defaultHierarchy: '' }
        for (const vp of ch.children) {
          if (vp.keyword === 'isDefault') v.isDefault = bool(vp)
          else if (vp.keyword === 'relationship') v.relationship = ref(vp)
          else if (vp.keyword === 'defaultHierarchy') v.defaultHierarchy = (vp.value ?? '').trim()
        }
        ;(c.variations ??= []).push(v)
        hintEntry(h, `variation:${v.name}`, ctx.src(ch), true, 'variation')
        break
      }
      case 'extendedProperty': {
        const raw = ch.value ?? ''
        let value: unknown
        try {
          value = JSON.parse(raw)
        } catch {
          value = { $tmdlRaw: raw }
        }
        ;(c.extendedProperties ??= {})[ch.name ?? ''] = value
        hintEntry(h, `extendedProperty:${ch.name ?? ''}`, ctx.src(ch), true, 'extendedProperty')
        break
      }
      case 'annotation':
        annotation(ctx, c, ch, h)
        break
      case 'changedProperty':
        changedProperty(ctx, c, ch, h)
        break
      default:
        unknown(ctx, c, ch, h)
    }
  }
  return c
}

function readMeasure(ctx: Ctx, n: TmdlNode): MeasureDef {
  const m: MeasureDef = { name: n.name ?? '', expression: n.value ?? '' }
  if (n.description !== undefined) m.description = n.description
  const h = newHint(m, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'dataType': {
        const v = (ch.value ?? '').trim()
        if (DATA_TYPES.has(v as DataType)) {
          m.dataType = v as DataType
          prop(h, ctx, ch)
        } else unknown(ctx, m, ch, h)
        break
      }
      case 'isHidden':
        m.isHidden = bool(ch)
        prop(h, ctx, ch)
        break
      case 'formatString':
        m.formatString = text(ch)
        prop(h, ctx, ch)
        break
      case 'displayFolder':
        m.displayFolder = text(ch)
        prop(h, ctx, ch)
        break
      case 'lineageTag':
        m.lineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'formatStringDefinition':
        m.formatStringDefinition = { expression: ch.value ?? '' }
        hintEntry(h, 'formatStringDefinition', ctx.src(ch), true, 'formatStringDefinition')
        break
      case 'detailRowsDefinition':
        m.detailRowsDefinition = ch.value ?? ''
        hintEntry(h, 'detailRowsDefinition', ctx.src(ch), true, 'detailRowsDefinition')
        break
      case 'kpi': {
        const kpi: NonNullable<MeasureDef['kpi']> = {}
        for (const kp of ch.children) {
          if (kp.keyword === 'targetExpression') kpi.targetExpression = kp.value ?? ''
          else if (kp.keyword === 'statusExpression') kpi.statusExpression = kp.value ?? ''
          else if (kp.keyword === 'trendExpression') kpi.trendExpression = kp.value ?? ''
          else if (kp.keyword === 'statusGraphic') kpi.statusGraphic = text(kp)
          else if (kp.keyword === 'trendGraphic') kpi.trendGraphic = text(kp)
          else unknown(ctx, kpi, kp, undefined)
        }
        m.kpi = kpi
        hintEntry(h, 'kpi', ctx.src(ch), true, 'kpi')
        break
      }
      case 'annotation':
        annotation(ctx, m, ch, h)
        break
      case 'changedProperty':
        changedProperty(ctx, m, ch, h)
        break
      default:
        unknown(ctx, m, ch, h)
    }
  }
  return m
}

function readHierarchy(ctx: Ctx, n: TmdlNode): HierarchyDef {
  const hd: HierarchyDef = { name: n.name ?? '', levels: [] }
  if (n.description !== undefined) (hd.extra ??= {})['@description'] = n.description
  const h = newHint(hd, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'isHidden':
        hd.isHidden = bool(ch)
        prop(h, ctx, ch)
        break
      case 'displayFolder':
        hd.displayFolder = text(ch)
        prop(h, ctx, ch)
        break
      case 'lineageTag':
        hd.lineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'level': {
        const lv: HierarchyLevelDef = { name: ch.name ?? '', column: '', ordinal: hd.levels.length }
        const lh = newHint(lv, ch.raw)
        for (const lp of ch.children) {
          if (lp.keyword === 'lineageTag') {
            lv.lineageTag = (lp.value ?? '').trim()
            prop(lh, ctx, lp)
          } else if (lp.keyword === 'column') {
            lv.column = ref(lp)
            prop(lh, ctx, lp)
          } else if (lp.keyword === 'annotation') annotation(ctx, lv, lp, lh)
          else unknown(ctx, lv, lp, lh)
        }
        hd.levels.push(lv)
        hintEntry(h, `level:${lv.name}`, undefined, true, 'level')
        break
      }
      case 'annotation':
        annotation(ctx, hd, ch, h)
        break
      default:
        unknown(ctx, hd, ch, h)
    }
  }
  return hd
}

function readPartition(ctx: Ctx, n: TmdlNode): PartitionDef {
  const st = (n.value ?? '').trim()
  const p: PartitionDef = { name: n.name ?? '', sourceType: PARTITION_SOURCES.has(st) ? (st as PartitionDef['sourceType']) : 'unknown' }
  if (p.sourceType === 'unknown') (p.extra ??= {})['@sourceType'] = st
  if (n.description !== undefined) (p.extra ??= {})['@description'] = n.description
  const h = newHint(p, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'mode':
        p.mode = (ch.value ?? '').trim() as PartitionMode
        prop(h, ctx, ch)
        break
      case 'queryGroup':
        p.queryGroup = ref(ch)
        prop(h, ctx, ch)
        break
      case 'source': {
        if (ch.sep === '=') p.expression = ch.value ?? ''
        for (const sp of ch.children) {
          if (sp.keyword === 'entityName') p.entityName = text(sp)
          else if (sp.keyword === 'schemaName') p.schemaName = text(sp)
          else if (sp.keyword === 'expressionSource') p.expressionSource = ref(sp)
          else {
            const tmp: { extra?: Extra } = {}
            unknown(ctx, tmp, sp, undefined)
            for (const [k, v] of Object.entries(tmp.extra ?? {})) (p.extra ??= {})[k === '@children' ? '@sourceChildren' : `source.${k}`] = v
          }
        }
        hintEntry(h, 'source', ctx.src(ch), false, 'prop')
        break
      }
      case 'annotation':
        annotation(ctx, p, ch, h)
        break
      default:
        unknown(ctx, p, ch, h)
    }
  }
  return p
}

function readCalcGroup(ctx: Ctx, n: TmdlNode): CalculationGroupDef {
  const cg: CalculationGroupDef = { items: [] }
  const h = newHint(cg, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'precedence':
        cg.precedence = num(ch)
        prop(h, ctx, ch)
        break
      case 'calculationItem': {
        const ci: CalculationItemDef = { name: ch.name ?? '', expression: ch.value ?? '' }
        if (ch.description !== undefined) ci.description = ch.description
        const ih = newHint(ci, ch.raw)
        for (const ip of ch.children) {
          if (ip.keyword === 'ordinal') {
            ci.ordinal = num(ip)
            prop(ih, ctx, ip)
          } else if (ip.keyword === 'formatStringDefinition') {
            ci.formatStringDefinition = { expression: ip.value ?? '' }
            hintEntry(ih, 'formatStringDefinition', ctx.src(ip), true, 'formatStringDefinition')
          } else unknown(ctx, ci, ip, ih)
        }
        cg.items.push(ci)
        hintEntry(h, `calculationItem:${ci.name}`, undefined, true, 'calculationItem')
        break
      }
      case 'noSelectionExpression':
        cg.noSelectionExpression = ch.value ?? ''
        hintEntry(h, 'noSelectionExpression', ctx.src(ch), true, 'noSelectionExpression')
        break
      case 'multipleOrEmptySelectionExpression':
        cg.multipleOrEmptySelectionExpression = ch.value ?? ''
        hintEntry(h, 'multipleOrEmptySelectionExpression', ctx.src(ch), true, 'multipleOrEmptySelectionExpression')
        break
      default:
        unknown(ctx, cg, ch, h)
    }
  }
  return cg
}

function readRefreshPolicy(n: TmdlNode): Record<string, unknown> {
  const rp: Record<string, unknown> = {}
  for (const ch of n.children) {
    if (ch.sep === '=') rp[ch.keyword] = ch.value ?? ''
    else if (ch.sep === ':') {
      const v = (ch.value ?? '').trim()
      rp[ch.keyword] = /^-?\d+$/.test(v) ? Number(v) : v
    } else rp[ch.keyword] = true
  }
  return rp
}

function readTable(ctx: Ctx, n: TmdlNode): TableDef {
  const t: TableDef = { name: n.name ?? '', columns: [], measures: [], hierarchies: [], partitions: [] }
  if (n.description !== undefined) t.description = n.description
  const h = newHint(t, n.raw)
  h.file = ctx.file
  h.fileFor = t.name
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'isHidden':
        t.isHidden = bool(ch)
        prop(h, ctx, ch)
        break
      case 'isPrivate':
        t.isPrivate = bool(ch)
        prop(h, ctx, ch)
        break
      case 'showAsVariationsOnly':
        t.showAsVariationsOnly = bool(ch)
        prop(h, ctx, ch)
        break
      case 'lineageTag':
        t.lineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'sourceLineageTag':
        t.sourceLineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'dataCategory':
        t.dataCategory = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'column': {
        const c = readColumn(ctx, ch)
        t.columns.push(c)
        hintEntry(h, `column:${c.name}`, undefined, true, 'column')
        break
      }
      case 'measure': {
        const m = readMeasure(ctx, ch)
        t.measures.push(m)
        hintEntry(h, `measure:${m.name}`, undefined, true, 'measure')
        break
      }
      case 'hierarchy': {
        const hd = readHierarchy(ctx, ch)
        t.hierarchies.push(hd)
        hintEntry(h, `hierarchy:${hd.name}`, undefined, true, 'hierarchy')
        break
      }
      case 'partition': {
        const p = readPartition(ctx, ch)
        t.partitions.push(p)
        hintEntry(h, `partition:${p.name}`, undefined, true, 'partition')
        break
      }
      case 'calculationGroup':
        t.calculationGroup = readCalcGroup(ctx, ch)
        hintEntry(h, 'calculationGroup', undefined, true, 'calculationGroup')
        break
      case 'refreshPolicy':
        t.refreshPolicy = readRefreshPolicy(ch)
        hintEntry(h, 'refreshPolicy', ctx.src(ch), true, 'refreshPolicy')
        break
      case 'annotation':
        annotation(ctx, t, ch, h)
        break
      case 'changedProperty':
        changedProperty(ctx, t, ch, h)
        break
      default:
        unknown(ctx, t, ch, h)
    }
  }
  if (t.partitions.some((p) => p.sourceType === 'calculated')) for (const c of t.columns) if (c.kind === 'data') c.kind = 'calculatedTableColumn'
  return t
}

function readRelationship(ctx: Ctx, n: TmdlNode): RelationshipDef {
  const r: RelationshipDef = {
    name: n.name ?? '',
    fromTable: '',
    fromColumn: '',
    toTable: '',
    toColumn: '',
    fromCardinality: 'many',
    toCardinality: 'one',
    crossFilteringBehavior: 'oneDirection',
    isActive: true
  }
  const h = newHint(r, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'isActive':
        r.isActive = bool(ch)
        prop(h, ctx, ch)
        break
      case 'crossFilteringBehavior':
        r.crossFilteringBehavior = (ch.value ?? '').trim() as CrossFilteringBehavior
        prop(h, ctx, ch)
        break
      case 'fromCardinality':
        r.fromCardinality = (ch.value ?? '').trim() as Cardinality
        prop(h, ctx, ch)
        break
      case 'toCardinality':
        r.toCardinality = (ch.value ?? '').trim() as Cardinality
        prop(h, ctx, ch)
        break
      case 'fromColumn': {
        const q = parseQualified(ch.value ?? '')
        r.fromTable = q.table
        r.fromColumn = q.member
        prop(h, ctx, ch)
        break
      }
      case 'toColumn': {
        const q = parseQualified(ch.value ?? '')
        r.toTable = q.table
        r.toColumn = q.member
        prop(h, ctx, ch)
        break
      }
      case 'securityFilteringBehavior':
        r.securityFilteringBehavior = (ch.value ?? '').trim() as RelationshipDef['securityFilteringBehavior']
        prop(h, ctx, ch)
        break
      case 'joinOnDateBehavior':
        r.joinOnDateBehavior = (ch.value ?? '').trim() as RelationshipDef['joinOnDateBehavior']
        prop(h, ctx, ch)
        break
      case 'relyOnReferentialIntegrity':
        r.relyOnReferentialIntegrity = bool(ch)
        prop(h, ctx, ch)
        break
      case 'annotation':
        annotation(ctx, r, ch, h)
        break
      default:
        unknown(ctx, r, ch, h)
    }
  }
  return r
}

function readExpression(ctx: Ctx, n: TmdlNode): NamedExpressionDef {
  const e: NamedExpressionDef = { name: n.name ?? '', kind: 'm', expression: n.value ?? '' }
  if (n.description !== undefined) e.description = n.description
  const h = newHint(e, n.raw)
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'kind': {
        const k = (ch.value ?? '').trim()
        if (k === 'm' || k === 'dax') {
          e.kind = k
          prop(h, ctx, ch)
        } else unknown(ctx, e, ch, h)
        break
      }
      case 'lineageTag':
        e.lineageTag = (ch.value ?? '').trim()
        prop(h, ctx, ch)
        break
      case 'queryGroup':
        e.queryGroup = ref(ch)
        prop(h, ctx, ch)
        break
      case 'annotation':
        annotation(ctx, e, ch, h)
        break
      default:
        unknown(ctx, e, ch, h)
    }
  }
  return e
}

function readRole(ctx: Ctx, n: TmdlNode): RoleDef {
  const r: RoleDef = { name: n.name ?? '', tablePermissions: [] }
  if (n.description !== undefined) (r.extra ??= {})['@description'] = n.description
  const h = newHint(r, n.raw)
  h.file = ctx.file
  h.fileFor = r.name
  for (const ch of n.children) {
    switch (ch.keyword) {
      case 'modelPermission':
        r.modelPermission = (ch.value ?? '').trim() as RoleDef['modelPermission']
        prop(h, ctx, ch)
        break
      case 'member':
        if (ch.children.length) unknown(ctx, r, ch, h)
        else {
          ;(r.members ??= []).push(ch.name ?? '')
          hintEntry(h, `member:${ch.name ?? ''}`, ctx.src(ch), true, 'member')
        }
        break
      case 'tablePermission': {
        const tp: RoleDef['tablePermissions'][number] = { table: ch.name ?? '' }
        if (ch.sep === '=') tp.filterExpression = ch.value ?? ''
        for (const tc of ch.children) unknown(ctx, tp, tc, undefined)
        r.tablePermissions.push(tp)
        hintEntry(h, `tablePermission:${tp.table}`, ctx.src(ch), true, 'tablePermission')
        break
      }
      case 'annotation':
        annotation(ctx, r, ch, h)
        break
      default:
        unknown(ctx, r, ch, h)
    }
  }
  return r
}

// ---------------------------------------------------------------------------------------------

function fileOrder(path: string): number {
  if (/(^|\/)database\.tmdl$/i.test(path)) return 0
  if (/(^|\/)model\.tmdl$/i.test(path)) return 1
  return 2
}

/** Parse the files of a TMDL `definition/` folder (relative path -> text). */
export function readTmdlFiles(files: Record<string, string>): TmdlReadResult {
  const errors: TmdlError[] = []
  const diagnostics: string[] = []
  const model: SemanticModel = { name: 'Model', tables: [], relationships: [], expressions: [], roles: [] }
  const mh = newHint(model)
  const refs: Record<string, string[]> = {}
  const rawFiles: TmdlRawFiles = {}
  let dbInfo: DatabaseInfo | undefined
  const paths = Object.keys(files)
    .filter((p) => p.toLowerCase().endsWith('.tmdl'))
    .sort((a, b) => fileOrder(a) - fileOrder(b) || (a < b ? -1 : a > b ? 1 : 0))

  for (const file of paths) {
    const doc = parseTmdlText(files[file], file)
    ;(mh.fileTails ??= {})[file] = /\s*$/.exec(files[file].replace(/\r\n?/g, '\n'))![0]
    errors.push(...doc.errors)
    const ctx = new Ctx(doc, file)
    for (const n of doc.nodes) {
      switch (n.keyword) {
        case 'database': {
          const db: DatabaseInfo = {}
          if (n.name !== undefined) db.name = n.name
          const dh = newHint(db, n.raw)
          for (const ch of n.children) {
            if (ch.keyword === 'compatibilityLevel') {
              model.compatibilityLevel = num(ch)
              prop(dh, ctx, ch)
            } else unknown(ctx, db, ch, dh)
          }
          dbInfo = db
          break
        }
        case 'model': {
          model.name = n.name ?? 'Model'
          mh.header = n.raw
          if (n.description !== undefined) (model.extra ??= {})['@description'] = n.description
          for (const ch of n.children) {
            switch (ch.keyword) {
              case 'culture':
                model.culture = (ch.value ?? '').trim()
                prop(mh, ctx, ch)
                break
              case 'defaultPowerBIDataSourceVersion':
                model.defaultPowerBIDataSourceVersion = (ch.value ?? '').trim()
                prop(mh, ctx, ch)
                break
              case 'sourceQueryCulture':
                model.sourceQueryCulture = (ch.value ?? '').trim()
                prop(mh, ctx, ch)
                break
              case 'discourageImplicitMeasures':
                model.discourageImplicitMeasures = bool(ch)
                prop(mh, ctx, ch)
                break
              case 'dataAccessOptions': {
                const dao: Record<string, boolean> = {}
                for (const o of ch.children) dao[o.keyword] = bool(o)
                model.dataAccessOptions = dao
                hintEntry(mh, 'dataAccessOptions', ctx.src(ch), true, 'dataAccessOptions')
                break
              }
              case 'annotation':
                annotation(ctx, model, ch, mh)
                break
              case 'queryGroup':
                readQueryGroup(ctx, model, ch, mh)
                break
              case 'ref':
                addRef(refs, mh, ch)
                break
              default:
                unknown(ctx, model, ch, mh)
            }
          }
          break
        }
        case 'queryGroup':
          readQueryGroup(ctx, model, n, mh)
          break
        case 'annotation':
          annotation(ctx, model, n, mh)
          break
        case 'ref':
          addRef(refs, mh, n)
          break
        case 'table':
          model.tables.push(readTable(ctx, n))
          break
        case 'relationship':
          model.relationships.push(readRelationship(ctx, n))
          break
        case 'expression':
          model.expressions.push(readExpression(ctx, n))
          break
        case 'role':
          model.roles.push(readRole(ctx, n))
          break
        case 'perspective': {
          const only = doc.nodes.length === 1
          const p: PerspectiveDef = { name: n.name ?? '', extra: { tmdl: only ? files[file] : ctx.src(n).join('\n') + '\n\n' } }
          ;(model.perspectives ??= []).push(p)
          break
        }
        case 'cultureInfo': {
          const only = doc.nodes.length === 1
          const c: CultureDef = { name: n.name ?? '', raw: only ? files[file] : ctx.src(n).join('\n') + '\n\n' }
          ;(model.cultures ??= []).push(c)
          break
        }
        default:
          ;(rawFiles[file] ??= []).push(ctx.src(n).join('\n'))
          if (n.keyword === 'function') {
            // user-defined functions: modeled for the DAX engine, text preserved verbatim (rawFiles) for round-trip
            const fd: FunctionDef = { name: n.name ?? '', expression: n.value ?? '' }
            if (n.description !== undefined) fd.description = n.description
            ;(model.functions ??= []).push(fd)
            break
          }
          if (n.keyword !== 'dataSource') diagnostics.push(`TMDL: '${n.keyword}' objects are preserved but not modeled (${file})`)
      }
    }
  }

  if (dbInfo && (dbInfo.name !== undefined || dbInfo.extra)) (model.extra ??= {})['@database'] = dbInfo
  else if (dbInfo) {
    // keep the (empty) database object so its formatting hint survives
    ;(model.extra ??= {})['@database'] = dbInfo
  }
  if (Object.keys(rawFiles).length) (model.extra ??= {})['@tmdlRaw'] = rawFiles

  model.tables = orderBy(model.tables, refs.table)
  if (model.cultures) model.cultures = orderBy(model.cultures, refs.cultureInfo)
  if (model.perspectives) model.perspectives = orderBy(model.perspectives, refs.perspective)
  model.roles = orderBy(model.roles, refs.role)

  // capture canonical texts for the formatting hints
  writeTmdlFiles(model, true)
  return { model, errors, diagnostics }
}

function readQueryGroup(ctx: Ctx, model: SemanticModel, n: TmdlNode, mh: ObjHint): void {
  const qg: { name: string; annotations?: Record<string, string> } = { name: n.name ?? '' }
  const qh = newHint(qg, n.raw)
  for (const ch of n.children) if (ch.keyword === 'annotation') annotation(ctx, qg, ch, qh)
  ;(model.queryGroups ??= []).push(qg)
  hintEntry(mh, `queryGroup:${qg.name}`, undefined, true, 'queryGroup')
}

function addRef(refs: Record<string, string[]>, mh: ObjHint, n: TmdlNode): void {
  const type = n.refType ?? ''
  ;(refs[type] ??= []).push(n.name ?? '')
  hintEntry(mh, `ref:${type}:${n.name ?? ''}`, undefined, true, 'ref')
}

function orderBy<T extends { name: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order?.length) return items
  const rank = new Map(order.map((n, i) => [n, i]))
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (rank.get(a.it.name) ?? order.length + a.i) - (rank.get(b.it.name) ?? order.length + b.i))
    .map((x) => x.it)
}
