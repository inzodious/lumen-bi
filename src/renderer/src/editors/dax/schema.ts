/**
 * Model metadata used by the DAX editor (completion, local lint). Kept small and structured-clonable.
 */
import type { DataType, SemanticModel } from '@core/model/types'

export interface DaxSchemaColumn {
  name: string
  dataType?: DataType
  hidden?: boolean
  calculated?: boolean
  expression?: string
  description?: string
  formatString?: string
}

export interface DaxSchemaTable {
  name: string
  hidden?: boolean
  columns: DaxSchemaColumn[]
  measures: Array<{ name: string; hidden?: boolean; formatString?: string; description?: string; expression?: string; displayFolder?: string }>
}

export interface DaxSchema {
  tables: DaxSchemaTable[]
  /** Table whose columns may be referenced unqualified (`[Col]`) — calculated column context. */
  homeTable?: string
}

export function schemaFromModel(model: SemanticModel | null | undefined, homeTable?: string): DaxSchema {
  if (!model) return { tables: [], homeTable }
  return {
    homeTable,
    tables: model.tables
      .filter((t) => !t.isPrivate && !t.showAsVariationsOnly)
      .map((t) => ({
        name: t.name,
        hidden: t.isHidden,
        columns: t.columns.filter((c) => c.kind !== 'rowNumber').map((c) => ({ name: c.name, dataType: c.dataType, hidden: c.isHidden, calculated: c.kind === 'calculated', expression: c.expression, description: c.description, formatString: c.formatString })),
        measures: t.measures.map((m) => ({ name: m.name, hidden: m.isHidden, formatString: m.formatString, description: m.description, expression: m.expression, displayFolder: m.displayFolder }))
      }))
  }
}
