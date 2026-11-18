/**
 * Minimal, faithful TMDL writer for the subset of `SemanticModel` the dataset generator produces
 * (tables, columns, measures, hierarchies, M/calculated partitions, calculation groups, field
 * parameters, relationships, expressions). Produces the PBIP `definition/` folder layout:
 * database.tmdl, model.tmdl, expressions.tmdl, relationships.tmdl, tables/<table>.tmdl.
 *
 * Indentation follows Power BI Desktop: TABs; multi-line expressions of an object at depth d are
 * written at depth d+2.
 */
import type { Annotations, ColumnDef, HierarchyDef, MeasureDef, PartitionDef, SemanticModel, TableDef } from '../../../../src/core/model/types.ts'

export function tmdlName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

const T = (n: number) => '\t'.repeat(n)

/** `keyword Name = expr` with single- or multi-line expression (content at depth+2). */
function exprDecl(depth: number, head: string, expr: string): string[] {
  const lines = expr.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
  if (lines.length === 1) return [`${T(depth)}${head} = ${lines[0]}`]
  return [`${T(depth)}${head} =`, ...lines.map((l) => (l === '' ? '' : `${T(depth + 2)}${l}`))]
}

function description(depth: number, text?: string): string[] {
  if (!text) return []
  return text.split('\n').map((l) => `${T(depth)}/// ${l}`)
}

function annotations(depth: number, a?: Annotations): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(a ?? {})) out.push('', `${T(depth)}annotation ${tmdlName(k)} = ${v}`)
  return out
}

function columnLines(c: ColumnDef): string[] {
  const out = [...description(1, c.description)]
  if (c.kind === 'calculated' && c.expression) out.push(...exprDecl(1, `column ${tmdlName(c.name)}`, c.expression))
  else out.push(`\tcolumn ${tmdlName(c.name)}`)
  out.push(`\t\tdataType: ${c.dataType}`)
  if (c.isHidden) out.push('\t\tisHidden')
  if (c.isKey) out.push('\t\tisKey')
  if (c.formatString) out.push(`\t\tformatString: ${c.formatString}`)
  if (c.displayFolder) out.push(`\t\tdisplayFolder: ${c.displayFolder}`)
  if (c.lineageTag) out.push(`\t\tlineageTag: ${c.lineageTag}`)
  if (c.dataCategory) out.push(`\t\tdataCategory: ${c.dataCategory}`)
  if (c.summarizeBy) out.push(`\t\tsummarizeBy: ${c.summarizeBy}`)
  if (c.sourceColumn) out.push(`\t\tsourceColumn: ${c.sourceColumn}`)
  if (c.sortByColumn) out.push(`\t\tsortByColumn: ${tmdlName(c.sortByColumn)}`)
  const rcd = (c.extra?.relatedColumnDetails as { groupByColumn?: string } | undefined)?.groupByColumn
  if (rcd) out.push('', '\t\trelatedColumnDetails', `\t\t\tgroupByColumn: ${tmdlName(rcd)}`)
  for (const [k, v] of Object.entries(c.extendedProperties ?? {})) {
    const json = JSON.stringify(v, null, 2).split('\n')
    out.push('', `\t\textendedProperty ${tmdlName(k)} =`, ...json.map((l) => `\t\t\t\t${l}`))
  }
  for (const cp of c.changedProperties ?? []) out.push('', `\t\tchangedProperty = ${cp}`)
  out.push(...annotations(2, c.annotations))
  return out
}

function measureLines(m: MeasureDef): string[] {
  const out = [...description(1, m.description), ...exprDecl(1, `measure ${tmdlName(m.name)}`, m.expression)]
  if (m.formatString) out.push(`\t\tformatString: ${m.formatString}`)
  if (m.isHidden) out.push('\t\tisHidden')
  if (m.displayFolder) out.push(`\t\tdisplayFolder: ${m.displayFolder}`)
  if (m.lineageTag) out.push(`\t\tlineageTag: ${m.lineageTag}`)
  if (m.formatStringDefinition) out.push('', ...exprDecl(2, 'formatStringDefinition', m.formatStringDefinition.expression))
  out.push(...annotations(2, m.annotations))
  return out
}

function hierarchyLines(h: HierarchyDef): string[] {
  const out = [`\thierarchy ${tmdlName(h.name)}`]
  if (h.lineageTag) out.push(`\t\tlineageTag: ${h.lineageTag}`)
  for (const lv of [...h.levels].sort((a, b) => a.ordinal - b.ordinal)) {
    out.push('', `\t\tlevel ${tmdlName(lv.name)}`)
    if (lv.lineageTag) out.push(`\t\t\tlineageTag: ${lv.lineageTag}`)
    out.push(`\t\t\tcolumn: ${tmdlName(lv.column)}`)
  }
  return out
}

function partitionLines(p: PartitionDef): string[] {
  const kind = p.sourceType === 'm' ? 'm' : p.sourceType === 'calculated' ? 'calculated' : p.sourceType
  const out = [`\tpartition ${tmdlName(p.name)} = ${kind}`]
  if (p.mode) out.push(`\t\tmode: ${p.mode}`)
  if (p.queryGroup) out.push(`\t\tqueryGroup: ${p.queryGroup}`)
  if (p.expression !== undefined) out.push(...exprDecl(2, 'source', p.expression))
  return out
}

export function tableTmdl(t: TableDef): string {
  const out = [...description(0, t.description), `table ${tmdlName(t.name)}`]
  if (t.isHidden) out.push('\tisHidden')
  if (t.lineageTag) out.push(`\tlineageTag: ${t.lineageTag}`)
  if (t.dataCategory) out.push(`\tdataCategory: ${t.dataCategory}`)
  if (t.calculationGroup) {
    const cg = t.calculationGroup
    out.push('', '\tcalculationGroup')
    if (cg.precedence !== undefined) out.push(`\t\tprecedence: ${cg.precedence}`)
    for (const item of cg.items) {
      out.push('', ...exprDecl(2, `calculationItem ${tmdlName(item.name)}`, item.expression))
      if (item.formatStringDefinition) out.push('', ...exprDecl(3, 'formatStringDefinition', item.formatStringDefinition.expression))
    }
  }
  for (const m of t.measures) out.push('', ...measureLines(m))
  for (const c of t.columns) out.push('', ...columnLines(c))
  for (const h of t.hierarchies) out.push('', ...hierarchyLines(h))
  for (const p of t.partitions) out.push('', ...partitionLines(p))
  out.push(...annotations(1, t.annotations))
  return out.join('\n') + '\n'
}

export function modelTmdl(m: SemanticModel): string {
  const out = [`model ${tmdlName(m.name)}`]
  if (m.culture) out.push(`\tculture: ${m.culture}`)
  if (m.defaultPowerBIDataSourceVersion) out.push(`\tdefaultPowerBIDataSourceVersion: ${m.defaultPowerBIDataSourceVersion}`)
  if (m.discourageImplicitMeasures) out.push('\tdiscourageImplicitMeasures')
  if (m.sourceQueryCulture) out.push(`\tsourceQueryCulture: ${m.sourceQueryCulture}`)
  const dao = Object.entries(m.dataAccessOptions ?? {}).filter(([, v]) => v)
  if (dao.length) out.push('\tdataAccessOptions', ...dao.map(([k]) => `\t\t${k}`))
  for (const g of m.queryGroups ?? []) {
    out.push('', `queryGroup ${tmdlName(g.name)}`)
    for (const [k, v] of Object.entries(g.annotations ?? {})) out.push('', `\tannotation ${k} = ${v}`)
  }
  for (const [k, v] of Object.entries(m.annotations ?? {})) out.push('', `annotation ${tmdlName(k)} = ${v}`)
  out.push('')
  for (const t of m.tables) out.push(`ref table ${tmdlName(t.name)}`)
  return out.join('\n') + '\n'
}

export function relationshipsTmdl(m: SemanticModel): string {
  const out: string[] = []
  for (const r of m.relationships) {
    if (out.length) out.push('')
    out.push(`relationship ${r.name}`)
    if (r.fromCardinality === 'one') out.push('\tfromCardinality: one')
    if (r.toCardinality === 'many') out.push('\ttoCardinality: many')
    if (r.crossFilteringBehavior === 'bothDirections') out.push('\tcrossFilteringBehavior: bothDirections')
    if (!r.isActive) out.push('\tisActive: false')
    out.push(`\tfromColumn: ${tmdlName(r.fromTable)}.${tmdlName(r.fromColumn)}`)
    out.push(`\ttoColumn: ${tmdlName(r.toTable)}.${tmdlName(r.toColumn)}`)
  }
  return out.join('\n') + '\n'
}

export function expressionsTmdl(m: SemanticModel): string {
  const out: string[] = []
  for (const e of m.expressions) {
    if (out.length) out.push('')
    out.push(...description(0, e.description), ...exprDecl(0, `expression ${tmdlName(e.name)}`, e.expression))
    if (e.lineageTag) out.push(`\tlineageTag: ${e.lineageTag}`)
    if (e.queryGroup) out.push(`\tqueryGroup: ${e.queryGroup}`)
    out.push(...annotations(1, e.annotations))
  }
  return out.join('\n') + '\n'
}

export function fileSafe(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_')
}

/** All TMDL files of the `definition/` folder, keyed by path relative to it. */
export function modelToTmdlFiles(m: SemanticModel): Record<string, string> {
  const files: Record<string, string> = {
    'database.tmdl': `database\n\tcompatibilityLevel: ${m.compatibilityLevel ?? 1601}\n`,
    'model.tmdl': modelTmdl(m),
    'relationships.tmdl': relationshipsTmdl(m),
    'expressions.tmdl': expressionsTmdl(m)
  }
  for (const t of m.tables) files[`tables/${fileSafe(t.name)}.tmdl`] = tableTmdl(t)
  return files
}
