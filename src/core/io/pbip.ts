/**
 * PBIP project parts: `*.SemanticModel` folders (TMDL `definition/` or `model.bim`) and the file maps
 * for writing a whole PBIP project (`<Name>.pbip`, `<Name>.Report/`, `<Name>.SemanticModel/`).
 * Everything works on in-memory file maps so the `.wbi` bundle reuses it.
 */
import type { SemanticModel } from '../model/types'
import type { ReportDocument } from '../report/types'
import { decodeText, pbirToFiles, type FileMap, type OutFileMap } from '../pbir/pbir'
import { PBIR_DEFINITION_VERSION, SCHEMA } from '../pbir/schemas'
import { readTmdlFiles } from '../tmdl/read'
import { writeTmdlFiles } from '../tmdl/write'
import { readTmsl, writeTmsl } from '../tmdl/tmsl'
import type { Diagnostic } from './pbix/container'
import { cloneDeep } from '../clone'

/** Sidecar files that are per-user state and are not carried along. */
function isUserState(rel: string): boolean {
  return rel.startsWith('.pbi/') && rel !== '.pbi/editorSettings.json'
}

export interface SemanticModelReadResult {
  model: SemanticModel
  diagnostics: Diagnostic[]
  /** `.pbi/cache.abf` bytes when present (data cache, decoded by the caller) */
  cache?: Uint8Array
}

/** Read a semantic model from the files of a `*.SemanticModel` folder (relative paths). */
export function readSemanticModelFiles(files: FileMap): SemanticModelReadResult {
  const diagnostics: Diagnostic[] = []
  const tmdl: Record<string, string> = {}
  for (const [rel, bytes] of Object.entries(files)) if (rel.startsWith('definition/') && rel.endsWith('.tmdl')) tmdl[rel.slice('definition/'.length)] = decodeText(bytes)
  let model: SemanticModel
  if (Object.keys(tmdl).length) {
    const r = readTmdlFiles(tmdl)
    model = r.model
    for (const e of r.errors) diagnostics.push({ level: 'error', message: `TMDL ${e.file ?? ''}:${e.line}: ${e.message}` })
    for (const d of r.diagnostics) diagnostics.push({ level: 'warning', message: d })
  } else if (files['model.bim']) {
    let json: any
    try {
      json = JSON.parse(decodeText(files['model.bim']))
    } catch (e) {
      throw new Error(`model.bim is not valid JSON: ${(e as Error).message}`)
    }
    const r = readTmsl(json)
    model = r.model
    ;(model.extra ??= {})['@pbipFormat'] = 'bim'
    for (const d of r.diagnostics) diagnostics.push({ level: 'warning', message: d })
  } else {
    throw new Error('No semantic model definition found (definition/*.tmdl or model.bim)')
  }
  const side: Record<string, string> = {}
  for (const [rel, bytes] of Object.entries(files)) {
    if ((rel.startsWith('definition/') && rel.endsWith('.tmdl')) || rel === 'model.bim' || rel === '.pbi/cache.abf' || isUserState(rel)) continue
    side[rel] = decodeText(bytes)
  }
  if (Object.keys(side).length) model.sidecarFiles = { ...(model.sidecarFiles ?? {}), ...side }
  return { model, diagnostics, cache: files['.pbi/cache.abf'] }
}

function uuid(): string {
  return globalThis.crypto.randomUUID()
}

function platformJson(existing: string | Uint8Array | undefined, type: 'Report' | 'SemanticModel', displayName: string): string {
  let obj: any
  if (existing !== undefined) {
    try {
      obj = JSON.parse(typeof existing === 'string' ? existing : decodeText(existing))
    } catch {
      obj = undefined
    }
  }
  if (!obj) obj = { $schema: SCHEMA.platform, metadata: { type, displayName }, config: { version: '2.0', logicalId: uuid() } }
  obj.metadata = { ...(obj.metadata ?? {}), type, displayName }
  return JSON.stringify(obj, null, 2)
}

export interface ModelFilesOptions {
  /** 'tmdl' (default for new projects) or 'bim'; default: the format the model was read from */
  format?: 'tmdl' | 'bim'
}

/** Files of a `*.SemanticModel` folder for `model` (relative paths). */
export function semanticModelFiles(model: SemanticModel, displayName: string, opts: ModelFilesOptions = {}): { files: OutFileMap; diagnostics: string[] } {
  const format = opts.format ?? (model.extra?.['@pbipFormat'] === 'bim' ? 'bim' : 'tmdl')
  const files: OutFileMap = {}
  let diagnostics: string[]
  if (format === 'tmdl') {
    const r = writeTmdlFiles(model)
    diagnostics = r.diagnostics
    for (const [p, t] of Object.entries(r.files)) files[`definition/${p}`] = t
  } else {
    const r = writeTmsl(model)
    diagnostics = r.diagnostics
    files['model.bim'] = JSON.stringify(r.json, null, 2)
  }
  const side = model.sidecarFiles ?? {}
  for (const [rel, text] of Object.entries(side)) {
    if (rel === '.platform' || rel === 'definition.pbism' || rel === 'model.bim' || rel.startsWith('@')) continue
    if (format === 'tmdl' && rel.startsWith('definition/') && rel.endsWith('.tmdl')) continue
    files[rel] = text
  }
  files['.platform'] = platformJson(side['.platform'], 'SemanticModel', displayName)
  let pbism: any
  try {
    pbism = side['definition.pbism'] ? JSON.parse(side['definition.pbism']) : undefined
  } catch {
    pbism = undefined
  }
  pbism ??= { $schema: SCHEMA.semanticModelDefinition, version: '4.2', settings: {} }
  // TMDL definitions require definition.pbism version 4.0 or later
  if (format === 'tmdl' && !(Number.parseFloat(String(pbism.version ?? '0')) >= 4)) pbism.version = '4.2'
  files['definition.pbism'] = JSON.stringify(pbism, null, 2)
  return { files, diagnostics }
}

/** Files of a `*.Report` folder with its dataset reference pointing at `modelRelPath` (when given). */
export function reportFiles(report: ReportDocument, displayName: string, modelRelPath?: string): OutFileMap {
  const pbir: any = report.pbir ? cloneDeep(report.pbir) : { $schema: SCHEMA.definitionProperties, version: PBIR_DEFINITION_VERSION, datasetReference: {} }
  if (Number.parseFloat(String(pbir.version ?? '0')) < 4) pbir.version = PBIR_DEFINITION_VERSION
  if (modelRelPath) pbir.datasetReference = { byPath: { path: modelRelPath } }
  const files = pbirToFiles({ ...report, pbir })
  files['.platform'] = platformJson(report.extraFiles['.platform'], 'Report', displayName)
  return files
}

/**
 * `.pbip` JSON pointing at `reportFolder`. An existing file keeps its other artifacts (a `.pbip` can list several
 * reports): the entry for `previousFolder` (or `reportFolder`) is replaced in place, else the report is added.
 */
export function pbipJson(existing: unknown, reportFolder: string | undefined, previousFolder?: string): string {
  const obj: any =
    existing && typeof existing === 'object'
      ? cloneDeep(existing)
      : { $schema: SCHEMA.pbip, version: '1.0', artifacts: [], settings: { enableAutoRecovery: true } }
  const list: any[] = Array.isArray(obj.artifacts) ? obj.artifacts : []
  const norm = (p: unknown): string => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
  const targets = new Set([reportFolder, previousFolder].filter((x): x is string => !!x).map(norm))
  const at = list.findIndex((a) => a?.report?.path !== undefined && targets.has(norm(a.report.path)))
  if (!reportFolder) obj.artifacts = list.filter((a) => !a?.report)
  else if (at >= 0) {
    // keep Desktop's own spelling of an unchanged path
    if (norm(list[at].report.path) !== norm(reportFolder)) list[at] = { ...list[at], report: { ...list[at].report, path: reportFolder } }
    obj.artifacts = list
  } else obj.artifacts = [...list.filter((a) => a?.report), { report: { path: reportFolder } }, ...list.filter((a) => !a?.report)].filter((a, i, arr) => arr.indexOf(a) === i)
  return JSON.stringify(obj, null, 2)
}

/** Whole PBIP project as a file map relative to the project directory. */
export function pbipProjectFiles(
  name: string,
  model: SemanticModel | undefined,
  report: ReportDocument | undefined,
  opts: ModelFilesOptions & { pbip?: unknown } = {}
): { files: OutFileMap; diagnostics: string[] } {
  const files: OutFileMap = {}
  const diagnostics: string[] = []
  const live = !!report?.pbir?.datasetReference?.byConnection && !model?.tables.length
  if (model && !live) {
    const m = semanticModelFiles(model, name, opts)
    diagnostics.push(...m.diagnostics)
    for (const [p, c] of Object.entries(m.files)) files[`${name}.SemanticModel/${p}`] = c
  }
  if (report) {
    const r = reportFiles(report, name, model && !live ? `../${name}.SemanticModel` : undefined)
    for (const [p, c] of Object.entries(r)) files[`${name}.Report/${p}`] = c
    files[`${name}.pbip`] = pbipJson(opts.pbip, `${name}.Report`)
  }
  return { files, diagnostics }
}
