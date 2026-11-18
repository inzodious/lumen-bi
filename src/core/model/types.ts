/**
 * Semantic model definitions (Tabular Object Model subset).
 *
 * This is the canonical in-memory representation of a semantic model regardless of
 * where it came from (TMDL folder, PBIX DataModel metadata, model.bim JSON, or created
 * in-app). Readers MUST populate it; writers (TMDL serializer) MUST be able to round-trip it.
 *
 * Unknown/unsupported properties are preserved in `extra` (name -> raw text/JSON) so that
 * saving a model we opened does not silently drop information.
 */

export type DataType =
  | 'string'
  | 'int64'
  | 'double'
  | 'decimal' // currency / fixed decimal — stored as JS number
  | 'boolean'
  | 'dateTime'
  | 'binary'
  | 'variant'
  | 'unknown'

export type SummarizeBy =
  | 'default'
  | 'none'
  | 'sum'
  | 'min'
  | 'max'
  | 'count'
  | 'average'
  | 'distinctCount'

export type Annotations = Record<string, string>

/** Raw, unparsed properties preserved for round-trip. Values are the raw TMDL/JSON text. */
export type ExtraProps = Record<string, unknown>

export interface ColumnDef {
  name: string
  dataType: DataType
  /** 'data' = loaded from partition source; 'calculated' = DAX calculated column;
   *  'calculatedTableColumn' = column of a calculated table; 'rowNumber' = internal. */
  kind: 'data' | 'calculated' | 'calculatedTableColumn' | 'rowNumber'
  /** DAX expression for calculated columns. */
  expression?: string
  /** Source column name in the partition result (data columns) or `[name]` for calc tables. */
  sourceColumn?: string
  formatString?: string
  isHidden?: boolean
  isKey?: boolean
  isNullable?: boolean
  isAvailableInMdx?: boolean
  sortByColumn?: string
  summarizeBy?: SummarizeBy
  displayFolder?: string
  dataCategory?: string
  description?: string
  lineageTag?: string
  sourceLineageTag?: string
  /** Field-parameter / variation metadata etc. are kept as raw extended properties. */
  extendedProperties?: Record<string, unknown>
  /** Auto date/time variations (Variation -> LocalDateTable hierarchy). */
  variations?: Array<{ name: string; relationship: string; defaultHierarchy: string; isDefault?: boolean }>
  annotations?: Annotations
  changedProperties?: string[]
  extra?: ExtraProps
}

export interface FormatStringDefinition {
  expression: string
}

export interface MeasureDef {
  name: string
  expression: string
  formatString?: string
  /** Dynamic format string (DAX expression returning a format string). */
  formatStringDefinition?: FormatStringDefinition
  displayFolder?: string
  isHidden?: boolean
  description?: string
  lineageTag?: string
  dataType?: DataType
  detailRowsDefinition?: string
  kpi?: { targetExpression?: string; statusExpression?: string; trendExpression?: string; statusGraphic?: string; trendGraphic?: string; extra?: ExtraProps }
  annotations?: Annotations
  changedProperties?: string[]
  extra?: ExtraProps
}

export interface HierarchyLevelDef {
  name: string
  column: string
  ordinal: number
  lineageTag?: string
  annotations?: Annotations
  extra?: ExtraProps
}

export interface HierarchyDef {
  name: string
  levels: HierarchyLevelDef[]
  isHidden?: boolean
  displayFolder?: string
  lineageTag?: string
  annotations?: Annotations
  extra?: ExtraProps
}

export type PartitionMode = 'import' | 'directQuery' | 'dual' | 'directLake' | 'default'

export interface PartitionDef {
  name: string
  mode?: PartitionMode
  /** 'm' = Power Query M; 'calculated' = DAX table expression; 'entity' = Direct Lake/entity;
   *  'calculationGroup' = calc group; 'policyRange' = incremental refresh range; 'query' = native. */
  sourceType: 'm' | 'calculated' | 'entity' | 'calculationGroup' | 'policyRange' | 'query' | 'unknown'
  /** M expression (sourceType 'm'), DAX expression (sourceType 'calculated'). */
  expression?: string
  /** For entity partitions (Direct Lake): entity name, schema, expressionSource. */
  entityName?: string
  schemaName?: string
  expressionSource?: string
  queryGroup?: string
  annotations?: Annotations
  extra?: ExtraProps
}

export interface CalculationItemDef {
  name: string
  expression: string
  ordinal?: number
  formatStringDefinition?: FormatStringDefinition
  description?: string
  extra?: ExtraProps
}

export interface CalculationGroupDef {
  precedence?: number
  items: CalculationItemDef[]
  noSelectionExpression?: string
  multipleOrEmptySelectionExpression?: string
  extra?: ExtraProps
}

export interface TableDef {
  name: string
  columns: ColumnDef[]
  measures: MeasureDef[]
  hierarchies: HierarchyDef[]
  partitions: PartitionDef[]
  calculationGroup?: CalculationGroupDef
  isHidden?: boolean
  isPrivate?: boolean
  /** e.g. 'Time' for date tables marked as date table */
  dataCategory?: string
  description?: string
  lineageTag?: string
  sourceLineageTag?: string
  showAsVariationsOnly?: boolean
  refreshPolicy?: Record<string, unknown>
  annotations?: Annotations
  changedProperties?: string[]
  extra?: ExtraProps
}

export type Cardinality = 'one' | 'many'
export type CrossFilteringBehavior = 'oneDirection' | 'bothDirections' | 'automatic'

export interface RelationshipDef {
  name: string
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  /** Defaults per TMDL: fromCardinality 'many', toCardinality 'one'. */
  fromCardinality: Cardinality
  toCardinality: Cardinality
  crossFilteringBehavior: CrossFilteringBehavior
  isActive: boolean
  securityFilteringBehavior?: 'oneDirection' | 'bothDirections' | 'none'
  joinOnDateBehavior?: 'dateAndTime' | 'datePartOnly'
  relyOnReferentialIntegrity?: boolean
  annotations?: Annotations
  extra?: ExtraProps
}

/** Shared M expressions / parameters (expressions.tmdl). */
export interface NamedExpressionDef {
  name: string
  kind: 'm' | 'dax'
  expression: string
  description?: string
  queryGroup?: string
  lineageTag?: string
  /** Parameter metadata from `meta [IsParameterQuery=true, ...]` is part of the expression text. */
  annotations?: Annotations
  extra?: ExtraProps
}

export interface RoleDef {
  name: string
  modelPermission?: 'read' | 'readRefresh' | 'none' | 'administrator' | 'refresh'
  tablePermissions: Array<{ table: string; filterExpression?: string; extra?: ExtraProps }>
  members?: string[]
  annotations?: Annotations
  extra?: ExtraProps
}

export interface PerspectiveDef {
  name: string
  extra?: ExtraProps
}

export interface CultureDef {
  name: string
  /** raw TMDL text of the culture file — preserved verbatim */
  raw?: string
  extra?: ExtraProps
}

/** DAX user-defined function (functions.tmdl): `function Name = ( params ) => body`. */
export interface FunctionDef {
  name: string
  /** the full definition text after '=': `( a : NUMERIC, b = 1 ) => a * b` */
  expression: string
  description?: string
}

export interface SemanticModel {
  name: string
  culture?: string
  compatibilityLevel?: number
  defaultPowerBIDataSourceVersion?: string
  sourceQueryCulture?: string
  discourageImplicitMeasures?: boolean
  tables: TableDef[]
  relationships: RelationshipDef[]
  expressions: NamedExpressionDef[]
  roles: RoleDef[]
  /** DAX user-defined functions (read from TMDL; the TMDL text itself is preserved separately for round-trip) */
  functions?: FunctionDef[]
  perspectives?: PerspectiveDef[]
  cultures?: CultureDef[]
  queryGroups?: Array<{ name: string; annotations?: Annotations }>
  /** Model-level `dataAccessOptions` etc. */
  dataAccessOptions?: Record<string, boolean>
  annotations?: Annotations
  /** Files we read but don't model (diagramLayout.json, .platform, definition.pbism...) keyed by relative path. */
  sidecarFiles?: Record<string, string>
  extra?: ExtraProps
}

export function emptyModel(name = 'Model'): SemanticModel {
  return { name, culture: 'en-US', tables: [], relationships: [], expressions: [], roles: [] }
}

export function findTable(model: SemanticModel, name: string): TableDef | undefined {
  const lower = name.toLowerCase()
  return model.tables.find((t) => t.name.toLowerCase() === lower)
}

export function findColumn(table: TableDef, name: string): ColumnDef | undefined {
  const lower = name.toLowerCase()
  return table.columns.find((c) => c.name.toLowerCase() === lower)
}

export function findMeasure(model: SemanticModel, name: string): { table: TableDef; measure: MeasureDef } | undefined {
  const lower = name.toLowerCase()
  for (const table of model.tables) {
    const measure = table.measures.find((m) => m.name.toLowerCase() === lower)
    if (measure) return { table, measure }
  }
  return undefined
}
