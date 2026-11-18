/**
 * A ProjectDocument is everything open in one window: semantic model + its data + report.
 * Loaders (src/core/io/*) produce it; savers write it back; the renderer store holds it.
 */
import type { SemanticModel } from './model/types'
import type { DataStore } from './model/data'
import type { ReportDocument } from './report/types'

export type ProjectSourceKind =
  | 'pbip' // folder with *.pbip + X.Report + X.SemanticModel
  | 'pbir-folder' // a *.Report folder (definition.pbir) — model resolved via datasetReference.byPath
  | 'semantic-model-folder' // a *.SemanticModel folder (TMDL or model.bim) without report
  | 'pbix' // Power BI Desktop file (zip)
  | 'pbit' // template (zip, no data)
  | 'wbi' // Lumen project bundle (zip of PBIP + cached data)
  | 'new'

export interface ProjectSource {
  kind: ProjectSourceKind
  /** path of the file/folder the user opened */
  path?: string
  /** resolved paths of the parts */
  reportPath?: string
  modelPath?: string
}

export interface ProjectDocument {
  id: string
  name: string
  source: ProjectSource
  model: SemanticModel
  data: DataStore
  /** absent when only a semantic model was opened */
  report?: ReportDocument
  /** loader diagnostics shown in a notification area */
  diagnostics: Array<{ level: 'info' | 'warning' | 'error'; message: string }>
  /** true when edited since last save */
  dirty: boolean
}
