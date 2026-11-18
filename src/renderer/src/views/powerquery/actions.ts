/**
 * Power Query Editor commands shared by the ribbon, context menus, panes and dialogs: selection,
 * step insertion (ribbon actions), applied-step editing, query management and Apply / Close.
 * All edits go to the draft (`usePq.draft`); Apply writes it to the model.
 */
import { useApp } from '../../state/store'
import { useShell } from '../../app/shellState'
import { confirmDialog, promptDialog, toast } from '../../app/ui'
import { renameReportReferences } from '../../dialogs/modeling/fieldEdits'
import {
  addQuery,
  applyDraft,
  deleteQuery,
  dependents,
  draftFromModel,
  duplicateQuery,
  groupsOf,
  isDirty,
  newQueryName,
  queryNameError,
  rebaseDraft,
  referenceQuery,
  renameQuery,
  syncDraft,
  updateQuery,
  type ApplyResult,
  type DraftQuery
} from './logic/draft'
import { addStep, deleteUntilEnd, firstArgStep, insertEmptyStepAfter, moveStep, outlineQuery, removeStep, renameStep, setStepFormula, stepRef, stepsAfter } from './logic/steps'
import { changeType, changeTypeColumns, mergeChangeType, type StepSpec } from './logic/transforms'
import type { PqType } from './logic/mtext'
import { previewColumns, selectedQuery, usePq } from './pqStore'
import { effectiveStep, pqSession, resetSession } from './session'

// ---------------------------------------------------------------------------------------------
// Selection

export function selectQuery(id: string | null): void {
  const s = usePq.getState()
  if (s.selectedId === id) return
  usePq.setState({ selectedId: id, selectedCols: [], colAnchor: null, detail: null, renamingStep: null })
}

/** Select an applied step (null = the last step). */
export function selectStep(name: string | null): void {
  const s = usePq.getState()
  const q = selectedQuery(s)
  if (!q) return
  usePq.setState({ steps: { ...s.steps, [q.id]: effectiveStep(q.source, name) }, detail: null })
}

/** The selected step's name (the last step when none is selected); null for non-`let` queries. */
export function currentStep(): string | null {
  const s = usePq.getState()
  const q = selectedQuery(s)
  if (!q) return null
  const o = outlineQuery(q.source)
  if (!o?.steps.length) return null
  const sel = s.steps[q.id]
  return sel && o.steps.some((x) => x.name === sel) ? sel : o.steps[o.steps.length - 1]!.name
}

export function selectColumn(name: string, mode: 'single' | 'toggle' | 'range' = 'single'): void {
  const s = usePq.getState()
  const all = previewColumns(s).map((c) => c.name)
  if (mode === 'toggle') {
    const has = s.selectedCols.includes(name)
    usePq.setState({ selectedCols: has ? s.selectedCols.filter((c) => c !== name) : [...s.selectedCols, name], colAnchor: name })
    return
  }
  if (mode === 'range' && s.colAnchor && all.includes(s.colAnchor)) {
    const a = all.indexOf(s.colAnchor)
    const b = all.indexOf(name)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    usePq.setState({ selectedCols: all.slice(lo, hi + 1) })
    return
  }
  usePq.setState({ selectedCols: [name], colAnchor: name })
}

export function selectAllColumns(): void {
  usePq.setState({ selectedCols: previewColumns().map((c) => c.name) })
}

/** Selected columns with their types, in table order. */
export function selectedColumnInfo(): Array<{ name: string; type: string }> {
  const s = usePq.getState()
  const sel = new Set(s.selectedCols)
  return previewColumns(s).filter((c) => sel.has(c.name))
}

// ---------------------------------------------------------------------------------------------
// Draft edits

function setDraft(next: ReturnType<typeof usePq.getState>['draft']): void {
  usePq.setState({ draft: next })
}

export function updateSelectedSource(source: string, step?: string | null): void {
  const s = usePq.getState()
  const q = selectedQuery(s)
  if (!q) return
  const draft = updateQuery(s.draft, q.id, { source })
  const steps = { ...s.steps }
  if (step !== undefined) steps[q.id] = effectiveStep(source, step)
  else steps[q.id] = effectiveStep(source, steps[q.id])
  usePq.setState({ draft, steps, detail: null })
}

/**
 * Adds a step from a ribbon / menu action after the selected step. When the selected step is not the
 * last one, asks first like Power Query ("Insert Step"). The new step becomes the selected one.
 */
export async function addSpec(spec: StepSpec): Promise<boolean> {
  const s = usePq.getState()
  const q = selectedQuery(s)
  if (!q) return false
  const after = currentStep()
  const o = outlineQuery(q.source)
  if (o && after && o.steps[o.steps.length - 1]?.name !== after) {
    const ok = await confirmDialog({
      title: 'Insert Step',
      message: 'Are you sure you want to insert a step? Inserting an intermediate step may affect subsequent steps, which could cause your query to break.',
      buttons: ['Insert', 'Cancel']
    })
    if (ok !== 0) return false
  }
  const r = addStep(q.source, after, spec.name, spec.formula)
  if (!r) {
    toast({ kind: 'error', message: "This query can't be edited step by step. Open the Advanced Editor to change it." })
    return false
  }
  updateSelectedSource(r.source, r.name)
  return true
}

/**
 * Step settings dialogs (gear / Edit Settings): replace an existing step's formula with a regenerated
 * one, reading the same input step as before (its first argument, else the previous step).
 */
export function replaceStepWith(step: string, spec: StepSpec): boolean {
  const q = selectedQuery()
  if (!q) return false
  const o = outlineQuery(q.source)
  const i = o?.steps.findIndex((x) => x.name === step) ?? -1
  if (!o || i < 0) return false
  const input = firstArgStep(o.steps[i]!.formula) ?? (i > 0 ? o.steps[i - 1]!.name : null)
  if (input === null) return false
  const next = setStepFormula(q.source, step, spec.formula(stepRef(input)))
  if (!next) return false
  updateSelectedSource(next, usePq.getState().steps[q.id] ?? null)
  return true
}

/** Add a step, or replace `step` when a settings dialog edits an existing one. */
export async function addOrReplace(spec: StepSpec, step?: string): Promise<boolean> {
  return step ? replaceStepWith(step, spec) : addSpec(spec)
}

/**
 * Data Type menu: when the selected step is a Changed Type step that already converts one of these
 * columns, Power Query asks "Replace current" (edit that step) or "Add new step".
 */
export async function changeTypeAction(cols: Array<{ name: string; type: PqType }>): Promise<void> {
  if (!cols.length) return
  const q = selectedQuery()
  const step = currentStep()
  const o = q ? outlineQuery(q.source) : null
  const formula = o?.steps.find((x) => x.name === step)?.formula
  const inStep = formula ? changeTypeColumns(formula) : []
  if (q && step && formula && cols.some((c) => inStep.includes(c.name))) {
    const choice = await confirmDialog({
      title: 'Change Column Type',
      message: 'The selected column already has a type conversion in the current step. Do you want to replace the current conversion, or add a new step to apply the type conversion?',
      buttons: ['Replace current', 'Add new step', 'Cancel']
    })
    if (choice === 2) return
    if (choice === 0) {
      const merged = mergeChangeType(formula, cols)
      const next = merged ? setStepFormula(q.source, step, merged) : null
      if (next) return updateSelectedSource(next, usePq.getState().steps[q.id] ?? null)
    }
  }
  await addSpec(changeType(cols))
}

/** Commit the formula bar text for the selected step (`= …` prefix optional). */
export function commitStepFormula(text: string): boolean {
  const s = usePq.getState()
  const q = selectedQuery(s)
  if (!q) return false
  const formula = text.replace(/^\s*=\s*/, '')
  const step = currentStep()
  if (!step) {
    // not a let query: the formula is the whole query
    updateSelectedSource(formula)
    return true
  }
  const next = setStepFormula(q.source, step, formula)
  if (!next) return false
  updateSelectedSource(next, s.steps[q.id] ?? null)
  return true
}

export async function deleteStepAction(name: string): Promise<void> {
  const q = selectedQuery()
  if (!q) return
  if (stepsAfter(q.source, name).length) {
    const ok = await confirmDialog({
      title: 'Delete Step',
      message: 'Are you sure you want to delete this step? Deleting an intermediate step may affect subsequent steps, which could cause your query to break.',
      buttons: ['Delete', 'Cancel']
    })
    if (ok !== 0) return
  }
  const next = removeStep(q.source, name)
  if (!next) return void toast({ kind: 'warning', message: "The query's only step can't be deleted." })
  const o = outlineQuery(q.source)
  const i = o?.steps.findIndex((x) => x.name === name) ?? -1
  const prev = i > 0 ? o!.steps[i - 1]!.name : null
  const sel = usePq.getState().steps[q.id]
  updateSelectedSource(next, sel === name ? prev : (sel ?? null))
}

export async function deleteUntilEndAction(name: string): Promise<void> {
  const q = selectedQuery()
  if (!q) return
  const ok = await confirmDialog({
    title: 'Delete Steps',
    message: 'Are you sure you want to delete this step and all subsequent steps?',
    buttons: ['Delete', 'Cancel']
  })
  if (ok !== 0) return
  const next = deleteUntilEnd(q.source, name)
  if (next) updateSelectedSource(next, null)
}

export function renameStepAction(from: string, to: string): boolean {
  const q = selectedQuery()
  const name = to.trim()
  if (!q || !name || name === from) return false
  const next = renameStep(q.source, from, name)
  if (!next) {
    toast({ kind: 'warning', message: `A step named '${name}' already exists.` })
    return false
  }
  const sel = usePq.getState().steps[q.id]
  updateSelectedSource(next, sel === from ? name : (sel ?? null))
  return true
}

export function moveStepAction(name: string, dir: 'up' | 'down'): void {
  const q = selectedQuery()
  if (!q) return
  const next = moveStep(q.source, name, dir)
  if (!next) return void toast({ kind: 'info', message: "This step can't be moved there." })
  updateSelectedSource(next, usePq.getState().steps[q.id] ?? null)
}

export function insertStepAfterAction(name: string): void {
  const q = selectedQuery()
  if (!q) return
  const r = insertEmptyStepAfter(q.source, name)
  if (!r) return
  updateSelectedSource(r.source, r.name)
  usePq.setState({ view: { ...usePq.getState().view, formulaBar: true } })
}

// ---------------------------------------------------------------------------------------------
// Queries

export function newQuery(q: Omit<DraftQuery, 'id'>): string {
  const s = usePq.getState()
  const r = addQuery(s.draft, q)
  usePq.setState({ draft: r.draft, selectedId: r.id, selectedCols: [], colAnchor: null })
  return r.id
}

export function newBlankQuery(): void {
  const s = usePq.getState()
  newQuery({ name: newQueryName(s.draft), kind: 'query', source: 'let\n    Source = ""\nin\n    Source', loadEnabled: true })
}

export function renameQueryAction(id: string, name: string): boolean {
  const s = usePq.getState()
  const q = s.draft.queries.find((x) => x.id === id)
  if (!q) return false
  const n = name.trim()
  if (n === q.name) return true
  const err = queryNameError(s.draft, n, id)
  if (err) {
    toast({ kind: 'warning', message: err })
    return false
  }
  setDraft(renameQuery(s.draft, id, n))
  return true
}

export async function deleteQueryAction(id: string): Promise<void> {
  const s = usePq.getState()
  const q = s.draft.queries.find((x) => x.id === id)
  if (!q) return
  const deps = dependents(s.draft, q.name)
  const ok = await confirmDialog({
    title: 'Delete Query',
    message: deps.length
      ? `Are you sure you want to delete the query '${q.name}'? The following queries depend on it and will fail: ${deps.join(', ')}.`
      : `Are you sure you want to delete the query '${q.name}'?`,
    buttons: ['Delete', 'Cancel']
  })
  if (ok !== 0) return
  const cur = usePq.getState()
  const draft = deleteQuery(cur.draft, id)
  const idx = cur.draft.queries.findIndex((x) => x.id === id)
  const next = draft.queries[Math.min(idx, draft.queries.length - 1)]?.id ?? null
  usePq.setState({ draft, selectedId: cur.selectedId === id ? next : cur.selectedId, selectedCols: [] })
}

export function duplicateQueryAction(id: string): void {
  const r = duplicateQuery(usePq.getState().draft, id)
  if (r) usePq.setState({ draft: r.draft, selectedId: r.id, selectedCols: [] })
}

export function referenceQueryAction(id: string): void {
  const r = referenceQuery(usePq.getState().draft, id)
  if (r) usePq.setState({ draft: r.draft, selectedId: r.id, selectedCols: [] })
}

export function setQueryGroup(id: string, group: string | undefined): void {
  setDraft(updateQuery(usePq.getState().draft, id, { group: group || undefined }))
}

export async function newGroupAction(forQuery?: string): Promise<void> {
  const s = usePq.getState()
  const taken = groupsOf(s.draft).map((g) => g.toLowerCase())
  const name = await promptDialog({
    title: 'New Group',
    label: 'Name',
    value: 'New Group',
    validate: (v) => (!v.trim() ? 'The group name cannot be empty.' : taken.includes(v.trim().toLowerCase()) ? 'A group with this name already exists.' : undefined)
  })
  if (!name) return
  const cur = usePq.getState().draft
  let draft = { ...cur, groups: [...cur.groups, name.trim()] }
  if (forQuery) draft = updateQuery(draft, forQuery, { group: name.trim() })
  setDraft(draft)
}

export function toggleLoad(id: string): void {
  const s = usePq.getState()
  const q = s.draft.queries.find((x) => x.id === id)
  if (!q || q.kind === 'parameter' || q.kind === 'function') return
  setDraft(updateQuery(s.draft, id, { loadEnabled: !q.loadEnabled }))
}

export function patchQuery(id: string, patch: Partial<Omit<DraftQuery, 'id' | 'origin'>>): void {
  setDraft(updateQuery(usePq.getState().draft, id, patch))
}

// ---------------------------------------------------------------------------------------------
// Apply / Close

export function draftIsDirty(): boolean {
  const project = useApp.getState().project
  return !!project && isDirty(usePq.getState().draft, project.model)
}

/** Writes the draft to the model and refreshes the changed tables. Returns false when nothing was applied. */
export function applyChanges(): ApplyResult | null {
  const app = useApp.getState()
  const project = app.project
  if (!project) return null
  const s = usePq.getState()
  if (!isDirty(s.draft, project.model)) return { refresh: [], renamedTables: [], origins: {} }
  let result: ApplyResult | null = null
  app.mutateModel('Apply query changes', (m) => {
    result = applyDraft(m, s.draft, { columns: s.outputs })
  })
  const r = result as ApplyResult | null
  if (!r) return null
  for (const [from, to] of r.renamedTables) renameReportReferences({ kind: 'table', table: from }, to)
  usePq.setState({ draft: rebaseDraft(usePq.getState().draft, r.origins) })
  pqSession()
  return r
}

function refreshTables(tables: string[]): void {
  if (!tables.length) return
  useShell.getState().openDialog({ id: 'refresh', tables })
}

/** Home ▸ Close & Apply ▸ Apply */
export function applyAction(): void {
  const r = applyChanges()
  if (r) refreshTables(r.refresh)
}

/** Home ▸ Close & Apply */
export function closeAndApply(): void {
  const r = applyChanges()
  useApp.getState().setView('report')
  if (r) refreshTables(r.refresh)
}

/** Home ▸ Close & Apply ▸ Close (asks to apply pending changes like Power BI). */
export async function closeEditor(): Promise<void> {
  if (draftIsDirty()) {
    const choice = await confirmDialog({
      title: 'Apply query changes?',
      message: 'You have pending changes to your queries that haven’t been applied.',
      buttons: ['Apply', 'Discard', 'Cancel'],
      primary: 0
    })
    if (choice === 2) return
    if (choice === 0) return closeAndApply()
    discardChanges()
  }
  useApp.getState().setView('report')
}

export function discardChanges(): void {
  const project = useApp.getState().project
  if (!project) return
  const s = usePq.getState()
  const draft = draftFromModel(project.model)
  const sel = s.draft.queries.find((q) => q.id === s.selectedId)
  const keep = sel ? draft.queries.find((q) => q.name === sel.name) : undefined
  usePq.setState({ draft, selectedId: keep?.id ?? draft.queries[0]?.id ?? null, steps: {}, selectedCols: [], errors: {}, errorSteps: {}, outputs: {} })
}

/** Called when the editor mounts / the model changes: reset for a new project, else merge new queries. */
export function syncWithProject(): void {
  const project = useApp.getState().project
  const s = usePq.getState()
  if (!project) {
    if (s.projectId !== null) s.reset(null, { queries: [], deleted: [], groups: [] })
    return
  }
  if (s.projectId !== project.id) {
    resetSession()
    s.reset(project.id, draftFromModel(project.model))
    return
  }
  const next = syncDraft(s.draft, project.model)
  if (next !== s.draft) usePq.setState({ draft: next })
}

/** Home ▸ Refresh Preview */
export function refreshPreview(): void {
  pqSession()?.clearCache()
  usePq.setState((s) => ({ nonce: s.nonce + 1, errors: {}, errorSteps: {} }))
}
