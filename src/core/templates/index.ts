/**
 * Report templates: PBIP projects (`<Name>.Report` + `<Name>.SemanticModel`) shipped with the app as
 * plain files under `src/core/templates/<id>/`. A template opens as a new, unsaved report (source
 * kind 'new', so Save asks where to put it); its Power Query tables are refreshed by the caller.
 *
 * The renderer bundles the files (`app/templates.ts`, Vite `import.meta.glob`); tests read them
 * from disk. This module only turns a file map into a project, so it stays pure TS.
 */
import type { ProjectDocument } from '../project'
import { readPbirFiles, type FileMap } from '../pbir/pbir'
import { readSemanticModelFiles } from '../io/pbip'
import type { Diagnostic } from '../io/pbix/container'
import { emptyDataStore } from '../model/data'
import { GALLERY_TEMPLATES } from './catalog'

export interface ReportTemplate {
  /** folder name under src/core/templates */
  id: string
  /** shown in the gallery; also the `<Name>.Report` / `<Name>.SemanticModel` folder name */
  name: string
  /** one line for the gallery card */
  summary: string
  description: string
  /** gallery grouping, e.g. 'Professional', 'Retro', 'Futuristic' */
  style?: string
  /**
   * 'powerbi': uses only what Power BI Desktop can open and render the same way (saved as PBIP or .pbit it opens there as is).
   * 'lumen': uses Lumen-only features (listed in `lumenFeatures`); Power BI Desktop opens it but draws those parts plainly.
   */
  compatibility?: 'powerbi' | 'lumen'
  lumenFeatures?: string[]
  /** a few colors for the gallery card when there is no preview picture */
  swatch?: string[]
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  ...GALLERY_TEMPLATES,
  {
    id: 'first-edition',
    name: '1st Edition',
    summary: 'Four pages with navigation and filter panel',
    description: 'Overview, Detail, Export and Info pages with navigation, filter panel, calendar and last refreshed date',
    style: 'Starter',
    compatibility: 'powerbi',
    swatch: ['#EEF2F6', '#171C73', '#0583F2', '#F2BB13']
  }
]

/** Build a new project from a template's files (paths relative to the template folder, e.g. `1st Edition.Report/definition/report.json`). */
export function projectFromTemplate(template: ReportTemplate, files: Record<string, string | Uint8Array>): ProjectDocument {
  const enc = new TextEncoder()
  const sub = (prefix: string): FileMap => {
    const out: FileMap = {}
    for (const [p, v] of Object.entries(files)) if (p.startsWith(prefix)) out[p.slice(prefix.length)] = typeof v === 'string' ? enc.encode(v) : v
    return out
  }
  const modelFiles = sub(`${template.name}.SemanticModel/`)
  const reportFiles = sub(`${template.name}.Report/`)
  if (!Object.keys(modelFiles).length || !Object.keys(reportFiles).length) throw new Error(`The template "${template.name}" is incomplete`)
  const diagnostics: Diagnostic[] = []
  const m = readSemanticModelFiles(modelFiles)
  diagnostics.push(...m.diagnostics)
  const report = readPbirFiles(reportFiles, 'pbir')
  for (const d of report.diagnostics) diagnostics.push({ level: 'warning', message: d })
  m.model.name = template.name
  return {
    id: globalThis.crypto.randomUUID(),
    name: template.name,
    source: { kind: 'new' },
    model: m.model,
    data: emptyDataStore(),
    report,
    diagnostics,
    dirty: false
  }
}
