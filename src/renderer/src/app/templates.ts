/**
 * Built-in report templates (Start screen and File ▸ New "Templates" gallery). The template files
 * live in src/core/templates/<id>/ as a PBIP project and are bundled here as raw text; each
 * template is loaded only when it is opened.
 */
import { REPORT_TEMPLATES, projectFromTemplate, type ReportTemplate } from '@core/templates'
import { refreshProject } from '@core/data/refresh'
import { useApp } from '../state/store'
import { useShell } from './shellState'
import { holdBusy, releaseAfterPaint, setReady } from './readiness'
import { confirmDiscard } from './commands'
import { alertDialog } from './ui/Modal'
import { refreshHost } from '../views/powerquery/credentials'

export { REPORT_TEMPLATES, type ReportTemplate }

const templateFiles = import.meta.glob<string>('../../../core/templates/*/**/*', { query: '?raw', import: 'default' })

async function loadFiles(id: string): Promise<Record<string, string>> {
  const prefix = `../../../core/templates/${id}/`
  const out: Record<string, string> = {}
  await Promise.all(
    Object.entries(templateFiles)
      .filter(([p]) => p.startsWith(prefix))
      .map(async ([p, load]) => {
        out[p.slice(prefix.length)] = await load()
      })
  )
  return out
}

/** Open a template as a new, unsaved report and run its Power Query tables (calendar, last refreshed). */
export async function newFromTemplate(id: string): Promise<boolean> {
  const template = REPORT_TEMPLATES.find((t) => t.id === id)
  if (!template) return false
  if (!(await confirmDiscard())) return false
  const release = holdBusy('open')
  const app = useApp.getState()
  const shell = useShell.getState()
  shell.openBackstage(null)
  shell.setStartScreen(false)
  app.setBusy({ message: `Creating ${template.name}…`, progress: 0 })
  try {
    const project = projectFromTemplate(template, await loadFiles(id))
    // the template's tables are all Power Query computed (no source to reach), so refresh before showing it
    const r = await refreshProject(project, refreshHost())
    if (project.report) setReady(false)
    useApp.getState().setProject(project)
    useApp.getState().setView('report')
    useApp.getState().setBusy(null)
    shell.setDataNotice(null)
    const failed = r.tables.filter((t) => !t.ok)
    if (failed.length) shell.setDataNotice({ kind: 'refreshErrors', tables: failed.map((t) => t.table) })
    return true
  } catch (e) {
    useApp.getState().setBusy(null)
    await alertDialog("Couldn't create the report", `${template.name}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  } finally {
    releaseAfterPaint(release)
  }
}
