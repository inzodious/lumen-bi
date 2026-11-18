import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../nodefs'
import { openProject, saveProject } from '../open'
import { emptyDataStore } from '../../model/data'
import { emptyModel, type SemanticModel, type TableDef } from '../../model/types'
import { emptyReport } from '../../report/types'
import type { ProjectDocument } from '../../project'
import {
  LUMEN_LAYOUT_FILE,
  diffModelRefs,
  isRouteEmpty,
  lumenDiagram,
  migrateLumenLayout,
  newGroupIdentity,
  parseLumenLayout,
  pruneLumenDiagram,
  readLumenLayout,
  reconcileLumenSidecar,
  removeLumenDiagram,
  resolveLumenDiagram,
  serializeLumenLayout,
  updateLumenDiagram,
  withReconciledSidecars,
  type LumenLayout
} from '../diagramSidecar'

function table(name: string, lineageTag?: string): TableDef {
  return {
    name,
    ...(lineageTag ? { lineageTag } : {}),
    columns: [{ name: 'Key', dataType: 'int64', kind: 'data', sourceColumn: 'Key', summarizeBy: 'none' }],
    measures: [],
    hierarchies: [],
    partitions: [{ name, sourceType: 'm', mode: 'import', expression: 'let\n    Source = #table({"Key"}, {{1}})\nin\n    Source' }]
  }
}

function model(): SemanticModel {
  const m = emptyModel()
  m.compatibilityLevel = 1600
  m.tables.push(table('Sales', 'tag-sales'), table('Date', 'tag-date'), table('Product'))
  m.relationships.push(
    { name: 'r-date', fromTable: 'Sales', fromColumn: 'Key', toTable: 'Date', toColumn: 'Key', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true },
    { name: 'r-product', fromTable: 'Sales', fromColumn: 'Key', toTable: 'Product', toColumn: 'Key', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
  )
  return m
}

const sample = (): LumenLayout => ({
  version: 1,
  diagrams: [
    {
      name: 'All tables',
      lineStyle: 'curved',
      routes: {
        'r-date': { waypoints: [{ x: 100.004, y: 50 }], from: { side: 'right', t: 0.123456 } },
        'r-product': { style: 'orthogonal' }
      },
      groups: [{ id: 'g1', name: 'Dimensions', tables: [{ name: 'Date', lineageTag: 'tag-date' }, { name: 'Product' }], bounds: { x: 0, y: 0, width: 600, height: 400 } }]
    }
  ]
})

describe('diagramLayout.lumen.json — read / write', () => {
  it('round-trips through text and is stable', () => {
    const text = serializeLumenLayout(sample())!
    const back = parseLumenLayout(text)!
    expect(back.version).toBe(1)
    expect(JSON.parse(text).$lumen).toBe('diagramLayout')
    const d = lumenDiagram(back, 'All tables')
    expect(d.lineStyle).toBe('curved')
    expect(d.routes!['r-date'].waypoints).toEqual([{ x: 100, y: 50 }])
    expect(d.routes!['r-date'].from).toEqual({ side: 'right', t: 0.1235 })
    expect(d.routes!['r-product']).toEqual({ style: 'orthogonal' })
    expect(d.groups![0]).toMatchObject({ id: 'g1', name: 'Dimensions', bounds: { x: 0, y: 0, width: 600, height: 400 } })
    expect(d.groups![0].color).toBeUndefined()
    // serialising what was parsed gives the same bytes
    expect(serializeLumenLayout(back)).toBe(text)
  })

  it('returns null (no file) when nothing custom is left', () => {
    expect(serializeLumenLayout(null)).toBeNull()
    expect(serializeLumenLayout({ version: 1, diagrams: [] })).toBeNull()
    expect(serializeLumenLayout({ version: 1, diagrams: [{ name: 'All tables', routes: { r: {} }, groups: [{ id: 'g1', name: 'Empty', tables: [] }] }] })).toBeNull()
    let l = updateLumenDiagram(sample(), 'All tables', (d) => {
      delete d.lineStyle
      delete d.routes
      delete d.groups
    })
    expect(serializeLumenLayout(l)).toBeNull()
    l = updateLumenDiagram(null, 'Layout 1', (d) => {
      d.lineStyle = 'straight'
    })
    expect(JSON.parse(serializeLumenLayout(l)!).diagrams).toEqual([{ name: 'Layout 1', lineStyle: 'straight' }])
    expect(serializeLumenLayout(removeLumenDiagram(l, 'Layout 1'))).toBeNull()
  })

  it('ignores files that are not a Lumen layout and tolerates damaged entries', () => {
    expect(parseLumenLayout(undefined)).toBeNull()
    expect(parseLumenLayout('not json')).toBeNull()
    expect(parseLumenLayout('[1,2]')).toBeNull()
    expect(parseLumenLayout('{"version":1}')).toBeNull()
    const l = parseLumenLayout(
      JSON.stringify({
        version: 1,
        diagrams: [
          null,
          { name: 'A', lineStyle: 'zigzag', routes: { r1: { waypoints: [{ x: 1, y: 2 }, { x: 'bad' }, null], from: { side: 'diagonal', t: 2 }, to: { side: 'top', t: 7 } }, r2: 'nope' }, groups: [{ name: '', tables: ['T1', { name: 'T2' }, 5, 'T1'] }, { id: 'g1', tables: ['T2', 'T3'] }, 'x'] },
          { name: 'A', lineStyle: 'curved' }
        ]
      })
    )!
    expect(l.diagrams).toHaveLength(1)
    const d = l.diagrams[0]
    expect(d.lineStyle).toBeUndefined()
    expect(d.routes).toEqual({ r1: { waypoints: [{ x: 1, y: 2 }], to: { side: 'top', t: 1 } } })
    // ids are made unique, names defaulted, a table belongs to the first group that lists it
    expect(d.groups!.map((g) => [g.id, g.name, g.tables.map((t) => t.name)])).toEqual([
      ['g1', 'Group', ['T1', 'T2']],
      ['g2', 'Group', ['T3']]
    ])
  })

  it('keeps unknown properties at every level', () => {
    const src = { $lumen: 'diagramLayout', version: 1, future: { a: 1 }, diagrams: [{ name: 'A', lineStyle: 'curved', zoomPreset: 2, routes: { r: { style: 'straight', label: 'x', waypoints: [{ x: 1, y: 2, locked: true }] } }, groups: [{ id: 'g1', name: 'G', tables: [{ name: 'T', pinned: true }], note: 'hi' }] }] }
    const back = JSON.parse(serializeLumenLayout(parseLumenLayout(JSON.stringify(src)))!)
    expect(back).toEqual(src)
  })

  it('newGroupIdentity picks a free id and name', () => {
    expect(newGroupIdentity({ name: 'A' })).toEqual({ id: 'g1', name: 'Group 1' })
    expect(newGroupIdentity({ name: 'A', groups: [{ id: 'g1', name: 'Group 1', tables: [] }, { id: 'g3', name: 'Dims', tables: [] }] })).toEqual({ id: 'g2', name: 'Group 2' })
  })

  it('isRouteEmpty', () => {
    expect(isRouteEmpty(undefined)).toBe(true)
    expect(isRouteEmpty({})).toBe(true)
    expect(isRouteEmpty({ waypoints: [] })).toBe(true)
    expect(isRouteEmpty({ style: 'curved' })).toBe(false)
    expect(isRouteEmpty({ to: { side: 'left', t: 0.5 } })).toBe(false)
  })
})

describe('diagramLayout.lumen.json — migration', () => {
  it('reads the pre-release shape (diagrams keyed by name, [x, y] waypoints, plain table names, style aliases)', () => {
    const l = migrateLumenLayout({
      version: 0,
      diagrams: {
        'All tables': { lineStyle: 'bezier', routes: { r: { style: 'elbow', waypoints: [[10, 20], [30, 40]] } }, groups: [{ id: 'a', name: 'Dims', color: 'blue', tables: ['Date', 'Product'], collapsed: true }] },
        'Layout 1': { lineStyle: 'line' }
      }
    })!
    expect(l.version).toBe(1)
    expect(l.diagrams.map((d) => d.name)).toEqual(['All tables', 'Layout 1'])
    expect(l.diagrams[0].lineStyle).toBe('curved')
    expect(l.diagrams[0].routes!['r']).toEqual({ style: 'orthogonal', waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }] })
    expect(l.diagrams[0].groups![0]).toEqual({ id: 'a', name: 'Dims', color: 'blue', collapsed: true, tables: [{ name: 'Date' }, { name: 'Product' }] })
    expect(l.diagrams[1].lineStyle).toBe('straight')
    // written back in the current shape
    const out = JSON.parse(serializeLumenLayout(l)!)
    expect(out.version).toBe(1)
    expect(Array.isArray(out.diagrams)).toBe(true)
  })

  it('keeps the version of a file written by a newer Lumen', () => {
    const l = migrateLumenLayout({ version: 3, diagrams: [{ name: 'A', lineStyle: 'curved', lanes: [1, 2] }] })!
    expect(l.version).toBe(3)
    const out = JSON.parse(serializeLumenLayout(l)!)
    expect(out.version).toBe(3)
    expect(out.diagrams[0].lanes).toEqual([1, 2])
  })
})

describe('diagramLayout.lumen.json — stale references', () => {
  it('resolve: drops routes of missing relationships and follows a rename by lineage tag', () => {
    const m = model()
    m.tables[1].name = 'Calendar' // renamed outside Lumen, lineage tag unchanged
    m.relationships = m.relationships.filter((r) => r.name !== 'r-product')
    const d = resolveLumenDiagram(sample().diagrams[0], m)
    expect(Object.keys(d.routes!)).toEqual(['r-date'])
    expect(d.groups![0].tables.map((t) => t.name)).toEqual(['Calendar', 'Product'])
    // the stored document is untouched
    expect(sample().diagrams[0].groups![0].tables[0].name).toBe('Date')
  })

  it('resolve: a group whose tables are all gone disappears; prune makes it permanent', () => {
    const m = model()
    m.tables = m.tables.filter((t) => t.name === 'Sales')
    m.relationships = []
    const d = sample().diagrams[0]
    expect(resolveLumenDiagram(d, m).groups).toEqual([])
    pruneLumenDiagram(d, m)
    expect(d.groups).toBeUndefined()
    expect(d.routes).toBeUndefined()
    expect(d.lineStyle).toBe('curved')
  })

  it('prune refreshes lineage tags', () => {
    const m = model()
    m.tables[2].lineageTag = 'tag-product'
    const d = sample().diagrams[0]
    pruneLumenDiagram(d, m)
    expect(d.groups![0].tables).toEqual([
      { name: 'Date', lineageTag: 'tag-date' },
      { name: 'Product', lineageTag: 'tag-product' }
    ])
  })

  it('diff: rename by lineage tag, rename in place without a tag, delete', () => {
    const a = model()
    const b: SemanticModel = { ...a, tables: [{ ...a.tables[0] }, { ...a.tables[1], name: 'Calendar' }, { ...a.tables[2], name: 'Item' }] }
    let d = diffModelRefs(a, b)
    expect([...d.tableRenames]).toEqual([
      ['Date', 'Calendar'],
      ['Product', 'Item']
    ])
    expect(d.tablesDeleted.size).toBe(0)
    const c: SemanticModel = { ...a, tables: [a.tables[0], a.tables[2]], relationships: [a.relationships[1]] }
    d = diffModelRefs(a, c)
    expect([...d.tablesDeleted]).toEqual(['Date'])
    expect([...d.relsDeleted]).toEqual(['r-date'])
    expect(d.tableRenames.size).toBe(0)
  })

  it('diff: a relationship recreated over the same columns keeps its route', () => {
    const a = model()
    const b: SemanticModel = { ...a, relationships: [{ ...a.relationships[0], name: 'new-name', toTable: 'Sales', toColumn: 'Key', fromTable: 'Date', fromColumn: 'Key' }, a.relationships[1]] }
    const d = diffModelRefs(a, b)
    expect([...d.relRenames]).toEqual([['r-date', 'new-name']])
    expect(d.relsDeleted.size).toBe(0)
  })

  it('reconcile: renames follow, deletions clean up, unrelated edits leave the text alone', () => {
    const a = model()
    a.sidecarFiles = { [LUMEN_LAYOUT_FILE]: serializeLumenLayout(sample())! }
    // unrelated edit (a measure): nothing to do
    const measureEdit: SemanticModel = { ...a, tables: [{ ...a.tables[0], measures: [{ name: 'M', expression: '1' }] }, a.tables[1], a.tables[2]] }
    expect(reconcileLumenSidecar(a, measureEdit)).toBeUndefined()
    expect(withReconciledSidecars(a, measureEdit)).toBe(measureEdit)
    // rename Date → Calendar (relationships follow the rename like modelOps.renameTable does)
    const renamed: SemanticModel = {
      ...a,
      tables: [a.tables[0], { ...a.tables[1], name: 'Calendar' }, a.tables[2]],
      relationships: [{ ...a.relationships[0], toTable: 'Calendar' }, a.relationships[1]]
    }
    const r1 = readLumenLayout(withReconciledSidecars(a, renamed))!
    expect(r1.diagrams[0].groups![0].tables.map((t) => t.name)).toEqual(['Calendar', 'Product'])
    expect(Object.keys(r1.diagrams[0].routes!)).toEqual(['r-date', 'r-product'])
    // delete Product (+ its relationship)
    const deleted: SemanticModel = { ...a, tables: [a.tables[0], a.tables[1]], relationships: [a.relationships[0]] }
    const r2 = readLumenLayout(withReconciledSidecars(a, deleted))!
    expect(r2.diagrams[0].groups![0].tables.map((t) => t.name)).toEqual(['Date'])
    expect(Object.keys(r2.diagrams[0].routes!)).toEqual(['r-date'])
    // the original model object is never modified
    expect(a.sidecarFiles[LUMEN_LAYOUT_FILE]).toBe(serializeLumenLayout(sample()))
  })

  it('reconcile: removes the file when the last custom entry goes', () => {
    const a = model()
    a.sidecarFiles = { [LUMEN_LAYOUT_FILE]: serializeLumenLayout({ version: 1, diagrams: [{ name: 'All tables', routes: { 'r-date': { waypoints: [{ x: 1, y: 2 }] } } }] })! }
    const b: SemanticModel = { ...a, relationships: [a.relationships[1]] }
    expect(reconcileLumenSidecar(a, b)).toBeNull()
    expect(withReconciledSidecars(a, b).sidecarFiles).toEqual({})
  })
})

describe('diagramLayout.lumen.json — saved beside diagramLayout.json', () => {
  const project = (m: SemanticModel): ProjectDocument => ({ id: 'p', name: 'Demo', source: { kind: 'new' }, model: m, data: emptyDataStore(), report: emptyReport(), diagnostics: [], dirty: true })

  it('PBIP: written, restored on open, and removed again when nothing custom is left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-sidecar-'))
    try {
      const m = model()
      const text = serializeLumenLayout(sample())!
      m.sidecarFiles = { 'diagramLayout.json': '{"version":"1.1.0","diagrams":[]}', [LUMEN_LAYOUT_FILE]: text }
      const p = project(m)
      await saveProject(p, join(dir, 'Demo.pbip'), nodeFs, { format: 'pbip' })
      const file = join(dir, 'Demo.SemanticModel', LUMEN_LAYOUT_FILE)
      expect(readFileSync(file, 'utf8')).toBe(text)
      expect(existsSync(join(dir, 'Demo.SemanticModel', 'diagramLayout.json'))).toBe(true)
      const back = await openProject(join(dir, 'Demo.pbip'), nodeFs)
      expect(back.model.sidecarFiles?.[LUMEN_LAYOUT_FILE]).toBe(text)
      expect(lumenDiagram(readLumenLayout(back.model), 'All tables').groups![0].name).toBe('Dimensions')
      // the user resets everything: the next save removes the file
      delete back.model.sidecarFiles![LUMEN_LAYOUT_FILE]
      await saveProject(back, join(dir, 'Demo.pbip'), nodeFs, { format: 'pbip' })
      expect(existsSync(file)).toBe(false)
      expect(existsSync(join(dir, 'Demo.SemanticModel', 'diagramLayout.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a project without the sidecar never gets one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-sidecar-'))
    try {
      const p = project(model())
      await saveProject(p, join(dir, 'Demo.pbip'), nodeFs, { format: 'pbip' })
      expect(existsSync(join(dir, 'Demo.SemanticModel', LUMEN_LAYOUT_FILE))).toBe(false)
      const back = await openProject(join(dir, 'Demo.pbip'), nodeFs)
      expect(readLumenLayout(back.model)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('.wbi bundle: carried along', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-sidecar-'))
    try {
      const m = model()
      const text = serializeLumenLayout(sample())!
      m.sidecarFiles = { [LUMEN_LAYOUT_FILE]: text }
      await saveProject(project(m), join(dir, 'Demo.wbi'), nodeFs, { format: 'wbi' })
      const back = await openProject(join(dir, 'Demo.wbi'), nodeFs)
      expect(back.model.sidecarFiles?.[LUMEN_LAYOUT_FILE]).toBe(text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
