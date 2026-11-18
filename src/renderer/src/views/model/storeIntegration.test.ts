/**
 * Model view edits through the document store: sidecar edits are undoable without rebuilding the engine,
 * and Lumen's diagram sidecar follows table renames / deletions made anywhere in the app.
 */
import { describe, expect, it } from 'vitest'
import { LUMEN_LAYOUT_FILE, lumenDiagram, parseLumenLayout, serializeLumenLayout, updateLumenDiagram } from '@core/io/diagramSidecar'
import { useApp } from '../../state/store'
import { createDevProject } from '../dev/devProject'
import { deleteTable, renameTable } from '../../dialogs/modeling/logic/modelOps'
import { createGroup, setRoute } from './diagramOps'

function load() {
  const p = createDevProject()
  p.dirty = false
  useApp.getState().setProject(p)
  const m = useApp.getState().project!.model
  const rel = m.relationships[0]
  return { rel, tables: [rel.fromTable, rel.toTable] }
}

const diagram = () => lumenDiagram(parseLumenLayout(useApp.getState().project!.model.sidecarFiles?.[LUMEN_LAYOUT_FILE]), 'All tables')

function customise(rel: string, tables: string[]): void {
  useApp.getState().mutateModelSidecars('Customise diagram', (files) => {
    const next = updateLumenDiagram(parseLumenLayout(files[LUMEN_LAYOUT_FILE]), 'All tables', (d) => {
      setRoute(d, rel, { waypoints: [{ x: 10, y: 20 }] })
      createGroup(d, tables, new Map())
    })
    files[LUMEN_LAYOUT_FILE] = serializeLumenLayout(next)!
  })
}

describe('model view edits in the document store', () => {
  it('sidecar edits are undoable, mark the document dirty and keep the engine', () => {
    const { rel, tables } = load()
    const before = useApp.getState()
    const engine = before.engine
    expect(before.project!.dirty).toBe(false)
    customise(rel.name, tables)
    let s = useApp.getState()
    expect(s.project!.dirty).toBe(true)
    expect(s.undoStack).toHaveLength(1)
    expect(s.undoStack[0].label).toBe('Customise diagram')
    expect(s.engine).toBe(engine)
    expect(diagram().routes![rel.name].waypoints).toEqual([{ x: 10, y: 20 }])
    // the semantic model is shared: only the sidecar map is new
    expect(s.project!.model.tables).toBe(before.project!.model.tables)
    s.undo()
    s = useApp.getState()
    expect(s.project!.model.sidecarFiles?.[LUMEN_LAYOUT_FILE]).toBeUndefined()
    expect(s.engine).toBe(engine)
    s.redo()
    s = useApp.getState()
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(tables)
    expect(s.engine).toBe(engine)
  })

  it('an edit that changes nothing adds no undo step', () => {
    load()
    useApp.getState().mutateModelSidecars('Nothing', () => undefined)
    expect(useApp.getState().undoStack).toHaveLength(0)
    expect(useApp.getState().project!.dirty).toBe(false)
  })

  it('a table rename is followed by its group; undo restores the old names', () => {
    const { rel, tables } = load()
    customise(rel.name, tables)
    useApp.getState().mutateModel('Rename table', (m) => renameTable(m, tables[0], 'Renamed table'))
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(['Renamed table', tables[1]])
    // the relationship kept its name, so its routing is still there
    expect(diagram().routes![rel.name].waypoints).toHaveLength(1)
    useApp.getState().undo()
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(tables)
    useApp.getState().redo()
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(['Renamed table', tables[1]])
  })

  it('deleting a table removes it from its group and drops the routing of its relationships', () => {
    const { rel, tables } = load()
    customise(rel.name, tables)
    useApp.getState().mutateModel('Delete table', (m) => deleteTable(m, tables[0]))
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual([tables[1]])
    expect(diagram().routes).toBeUndefined()
    useApp.getState().mutateModel('Delete table', (m) => deleteTable(m, tables[1]))
    // nothing custom is left: the sidecar is gone
    expect(useApp.getState().project!.model.sidecarFiles?.[LUMEN_LAYOUT_FILE]).toBeUndefined()
    useApp.getState().undo()
    useApp.getState().undo()
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(tables)
    expect(diagram().routes![rel.name]).toBeDefined()
  })

  it('deleting a relationship removes its routing only', () => {
    const { rel, tables } = load()
    customise(rel.name, tables)
    useApp.getState().mutateModel('Delete relationship', (m) => {
      m.relationships = m.relationships.filter((r) => r.name !== rel.name)
    })
    expect(diagram().routes).toBeUndefined()
    expect(diagram().groups![0].tables.map((t) => t.name)).toEqual(tables)
  })
})
