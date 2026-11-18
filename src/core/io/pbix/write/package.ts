/**
 * `.pbit` / `.pbix` package writer (the write-side counterpart of ../container.ts). Pure TypeScript: no DOM, no Node.
 *
 * Paths (one is chosen by `planPackage`, shown in the Save dialog, recorded in docs/developer/file-format-io.md):
 *  - `pbit`                 template: DataModelSchema (TMSL, UTF-16LE) + report, no data. Power BI Desktop builds the
 *                           model and loads the data from the Power Query sources when the file is opened.
 *  - `pbix-original-model`  the project was read from a `.pbix` and its model and data are unchanged: the source
 *                           `DataModel` part is copied byte for byte, the report parts are rewritten.
 *  - `pbix-metadata`        as above with metadata-only model edits (measures, ...) applied to the source
 *                           `metadata.sqlitedb` and the `DataModel` re-packed by Lumen's ABF + XPress9 writers.
 * Everything else (a model whose tables, columns, relationships or data changed, or that never came from a `.pbix`)
 * cannot be written as a `.pbix` yet: the plan says so and offers `.pbit` / PBIP.
 *
 * Like every package Lumen writes, the result has no `SecurityBindings` part: that optional part holds data-source
 * permission settings encrypted for one Windows user on one machine, so a package written elsewhere cannot carry a
 * meaningful one. Power BI Desktop asks the person who opens the file to confirm data-source permissions, as for any
 * file received from someone else.
 *
 * None of these paths is verified in Power BI Desktop yet (VERIFIED_IN_DESKTOP).
 */
import { inflateSync } from 'fflate'
import type { ProjectDocument } from '../../../project'
import type { SemanticModel } from '../../../model/types'
import type { ReportDocument } from '../../../report/types'
import { deepEqual, pbirToFiles } from '../../../pbir/pbir'
import { reportToLegacyLayout } from '../../../pbir/toLegacy'
import { withBaseThemeResource } from '../../../pbir/themeResources'
import { writeTmsl } from '../../../tmdl/tmsl'
import { readPbix } from '../container'
import { contentTypesXml, fromUtf16le, readZipEntries, utf16le, ZipWriter, type ZipEntry } from './opc'
import { dataChangedSinceRead, packageFileOf, type PackageFileInfo } from './origin'
import { applyMetadataEdits, classifyModelChanges, type ModelChangeReport } from './metadataEdit'

export type PackageKind = 'pbix' | 'pbit'
export type PackagePath = 'pbit' | 'pbix-original-model' | 'pbix-metadata'

/**
 * Flip a path to `true` once a file written by it has been confirmed to open in Power BI Desktop. Until then the Save
 * dialog and the docs label it "Experimental: not yet verified in Power BI Desktop".
 */
export const VERIFIED_IN_DESKTOP: Record<PackagePath, boolean> = {
  pbit: false,
  'pbix-original-model': false,
  'pbix-metadata': false
}

/** Container `Version` part written for new packages (the value current Desktop writes). */
export const PACKAGE_VERSION = '1.28'
/** `Settings` written when there is no source package (shape of current Desktop's part; its Desktop version string). */
const DEFAULT_SETTINGS = { Version: 4, ReportSettings: {}, QueriesSettings: { TypeDetectionEnabled: true, RelationshipImportEnabled: true, Version: '2.139.2051.0' } }
/** `Metadata` written when there is no source package. */
const DEFAULT_METADATA = { Version: 5, AutoCreatedRelationships: [] as unknown[] }

export const CANNOT_WRITE_DATA =
  "Lumen can't write this model's data into a .pbix yet. Save a .pbit (Power BI loads the data from your sources when it opens the file) or a PBIP project."

export const PERMISSIONS_NOTE =
  'Power BI Desktop will ask whoever opens the file to confirm data source permissions (Lumen never writes the machine-specific SecurityBindings part).'

// ---------------------------------------------------------------------------------------------
// source packages
// ---------------------------------------------------------------------------------------------

export interface SourcePackage {
  bytes: Uint8Array
  entries: ZipEntry[]
  get(name: string): ZipEntry | undefined
  /** inflated bytes of a part */
  read(name: string): Uint8Array | undefined
}

export function openSourcePackage(bytes: Uint8Array): SourcePackage {
  const entries = readZipEntries(bytes)
  const byName = new Map(entries.map((e) => [e.name, e]))
  return {
    bytes,
    entries,
    get: (n) => byName.get(n),
    read: (n) => {
      const e = byName.get(n)
      if (!e) return undefined
      if (e.method === 0) return e.data
      if (e.method === 8) return inflateSync(e.data, { out: new Uint8Array(e.size) })
      throw new Error(`Unsupported zip compression method ${e.method} for ${n}`)
    }
  }
}

function jsonPart(src: SourcePackage | undefined, name: string): unknown {
  const b = src?.read(name)
  if (!b || b.length < 2) return undefined
  // JSON parts are UTF-16LE in Desktop's packages (2017 files carry binary Settings / Metadata: not JSON)
  const text = b[1] === 0 ? fromUtf16le(b) : new TextDecoder().decode(b)
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------------------------
// model (DataModelSchema)
// ---------------------------------------------------------------------------------------------

/**
 * TMSL database JSON for a template's `DataModelSchema`. Models without `defaultPowerBIDataSourceVersion` (2017-era
 * files whose queries lived in the DataMashup part) are written as V3 models at compatibility level 1550 or later,
 * because a template carries no DataMashup: every import partition must hold its Power Query expression.
 */
export function dataModelSchema(model: SemanticModel): { json: Record<string, any>; diagnostics: string[] } {
  const { json, diagnostics } = writeTmsl(model)
  const m = json.model
  let legacyQuery = 0
  for (const t of m.tables ?? []) {
    if (!t.partitions?.length) diagnostics.push(`Table ${t.name} has no partition; Power BI needs one to load it.`)
    for (const p of t.partitions ?? []) if (p.source?.type === 'query') legacyQuery++
  }
  if (legacyQuery) diagnostics.push(`${legacyQuery} partition(s) use a legacy query without Power Query (M); Power BI cannot load them from a template.`)
  if (!m.defaultPowerBIDataSourceVersion) {
    m.defaultPowerBIDataSourceVersion = 'powerBI_V3'
    if (!(Number(json.compatibilityLevel) >= 1550)) json.compatibilityLevel = 1550
    diagnostics.push('Model upgraded to Power BI data source version 3 (compatibility level 1550) so the template can carry its Power Query expressions.')
  }
  return { json, diagnostics }
}

// ---------------------------------------------------------------------------------------------
// report parts
// ---------------------------------------------------------------------------------------------

interface ReportParts {
  /** part name (without `Report/` prefix for report files) -> bytes */
  parts: Map<string, Uint8Array>
  diagnostics: string[]
}

/** Report parts in the package form (`Report/Layout` legacy layout, or `Report/definition/**` when `pbir`). */
function reportParts(report: ReportDocument, opts: { baseLayoutBytes?: Uint8Array; pbir?: boolean }): ReportParts {
  const diagnostics: string[] = []
  const parts = new Map<string, Uint8Array>()
  const themed = withBaseThemeResource(report.report, report.resources)
  const doc: ReportDocument = { ...report, report: themed.report, resources: themed.resources }
  if (opts.pbir) {
    const files = pbirToFiles(doc)
    for (const [p, c] of Object.entries(files)) {
      if (p === '.platform' || p === 'definition.pbir' || p.startsWith('.pbi/')) continue
      parts.set(`Report/${p}`, typeof c === 'string' ? new TextEncoder().encode(c) : c)
    }
  } else {
    const base = opts.baseLayoutBytes ? JSON.parse(fromUtf16le(opts.baseLayoutBytes)) : undefined
    const r = reportToLegacyLayout(doc, base)
    diagnostics.push(...r.diagnostics)
    // an unchanged report keeps the source part's exact bytes (number formatting such as 1280.0 included)
    parts.set('Report/Layout', base !== undefined && deepEqual(r.layout, base) ? opts.baseLayoutBytes! : utf16le(JSON.stringify(r.layout)))
    for (const res of Object.values(doc.resources)) parts.set(`Report/${res.path}`, res.bytes)
  }
  for (const [p, c] of Object.entries(report.extraFiles)) {
    if (p.startsWith('CustomVisuals/')) parts.set(`Report/${p}`, typeof c === 'string' ? new TextEncoder().encode(c) : c)
  }
  return { parts, diagnostics }
}

// ---------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------

export interface PackagePlan {
  kind: PackageKind
  /** the path that will be used; undefined when the file cannot be written */
  path?: PackagePath
  /** short label for the dialog */
  title: string
  /** what will happen, for the dialog */
  detail: string
  experimental: boolean
  /** why a `.pbix` can't be written (when path is undefined) */
  blockers: string[]
  /** metadata-only model changes (path `pbix-metadata`) */
  changes?: ModelChangeReport
}

const TITLES: Record<PackagePath, string> = {
  pbit: 'Power BI template (.pbit)',
  'pbix-original-model': 'Power BI file, keeping the original data model',
  'pbix-metadata': 'Power BI file with updated measures and metadata'
}

function planFor(kind: PackageKind, path: PackagePath, detail: string, changes?: ModelChangeReport): PackagePlan {
  return { kind, path, title: TITLES[path], detail, experimental: !VERIFIED_IN_DESKTOP[path], blockers: [], ...(changes ? { changes } : {}) }
}

function sourcePath(project: ProjectDocument): string | undefined {
  return project.source.kind === 'pbix' && project.source.path && /\.pbix$/i.test(project.source.path) ? project.source.path : undefined
}

export interface PlanInput {
  project: ProjectDocument
  /** bytes of the `.pbix` the project was read from (needed for `.pbix`) */
  source?: Uint8Array
  /** size / mtime of that file now: must match what was read (else the file changed on disk since it was opened) */
  sourceFile?: PackageFileInfo
}

/** Decide how a `.pbix` / `.pbit` of the project would be written. */
export async function planPackage(kind: PackageKind, input: PlanInput): Promise<PackagePlan> {
  const { project } = input
  if (kind === 'pbit') {
    if (!project.model.tables.length) return { kind, title: TITLES.pbit, detail: '', experimental: true, blockers: ['The project has no data model to put in a template (a live-connected report cannot be saved as a template).'] }
    return planFor(kind, 'pbit', 'The template holds the model and the report without data. Power BI Desktop loads the data from the Power Query sources when it opens the file. ' + PERMISSIONS_NOTE)
  }
  const blocked = (blockers: string[]): PackagePlan => ({ kind, title: 'Power BI file (.pbix)', detail: CANNOT_WRITE_DATA, experimental: true, blockers })
  if (!sourcePath(project) || !input.source) return blocked(['The model was not read from a .pbix file, so there is no Power BI data model to keep.'])
  const src = openSourcePackage(input.source)
  if (!src.get('DataModel')) return blocked(['The source file has no embedded data model (template, live connection or report-only file).'])
  const read = packageFileOf(project.data)
  if (input.sourceFile && read && (read.path !== input.sourceFile.path || read.size !== input.sourceFile.size || read.mtime !== input.sourceFile.mtime))
    return blocked([`${input.sourceFile.path} changed on disk since Lumen read it; reopen it to save a .pbix from it.`])
  const dataChanges = dataChangedSinceRead(project.data, project.model)
  if (dataChanges === undefined) return blocked(['Lumen cannot tell whether the data changed since the file was opened.'])
  if (dataChanges.length) return blocked([`Data changed since the file was opened (${dataChanges.slice(0, 5).join(', ')}${dataChanges.length > 5 ? ', ...' : ''}).`])
  const original = await readPbix(input.source, { loadData: false })
  const changes = classifyModelChanges(original.model, project.model)
  if (changes.unsupported.length) return blocked(changes.unsupported.slice(0, 8))
  if (!changes.changes.length) return planFor(kind, 'pbix-original-model', 'The data model is unchanged: Lumen copies the original data model byte for byte and writes the report. ' + PERMISSIONS_NOTE)
  return planFor(kind, 'pbix-metadata', `Lumen writes ${changes.changes.length} model change(s) (${changes.summary}) into the original data model and keeps all data. ${PERMISSIONS_NOTE}`, changes)
}

// ---------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------

export interface WritePackageOptions {
  /** timestamp of new parts (deterministic output in tests) */
  date?: Date
  /** write the report as PBIR (`Report/definition/**`) instead of the legacy `Report/Layout` */
  reportFormat?: 'legacy' | 'pbir'
}

export interface WritePackageResult {
  bytes: Uint8Array
  plan: PackagePlan
  diagnostics: string[]
}

/** Write a project as `.pbit` or `.pbix`. Throws (with the plan's reason) when the requested file cannot be written. */
export async function writePackage(kind: PackageKind, input: PlanInput, opts: WritePackageOptions = {}): Promise<WritePackageResult> {
  const plan = await planPackage(kind, input)
  if (!plan.path) throw new Error(`${plan.detail}${plan.blockers.length ? `\n\n${plan.blockers.join('\n')}` : ''}`)
  const src = input.source ? openSourcePackage(input.source) : undefined
  if (plan.path === 'pbit') return { ...writePbit(input.project, src, opts), plan }
  return { ...(await writePbixFromSource(input.project, src!, plan, opts)), plan }
}

function diagramLayout(model: SemanticModel): string | undefined {
  return model.sidecarFiles?.['diagramLayout.json']
}

/** Template: Version, [Content_Types].xml, DataModelSchema, DiagramLayout, Report/*, Settings, Metadata. */
export function writePbit(project: ProjectDocument, src: SourcePackage | undefined, opts: WritePackageOptions = {}): { bytes: Uint8Array; diagnostics: string[] } {
  const diagnostics: string[] = []
  const parts: Array<[string, Uint8Array]> = []
  parts.push(['Version', utf16le(PACKAGE_VERSION)])
  const schema = dataModelSchema(project.model)
  diagnostics.push(...schema.diagnostics)
  parts.push(['DataModelSchema', utf16le(JSON.stringify(schema.json, null, 2))])
  const dl = diagramLayout(project.model)
  if (dl !== undefined) parts.push(['DiagramLayout', utf16le(dl)])
  if (project.report) {
    const r = reportParts(project.report, { baseLayoutBytes: src?.read('Report/Layout'), pbir: opts.reportFormat === 'pbir' })
    diagnostics.push(...r.diagnostics)
    const layout = r.parts.get('Report/Layout')
    if (layout) parts.push(['Report/Layout', layout])
    parts.push(['Settings', utf16le(JSON.stringify(jsonPart(src, 'Settings') ?? DEFAULT_SETTINGS))])
    parts.push(['Metadata', utf16le(JSON.stringify(jsonPart(src, 'Metadata') ?? DEFAULT_METADATA))])
    for (const [n, b] of r.parts) if (n !== 'Report/Layout') parts.push([n, b])
  } else {
    parts.push(['Settings', utf16le(JSON.stringify(jsonPart(src, 'Settings') ?? DEFAULT_SETTINGS))])
    parts.push(['Metadata', utf16le(JSON.stringify(jsonPart(src, 'Metadata') ?? DEFAULT_METADATA))])
  }
  const zip = new ZipWriter({ date: opts.date })
  zip.add('Version', parts[0][1])
  zip.add('[Content_Types].xml', contentTypesXml(parts.map(([n]) => n)))
  for (const [n, b] of parts.slice(1)) zip.add(n, b)
  return { bytes: zip.finish(), diagnostics }
}

/** Parts of a source package that a `.pbix` save regenerates (the rest is copied byte for byte, except SecurityBindings). */
function isReportPart(name: string): boolean {
  return name === 'Report/Layout' || name.startsWith('Report/definition/') || name.startsWith('Report/StaticResources/') || name.startsWith('Report/CustomVisuals/') || name === 'Report/definition.pbir'
}

/** Patch the source `[Content_Types].xml`: drop Overrides of removed parts, add Overrides / Defaults for new ones. */
function patchContentTypes(xml: string, names: string[]): string {
  const present = new Set(names.map((n) => `/${n}`))
  let out = xml.replace(/<Override\s+PartName="([^"]*)"[^>]*\/>/g, (m, part: string) => {
    let decoded = part
    try {
      decoded = decodeURIComponent(part)
    } catch {
      /* keep */
    }
    return present.has(decoded) ? m : ''
  })
  const fresh = contentTypesXml(names)
  const has = (needle: string): boolean => out.toLowerCase().includes(needle.toLowerCase())
  const additions: string[] = []
  for (const m of fresh.matchAll(/<(Default|Override)\s+(Extension|PartName)="([^"]*)"[^>]*\/>/g)) {
    if (!has(`${m[2]}="${m[3]}"`)) additions.push(m[0])
  }
  if (additions.length) out = out.replace('</Types>', `${additions.join('')}</Types>`)
  return out
}

async function writePbixFromSource(project: ProjectDocument, src: SourcePackage, plan: PackagePlan, opts: WritePackageOptions): Promise<{ bytes: Uint8Array; diagnostics: string[] }> {
  const diagnostics: string[] = []
  const sourceIsPbir = !!src.get('Report/definition/report.json')
  const r = project.report ? reportParts(project.report, { baseLayoutBytes: src.read('Report/Layout'), pbir: opts.reportFormat ? opts.reportFormat === 'pbir' : sourceIsPbir }) : undefined
  if (r) diagnostics.push(...r.diagnostics)
  // DataModel: original bytes, or the source with metadata edits applied
  let dataModel: Uint8Array | undefined
  if (plan.path === 'pbix-metadata') {
    const res = await applyMetadataEdits(src.read('DataModel')!, plan.changes!)
    dataModel = res.dataModel
    diagnostics.push(...res.diagnostics)
  }
  const dl = diagramLayout(project.model)
  const srcDl = src.read('DiagramLayout')
  const newDl = dl !== undefined && (!srcDl || fromUtf16le(srcDl) !== dl) ? utf16le(dl) : undefined

  // final part list in source order; regenerated report parts take the place of the first source report part
  type Out = { name: string; raw?: ZipEntry; bytes?: Uint8Array; store?: boolean }
  const out: Out[] = []
  let reportInserted = false
  const insertReport = (): void => {
    if (reportInserted || !r) return
    reportInserted = true
    for (const [n, b] of r.parts) {
      const prev = src.get(n)
      const prevBytes = prev ? src.read(n) : undefined
      out.push(prev && prevBytes && bytesEqual(prevBytes, b) ? { name: n, raw: prev } : { name: n, bytes: b })
    }
  }
  for (const e of src.entries) {
    if (e.name === 'SecurityBindings') continue
    if (isReportPart(e.name)) {
      insertReport()
      continue
    }
    if (e.name === 'DiagramLayout' && newDl) out.push({ name: e.name, bytes: newDl })
    else if (e.name === 'DataModel' && dataModel) out.push({ name: e.name, bytes: dataModel, store: true })
    else out.push({ name: e.name, raw: e })
  }
  if (!reportInserted && r) {
    // the source had no report part: put the report before SecurityBindings / DataModel like Desktop
    const at = out.findIndex((o) => o.name === 'DataModel')
    const tail = at >= 0 ? out.splice(at) : []
    insertReport()
    out.push(...tail)
  }
  if (newDl && !src.get('DiagramLayout')) out.splice(Math.min(2, out.length), 0, { name: 'DiagramLayout', bytes: newDl })
  const names = out.map((o) => o.name)
  const ct = src.get('[Content_Types].xml')
  const ctText = ct ? new TextDecoder().decode(src.read('[Content_Types].xml')!) : undefined
  const ctNew = ctText !== undefined ? patchContentTypes(ctText, names) : contentTypesXml(names)

  const zip = new ZipWriter({ date: opts.date })
  for (const o of out) {
    if (o.name === '[Content_Types].xml') {
      if (ct && ctNew === ctText) zip.addRaw(ct)
      else zip.add('[Content_Types].xml', ctNew)
    } else if (o.raw) zip.addRaw(o.raw)
    else zip.add(o.name, o.bytes!, { store: o.store })
  }
  if (!zip.has('[Content_Types].xml')) throw new Error('The source package has no [Content_Types].xml')
  return { bytes: zip.finish(), diagnostics }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Plain-text summary of a plan for the dialog / CLI log. */
export function describePlan(plan: PackagePlan): string {
  const lines = [plan.path ? plan.title : 'Cannot write this file', plan.detail, ...plan.blockers]
  if (plan.path && plan.experimental) lines.push('Experimental: not yet verified in Power BI Desktop.')
  return lines.filter(Boolean).join('\n')
}

export { deepEqual }
