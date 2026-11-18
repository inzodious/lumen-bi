/**
 * Store mutations: an edit that throws leaves the document untouched (no undo step, no dirty flag) and is surfaced
 * once, as the app's error toast naming the action; the caller carries on (so menus still close).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toasts: Array<{ kind?: string; title?: string; message: unknown }> = []
vi.mock('../app/ui/Notify', () => ({ toast: (t: { kind?: string; title?: string; message: unknown }) => (toasts.push(t), toasts.length) }))

const { useApp } = await import('./store')
const { fixtureProject } = await import('../report/dev/fixture')
const { duplicatePage } = await import('../report/editOps')
const { FIXTURE } = await import('../report/dev/fixture')

function load() {
  const p = fixtureProject()
  p.dirty = false
  useApp.getState().setProject(p)
  toasts.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

const snapshot = () => {
  const s = useApp.getState()
  return { project: s.project, report: s.project!.report, model: s.project!.model, undo: s.undoStack.length, revision: s.revision }
}

describe('store mutations that throw', () => {
  beforeEach(load)

  it('mutateReport: state unchanged, error toast with the action name, the caller continues', () => {
    const before = snapshot()
    let after = false
    useApp.getState().mutateReport('Duplicate page', (r) => {
      r.pages[0].json.displayName = 'half-done'
      throw new Error('boom')
    })
    after = true
    expect(after).toBe(true)
    expect(snapshot()).toEqual(before)
    expect(useApp.getState().project).toBe(before.project)
    expect(useApp.getState().project!.report!.pages[0].json.displayName).not.toBe('half-done')
    expect(useApp.getState().project!.dirty).toBe(false)
    expect(toasts).toEqual([{ kind: 'error', title: 'Couldn\'t complete "Duplicate page"', message: 'Nothing was changed. boom' }])
  })

  it('mutateModel, patchReport and mutateModelSidecars report the same way', () => {
    const before = snapshot()
    useApp.getState().mutateModel('Rename table', (m) => {
      m.tables[0].name = 'X'
      throw new Error('model boom')
    })
    useApp.getState().patchReport(() => {
      throw new Error('patch boom')
    }, 'Apply bookmark')
    useApp.getState().mutateModelSidecars('Move cards', (files) => {
      files['diagramLayout.json'] = '{}'
      throw new Error('sidecar boom')
    })
    expect(snapshot()).toEqual(before)
    expect(useApp.getState().project).toBe(before.project)
    expect(toasts.map((t) => t.title)).toEqual(['Couldn\'t complete "Rename table"', 'Couldn\'t complete "Apply bookmark"', 'Couldn\'t complete "Move cards"'])
  })

  it('a working edit still applies (Duplicate page, one undo step)', () => {
    const before = snapshot()
    let dup: string | undefined
    useApp.getState().mutateReport('Duplicate page', (r) => {
      dup = duplicatePage(r, FIXTURE.overview)
    })
    const s = useApp.getState()
    expect(s.project!.report!.pages.some((p) => p.name === dup)).toBe(true)
    expect(s.undoStack.length).toBe(before.undo + 1)
    expect(toasts).toEqual([])
    s.undo()
    expect(useApp.getState().project!.report).toBe(before.report)
  })
})

describe('undo / redo and the active page', () => {
  beforeEach(load)

  it('undoing a new page that is open goes back to an existing page; redo keeps a valid page', () => {
    let dup: string | undefined
    useApp.getState().mutateReport('Duplicate page', (r) => {
      dup = duplicatePage(r, FIXTURE.overview)
    })
    useApp.getState().setActivePage(dup!)
    useApp.getState().undo()
    const s = useApp.getState()
    expect(s.project!.report!.pages.some((p) => p.name === s.activePage)).toBe(true)
    expect(s.activePage).toBe(FIXTURE.overview)
    useApp.getState().redo()
    expect(useApp.getState().activePage).toBe(FIXTURE.overview)
  })
})
