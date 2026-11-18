/**
 * PBIX / PBIT container (OPC zip) reader.
 *
 * Entries: Version, DataModel (VertiPaq, decoded by ./datamodel), DataModelSchema (PBIT: TMSL JSON,
 * UTF-16LE), DataMashup (Power Query package), Report/Layout (legacy layout, UTF-16LE) or
 * Report/definition/** (PBIR-enabled files), Report/StaticResources/**, Report/CustomVisuals/**,
 * DiagramLayout, Connections (live connection), Settings, Metadata, SecurityBindings, DAXQueries/**.
 * PBIX files cannot be written (the DataModel format is proprietary): save as PBIP or .wbi.
 */
import { unzipSync } from 'fflate'
import type { DataStore } from '../../model/data'
import { emptyDataStore } from '../../model/data'
import type { NamedExpressionDef, SemanticModel } from '../../model/types'
import { emptyModel } from '../../model/types'
import type { ReportDocument } from '../../report/types'
import { decodeText, readPbirFiles, type FileMap } from '../../pbir/pbir'
import { PBIR_DEFINITION_VERSION, SCHEMA } from '../../pbir/schemas'
import { readTmsl } from '../../tmdl/tmsl'
import { readDataModel } from './datamodel/index'
import { readMashup, type Mashup } from './mashup'

export interface Diagnostic {
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface PbixReadOptions {
  onProgress?: (fraction: number, message: string) => void
  /** decode embedded data (default true); false = model + report only */
  loadData?: boolean
}

export interface PbixReadResult {
  kind: 'pbix' | 'pbit'
  model: SemanticModel
  data: DataStore
  report?: ReportDocument
  diagnostics: Diagnostic[]
  /** container `Version` entry */
  version?: string
  /** parsed `Connections` entry when present */
  connections?: any
  /** true when the report is connected live to a remote model (no local model) */
  liveConnection: boolean
}

export function unzipEntries(bytes: Uint8Array): FileMap {
  return unzipSync(bytes)
}

function json(bytes: Uint8Array | undefined): any {
  if (!bytes) return undefined
  try {
    return JSON.parse(decodeText(bytes))
  } catch {
    return undefined
  }
}

/** Read a .pbix / .pbit file. */
export async function readPbix(bytes: Uint8Array, opts: PbixReadOptions = {}): Promise<PbixReadResult> {
  const progress = opts.onProgress ?? (() => {})
  const diagnostics: Diagnostic[] = []
  progress(0, 'Reading file')
  let entries: FileMap
  try {
    entries = unzipEntries(bytes)
  } catch (e) {
    throw new Error(`Not a valid Power BI file (zip): ${(e as Error).message}`)
  }
  const version = entries.Version ? decodeText(entries.Version).trim() : undefined
  const kind: 'pbix' | 'pbit' = entries.DataModelSchema && !entries.DataModel ? 'pbit' : 'pbix'
  const connections = json(entries.Connections)

  // ---------------- report
  let report: ReportDocument | undefined
  const reportFiles: FileMap = {}
  for (const [name, b] of Object.entries(entries)) {
    if (!name.startsWith('Report/')) continue
    const rel = name.slice('Report/'.length)
    // Q&A linguistic schema of the report: not part of the PBIR definition
    if (rel === 'LinguisticSchema') continue
    reportFiles[rel === 'Layout' ? 'report.json' : rel] = b
  }
  if (reportFiles['definition/report.json'] || reportFiles['report.json']) {
    progress(0.05, 'Reading report')
    report = readPbirFiles(reportFiles, reportFiles['definition/report.json'] ? 'pbix-pbir' : 'pbix-legacy')
    for (const d of report.diagnostics) diagnostics.push({ level: 'warning', message: d })
  } else diagnostics.push({ level: 'info', message: 'The file contains no report.' })

  // ---------------- model + data
  let model: SemanticModel = emptyModel()
  let data: DataStore = emptyDataStore()
  let liveConnection = false
  if (entries.DataModelSchema) {
    const schema = json(entries.DataModelSchema)
    if (schema) {
      const r = readTmsl(schema)
      model = r.model
      for (const m of r.diagnostics) diagnostics.push({ level: 'warning', message: m })
    } else diagnostics.push({ level: 'error', message: 'DataModelSchema is not valid JSON' })
    if (kind === 'pbit') diagnostics.push({ level: 'info', message: 'Template file: the model has no data until it is refreshed.' })
  } else if (entries.DataModel) {
    progress(0.1, 'Reading data model')
    try {
      const r = await readDataModel(entries.DataModel, {
        onProgress: (f, m) => progress(0.1 + 0.85 * f, m),
        tables: opts.loadData === false ? [] : undefined
      })
      model = r.model
      data = r.data
      for (const m of r.diagnostics) diagnostics.push({ level: 'warning', message: m })
    } catch (e) {
      diagnostics.push({ level: 'error', message: `Could not decode the embedded data model: ${(e as Error).message}` })
    }
  } else {
    const conns: any[] = Array.isArray(connections?.Connections) ? connections.Connections : []
    if (conns.length) {
      liveConnection = true
      const c = conns[0]
      diagnostics.push({
        level: 'warning',
        message: `This report uses a live connection to ${c.PbiModelDatabaseName ?? c.Name ?? 'a remote semantic model'}; there is no local model or data.`
      })
      if (report && !report.pbir)
        report.pbir = {
          $schema: SCHEMA.definitionProperties,
          version: PBIR_DEFINITION_VERSION,
          datasetReference: {
            byConnection: {
              connectionString: c.ConnectionString ?? null,
              pbiServiceModelId: c.PbiServiceModelId ?? null,
              pbiModelVirtualServerName: c.PbiModelVirtualServerName ?? 'sobe_wowvirtualserver',
              pbiModelDatabaseName: c.PbiModelDatabaseName ?? null,
              name: c.Name ?? 'EntityDataSource',
              connectionType: c.ConnectionType ?? 'pbiServiceXmlaStyleLive'
            }
          }
        }
    } else diagnostics.push({ level: 'warning', message: 'The file contains no data model.' })
  }

  // ---------------- Power Query (DataMashup)
  if (entries.DataMashup) {
    try {
      applyMashup(model, readMashup(entries.DataMashup), diagnostics)
    } catch (e) {
      diagnostics.push({ level: 'warning', message: `Could not read the Power Query package: ${(e as Error).message}` })
    }
  }

  // ---------------- sidecars (kept for PBIP export)
  const side: Record<string, string> = { ...(model.sidecarFiles ?? {}) }
  if (entries.DiagramLayout) side['diagramLayout.json'] = decodeText(entries.DiagramLayout)
  for (const [name, b] of Object.entries(entries)) if (name.startsWith('DAXQueries/')) side[decodeURIComponent(name)] = decodeText(b)
  if (Object.keys(side).length) model.sidecarFiles = side

  progress(1, 'Done')
  return { kind, model, data, report, diagnostics, version, connections, liveConnection }
}

/**
 * Older PBIX files store `SELECT * FROM [Query]` partitions (sourceType 'query' + extra.mashupQueryName);
 * the M lives in Section1.m. Replace those partitions with M partitions, and add the remaining
 * queries (parameters, helper queries) as shared expressions like Power BI does on upgrade.
 */
export function applyMashup(model: SemanticModel, mashup: Mashup, diagnostics: Diagnostic[]): void {
  const byName = new Map(mashup.queries.map((q) => [q.name, q]))
  const used = new Set<string>()
  let replaced = 0
  for (const t of model.tables) {
    for (const p of t.partitions) {
      const qn = p.extra?.mashupQueryName
      if (p.sourceType !== 'query' || typeof qn !== 'string') continue
      const q = byName.get(qn)
      if (!q) {
        diagnostics.push({ level: 'warning', message: `Power Query '${qn}' of table ${t.name} not found in the file` })
        continue
      }
      p.sourceType = 'm'
      p.expression = q.expression
      delete p.extra!.mashupQueryName
      if (!Object.keys(p.extra!).length) delete p.extra
      used.add(qn)
      replaced++
    }
    for (const p of t.partitions) if (p.sourceType === 'm' && p.expression === undefined && byName.has(t.name)) p.expression = byName.get(t.name)!.expression
  }
  if (!replaced) return
  const existing = new Set(model.expressions.map((e) => e.name))
  const partitionQueries = new Set(model.tables.map((t) => t.name))
  for (const q of mashup.queries) {
    if (used.has(q.name) || existing.has(q.name) || partitionQueries.has(q.name)) continue
    const e: NamedExpressionDef = { name: q.name, kind: 'm', expression: q.expression }
    model.expressions.push(e)
  }
  diagnostics.push({ level: 'info', message: `Upgraded ${replaced} legacy query partition(s) to Power Query (M) partitions` })
}
