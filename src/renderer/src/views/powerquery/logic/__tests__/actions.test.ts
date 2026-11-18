/**
 * Power Query Editor action layer against a real (sample) project: selection, ribbon step insertion,
 * formula bar commits, applied-step edits, query management, Apply → model, and the preview runner's
 * session (evaluation of the draft with the M engine).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleProject } from '@core/data/sample'
import { useApp } from '../../../../state/store'
import { usePq, previewColumns } from '../../pqStore'
import {
  addSpec,
  applyChanges,
  commitStepFormula,
  currentStep,
  draftIsDirty,
  duplicateQueryAction,
  referenceQueryAction,
  renameQueryAction,
  renameStepAction,
  selectColumn,
  selectQuery,
  selectStep,
  syncWithProject,
  toggleLoad
} from '../../actions'
import { previewDraftQuery, resetSession } from '../../session'
import { outlineQuery } from '../steps'
import * as T from '../transforms'

function select(name: string): void {
  const q = usePq.getState().draft.queries.find((x) => x.name === name)!
  selectQuery(q.id)
}

const source = (name: string) => usePq.getState().draft.queries.find((x) => x.name === name)!.source

beforeEach(() => {
  resetSession()
  useApp.getState().setProject(createSampleProject())
  usePq.setState({ projectId: null })
  syncWithProject()
})

describe('Power Query Editor actions', () => {
  it('loads the model queries into the draft and is clean', () => {
    const names = usePq.getState().draft.queries.map((q) => q.name)
    expect(names).toEqual(expect.arrayContaining(['Product', 'Date', 'Sales']))
    expect(draftIsDirty()).toBe(false)
  })

  it('previews a draft query through the session (and a step of it)', async () => {
    select('Date')
    const q = usePq.getState().draft.queries.find((x) => x.name === 'Date')!
    const full = await previewDraftQuery(q)
    expect(full.result.ok).toBe(true)
    if (full.result.ok && full.result.preview.kind === 'table') {
      expect(full.result.preview.columns[0]!.name).toBe('Date')
      expect(full.result.preview.truncated).toBe(true)
    }
    const atYear = await previewDraftQuery(q, { step: 'AddYear' })
    expect(atYear.result.ok && atYear.result.preview.kind === 'table' && atYear.result.preview.columns.map((c) => c.name)).toEqual(['Date', 'Year'])
  })

  it('adds ribbon steps after the selected (last) step and selects them', async () => {
    select('Product')
    expect(await addSpec(T.removeColumns(['Color']))).toBe(true)
    const o = outlineQuery(source('Product'))!
    expect(o.steps.map((s) => s.name)).toEqual(['Source', 'Removed Columns'])
    expect(o.steps[1]!.formula).toBe('Table.RemoveColumns(Source,{"Color"})')
    expect(currentStep()).toBe('Removed Columns')
    // repeated action → numbered step name
    await addSpec(T.removeColumns(['Category']))
    expect(outlineQuery(source('Product'))!.steps.map((s) => s.name)).toEqual(['Source', 'Removed Columns', 'Removed Columns1'])
    expect(draftIsDirty()).toBe(true)
  })

  it('commits formula bar edits and renames steps with their references', async () => {
    select('Product')
    await addSpec(T.removeColumns(['Color']))
    expect(commitStepFormula('= Table.RemoveColumns(Source,{"Category"})')).toBe(true)
    expect(outlineQuery(source('Product'))!.steps[1]!.formula).toBe('Table.RemoveColumns(Source,{"Category"})')
    expect(renameStepAction('Source', 'Base')).toBe(true)
    const o = outlineQuery(source('Product'))!
    expect(o.steps[0]!.name).toBe('Base')
    expect(o.steps[1]!.formula).toBe('Table.RemoveColumns(Base,{"Category"})')
    selectStep('Base')
    expect(currentStep()).toBe('Base')
  })

  it('selects columns with toggle / range like the grid', () => {
    select('Product')
    usePq.setState({
      preview: {
        key: 'k',
        queryId: usePq.getState().selectedId,
        running: false,
        waiting: null,
        at: 0,
        result: { outline: null, step: null, ms: 0, result: { ok: true, kind: 'table', preview: { kind: 'table', columns: ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'text' })), rows: [], rowCount: 0, truncated: false } } }
      }
    })
    expect(previewColumns().length).toBe(4)
    selectColumn('B')
    selectColumn('D', 'range')
    expect(usePq.getState().selectedCols).toEqual(['B', 'C', 'D'])
    selectColumn('C', 'toggle')
    expect(usePq.getState().selectedCols).toEqual(['B', 'D'])
  })

  it('manages queries: rename (with references), duplicate, reference, load toggle', () => {
    select('Product')
    const id = usePq.getState().selectedId!
    referenceQueryAction(id)
    const ref = usePq.getState().draft.queries.find((q) => q.name === 'Product (2)')!
    expect(ref.source).toContain('Source = Product')
    expect(renameQueryAction(id, 'Products')).toBe(true)
    expect(usePq.getState().draft.queries.find((q) => q.id === ref.id)!.source).toContain('Source = Products')
    expect(renameQueryAction(ref.id, 'products')).toBe(false) // names are case-insensitively unique
    duplicateQueryAction(id)
    expect(usePq.getState().draft.queries.some((q) => q.name === 'Products (2)')).toBe(true)
    toggleLoad(ref.id)
    expect(usePq.getState().draft.queries.find((q) => q.id === ref.id)!.loadEnabled).toBe(false)
  })

  it('applies the draft to the model (changed partition, renamed table, new query)', async () => {
    select('Product')
    await addSpec(T.removeColumns(['Color']))
    const id = usePq.getState().selectedId!
    renameQueryAction(id, 'Products')
    referenceQueryAction(id)
    const r = applyChanges()!
    expect(r.renamedTables).toEqual([['Product', 'Products']])
    expect(r.refresh).toEqual(expect.arrayContaining(['Products', 'Products (2)']))
    const model = useApp.getState().project!.model
    const t = model.tables.find((x) => x.name === 'Products')!
    expect(t.partitions[0]!.expression).toContain('Removed Columns')
    expect(model.tables.some((x) => x.name === 'Products (2)')).toBe(true)
    // the draft was rebased: nothing pending anymore
    expect(draftIsDirty()).toBe(false)
  })
})
