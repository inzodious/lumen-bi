/**
 * The data side of a published dashboard: a trimmed copy of the project as a `.wbi` bundle plus the publish manifest.
 * The web viewer (src/renderer/viewer) loads `lumen-publish.json`, then `report.wbi`, and renders the report's
 * reading view with the DAX engine running in the browser. Everything in these files is readable by whoever can
 * open the site.
 */
import { cloneDeep } from '../clone'
import type { DataStore, TableData } from '../model/data'
import type { SemanticModel } from '../model/types'
import type { ProjectDocument } from '../project'
import { pbipProjectFiles } from '../io/pbip'
import { writeWbi } from '../io/wbi'
import { orderedPageList } from './pages'
import { columnUsage, isColumnKept } from './usage'

export const PUBLISH_MANIFEST = 'lumen-publish.json'
export const PUBLISH_BUNDLE = 'report.wbi'
export const PUBLISH_FORMAT_VERSION = 1

/** M text written in place of a query when queries are left out. */
export const REMOVED_QUERY = '"Removed when published"'

export interface PublishOptions {
  /** leave out the data of columns the report and the measures never reach (default true) */
  trimData?: boolean
  /** leave out Power Query (M) queries and parameters, which hold server names and paths (default true) */
  stripQueries?: boolean
  /** title shown in the browser tab and the viewer header (default: the project name) */
  title?: string
  /** clock for the manifest (tests) */
  now?: Date
}

export interface PublishManifest {
  format: 'lumen-publish'
  version: number
  title: string
  /** project name (the folder prefix inside report.wbi) */
  name: string
  publishedAt: string
  generator: string
  bundle: string
  /** visible pages in report order (hidden, tooltip and drillthrough-only pages are not listed) */
  pages: Array<{ name: string; displayName: string }>
  bytes: number
}

export interface PublishSummary {
  tables: number
  rows: number
  columns: number
  /** columns whose data was left out */
  columnsLeftOut: number
  queriesRemoved: number
  /** things the publisher should know before the site goes out (shown in the Publish dialog) */
  warnings: string[]
}

export interface PublishBundle {
  /** site-relative path → content */
  files: Record<string, Uint8Array | string>
  manifest: PublishManifest
  summary: PublishSummary
}

function blankColumn(rowCount: number) {
  return new Array(rowCount).fill(null)
}

function trimmedData(model: SemanticModel, data: DataStore, trim: boolean, usage: ReturnType<typeof columnUsage>): { data: DataStore; leftOut: number; columns: number; rows: number } {
  const out: DataStore = { tables: new Map(), status: new Map(data.status) }
  let leftOut = 0
  let columns = 0
  let rows = 0
  for (const [name, table] of data.tables) {
    const def = model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
    rows += table.rowCount
    const next: TableData = {
      rowCount: table.rowCount,
      columns: table.columns.map((c) => {
        columns++
        if (!trim || !def || isColumnKept(usage, def.name, c.name)) return c
        leftOut++
        return { name: c.name, type: c.type, values: blankColumn(table.rowCount) }
      })
    }
    out.tables.set(name, next)
  }
  return { data: out, leftOut, columns, rows }
}

function stripQueries(model: SemanticModel): number {
  let n = 0
  for (const e of model.expressions)
    if (e.kind === 'm') {
      e.expression = REMOVED_QUERY
      n++
    }
  for (const t of model.tables)
    for (const p of t.partitions)
      if (p.sourceType === 'm' || p.sourceType === 'query') {
        p.expression = REMOVED_QUERY
        n++
      }
  return n
}

function warningsFor(project: ProjectDocument, model: SemanticModel): string[] {
  const out: string[] = []
  if (model.roles.some((r) => r.tablePermissions.some((p) => p.filterExpression)))
    out.push('Row-level security does not apply to a published dashboard: everyone who opens it sees every row that is published.')
  const synthetic = [...project.data.status].filter(([, s]) => s.state === 'loaded' && s.source === 'synthetic').map(([n]) => n)
  if (synthetic.length) out.push(`${synthetic.length === 1 ? 'Table' : 'Tables'} ${synthetic.join(', ')} ${synthetic.length === 1 ? 'holds' : 'hold'} generated sample data, not real data.`)
  const empty = model.tables.filter((t) => !t.calculationGroup && !project.data.tables.has(t.name) && t.partitions.some((p) => p.sourceType !== 'calculated')).map((t) => t.name)
  if (empty.length) out.push(`${empty.length === 1 ? 'Table' : 'Tables'} ${empty.slice(0, 5).join(', ')}${empty.length > 5 ? ` and ${empty.length - 5} more` : ''} ${empty.length === 1 ? 'has' : 'have'} no data; visuals that use them will be blank. Refresh before publishing.`)
  if (model.tables.some((t) => t.partitions.some((p) => p.mode === 'directQuery' || p.mode === 'directLake')))
    out.push('DirectQuery and Direct Lake tables are published with the data Lumen last loaded; the dashboard does not query the source.')
  return out
}

/** Build `report.wbi` and `lumen-publish.json` for a project with a report. */
export function buildPublishBundle(project: ProjectDocument, opts: PublishOptions = {}): PublishBundle {
  if (!project.report) throw new Error('Only a report can be published. Open or create a report first.')
  if (project.report.pbir?.datasetReference?.byConnection && !project.model.tables.length)
    throw new Error('This report uses a live connection to a semantic model, so it has no data to publish.')
  const trim = opts.trimData !== false
  const model = cloneDeep(project.model)
  const queriesRemoved = opts.stripQueries === false ? 0 : stripQueries(model)
  const keepSidecars = ['.platform', 'definition.pbism']
  model.sidecarFiles = Object.fromEntries(Object.entries(model.sidecarFiles ?? {}).filter(([k]) => keepSidecars.includes(k)))
  const usage = columnUsage(project.model, project.report)
  const { data, leftOut, columns, rows } = trimmedData(project.model, project.data, trim, usage)
  const name = project.name || 'Report'
  const { files: projectFiles } = pbipProjectFiles(name, model, project.report)
  const wbi = writeWbi(name, projectFiles, data, { kind: 'publish' })
  const manifest: PublishManifest = {
    format: 'lumen-publish',
    version: PUBLISH_FORMAT_VERSION,
    title: (opts.title ?? '').trim() || name,
    name,
    publishedAt: (opts.now ?? new Date()).toISOString(),
    generator: 'Lumen',
    bundle: PUBLISH_BUNDLE,
    pages: orderedPageList(project.report),
    bytes: wbi.byteLength
  }
  return {
    files: { [PUBLISH_BUNDLE]: wbi, [PUBLISH_MANIFEST]: JSON.stringify(manifest, null, 2) },
    manifest,
    summary: { tables: data.tables.size, rows, columns, columnsLeftOut: leftOut, queriesRemoved, warnings: warningsFor(project, project.model) }
  }
}
