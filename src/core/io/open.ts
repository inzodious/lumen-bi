/**
 * Project open/save entry points.
 *
 * openProject accepts: `.pbix`, `.pbit`, `.pbip`, `.wbi`, `.bim`, a `*.Report` folder (model resolved
 * through `definition.pbir` byPath), a `*.SemanticModel` folder (model only), or a folder that contains
 * a `.pbip` / a single `*.Report` / a single `*.SemanticModel`.
 * saveProject writes PBIP (`<dir>/<Name>.pbip`, `<Name>.Report/`, `<Name>.SemanticModel/` with TMDL) or a
 * `.wbi` bundle (PBIP + cached data). Data is never written into PBIP folders.
 */
import type { FileSystem } from './fs'
import { basename, dirname, joinPath, walk } from './fs'
import type { ProjectDocument, ProjectSource } from '../project'
import type { DataStore } from '../model/data'
import { emptyDataStore } from '../model/data'
import type { SemanticModel } from '../model/types'
import { emptyModel } from '../model/types'
import type { ReportDocument } from '../report/types'
import { decodeText, readPbirFiles, readTree, writeFileMap, writePbirFolder, type FileMap } from '../pbir/pbir'
import { readTmsl, writeTmsl } from '../tmdl/tmsl'
import { readPbix, type Diagnostic } from './pbix/container'
import { readDataModel } from './pbix/datamodel/index'
import { movePackageData, rememberPackageData } from './pbix/write/origin'
import { planPackage, writePackage, type PackagePlan } from './pbix/write/package'
import { pbipJson, pbipProjectFiles, readSemanticModelFiles, reportFiles, semanticModelFiles } from './pbip'
import { LUMEN_LAYOUT_FILE } from './diagramSidecar'
import { readWbi, writeWbi } from './wbi'
import { pruneStaleIcons } from '../icons/bake'

export interface OpenOptions {
  /** progress callback (0..1 + message) */
  onProgress?: (fraction: number, message: string) => void
  /** decode embedded data (PBIX DataModel, PBIP `.pbi/cache.abf`); default true */
  loadData?: boolean
}

function newId(): string {
  return globalThis.crypto.randomUUID()
}

function stripExt(name: string): string {
  return name.replace(/\.(pbix|pbit|pbip|wbi|bim|Report|SemanticModel)$/i, '')
}

function project(name: string, source: ProjectSource, model: SemanticModel, data: DataStore, report: ReportDocument | undefined, diagnostics: Diagnostic[]): ProjectDocument {
  const doc: ProjectDocument = { id: newId(), name, source, model, data, diagnostics, dirty: false }
  if (report) {
    // Lumen icons whose baked image was replaced outside Lumen (e.g. in Power BI): the image wins; icons of sets
    // Lumen no longer offers keep their picture as a plain image (docs/ICONS.md)
    const { stale, removed, removedSets, moved } = pruneStaleIcons(report)
    if (moved) diagnostics.push({ level: 'info', message: `${moved} card icon${moved === 1 ? '' : 's'} saved by an earlier Lumen build moved to the image settings the card reads (they now show).` })
    if (stale) diagnostics.push({ level: 'info', message: `${stale} icon${stale === 1 ? '' : 's'} replaced by another image outside Lumen now show as plain images.` })
    if (removed) diagnostics.push({ level: 'info', message: `${removed} icon${removed === 1 ? '' : 's'} from an icon set Lumen no longer offers (${removedSets.join(', ')}) now show${removed === 1 ? 's' : ''} as ${removed === 1 ? 'a plain image' : 'plain images'}; pick a new icon to edit ${removed === 1 ? 'it' : 'them'} again.` })
    doc.report = report
  }
  return doc
}

async function readJson(fs: FileSystem, path: string): Promise<any> {
  return JSON.parse(await fs.readText(path))
}

/** Read a `*.SemanticModel` folder; data from `.pbi/cache.abf` when present and requested. */
async function openModelFolder(fs: FileSystem, dir: string, opts: OpenOptions, diagnostics: Diagnostic[]): Promise<{ model: SemanticModel; data: DataStore }> {
  opts.onProgress?.(0.1, 'Reading semantic model')
  const files = await readTree(fs, dir, (rel) => rel.startsWith('.pbi/') && rel !== '.pbi/cache.abf' && rel !== '.pbi/editorSettings.json')
  const r = readSemanticModelFiles(files)
  diagnostics.push(...r.diagnostics)
  let data = emptyDataStore()
  // Test-suite guard: tests must never decode a PBIP data cache (it can hold confidential data from
  // real reports used as a parsing corpus). tests/setup.ts sets this flag for every vitest run; app runs
  // launched with WBI_BLOCK_CACHE=1 get it from the preload (src/shared/cacheGuard.ts).
  const cacheBlocked = (globalThis as { __LUMEN_BLOCK_CACHE_ABF__?: boolean }).__LUMEN_BLOCK_CACHE_ABF__ === true
  if (r.cache && cacheBlocked) diagnostics.push({ level: 'info', message: 'Data cache (.pbi/cache.abf) not read: blocked (tests / WBI_BLOCK_CACHE).' })
  if (r.cache && opts.loadData !== false && !cacheBlocked) {
    opts.onProgress?.(0.3, 'Reading data cache')
    try {
      // the cache provides data only; the TMDL definition stays authoritative for the model
      const names = r.model.tables.map((t) => t.name)
      const res = await readDataModel(r.cache, { tables: names, onProgress: (f, m) => opts.onProgress?.(0.3 + 0.6 * f, m) })
      const keep = new Set(names.map((n) => n.toLowerCase()))
      for (const [n, t] of res.data.tables) if (keep.has(n.toLowerCase())) data.tables.set(n, t)
      for (const [n, s] of res.data.status) if (keep.has(n.toLowerCase())) data.status.set(n, s)
      for (const d of res.diagnostics) diagnostics.push({ level: 'info', message: `Data cache: ${d}` })
    } catch (e) {
      diagnostics.push({ level: 'warning', message: `Could not read the data cache (.pbi/cache.abf): ${(e as Error).message}` })
      data = emptyDataStore()
    }
  }
  return { model: r.model, data }
}

async function openReportFolder(fs: FileSystem, dir: string, opts: OpenOptions, kind: 'pbip' | 'pbir-folder', openedPath: string): Promise<ProjectDocument> {
  const diagnostics: Diagnostic[] = []
  opts.onProgress?.(0, 'Reading report')
  const files = await readTree(fs, dir, (rel) => rel.startsWith('.pbi/'))
  const report = readPbirFiles(files, 'pbir')
  for (const d of report.diagnostics) diagnostics.push({ level: 'warning', message: d })
  const ref = report.pbir?.datasetReference
  let model: SemanticModel = emptyModel()
  let data: DataStore = emptyDataStore()
  const source: ProjectSource = { kind, path: openedPath, reportPath: dir }
  if (ref?.byPath?.path) {
    const modelDir = joinPath(dir, String(ref.byPath.path).replace(/\\/g, '/'))
    if (await fs.exists(modelDir)) {
      const m = await openModelFolder(fs, modelDir, opts, diagnostics)
      model = m.model
      data = m.data
      source.modelPath = modelDir
    } else diagnostics.push({ level: 'error', message: `Semantic model folder not found: ${ref.byPath.path}` })
  } else if (ref?.byConnection) {
    const c = ref.byConnection
    diagnostics.push({
      level: 'warning',
      message: `This report is connected live to ${c.pbiModelDatabaseName ?? c.name ?? 'a remote semantic model'}; there is no local model or data.`
    })
  } else diagnostics.push({ level: 'warning', message: 'The report has no dataset reference.' })
  opts.onProgress?.(1, 'Done')
  return project(stripExt(basename(dir)), source, model, data, report, diagnostics)
}

async function openPbipFile(fs: FileSystem, path: string, opts: OpenOptions): Promise<ProjectDocument> {
  const pbip = await readJson(fs, path)
  const art = (pbip.artifacts ?? []).find((a: any) => a?.report?.path) ?? (pbip.artifacts ?? [])[0]
  const rel: string | undefined = art?.report?.path
  if (!rel) throw new Error('The .pbip file does not reference a report')
  const doc = await openReportFolder(fs, joinPath(dirname(path), rel.replace(/\\/g, '/')), opts, 'pbip', path)
  doc.name = stripExt(basename(path))
  return doc
}

function isModelFolderFiles(names: string[]): boolean {
  return names.includes('definition.pbism') || names.includes('model.bim')
}

/** Open a .pbix/.pbit/.pbip/.wbi/.bim file or a *.Report / *.SemanticModel / project folder. */
export async function openProject(path: string, fs: FileSystem, opts: OpenOptions = {}): Promise<ProjectDocument> {
  const st = await fs.stat(path)
  if (!st) throw new Error(`Not found: ${path}`)
  const name = basename(path)
  if (st.isDirectory) {
    const entries = await fs.list(path)
    const names = entries.map((e) => e.name)
    if (/\.Report$/i.test(name) || names.includes('definition.pbir')) return openReportFolder(fs, path, opts, 'pbir-folder', path)
    if (/\.SemanticModel$/i.test(name) || isModelFolderFiles(names)) {
      const diagnostics: Diagnostic[] = []
      const { model, data } = await openModelFolder(fs, path, opts, diagnostics)
      return project(stripExt(name), { kind: 'semantic-model-folder', path, modelPath: path }, model, data, undefined, diagnostics)
    }
    const pbips = entries.filter((e) => !e.isDirectory && /\.pbip$/i.test(e.name))
    if (pbips.length) return openPbipFile(fs, pbips[0].path, opts)
    const reports = entries.filter((e) => e.isDirectory && /\.Report$/i.test(e.name))
    if (reports.length === 1) return openReportFolder(fs, reports[0].path, opts, 'pbir-folder', path)
    const models = entries.filter((e) => e.isDirectory && /\.SemanticModel$/i.test(e.name))
    if (!reports.length && models.length === 1) return openProject(models[0].path, fs, opts)
    throw new Error(reports.length > 1 ? 'The folder contains several reports; open one of the *.Report folders' : 'No Power BI project found in this folder')
  }
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  switch (ext) {
    case 'pbip':
      return openPbipFile(fs, path, opts)
    case 'pbix':
    case 'pbit': {
      const bytes = await fs.readFile(path)
      const r = await readPbix(bytes, { onProgress: opts.onProgress, loadData: opts.loadData })
      // a later .pbix save keeps the embedded data model only while these tables are unchanged (pbix/write/origin.ts)
      if (r.kind === 'pbix') rememberPackageData(r.data, { path, size: st.size, mtime: st.mtime })
      return project(stripExt(name), { kind: r.kind, path }, r.model, r.data, r.report, r.diagnostics)
    }
    case 'wbi':
      return openWbi(await fs.readFile(path), path, opts)
    case 'bim': {
      const r = readTmsl(await readJson(fs, path))
      r.model.extra = { ...(r.model.extra ?? {}), '@pbipFormat': 'bim' }
      return project(stripExt(name), { kind: 'semantic-model-folder', path, modelPath: dirname(path) }, r.model, emptyDataStore(), undefined, r.diagnostics.map((m) => ({ level: 'warning' as const, message: m })))
    }
    default:
      throw new Error(`Unsupported file type: ${name}`)
  }
}

/** Open a `.wbi` bundle from bytes. */
export async function openWbi(bytes: Uint8Array, path: string | undefined, opts: OpenOptions = {}): Promise<ProjectDocument> {
  opts.onProgress?.(0, 'Reading bundle')
  const w = readWbi(bytes)
  const diagnostics: Diagnostic[] = []
  const name = w.manifest.name
  const sub = (prefix: string): FileMap => {
    const out: FileMap = {}
    for (const [p, b] of Object.entries(w.project)) if (p.startsWith(prefix)) out[p.slice(prefix.length)] = b
    return out
  }
  const modelFiles = sub(`${name}.SemanticModel/`)
  let model = emptyModel()
  if (Object.keys(modelFiles).length) {
    const r = readSemanticModelFiles(modelFiles)
    model = r.model
    diagnostics.push(...r.diagnostics)
  }
  const reportFilesMap = sub(`${name}.Report/`)
  let report: ReportDocument | undefined
  if (Object.keys(reportFilesMap).length) {
    report = readPbirFiles(reportFilesMap, 'pbir')
    for (const d of report.diagnostics) diagnostics.push({ level: 'warning', message: d })
  }
  const data = opts.loadData === false ? emptyDataStore() : w.data
  opts.onProgress?.(1, 'Done')
  return project(name, { kind: 'wbi', path }, model, data, report, diagnostics)
}

export interface SaveOptions {
  /**
   * 'pbip' writes <dir>/<name>.pbip + <name>.Report + <name>.SemanticModel; 'wbi' writes a single bundle with cached data;
   * 'bim' writes the model alone as a TMSL `.bim` file (`targetPath` is the file);
   * 'pbix' / 'pbit' write a Power BI package (pbix/write/package.ts: experimental, not verified in Power BI Desktop)
   */
  format: 'pbip' | 'wbi' | 'pbix' | 'pbit' | 'bim'
  /** report form inside a .pbix / .pbit: Desktop's legacy `Report/Layout` (default) or PBIR `Report/definition/**` */
  reportFormat?: 'legacy' | 'pbir'
  /** semantic model storage for PBIP (default: TMDL, or model.bim when the model was read from one) */
  modelFormat?: 'tmdl' | 'bim'
}

/**
 * Save a project.
 *  - format 'pbip': `targetPath` is either the `.pbip` file path or a directory (then `<dir>/<project.name>.pbip`).
 *    Files of removed pages/visuals/tables are deleted; unchanged files are left untouched.
 *  - format 'wbi': `targetPath` is the bundle file path.
 * Returns nothing; `project.source` is updated to the saved location and `dirty` cleared.
 */
export async function saveProject(project: ProjectDocument, targetPath: string, fs: FileSystem, opts: SaveOptions): Promise<void> {
  if (opts.format === 'pbix' || opts.format === 'pbit') {
    const r = await writePackage(opts.format, await packageInput(project, fs), { reportFormat: opts.reportFormat })
    await fs.mkdirp(dirname(targetPath))
    await fs.writeFile(targetPath, r.bytes)
    for (const d of r.diagnostics) project.diagnostics.push({ level: 'warning', message: d })
    // a template is an export: the document keeps its source. A .pbix becomes the document's file.
    if (opts.format === 'pbix') {
      const st = await fs.stat(targetPath)
      if (st) movePackageData(project.data, { path: targetPath, size: st.size, mtime: st.mtime })
      project.name = stripExt(basename(targetPath))
      project.source = { kind: 'pbix', path: targetPath }
      project.dirty = false
    }
    return
  }
  if (opts.format === 'wbi') {
    const name = /\.wbi$/i.test(targetPath) ? stripExt(basename(targetPath)) : project.name
    const { files } = pbipProjectFiles(name, project.model, project.report, { format: opts.modelFormat })
    const bytes = writeWbi(name, files, project.data, { kind: project.source.kind })
    await fs.mkdirp(dirname(targetPath))
    await fs.writeFile(targetPath, bytes)
    project.source = { kind: 'wbi', path: targetPath }
    project.dirty = false
    return
  }
  let dir: string
  let name: string
  if (/\.pbip$/i.test(targetPath)) {
    dir = dirname(targetPath)
    name = stripExt(basename(targetPath))
  } else {
    dir = targetPath
    name = project.name
  }
  if (opts.format === 'bim') {
    // a standalone model.bim saved in place (or to another .bim): the TMSL file only
    const { json, diagnostics } = writeTmsl(project.model)
    await fs.mkdirp(dirname(targetPath))
    await writeFileMap(fs, dirname(targetPath), { [basename(targetPath)]: JSON.stringify(json, null, 2) })
    for (const d of diagnostics) project.diagnostics.push({ level: 'warning', message: d })
    project.source = { kind: 'semantic-model-folder', path: targetPath, modelPath: dirname(targetPath) }
    project.dirty = false
    return
  }
  await fs.mkdirp(dir)
  const live = !!project.report?.pbir?.datasetReference?.byConnection && !project.model.tables.length
  // Saving where the project already lives keeps its folders: a report may point at a model folder with another name
  // (several reports sharing one model), and Power BI Desktop resolves the reference, not the name.
  const src = project.source
  const inPlace = (src.kind === 'pbip' || src.kind === 'pbir-folder' || src.kind === 'semantic-model-folder') && !!(src.reportPath ?? src.modelPath) && name === project.name
  const srcReport = inPlace && src.reportPath && dirname(src.reportPath) === dir ? src.reportPath : undefined
  const srcModel = inPlace && src.modelPath && dirname(src.modelPath) === dir && (srcReport || src.kind === 'semantic-model-folder') && !/\.bim$/i.test(src.path ?? '') ? src.modelPath : undefined
  const modelDir = srcModel ?? joinPath(dir, `${name}.SemanticModel`)
  const reportDir = srcReport ?? joinPath(dir, `${name}.Report`)
  const diagnostics: string[] = []
  if (!live) {
    const m = semanticModelFiles(project.model, name, { format: opts.modelFormat })
    diagnostics.push(...m.diagnostics)
    await fs.mkdirp(modelDir)
    await writeFileMap(fs, modelDir, m.files)
    project.model.sidecarFiles = { ...(project.model.sidecarFiles ?? {}), '.platform': m.files['.platform'] as string, 'definition.pbism': m.files['definition.pbism'] as string }
    // remove stale definition files (deleted tables / roles / cultures) and a superseded model.bim
    const format = opts.modelFormat ?? (project.model.extra?.['@pbipFormat'] === 'bim' ? 'bim' : 'tmdl')
    for (const rel of await walk(fs, modelDir)) {
      if (rel in m.files) continue
      // (Lumen's diagram sidecar is removed again once nothing custom is left in the diagram)
      if ((rel.startsWith('definition/') && rel.endsWith('.tmdl')) || (rel === 'model.bim' && format === 'tmdl') || rel === LUMEN_LAYOUT_FILE) await fs.remove(joinPath(modelDir, rel))
    }
  }
  if (project.report) {
    const files = reportFiles(project.report, name, live ? undefined : `../${basename(modelDir)}`)
    const pbir = JSON.parse(files['definition.pbir'] as string)
    const platformText = files['.platform'] as string
    const doc: ReportDocument = { ...project.report, pbir, extraFiles: { ...project.report.extraFiles, '.platform': platformText } }
    await writePbirFolder(fs, reportDir, doc)
    project.report.pbir = pbir
    project.report.extraFiles['.platform'] = platformText
    const pbipPath = joinPath(dir, `${name}.pbip`)
    let existing: unknown
    if (await fs.exists(pbipPath)) existing = await readJson(fs, pbipPath).catch(() => undefined)
    await writeFileMap(fs, dir, { [`${name}.pbip`]: pbipJson(existing, basename(reportDir), src.reportPath ? basename(src.reportPath) : undefined) })
  }
  for (const d of diagnostics) project.diagnostics.push({ level: 'warning', message: d })
  project.name = name
  project.source = project.report
    ? { kind: 'pbip', path: joinPath(dir, `${name}.pbip`), reportPath: reportDir, modelPath: live ? undefined : modelDir }
    : { kind: 'semantic-model-folder', path: modelDir, modelPath: modelDir }
  project.dirty = false
}

async function packageInput(project: ProjectDocument, fs: FileSystem): Promise<{ project: ProjectDocument; source?: Uint8Array; sourceFile?: { path: string; size: number; mtime: number } }> {
  const path = project.source.kind === 'pbix' ? project.source.path : undefined
  const st = path ? await fs.stat(path) : null
  if (!path || !st || st.isDirectory) return { project }
  return { project, source: await fs.readFile(path), sourceFile: { path, size: st.size, mtime: st.mtime } }
}

/** How a `.pbix` / `.pbit` save of the project would be written (for the Save dialog). */
export async function planPackageSave(project: ProjectDocument, format: 'pbix' | 'pbit', fs: FileSystem): Promise<PackagePlan> {
  return planPackage(format, await packageInput(project, fs))
}

/**
 * What **Save** writes without asking: the format and target for the place the project came from, or null when the
 * project has no saveable home (a `.pbix` / `.pbit`, a new report): then Save opens Save as.
 */
export function defaultSaveTarget(project: ProjectDocument): { format: 'pbip' | 'wbi' | 'bim'; target: string } | null {
  const p = project.source.path
  if (!p) return null
  switch (project.source.kind) {
    case 'wbi':
      return { format: 'wbi', target: p }
    case 'pbip':
      return /\.pbip$/i.test(p) ? { format: 'pbip', target: p } : { format: 'pbip', target: joinPath(p, `${project.name}.pbip`) }
    case 'pbir-folder':
    case 'semantic-model-folder': {
      // a standalone model.bim is saved back to itself (not to a new `model.bim.pbip` project)
      if (/\.bim$/i.test(p)) return { format: 'bim', target: p }
      const base = basename(p).replace(/\.(Report|SemanticModel)$/i, '')
      return { format: 'pbip', target: `${dirname(p)}/${base}.pbip` }
    }
    default:
      return null
  }
}

/** Text of a file inside a project file map (helper for callers/tests). */
export function fileText(files: FileMap, rel: string): string | undefined {
  return files[rel] ? decodeText(files[rel]) : undefined
}
