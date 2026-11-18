/**
 * PBIR report folder <-> ReportDocument.
 *
 * The pure functions work on a map of files relative to the `*.Report` folder (so the same code
 * serves PBIP folders, PBIR-enabled PBIX files (`Report/definition/**`) and `.wbi` bundles);
 * `readPbirFolder` / `writePbirFolder` add the filesystem.
 *
 * Folder layout:
 *   definition.pbir                        dataset reference (byPath / byConnection)
 *   definition/version.json, report.json, reportExtensions.json
 *   definition/pages/pages.json, pages/<p>/page.json, pages/<p>/visuals/<v>/visual.json (+ mobile.json)
 *   definition/bookmarks/bookmarks.json, bookmarks/<b>.bookmark.json
 *   StaticResources/SharedResources/BaseThemes/*.json, StaticResources/RegisteredResources/*
 *   (PBIR-legacy: report.json instead of definition/ — converted with legacy.ts)
 */
import { builtinTheme, legacyDefaultBaseTheme } from '../report/themes/builtin'
import type { BookmarkDocument, PageDocument, ReportDocument, ResourceFile, VisualDocument } from '../report/types'
import { joinPath, walk, type FileSystem } from '../io/fs'
import { convertLegacyLayout } from './legacy'
import { makeResource } from './resources'
import { PBIR_VERSION, SCHEMA } from './schemas'

export type FileMap = Record<string, Uint8Array>
export type OutFileMap = Record<string, Uint8Array | string>

const utf8 = new TextDecoder('utf-8')

/** Decode text: UTF-8 (BOM stripped) or UTF-16LE (BOM or zero high bytes). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3))
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes)
  return utf8.decode(bytes)
}

export function parseJsonBytes(bytes: Uint8Array | undefined, what: string, diagnostics: string[]): any {
  if (!bytes) return undefined
  try {
    return JSON.parse(decodeText(bytes))
  } catch (e) {
    diagnostics.push(`Invalid JSON in ${what}: ${(e as Error).message}`)
    return undefined
  }
}

/** Resolve base / custom theme JSON from the report's resources. */
export function resolveThemes(report: Pick<ReportDocument, 'report' | 'resources'> & { origin?: ReportDocument['origin'] }, diagnostics?: string[]): { base?: any; custom?: any } {
  const tc = report.report?.themeCollection ?? {}
  const pkgs: any[] = Array.isArray(report.report?.resourcePackages) ? report.report.resourcePackages : []
  const find = (t: any): any => {
    if (!t?.name) return undefined
    const shared = t.type === 'SharedResources' || t.type === 2
    const pkgType = shared ? 'SharedResources' : 'RegisteredResources'
    const pkg = pkgs.find((p) => p.type === pkgType || p.name === pkgType)
    const item = pkg?.items?.find((i: any) => i.name === t.name)
    const rel = item?.path ?? (shared ? `BaseThemes/${t.name}.json` : t.name)
    const path = `StaticResources/${pkgType}/${rel}`
    const file = report.resources[path]
    if (!file) {
      // built-in themes referenced by name only (legacy layouts): Power BI ships them, so do we
      const builtin = builtinTheme(t.name)
      if (builtin) return builtin
      diagnostics?.push(`Theme '${t.name}' not found in the report resources (${path})`)
      return undefined
    }
    try {
      return JSON.parse(decodeText(file.bytes))
    } catch {
      diagnostics?.push(`Theme '${t.name}' is not valid JSON`)
      return undefined
    }
  }
  const out: { base?: any; custom?: any } = {}
  const base = find(tc.baseTheme)
  const custom = find(tc.customTheme)
  if (base !== undefined) out.base = base
  // legacy layouts without a base theme render with the pre-2019 default (Classic) palette in Power BI
  else if (report.origin === 'pbix-legacy' && !tc.baseTheme) out.base = legacyDefaultBaseTheme()
  if (custom !== undefined) out.custom = custom
  return out
}

const PAGE_RE = /^definition\/pages\/([^/]+)\/page\.json$/
const VISUAL_RE = /^definition\/pages\/([^/]+)\/visuals\/([^/]+)\/(visual|mobile)\.json$/
const BOOKMARK_RE = /^definition\/bookmarks\/(.+)\.bookmark\.json$/

/** Read a report from its files (paths relative to the `.Report` folder). */
export function readPbirFiles(files: FileMap, origin: ReportDocument['origin'] = 'pbir'): ReportDocument {
  const diagnostics: string[] = []
  const used = new Set<string>()
  const json = (p: string): any => {
    if (!(p in files)) return undefined
    used.add(p)
    return parseJsonBytes(files[p], p, diagnostics)
  }
  const doc: ReportDocument = {
    origin,
    report: {},
    pagesMeta: { pageOrder: [] },
    pages: [],
    bookmarks: [],
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics
  }
  const pbir = json('definition.pbir')
  if (pbir !== undefined) doc.pbir = pbir

  if ('definition/report.json' in files) {
    doc.report = json('definition/report.json') ?? {}
    const version = json('definition/version.json')
    if (version !== undefined) doc.version = version
    doc.pagesMeta = json('definition/pages/pages.json') ?? { pageOrder: [] }
    if (!Array.isArray(doc.pagesMeta.pageOrder)) doc.pagesMeta.pageOrder = []
    const pages = new Map<string, PageDocument>()
    for (const p of Object.keys(files)) {
      const m = PAGE_RE.exec(p)
      if (m) pages.set(m[1], { name: m[1], json: json(p) ?? { name: m[1] }, visuals: [] })
    }
    const visuals = new Map<string, VisualDocument>()
    for (const p of Object.keys(files).sort()) {
      const m = VISUAL_RE.exec(p)
      if (!m) continue
      const page = pages.get(m[1])
      if (!page) {
        diagnostics.push(`Visual ${m[2]} belongs to missing page ${m[1]}`)
        continue
      }
      const key = `${m[1]}/${m[2]}`
      let v = visuals.get(key)
      if (!v) {
        v = { name: m[2], json: {} }
        visuals.set(key, v)
        page.visuals.push(v)
      }
      if (m[3] === 'visual') v.json = json(p) ?? {}
      else v.mobile = json(p)
    }
    for (const v of visuals.values()) if (!v.json || !Object.keys(v.json).length) diagnostics.push(`Visual ${v.name} has a mobile.json but no visual.json`)
    const order = doc.pagesMeta.pageOrder as string[]
    for (const name of order) {
      const p = pages.get(name)
      if (p) doc.pages.push(p)
      else diagnostics.push(`Page ${name} listed in pages.json is missing`)
    }
    for (const [name, p] of [...pages].sort(([a], [b]) => (a < b ? -1 : 1))) if (!order.includes(name)) doc.pages.push(p)
    const bm = json('definition/bookmarks/bookmarks.json')
    if (bm !== undefined) doc.bookmarksMeta = bm
    for (const p of Object.keys(files).sort()) {
      const m = BOOKMARK_RE.exec(p)
      if (m) doc.bookmarks.push({ name: m[1], json: json(p) ?? {} })
    }
    const ext = json('definition/reportExtensions.json')
    if (ext !== undefined) doc.reportExtensions = ext
  } else if ('report.json' in files) {
    // PBIR-legacy: a single report.json in the legacy Layout format
    const layout = json('report.json')
    applyLegacy(doc, layout)
    doc.origin = origin === 'pbir' ? 'pbix-legacy' : origin
  } else {
    diagnostics.push('No report definition found (definition/report.json or report.json)')
  }

  for (const [p, bytes] of Object.entries(files)) {
    if (used.has(p)) continue
    if (p.startsWith('StaticResources/')) doc.resources[p] = makeResource(p, bytes)
    else doc.extraFiles[p] = bytes
  }
  doc.theme = resolveThemes(doc, diagnostics)
  return doc
}

/** Fill a ReportDocument from a parsed legacy layout (PBIX Report/Layout or PBIR-legacy report.json). */
export function applyLegacy(doc: ReportDocument, layout: any): void {
  if (!layout) return
  const conv = convertLegacyLayout(layout)
  doc.report = conv.report
  doc.version = conv.version
  doc.pagesMeta = conv.pagesMeta
  // visuals are kept sorted by name, like when they are read from a PBIR folder (z-order lives in position.z)
  doc.pages = conv.pages.map((p) => ({
    name: p.name,
    json: p.json,
    visuals: p.visuals
      .map((v) => (v.mobile ? { name: v.name, json: v.json, mobile: v.mobile } : { name: v.name, json: v.json }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }))
  if (conv.bookmarksMeta) doc.bookmarksMeta = conv.bookmarksMeta
  doc.bookmarks = conv.bookmarks
  if (conv.reportExtensions) doc.reportExtensions = conv.reportExtensions
  doc.diagnostics.push(...conv.diagnostics)
}

function jsonText(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

/** Serialize a report to its PBIR files (paths relative to the `.Report` folder). */
export function pbirToFiles(doc: ReportDocument): OutFileMap {
  const out: OutFileMap = {}
  if (doc.pbir !== undefined) out['definition.pbir'] = jsonText(doc.pbir)
  out['definition/version.json'] = jsonText(doc.version ?? { $schema: SCHEMA.version, version: PBIR_VERSION })
  // A legacy layout with no base theme renders with the Classic palette (see resolveThemes). Persist that as an
  // explicit SharedResources base theme so the saved PBIR reopens with the same colors here and in Power BI.
  const legacyTheme = doc.origin === 'pbix-legacy' && !doc.report?.themeCollection?.baseTheme
  const reportJson = legacyTheme
    ? { ...doc.report, themeCollection: { ...(doc.report?.themeCollection ?? {}), baseTheme: { name: 'Classic', type: 'SharedResources' } } }
    : doc.report
  if (legacyTheme) out['StaticResources/SharedResources/BaseThemes/Classic.json'] = jsonText(legacyDefaultBaseTheme())
  out['definition/report.json'] = jsonText(reportJson)
  const pagesMeta: Record<string, any> = { ...doc.pagesMeta, pageOrder: doc.pages.map((p) => p.name) }
  if (pagesMeta.activePageName && !pagesMeta.pageOrder.includes(pagesMeta.activePageName)) pagesMeta.activePageName = pagesMeta.pageOrder[0]
  if (!pagesMeta.$schema) pagesMeta.$schema = SCHEMA.pagesMetadata
  out['definition/pages/pages.json'] = jsonText(orderKeys(pagesMeta, ['$schema', 'pageOrder', 'activePageName']))
  for (const p of doc.pages) {
    const base = `definition/pages/${p.name}`
    out[`${base}/page.json`] = jsonText(p.json)
    for (const v of p.visuals) {
      out[`${base}/visuals/${v.name}/visual.json`] = jsonText(v.json)
      if (v.mobile !== undefined) out[`${base}/visuals/${v.name}/mobile.json`] = jsonText(v.mobile)
    }
  }
  if (doc.bookmarksMeta !== undefined || doc.bookmarks.length) {
    const meta = doc.bookmarksMeta ?? { $schema: SCHEMA.bookmarksMetadata, items: doc.bookmarks.map((b: BookmarkDocument) => ({ name: b.name })) }
    out['definition/bookmarks/bookmarks.json'] = jsonText(meta)
    for (const b of doc.bookmarks) out[`definition/bookmarks/${b.name}.bookmark.json`] = jsonText(b.json)
  }
  if (doc.reportExtensions !== undefined) out['definition/reportExtensions.json'] = jsonText(doc.reportExtensions)
  for (const r of Object.values(doc.resources) as ResourceFile[]) out[r.path] = r.bytes
  for (const [p, c] of Object.entries(doc.extraFiles)) if (!(p in out) && p !== 'report.json') out[p] = c
  return out
}

function orderKeys<T extends Record<string, any>>(o: T, first: string[]): T {
  const out: Record<string, any> = {}
  for (const k of first) if (o[k] !== undefined) out[k] = o[k]
  for (const [k, v] of Object.entries(o)) if (!(k in out)) out[k] = v
  return out as T
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k]))
}

// ---------------------------------------------------------------------------------------------
// filesystem
// ---------------------------------------------------------------------------------------------

/** Read every file below `dir` into a FileMap (relative paths). */
export async function readTree(fs: FileSystem, dir: string, skip: (rel: string) => boolean = () => false): Promise<FileMap> {
  const out: FileMap = {}
  for (const rel of await walk(fs, dir)) {
    if (skip(rel)) continue
    out[rel] = await fs.readFile(joinPath(dir, rel))
  }
  return out
}

export async function readPbirFolder(fs: FileSystem, dir: string): Promise<ReportDocument> {
  // .pbi/ holds per-user state (localSettings.json); not part of the report definition
  const files = await readTree(fs, dir, (rel) => rel.startsWith('.pbi/'))
  return readPbirFiles(files, 'pbir')
}

const enc = new TextEncoder()

/**
 * Write files below `dir`, skipping files whose content is unchanged (JSON compared semantically,
 * so untouched files keep their original bytes and git diffs stay minimal). Returns written paths.
 */
export async function writeFileMap(fs: FileSystem, dir: string, files: OutFileMap): Promise<string[]> {
  const written: string[] = []
  const madeDirs = new Set<string>()
  for (const [rel, content] of Object.entries(files)) {
    const path = joinPath(dir, rel)
    const bytes = typeof content === 'string' ? enc.encode(content) : content
    if (await fs.exists(path)) {
      try {
        const cur = await fs.readFile(path)
        if (deepEqual(cur, bytes)) continue
        if (/\.(json|pbir|pbism|pbip|platform)$/i.test(rel) || rel.endsWith('/.platform') || rel === '.platform') {
          if (deepEqual(JSON.parse(decodeText(cur)), JSON.parse(decodeText(bytes)))) continue
        }
      } catch {
        /* rewrite */
      }
    }
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (parent && !madeDirs.has(parent)) {
      await fs.mkdirp(parent)
      madeDirs.add(parent)
    }
    await fs.writeFile(path, content)
    written.push(rel)
  }
  return written
}

/**
 * Write a report to a `*.Report` folder: definition files, resources and preserved extra files.
 * Files of removed pages / visuals / bookmarks / resources are deleted; a PBIR-legacy `report.json`
 * is removed since the definition is now written in the PBIR format.
 */
export async function writePbirFolder(fs: FileSystem, dir: string, doc: ReportDocument): Promise<void> {
  const files = pbirToFiles(doc)
  await fs.mkdirp(dir)
  await writeFileMap(fs, dir, files)
  const existing = await walk(fs, dir)
  const stale = existing.filter((rel) => !(rel in files) && (rel.startsWith('definition/') || rel.startsWith('StaticResources/') || rel === 'report.json'))
  const removedDirs = new Set<string>()
  for (const rel of stale) {
    // remove whole page / visual folders when they are gone entirely
    const pm = /^definition\/pages\/([^/]+)\//.exec(rel)
    if (pm && !doc.pages.some((p) => p.name === pm[1])) {
      const d = `definition/pages/${pm[1]}`
      if (!removedDirs.has(d)) {
        removedDirs.add(d)
        await fs.remove(joinPath(dir, d))
      }
      continue
    }
    const vm = /^definition\/pages\/([^/]+)\/visuals\/([^/]+)\//.exec(rel)
    if (vm && !doc.pages.find((p) => p.name === vm[1])?.visuals.some((v) => v.name === vm[2])) {
      const d = `definition/pages/${vm[1]}/visuals/${vm[2]}`
      if (!removedDirs.has(d)) {
        removedDirs.add(d)
        await fs.remove(joinPath(dir, d))
      }
      continue
    }
    await fs.remove(joinPath(dir, rel))
  }
}
