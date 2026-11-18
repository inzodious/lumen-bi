/**
 * Modeling commands — called by the shell ribbon (Home / Modeling / Table tools / Column tools /
 * Measure tools), context menus, the Data/Model views and `openModelingDialog`.
 */
import { createElement } from 'react'
import { useApp } from '../../state/store'
import { showModelingDialog } from './host'
import { app, currentModel, targetTable } from './context'
import { newCalculationGroupTable, takenFieldNames, uniqueName, deleteTable, deleteColumn, ensureDiscourageImplicitMeasures } from './logic/modelOps'
import { requestFormulaBarFocus } from '../../editors/formulaBarState'
import { QuickMeasureDialog } from './QuickMeasureDialog'
import { NumericRangeParameterDialog, FieldParameterDialog } from './ParameterDialogs'
import { ManageRelationshipsDialog, RelationshipEditorDialog } from './RelationshipDialogs'
import { MarkAsDateTableDialog } from './MarkAsDateTableDialog'
import { ManageRolesDialog, ViewAsDialog } from './RolesDialogs'
import { EnterDataDialog } from './EnterDataDialog'
import { CalculationGroupDialog } from './CalculationGroupDialog'
import { confirmDialog } from '../../app/ui/Modal'

/** Home/Modeling ▸ New measure: "Measure = " in the selected (or first) table, formula bar focused. */
export function newMeasure(table?: string): void {
  const model = currentModel()
  const home = table ?? targetTable()
  if (!model || !home) return
  const name = uniqueName('Measure', takenFieldNames(model, home))
  app().mutateModel('New measure', (m) => m.tables.find((t) => t.name === home)?.measures.push({ name, expression: '', lineageTag: crypto.randomUUID() }))
  app().selectField({ kind: 'measure', table: home, name })
  requestFormulaBarFocus()
}

/** Modeling ▸ New column (calculated column) in the selected table. */
export function newColumn(table?: string): void {
  const model = currentModel()
  const home = table ?? targetTable(undefined, 'column')
  if (!model || !home) return
  const name = uniqueName('Column', takenFieldNames(model, home))
  app().mutateModel('New column', (m) =>
    m.tables.find((t) => t.name === home)?.columns.push({ name, dataType: 'string', kind: 'calculated', expression: '', lineageTag: crypto.randomUUID(), summarizeBy: 'none', annotations: { SummarizationSetBy: 'Automatic' } })
  )
  app().selectField({ kind: 'column', table: home, name })
  requestFormulaBarFocus()
}

/** Modeling ▸ New table (calculated table). */
export function newTable(): void {
  const model = currentModel()
  if (!model) return
  const name = uniqueName('Table', model.tables.map((t) => t.name))
  app().mutateModel('New table', (m) => m.tables.push({ name, lineageTag: crypto.randomUUID(), columns: [], measures: [], hierarchies: [], partitions: [{ name, mode: 'import', sourceType: 'calculated', expression: '' }] }))
  app().selectField({ kind: 'table', table: name })
  requestFormulaBarFocus()
}

export function openQuickMeasure(): void {
  showModelingDialog((close) => createElement(QuickMeasureDialog, { onClose: close }))
}

export function openNumericRangeParameter(): void {
  showModelingDialog((close) => createElement(NumericRangeParameterDialog, { onClose: close }))
}

export function openFieldParameter(editTable?: string): void {
  showModelingDialog((close) => createElement(FieldParameterDialog, { onClose: close, editTable }))
}

/** Modeling ▸ Calculation group: creates the group (PBI turns on "discourage implicit measures") and opens the editor. */
export async function newCalculationGroup(): Promise<void> {
  const model = currentModel()
  if (!model) return
  if (!model.discourageImplicitMeasures) {
    const r = await confirmDialog({
      title: 'Discourage implicit measures',
      message: 'Creating a calculation group sets the model property "Discourage implicit measures" to On. Visuals will no longer aggregate columns automatically; use explicit measures instead.',
      buttons: ['Yes', 'Cancel']
    })
    if (r !== 0) return
  }
  const table = newCalculationGroupTable(model)
  app().mutateModel('New calculation group', (m) => {
    ensureDiscourageImplicitMeasures(m)
    m.tables.push(table)
  })
  app().selectField({ kind: 'table', table: table.name })
  openCalculationGroup(table.name)
}

export function openCalculationGroup(table: string): void {
  showModelingDialog((close) => createElement(CalculationGroupDialog, { onClose: close, table }))
}

export function openManageRelationships(): void {
  showModelingDialog((close) => createElement(ManageRelationshipsDialog, { onClose: close }))
}

/** New relationship dialog, optionally prefilled (Model view drag column → column). */
export function openNewRelationship(prefill?: { table1?: string; column1?: string; table2?: string; column2?: string }): void {
  showModelingDialog((close) => createElement(RelationshipEditorDialog, { onClose: close, prefill }))
}

export function openEditRelationship(name: string): void {
  showModelingDialog((close) => createElement(RelationshipEditorDialog, { onClose: close, editName: name }))
}

export function openMarkAsDateTable(table?: string): void {
  const t = table ?? targetTable()
  if (!t) return
  showModelingDialog((close) => createElement(MarkAsDateTableDialog, { onClose: close, table: t }))
}

export function openManageRoles(): void {
  showModelingDialog((close) => createElement(ManageRolesDialog, { onClose: close }))
}

export function openViewAs(): void {
  showModelingDialog((close) => createElement(ViewAsDialog, { onClose: close }))
}

export function stopViewingAs(): void {
  useApp.getState().setViewAsRoles(null)
}

/** Home ▸ Enter data (also "Edit" of an existing Enter-data table). */
export function openEnterData(editTable?: string): void {
  showModelingDialog((close) => createElement(EnterDataDialog, { onClose: close, editTable }))
}

export async function deleteField(sel: { kind: 'table' | 'column' | 'measure' | 'hierarchy'; table: string; name?: string }): Promise<void> {
  const what = sel.kind === 'table' ? `table '${sel.table}'` : `${sel.kind} '${sel.name}'`
  const r = await confirmDialog({ title: `Delete ${sel.kind}`, message: `Are you sure you want to permanently delete ${what}? This can be undone with Undo.`, buttons: ['Delete', 'Cancel'] })
  if (r !== 0) return
  app().mutateModel(`Delete ${sel.kind}`, (m) => {
    if (sel.kind === 'table') deleteTable(m, sel.table)
    else if (sel.kind === 'column') deleteColumn(m, sel.table, sel.name!)
    else {
      const t = m.tables.find((x) => x.name === sel.table)
      if (!t) return
      if (sel.kind === 'measure') t.measures = t.measures.filter((x) => x.name !== sel.name)
      else t.hierarchies = t.hierarchies.filter((x) => x.name !== sel.name)
    }
  })
  app().selectField(null)
}

export function setHidden(sel: { kind: 'table' | 'column' | 'measure' | 'hierarchy'; table: string; name?: string }, hidden: boolean): void {
  app().mutateModel(hidden ? 'Hide' : 'Unhide', (m) => {
    const t = m.tables.find((x) => x.name === sel.table)
    if (!t) return
    const obj = sel.kind === 'table' ? t : sel.kind === 'column' ? t.columns.find((c) => c.name === sel.name) : sel.kind === 'measure' ? t.measures.find((c) => c.name === sel.name) : t.hierarchies.find((c) => c.name === sel.name)
    if (!obj) return
    if (hidden) obj.isHidden = true
    else delete obj.isHidden
  })
}
