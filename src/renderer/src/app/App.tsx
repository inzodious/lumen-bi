/**
 * Application shell (Power BI Desktop layout):
 *
 *   ┌ TitleBar ─────────────────────────────────────────────────────────────┐
 *   │ Ribbon (File · Home · Insert · Modeling · View · Optimize · Help …)   │
 *   │ notification bars                                                     │
 *   ├─NavRail─┬─────────── active view ───────────────┬── panes ──┬switch─┤
 *   │         │ Report canvas + page tabs / Table / … │ Filters … │       │
 *   ├─────────┴───────────────────────────────────────┴───────────┴───────┤
 *   │ StatusBar                                                           │
 *   └─────────────────────────────────────────────────────────────────────┘
 * Power Query opens full-window (own ribbon) below the title bar. Backstage (File) overlays everything.
 *
 * Headless capture options (hash query on `#/`): sample=1 · view=report|data|model|dax|powerquery ·
 * backstage=home|open|save|saveAs|export|options|about · panes=filters,visualizations,… · collapse=filters,… ·
 * select=<visualName> · vizTab=build|format|analytics · formatTab=visual|general · dialog=getData|options|… ·
 * start=1 (start screen) · tab=<ribbon tab id> · notice=1 (missing-data bar) · field=Table.Column|Table.[Measure] ·
 * export=pdf|pptx|png|html&exportPath=/abs[&pngScale=2] (scripted export) · simdrag=<visual|type#n>:<dx>,<dy>[:<handle>]
 * (canvas: show the smart guides of a simulated drag) · page=<name|n> · perf=1 (record Performance analyzer + refresh) ·
 * mobile=1|auto (mobile layout, report/mobile) · e2e=1 (window.__lumen test hooks, app/e2eHooks.ts) · cf=<object>.<prop>[@queryRef][&cfStyle=rules] (fx dialog, panes/visualizations/cf)
 */
import { useEffect, useRef } from 'react'
import '../visuals'
import { useApp } from '../state/store'
import { ReportView } from '../report'
import { DataView } from '../views/data/DataView'
import { ModelView } from '../views/model/ModelView'
import { DaxQueryView } from '../views/dax/DaxQueryView'
import { PowerQueryEditor } from '../views/powerquery/PowerQueryEditor'
import { FormulaBar, commitFormula, formulaTarget } from '../editors/FormulaBar'
import { PaneHost } from '../panes/PaneHost'
import { DialogsHost } from '../dialogs/DialogsHost'
import { AuthPromptHost } from '../views/powerquery/AuthPromptHost'
import { ModelingDialogHost } from '../dialogs/modeling'
import { exportVisualData, exportReportWithResult, describeIncompletePages, openExportDialog } from '../export'
import { TitleBar } from './TitleBar'
import { Ribbon } from './ribbon/Ribbon'
import { registerStandardTabs } from './ribbon/tabs'
import { NavRail } from './NavRail'
import { StatusBar } from './StatusBar'
import { Backstage } from './backstage/Backstage'
import { StartScreen } from './StartScreen'
import { NoticeArea } from './NoticeArea'
import { BusyOverlay } from './BusyOverlay'
import { useShell, PANE_ORDER, type BackstagePage, type PaneId } from './shellState'
import { ContextMenuHost } from './ui/Menu'
import { DialogHost } from './ui/Modal'
import { ToastHost } from './ui/Notify'
import { runModelingCommand, type ModelingCommand } from './commands'
import { newFromTemplate } from './templates'
import { closeProject, handleCloseRequest, newReport, openFileDialog, openFolderDialog, openPath, redo, save, saveAs, tablesWithoutData, undo, loadSampleProject, useSampleData } from './commands'
import { parseHash } from './Router'
import type { AppView } from '../state/store'
import { holdBusy, mirrorStoreBusy, releaseAfterPaint, setReady } from './readiness'
import { installE2EHooks } from './e2eHooks'

registerStandardTabs()
mirrorStoreBusy()
// end-to-end tests (e2e/harness.ts): expose stores + error log on window.__lumen
if (typeof window !== 'undefined' && parseHash(window.location.hash).params.get('e2e') === '1') installE2EHooks()
// busy from the first moment the renderer runs until launch() finished opening/applying the route (see readiness.ts)
const releaseLaunch = holdBusy('launch')
setReady(false)

let launched = false

function markReadyUnlessReport(): void {
  const { project, view } = useApp.getState()
  const shell = useShell.getState()
  // ReportView owns readiness while it displays a report (sets '0' then '1' when visuals rendered)
  if (project?.report && view === 'report' && !shell.backstage && !shell.startScreen) return
  requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
}

/** Apply `#/?…` options (used by headless captures and deep links). */
function applyRouteOptions(params: URLSearchParams): void {
  const shell = useShell.getState()
  const app = useApp.getState()
  const view = params.get('view') as AppView | null
  if (view) app.setView(view)
  const panes = params.get('panes')
  if (panes) for (const id of PANE_ORDER) shell.setPane(id, { open: panes.split(',').includes(id), collapsed: false })
  for (const id of (params.get('collapse') ?? '').split(',').filter(Boolean)) shell.setPane(id as PaneId, { open: true, collapsed: true })
  const sel = params.get('select')
  if (sel) app.selectVisuals(sel.split(','))
  const vizTab = params.get('vizTab')
  if (vizTab === 'build' || vizTab === 'format' || vizTab === 'analytics') shell.setVizTab(vizTab)
  const formatTab = params.get('formatTab')
  if (formatTab === 'visual' || formatTab === 'general') shell.setFormatTab(formatTab)
  const tab = params.get('tab')
  if (tab) shell.setRibbonTab(tab)
  const field = params.get('field')
  if (field) {
    const m = /^(.+?)\.\[(.+)\]$/.exec(field)
    if (m) app.selectField({ kind: 'measure', table: m[1], name: m[2] })
    else {
      const [t, ...c] = field.split('.')
      app.selectField(c.length ? { kind: 'column', table: t, name: c.join('.') } : { kind: 'table', table: t })
    }
  }
  if (params.get('notice') === '1' && app.project) shell.setDataNotice({ kind: 'noData', tables: app.project.model.tables.map((t) => t.name).slice(0, 3) })
  // performance analyzer: start recording and refresh visuals (`perf=1`)
  if (params.get('perf') === '1' && app.project) {
    shell.setPerfRecording(true)
    useApp.getState().dataChanged()
  }
  const dialog = params.get('dialog')
  if (dialog) shell.openDialog({ id: dialog } as never)
  const backstage = params.get('backstage') as BackstagePage | null
  if (backstage) shell.openBackstage(backstage)
  if (params.get('start') === '1') shell.setStartScreen(true)
  if (params.get('data') === 'sample' && app.project) useSampleData()
  const page = params.get('page')
  if (page && app.project?.report) {
    // by page name or display name (case-insensitive), or 1-based index
    const pages = app.project.report.pagesMeta.pageOrder.map((n) => app.project!.report!.pages.find((p) => p.name === n)).filter(Boolean)
    const hit = /^\d+$/.test(page) ? pages[Number(page) - 1] : pages.find((p) => p!.name === page || String(p!.json?.displayName ?? '').toLowerCase() === page.toLowerCase())
    if (hit) app.setActivePage(hit.name)
  }
  // modeling: `cmd=newMeasure` runs a modeling command; `formula=Name = expr` commits to the selected formula
  const cmd = params.get('cmd')
  if (cmd) void runModelingCommand(cmd as ModelingCommand)
  const formula = params.get('formula')
  if (formula) {
    const target = formulaTarget(useApp.getState().project?.model, useApp.getState().selectedField)
    if (target) commitFormula(target, formula)
  }
}

/**
 * Scripted export self-test for headless runs: `#/?sample=1&export=pdf&exportPath=/abs/out.pdf`.
 * Holds `document.body.dataset.wbiBusy = '1'` so the capture harness waits for it.
 */
async function runScriptedExport(params: URLSearchParams): Promise<void> {
  const fmt = params.get('export') as 'pdf' | 'pptx' | 'png' | 'html' | null
  const path = params.get('exportPath')
  if (!fmt || !path || !useApp.getState().project?.report) return
  const release = holdBusy('scripted export')
  try {
    await new Promise((r) => setTimeout(r, 1500))
    const res = Number(params.get('pngScale') ?? '')
    const out = await exportReportWithResult(fmt, { path, ...(res > 0 ? { resolution: res } : {}) })
    console.info(`[export] ${fmt} → ${out?.path ?? 'cancelled'}`)
    if (out?.incomplete.length) console.warn(`[export] pages not fully rendered: ${describeIncompletePages(out.incomplete)}`)
  } catch (e) {
    console.error(`[export] ${fmt} failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    release()
  }
}

async function launch(): Promise<void> {
  // stay "busy" for the capture harness until the project is open, route options applied and React committed
  // (otherwise the empty-report readiness fires mid-load, e.g. at "Reading model metadata 37%")
  const release = releaseLaunch
  try {
    const params = parseHash(window.location.hash).params
    const files = await window.wbi?.app.getLaunchFiles().catch(() => [] as string[])
    if (files?.length) {
      const ok = await openPath(files[0], { skipConfirm: true })
      applyRouteOptions(params)
      markReadyUnlessReport()
      if (ok) void runScriptedExport(params)
      return
    }
    if (params.get('sample') === '1') await loadSampleProject()
    else if (params.get('template')) await newFromTemplate(params.get('template')!)
    else if (useShell.getState().options.showStartScreen && params.get('start') !== '0') useShell.getState().setStartScreen(true)
    applyRouteOptions(params)
    markReadyUnlessReport()
    void runScriptedExport(params)
  } catch (e) {
    console.error(`[launch] ${e instanceof Error ? e.message : String(e)}`)
    markReadyUnlessReport()
  } finally {
    releaseAfterPaint(release)
  }
}

function useMenuCommands(): void {
  useEffect(() => {
    if (!window.wbi) return
    const offMenu = window.wbi.window.onMenuCommand((cmd) => {
      switch (cmd) {
        case 'file.new':
          return void newReport()
        case 'file.open':
          return void openFileDialog()
        case 'file.openFolder':
          return void openFolderDialog()
        case 'file.save':
          return void save()
        case 'file.saveAs':
          return void saveAs()
        case 'file.close':
          return void closeProject()
        case 'file.export.pdf':
          return openExportDialog('pdf')
        case 'file.export.pptx':
          return openExportDialog('pptx')
        case 'file.export.png':
          return openExportDialog('png')
        case 'file.export.html':
          return openExportDialog('html')
        case 'file.export.pbip':
          return void saveAs('pbip')
        case 'edit.undo':
          return undo()
        case 'edit.redo':
          return redo()
        case 'view.report':
        case 'view.data':
        case 'view.model':
        case 'view.dax':
        case 'view.powerquery':
          return useApp.getState().setView(cmd.slice(5) as AppView)
        case 'help.about':
          return useShell.getState().openDialog({ id: 'about' })
      }
    })
    const offClose = window.wbi.window.onCloseRequested(() => void handleCloseRequest())
    return () => {
      offMenu()
      offClose()
    }
  }, [])
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const shell = useShell.getState()
      if (e.key === 'Escape' && shell.backstage && !document.querySelector('.wbi-modal, .wbi-popover')) {
        shell.openBackstage(null)
        return
      }
      if (e.key === 'F1' && mod) {
        e.preventDefault()
        shell.toggleRibbon()
        return
      }
      if (!mod || e.altKey) return
      const k = e.key.toLowerCase()
      const run = (f: () => unknown) => {
        e.preventDefault()
        e.stopPropagation()
        f()
      }
      if (k === 's' && e.shiftKey) run(() => saveAs())
      else if (k === 's') run(() => save())
      else if (k === 'o') run(() => openFileDialog())
      else if (k === 'n' && !e.shiftKey) run(() => newReport())
      else if (k === 'z' && !e.shiftKey) run(undo)
      else if (k === 'y' || (k === 'z' && e.shiftKey)) run(redo)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

function MainView() {
  const view = useApp((s) => s.view)
  if (view === 'data') return <DataView />
  if (view === 'model') return <ModelView />
  if (view === 'dax') return <DaxQueryView />
  return <ReportView />
}

export function App() {
  const view = useApp((s) => s.view)
  const backstage = useShell((s) => s.backstage)
  const startScreen = useShell((s) => s.startScreen)
  const setExportHandler = useApp((s) => s.setExportVisualDataHandler)
  const once = useRef(false)

  useMenuCommands()
  useShortcuts()

  useEffect(() => {
    setExportHandler(exportVisualData)
    return () => setExportHandler(null)
  }, [setExportHandler])

  useEffect(() => {
    if (once.current || launched) return
    once.current = launched = true
    void launch()
  }, [])

  // keep the missing-data notice in sync after refresh / sample data
  const revision = useApp((s) => s.revision)
  useEffect(() => {
    const { project } = useApp.getState()
    const notice = useShell.getState().dataNotice
    if (notice?.kind === 'noData' && project && !tablesWithoutData(project).length) useShell.getState().setDataNotice(null)
  }, [revision])

  // screens without a report canvas are "ready" for headless capture as soon as they render
  useEffect(() => {
    if (launched && (backstage || startScreen || view !== 'report')) markReadyUnlessReport()
  }, [backstage, startScreen, view])

  return (
    <div className="wbi-app">
      <TitleBar />
      {view === 'powerquery' ? (
        <div className="wbi-pqhost">
          <PowerQueryEditor />
        </div>
      ) : (
        <>
          <Ribbon />
          <NoticeArea />
          {/* Model view floats the formula bar over its diagram (views/model/ModelView.tsx) instead of pushing it down */}
          {(view === 'report' || view === 'data') && <FormulaBar className="wbi-formula-bar--shell" />}
          <div className="wbi-body">
            <NavRail />
            <main className="wbi-main">
              <MainView />
            </main>
            <PaneHost />
          </div>
          <StatusBar />
        </>
      )}
      {backstage && <Backstage />}
      {startScreen && <StartScreen />}
      <BusyOverlay />
      <DialogsHost />
      <ModelingDialogHost />
      {/* device-code / sign-in prompts from connectors, whichever view started the refresh */}
      <AuthPromptHost />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  )
}
