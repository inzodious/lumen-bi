/**
 * Shell commands: file lifecycle (new / open / save / save as / close), data (refresh, sample data),
 * insert (visuals, pages, text box, shapes, buttons, images), themes, modeling delegation.
 * Ribbon buttons, backstage entries, keyboard shortcuts and native menu commands all call these.
 */
import { nanoid } from 'nanoid'
import { openProject, saveProject } from '@core/io/open'
import { generateSyntheticData, type SyntheticResult } from '@core/data/synthetic'
import { emptyModel } from '@core/model/types'
import { emptyDataStore } from '@core/model/data'
import { emptyReport, type ReportDocument } from '@core/report/types'
import type { ProjectDocument } from '@core/project'
import { basename, dirname } from '@core/io/fs'
import { useApp } from '../state/store'
import { addPage, addVisual } from '../report/editOps'
import { holdBusy, releaseAfterPaint, setReady } from './readiness'
import { findPage, positionOf } from '../report/pbir'
import { getVisual } from '../visuals/registry'
import { applyDefaultSort } from '../panes/visualizations/wells'
import { useShell } from './shellState'
import { confirmDialog, alertDialog } from './ui/Modal'
import { toast } from './ui/Notify'
import { APP_NAME } from './brand'
import { openModelingDialog } from '../dialogs/modeling'
import { defaultThemeFor, setReportTheme } from './themes'

const host = () => window.wbi

export const PROJECT_FILTERS = [
  { name: 'Power BI files', extensions: ['pbix', 'pbit', 'pbip', 'wbi'] },
  { name: 'Power BI Desktop file', extensions: ['pbix'] },
  { name: 'Power BI template', extensions: ['pbit'] },
  { name: 'Power BI project', extensions: ['pbip'] },
  { name: `${APP_NAME} bundle`, extensions: ['wbi'] },
  { name: 'All files', extensions: ['*'] }
]

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------------------------
// Missing data detection
// ---------------------------------------------------------------------------------------------

/** Tables that should hold rows (non-calculated partitions) but have none loaded. */
export function tablesWithoutData(project: ProjectDocument): string[] {
  const out: string[] = []
  for (const t of project.model.tables) {
    if (t.calculationGroup) continue
    const parts = t.partitions
    if (!parts.length || parts.every((p) => p.sourceType === 'calculated' || p.sourceType === 'calculationGroup')) continue
    const st = project.data.status.get(t.name)
    const td = project.data.tables.get(t.name)
    if (st?.state === 'loaded') continue
    if (td && td.rowCount > 0) continue
    out.push(t.name)
  }
  return out
}

/** Tables whose rows came from the synthetic generator (status bar "Sample data" badge). */
export function syntheticTables(project: ProjectDocument | null): string[] {
  if (!project) return []
  const out: string[] = []
  for (const [name, st] of project.data.status) if (st.state === 'loaded' && st.source === 'synthetic') out.push(name)
  return out
}

function afterLoad(project: ProjectDocument): void {
  const shell = useShell.getState()
  shell.setDataNotice(null)
  const missing = tablesWithoutData(project)
  if (!missing.length) return
  const mode = shell.options.onMissingData
  if (mode === 'synthetic') useSampleData()
  else if (mode === 'refresh') shell.openDialog({ id: 'refresh' })
  else shell.setDataNotice({ kind: 'noData', tables: missing })
}

// ---------------------------------------------------------------------------------------------
// Unsaved changes
// ---------------------------------------------------------------------------------------------

/** Returns false when the user cancelled. */
export async function confirmDiscard(): Promise<boolean> {
  const { project } = useApp.getState()
  if (!project?.dirty) return true
  const r = await confirmDialog({
    title: APP_NAME,
    message: `Do you want to save your changes to "${project.name}"?`,
    buttons: ['Save', "Don't save", 'Cancel'],
    primary: 0
  })
  if (r === 2) return false
  if (r === 0) return save()
  return true
}

// ---------------------------------------------------------------------------------------------
// File lifecycle
// ---------------------------------------------------------------------------------------------

export function blankProject(name = 'Untitled'): ProjectDocument {
  const report = emptyReport()
  // Options ▸ Report settings ▸ default theme for new reports
  const theme = defaultThemeFor(useShell.getState().options.defaultTheme)
  if (theme?.json) setReportTheme(report, theme.json)
  return { id: nanoid(), name, source: { kind: 'new' }, model: emptyModel(name), data: emptyDataStore(), report, diagnostics: [], dirty: false }
}

export async function newReport(): Promise<void> {
  if (!(await confirmDiscard())) return
  useApp.getState().setProject(blankProject())
  useApp.getState().setView('report')
  useShell.getState().setDataNotice(null)
  useShell.getState().openBackstage(null)
  useShell.getState().setStartScreen(false)
}

export async function openFileDialog(): Promise<void> {
  const paths = await host().dialog.openFile({ title: 'Open', filters: PROJECT_FILTERS })
  if (paths?.[0]) await openPath(paths[0])
}

export async function openFolderDialog(): Promise<void> {
  const dir = await host().dialog.openDirectory({ title: 'Open a PBIP project, .Report or .SemanticModel folder' })
  if (dir) await openPath(dir)
}

/** Open a file/folder with a progress overlay. Resolves true on success. */
export async function openPath(path: string, opts: { skipConfirm?: boolean } = {}): Promise<boolean> {
  // busy from the request (before any await) until the project is installed and React committed, or the open failed
  const release = holdBusy('open')
  try {
    return await openPathInner(path, opts)
  } finally {
    releaseAfterPaint(release)
  }
}

async function openPathInner(path: string, opts: { skipConfirm?: boolean }): Promise<boolean> {
  if (!opts.skipConfirm && !(await confirmDiscard())) return false
  const app = useApp.getState()
  const shell = useShell.getState()
  shell.openBackstage(null)
  shell.setStartScreen(false)
  app.setBusy({ message: `Opening ${basename(path)}…`, progress: 0 })
  try {
    const project = await openProject(path, host().fs, { onProgress: (fraction, message) => useApp.getState().setBusy({ message, progress: fraction }) })
    // the canvas re-signals readiness once the new project's page rendered
    if (project.report) setReady(false)
    useApp.getState().setProject(project)
    useApp.getState().setView('report')
    useApp.getState().setBusy(null)
    host()
      .app.addRecent(path, project.name)
      .catch(() => undefined)
    for (const d of project.diagnostics.filter((x) => x.level === 'error').slice(0, 3)) toast({ kind: 'error', title: 'Problem while opening', message: d.message })
    afterLoad(project)
    return true
  } catch (e) {
    useApp.getState().setBusy(null)
    await alertDialog("Couldn't open the file", `${basename(path)}: ${errMessage(e)}`)
    return false
  }
}

function defaultSaveFormat(project: ProjectDocument): 'pbip' | 'wbi' | null {
  if (project.source.kind === 'wbi') return 'wbi'
  if (project.source.kind === 'pbip' || project.source.kind === 'pbir-folder' || project.source.kind === 'semantic-model-folder') return 'pbip'
  return null
}

/** Target path for saveProject: the .pbip file path (PBIP) or the .wbi file path. */
function saveTarget(project: ProjectDocument): string | null {
  const p = project.source.path
  if (!p) return null
  if (project.source.kind === 'wbi' || project.source.kind === 'pbip') return p
  if (project.source.kind === 'pbir-folder' || project.source.kind === 'semantic-model-folder') {
    const base = basename(p).replace(/\.(Report|SemanticModel)$/i, '')
    return `${dirname(p)}/${base}.pbip`
  }
  return null
}

export async function save(): Promise<boolean> {
  const { project } = useApp.getState()
  if (!project) return false
  const format = defaultSaveFormat(project)
  const target = saveTarget(project)
  if (!format || !target) return saveAs()
  return doSave(project, target, format)
}

export async function saveAs(preferred?: 'pbip' | 'wbi'): Promise<boolean> {
  const { project } = useApp.getState()
  if (!project) return false
  const docs = await host()
    .app.getPath('documents')
    .catch(() => '')
  const baseDir = project.source.path ? dirname(project.source.path) : docs
  const name = project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled'
  const filters =
    preferred === 'wbi'
      ? [{ name: `${APP_NAME} bundle (*.wbi)`, extensions: ['wbi'] }]
      : preferred === 'pbip'
        ? [{ name: 'Power BI project files (*.pbip)', extensions: ['pbip'] }]
        : [
            { name: 'Power BI project files (*.pbip)', extensions: ['pbip'] },
            { name: `${APP_NAME} bundle with data (*.wbi)`, extensions: ['wbi'] }
          ]
  const ext = preferred ?? 'pbip'
  const path = await host().dialog.saveFile({ title: 'Save as', defaultPath: `${baseDir}/${name}.${ext}`, filters })
  if (!path) return false
  const format: 'pbip' | 'wbi' = /\.wbi$/i.test(path) ? 'wbi' : 'pbip'
  const target = format === 'pbip' && !/\.pbip$/i.test(path) ? `${path}.pbip` : path
  return doSave(project, target, format)
}

async function doSave(project: ProjectDocument, target: string, format: 'pbip' | 'wbi'): Promise<boolean> {
  const app = useApp.getState()
  app.setBusy({ message: `Saving ${basename(target)}…` })
  try {
    await saveProject(project, target, host().fs, { format })
    const name = basename(target).replace(/\.(pbip|wbi)$/i, '')
    useApp.getState().markSaved({ kind: format === 'wbi' ? 'wbi' : 'pbip', path: target }, name)
    host()
      .app.addRecent(target, name)
      .catch(() => undefined)
    toast({ kind: 'success', message: `Saved to ${target}`, duration: 3000 })
    return true
  } catch (e) {
    await alertDialog("Couldn't save", errMessage(e))
    return false
  } finally {
    useApp.getState().setBusy(null)
  }
}

export async function closeProject(): Promise<void> {
  if (!(await confirmDiscard())) return
  useApp.getState().setProject(null)
  useShell.getState().setDataNotice(null)
  useShell.getState().openBackstage(null)
  useShell.getState().setStartScreen(true)
}

/** Window close requested (X / Alt+F4): prompt when dirty. */
export async function handleCloseRequest(): Promise<void> {
  const ok = await confirmDiscard()
  await host().window.confirmClose(ok)
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

export function refreshAll(tables?: string[]): void {
  if (!useApp.getState().project) return
  useShell.getState().openDialog({ id: 'refresh', tables })
}

/** Tables holding rows that were loaded from a source / file (not sample rows, not computed by the engine). */
export function tablesWithRealData(project: ProjectDocument | null): string[] {
  if (!project) return []
  const out: string[] = []
  for (const [name, st] of project.data.status) {
    if (st.state === 'loaded' && st.source !== 'synthetic' && st.source !== 'calculated' && (project.data.tables.get(name)?.rowCount ?? 0) > 0) out.push(name)
  }
  return out
}

/** What a sample-data run did, in one sentence per fact the user needs (toast + e2e). */
export function describeSampleRun(project: ProjectDocument, r: SyntheticResult): string {
  const filled = r.tables.filter((t) => (project.data.tables.get(t)?.rowCount ?? 0) > 0).length
  const count = (reason: string) => r.skipped.filter((s) => s.reason === reason).length
  const parts = [`Generated sample rows for ${filled} table${filled === 1 ? '' : 's'} (seed ${r.seed}).`]
  const calc = count('calculated')
  const meas = count('measureTable')
  const groups = count('calculationGroup')
  const kept = count('hasData')
  const empty: string[] = []
  if (calc) empty.push(`${calc} calculated table${calc === 1 ? ' is' : 's are'} computed from them`)
  if (meas) empty.push(`${meas} measure table${meas === 1 ? ' has' : 's have'} no rows by design`)
  if (groups) empty.push(`${groups} calculation group${groups === 1 ? '' : 's'} hold no rows`)
  if (kept) empty.push(`${kept} table${kept === 1 ? '' : 's'} kept ${kept === 1 ? 'its' : 'their'} existing data`)
  if (empty.length) parts.push(`${empty.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()))
  // free-text literals that were not reused need no warning: nothing is filtered to them in practice
  const named = r.withheld.filter((w) => w.kind !== 'text')
  const withheld = named.reduce((n, w) => n + w.literals, 0)
  if (withheld) {
    const where = [...new Set(named.map((w) => `${w.table}[${w.column}]`))]
    parts.push(
      `Privacy: ${withheld} name / id value${withheld === 1 ? '' : 's'} that formulas or report filters mention (${where.slice(0, 3).join(', ')}${where.length > 3 ? '…' : ''}) ${withheld === 1 ? 'was' : 'were'} not copied into the data; visuals or slicers filtered to ${withheld === 1 ? 'it' : 'them'} show no data until that filter is cleared (or allow it in Options ▸ Data load ▸ Sample data).`
    )
  }
  parts.push('All values are invented — refresh from the source for real data.')
  return parts.join(' ')
}

/**
 * Fill the model with schema-driven sample rows (src/core/data/synthetic.ts).
 *  - default: only tables without rows;
 *  - `replace: 'synthetic'`: also regenerate tables that hold sample rows (real data is kept);
 *  - `replace: 'all'`: every table, real data included.
 * `seed` overrides the seed of Options ▸ Data load.
 */
export function useSampleData(run: { replace?: 'empty' | 'synthetic' | 'all'; seed?: number } = {}): SyntheticResult | undefined {
  const { project } = useApp.getState()
  if (!project) return undefined
  const opts = useShell.getState().options
  try {
    const r = generateSyntheticData(project, {
      seed: run.seed ?? opts.syntheticSeed,
      factRows: opts.syntheticFactRows,
      replace: run.replace ?? 'empty',
      identifyingLiterals: opts.syntheticReuseIdentifying ? 'reuse' : 'never'
    })
    useApp.getState().dataChanged()
    useShell.getState().setDataNotice(null)
    toast({ kind: 'info', title: 'Sample data', message: describeSampleRun(project, r) })
    return r
  } catch (e) {
    toast({ kind: 'error', title: "Couldn't generate sample data", message: errMessage(e) })
    return undefined
  }
}

/**
 * "Regenerate sample data": a new random seed (stored in Options, so the dataset can be reproduced) and new
 * rows for every table that holds sample data or none — a different but equally consistent dataset. Tables
 * loaded from a real source are left alone unless the user asks for all tables.
 */
export async function regenerateSampleData(): Promise<SyntheticResult | undefined> {
  const { project } = useApp.getState()
  if (!project) return undefined
  const shell = useShell.getState()
  let replace: 'synthetic' | 'all' = 'synthetic'
  const real = tablesWithRealData(project)
  if (real.length) {
    const r = await confirmDialog({
      title: 'Regenerate sample data',
      message: `${real.length} table${real.length === 1 ? ' holds' : 's hold'} data loaded from the source${real.length <= 3 ? ` (${real.join(', ')})` : ''}. Replace only the sample tables, or every table?`,
      buttons: ['Sample tables only', 'All tables', 'Cancel'],
      primary: 0
    })
    if (r === 2 || r < 0) return undefined
    if (r === 1) replace = 'all'
  }
  let seed = shell.options.syntheticSeed
  while (seed === shell.options.syntheticSeed) seed = 1 + Math.floor(Math.random() * 2147483646)
  shell.setOptions({ syntheticSeed: seed })
  return useSampleData({ replace, seed })
}

// ---------------------------------------------------------------------------------------------
// Report editing
// ---------------------------------------------------------------------------------------------

function activePageDoc(report: ReportDocument): ReturnType<typeof findPage> {
  return findPage(report, useApp.getState().activePage)
}

/** Free slot for a new visual: cascade from top-left avoiding exact overlaps. */
function placement(report: ReportDocument, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const page = activePageDoc(report)
  const pw = Number(page?.json?.width ?? 1280)
  const ph = Number(page?.json?.height ?? 720)
  const width = Math.min(w, pw)
  const height = Math.min(h, ph)
  const taken = new Set((page?.visuals ?? []).map((v) => `${Math.round(positionOf(v).x)},${Math.round(positionOf(v).y)}`))
  let x = 20
  let y = 20
  for (let i = 0; i < 40 && taken.has(`${x},${y}`); i++) {
    x += 20
    y += 20
    if (x + width > pw || y + height > ph) {
      x = 20
      y = 20 + i
    }
  }
  return { x, y, width, height }
}

function ensureReport(): boolean {
  const { project } = useApp.getState()
  if (!project) {
    useApp.getState().setProject(blankProject())
    useShell.getState().setStartScreen(false)
  } else if (!project.report) {
    useApp.getState().setProject({ ...project, report: emptyReport() })
  }
  if (useApp.getState().view !== 'report') useApp.getState().setView('report')
  return true
}

/** Insert a visual of the given type on the active page and select it. Returns its name. */
export function insertVisual(visualType: string, visual: Record<string, any> = {}, size?: { width: number; height: number }, label = 'Insert visual'): string | undefined {
  ensureReport()
  const app = useApp.getState()
  let created: string | undefined
  const def = getVisual(visualType)
  const sz = size ?? def?.defaultSize ?? { width: 480, height: 270 }
  app.mutateReport(label, (r) => {
    const page = activePageDoc(r)
    if (!page) return
    created = addVisual(page, visualType, placement(r, sz.width, sz.height), visual)
  })
  if (created) useApp.getState().selectVisuals([created])
  return created
}

/** Change the type of the selected visual(s), keeping field wells (Visualizations pane gallery click). */
export function changeVisualType(names: string[], visualType: string): void {
  const app = useApp.getState()
  app.mutateReport('Change visual type', (r) => {
    const page = activePageDoc(r)
    for (const v of page?.visuals ?? []) {
      if (!names.includes(v.name) || !v.json.visual) continue
      v.json.visual.visualType = visualType
      // a default sort follows the new type (bar → value desc, line → category asc); user sorts are kept
      if (v.json.visual.query?.sortDefinition?.isDefaultSort) delete v.json.visual.query.sortDefinition
      applyDefaultSort(v.json)
      // PBI keeps objects that the new type understands; drop known type-specific objects is not needed (unknown objects are ignored by renderers)
    }
  })
}

const lit = (v: string | number | boolean) => ({ expr: { Literal: { Value: typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : typeof v === 'boolean' ? String(v) : Number.isInteger(v) ? `${v}L` : `${v}D` } } })

export function insertTextBox(): void {
  insertVisual(
    'textbox',
    {
      objects: {
        general: [{ properties: { paragraphs: [{ textRuns: [{ value: '' }] }] } }]
      },
      visualContainerObjects: { background: [{ properties: { show: lit(false) } }] }
    },
    { width: 280, height: 64 },
    'Insert text box'
  )
}

export type ButtonKind = 'Back' | 'Bookmark' | 'Information' | 'Help' | 'Q&A' | 'Blank' | 'Navigator' | 'PageNavigation' | 'DrillThrough'

const BUTTON_ICON: Record<string, string> = { Back: 'back', Bookmark: 'bookmark', Information: 'information', Help: 'help', 'Q&A': 'qna', Blank: 'blank', PageNavigation: 'rightArrow', DrillThrough: 'rightArrow' }

export function insertButton(kind: ButtonKind): void {
  if (kind === 'Navigator') return void insertVisual('pageNavigator', {}, { width: 480, height: 56 }, 'Insert page navigator')
  const icon = BUTTON_ICON[kind] ?? 'blank'
  const visual: Record<string, any> = {
    objects: { icon: [{ properties: { shapeType: lit(icon) }, selector: { id: 'default' } }] }
  }
  if (kind === 'Back' || kind === 'Bookmark' || kind === 'PageNavigation' || kind === 'DrillThrough' || kind === 'Q&A') {
    const type = kind === 'PageNavigation' ? 'PageNavigation' : kind === 'DrillThrough' ? 'Drillthrough' : kind === 'Q&A' ? 'Q&A' : kind
    visual.visualContainerObjects = { visualLink: [{ properties: { show: lit(true), type: lit(type) } }] }
  }
  insertVisual('actionButton', visual, { width: 112, height: 40 }, 'Insert button')
}

export type ShapeKind = 'rectangle' | 'rectangleRounded' | 'oval' | 'line' | 'triangle' | 'arrow' | 'pentagon' | 'hexagon' | 'octagon' | 'heart' | 'speechBubble' | 'chevron' | 'pentagonArrow' | 'tab'

export function insertShape(kind: ShapeKind): void {
  insertVisual('shape', { objects: { shape: [{ properties: { tileShape: lit(kind) } }] } }, { width: 200, height: 120 }, 'Insert shape')
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }

export async function insertImage(): Promise<void> {
  const paths = await host().dialog.openFile({ title: 'Open image', filters: [{ name: 'Images', extensions: Object.keys(IMAGE_MIME) }] })
  if (!paths?.[0]) return
  const bytes = await host().fs.readFile(paths[0])
  const ext = (paths[0].split('.').pop() ?? 'png').toLowerCase()
  const itemName = `${basename(paths[0]).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '')}${Date.now().toString().slice(-8)}.${ext}`
  ensureReport()
  let created: string | undefined
  useApp.getState().mutateReport('Insert image', (r) => {
    r.resources[`StaticResources/RegisteredResources/${itemName}`] = { path: `StaticResources/RegisteredResources/${itemName}`, bytes, mime: IMAGE_MIME[ext] }
    registerResource(r, itemName, 'Image')
    const page = activePageDoc(r)
    if (!page) return
    created = addVisual(page, 'image', placement(r, 240, 160), {
      objects: { general: [{ properties: { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: itemName } } } } }] }
    })
  })
  if (created) useApp.getState().selectVisuals([created])
}

/** Add an item to report.json `resourcePackages` (RegisteredResources). */
export function registerResource(r: ReportDocument, itemName: string, type: 'Image' | 'CustomTheme'): void {
  const rj = r.report
  rj.resourcePackages ??= []
  let pkg = rj.resourcePackages.find((p: any) => p.name === 'RegisteredResources')
  if (!pkg) {
    pkg = { name: 'RegisteredResources', type: 'RegisteredResources', items: [] }
    rj.resourcePackages.push(pkg)
  }
  pkg.items ??= []
  if (type === 'CustomTheme') pkg.items = pkg.items.filter((i: any) => i.type !== 'CustomTheme')
  if (!pkg.items.some((i: any) => i.name === itemName)) pkg.items.push({ name: itemName, path: itemName, type })
}

export function newPage(): void {
  ensureReport()
  let name: string | undefined
  useApp.getState().mutateReport('New page', (r) => {
    name = addPage(r, { after: useApp.getState().activePage ?? undefined })
  })
  if (name) useApp.getState().setActivePage(name)
}

// ---------------------------------------------------------------------------------------------
// Modeling delegation
// ---------------------------------------------------------------------------------------------

export type ModelingCommand =
  | 'newMeasure'
  | 'newColumn'
  | 'newTable'
  | 'quickMeasure'
  | 'manageRelationships'
  | 'markAsDateTable'
  | 'manageRoles'
  | 'viewAsRoles'
  | 'newParameter'
  | 'newFieldParameter'
  | 'newCalculationGroup'
  | 'newVisualCalculation'

/**
 * Run a modeling command. The modeling-views workstream implements the dialogs in dialogs/modeling
 * (`openModelingDialog(cmd, arg)`); commands it doesn't handle fall back to PBI's simplest behavior
 * (new measure/column/table create a `Name = ` stub selected for the formula bar).
 */
export async function runModelingCommand(cmd: ModelingCommand, arg?: unknown): Promise<void> {
  if (openModelingDialog(cmd, arg)) return
  const app = useApp.getState()
  const project = app.project
  if (!project) return
  const sel = app.selectedField
  const homeTable = (sel && sel.table) || project.model.tables.find((t) => !t.isHidden && !t.isPrivate)?.name
  const unique = (base: string, taken: Set<string>) => {
    if (!taken.has(base.toLowerCase())) return base
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
  }
  if (cmd === 'newMeasure' && homeTable) {
    const taken = new Set(project.model.tables.flatMap((t) => [...t.measures.map((m) => m.name.toLowerCase()), ...t.columns.map((c) => c.name.toLowerCase())]))
    const name = unique('Measure', taken)
    app.mutateModel('New measure', (m) => m.tables.find((t) => t.name === homeTable)?.measures.push({ name, expression: '', lineageTag: crypto.randomUUID() }))
    app.selectField({ kind: 'measure', table: homeTable, name })
  } else if (cmd === 'newColumn' && homeTable) {
    const t = project.model.tables.find((x) => x.name === homeTable)
    const name = unique('Column', new Set([...(t?.columns ?? []).map((c) => c.name.toLowerCase()), ...(t?.measures ?? []).map((c) => c.name.toLowerCase())]))
    app.mutateModel('New column', (m) => m.tables.find((x) => x.name === homeTable)?.columns.push({ name, dataType: 'string', kind: 'calculated', expression: '""', lineageTag: crypto.randomUUID(), summarizeBy: 'none' }))
    app.selectField({ kind: 'column', table: homeTable, name })
  } else if (cmd === 'newTable') {
    const name = unique('Table', new Set(project.model.tables.map((t) => t.name.toLowerCase())))
    app.mutateModel('New table', (m) =>
      m.tables.push({ name, columns: [], measures: [], hierarchies: [], partitions: [{ name, mode: 'import', sourceType: 'calculated', expression: '{ BLANK() }' }], lineageTag: crypto.randomUUID() })
    )
    app.selectField({ kind: 'table', table: name })
  } else {
    toast({ kind: 'info', message: 'This modeling dialog is not available in this build.' })
  }
}

// ---------------------------------------------------------------------------------------------
// Undo / redo honoring text inputs
// ---------------------------------------------------------------------------------------------

function inTextInput(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || !!el.closest('.cm-editor'))
}

export function undo(): void {
  if (inTextInput()) document.execCommand('undo')
  else useApp.getState().undo()
}

export function redo(): void {
  if (inTextInput()) document.execCommand('redo')
  else useApp.getState().redo()
}

// ---------------------------------------------------------------------------------------------
// Sample project
// ---------------------------------------------------------------------------------------------

type SampleModule = { createSampleProject?: () => ProjectDocument | Promise<ProjectDocument> }
const sampleModules = import.meta.glob<SampleModule>('../../../core/data/sample.ts')

/** True when a sample project can be opened (always: falls back to the built-in demo). */
export async function loadSampleProject(): Promise<void> {
  if (!(await confirmDiscard())) return
  let project: ProjectDocument | undefined
  for (const load of Object.values(sampleModules)) {
    const mod = await load()
    if (mod.createSampleProject) project = await mod.createSampleProject()
  }
  if (!project) project = (await import('./demoProject')).createDemoProject()
  if (project.report) setReady(false)
  useApp.getState().setProject(project)
  useApp.getState().setView('report')
  useShell.getState().setStartScreen(false)
  useShell.getState().openBackstage(null)
  afterLoad(project)
}
