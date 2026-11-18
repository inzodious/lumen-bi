import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { emptyModel, type SemanticModel, type TableDef } from '@core/model/types'
import { addDiagram, autoLayout, readLayout, resolveNodes, updateLayoutNodes, writeLayout, LAYOUT_FILE } from './layout'

const table = (name: string, n = 3): TableDef => ({ name, lineageTag: `tag-${name}`, columns: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, dataType: 'int64' as const, kind: 'data' as const })), measures: [], hierarchies: [], partitions: [] })

function model(): SemanticModel {
  const m = emptyModel()
  m.tables = [table('Sales', 6), table('Product'), table('Customer'), table('Date'), table('Category'), table('Measures', 0), table('LocalDateTable_x')]
  const rel = (f: string, t: string) => ({ name: `${f}-${t}`, fromTable: f, fromColumn: 'c0', toTable: t, toColumn: 'c0', fromCardinality: 'many' as const, toCardinality: 'one' as const, crossFilteringBehavior: 'oneDirection' as const, isActive: true })
  m.relationships = [rel('Sales', 'Product'), rel('Sales', 'Customer'), rel('Sales', 'Date'), rel('Product', 'Category')]
  return m
}

const overlaps = (a: { location: { x: number; y: number }; size: { width: number; height: number } }, b: typeof a) =>
  a.location.x < b.location.x + b.size.width && b.location.x < a.location.x + a.size.width && a.location.y < b.location.y + b.size.height && b.location.y < a.location.y + a.size.height

describe('diagram layout', () => {
  it('auto-layouts star/snowflake schemas without overlaps, skipping auto date tables', () => {
    const nodes = autoLayout(model())
    expect(nodes.map((n) => n.nodeIndex).sort()).toEqual(['Category', 'Customer', 'Date', 'Measures', 'Product', 'Sales'])
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlaps(nodes[i], nodes[j]), `${nodes[i].nodeIndex}/${nodes[j].nodeIndex}`).toBe(false)
    const x = (n: string) => nodes.find((v) => v.nodeIndex === n)!.location.x
    // dims are in a different column than the fact; the snowflake level is further out
    expect(x('Product')).not.toBe(x('Sales'))
    expect(Math.abs(x('Category') - x('Sales'))).toBeGreaterThan(Math.abs(x('Product') - x('Sales')))
    // the unrelated measure table is placed to the right of everything else
    expect(x('Measures')).toBeGreaterThan(Math.max(x('Sales'), x('Product'), x('Category'), x('Customer'), x('Date')))
  })
  it('reads PBI diagramLayout.json, keeps unknown properties and writes positions back', () => {
    const m = model()
    const raw = {
      version: '1.1.0',
      diagrams: [
        { ordinal: 0, scrollPosition: { x: 10, y: 0 }, nodes: [{ location: { x: 5, y: 6 }, nodeIndex: 'Sales', nodeLineageTag: 'tag-Sales', size: { height: 300, width: 234 }, zIndex: 0 }, { location: { x: 400, y: 6 }, nodeIndex: 'Renamed', nodeLineageTag: 'tag-Product', size: { height: 200, width: 234 }, zIndex: 1 }], name: 'All tables', zoomValue: 90, pinKeyFieldsToTop: false, showExtraHeaderInfo: false, hideKeyFieldsWhenCollapsed: false, tablesLocked: false },
        { ordinal: 1, nodes: [{ location: { x: 0, y: 0 }, nodeIndex: 'Date', size: { height: 100, width: 200 } }], name: 'Dates only', zoomValue: 100 }
      ],
      selectedDiagram: 'All tables',
      defaultDiagram: 'All tables',
      futureProp: { keep: true }
    }
    m.sidecarFiles = { [LAYOUT_FILE]: JSON.stringify(raw) }
    const layout = readLayout(m)!
    expect(layout.diagrams.map((d) => d.name)).toEqual(['All tables', 'Dates only'])
    const nodes = resolveNodes(m, layout, 'All tables')
    expect(nodes.find((n) => n.nodeIndex === 'Sales')!.location).toEqual({ x: 5, y: 6 })
    expect(nodes.find((n) => n.nodeIndex === 'Product')!.location).toEqual({ x: 400, y: 6 }) // matched by lineage tag
    expect(nodes).toHaveLength(6) // missing tables appended in "All tables"
    expect(resolveNodes(m, layout, 'Dates only').map((n) => n.nodeIndex)).toEqual(['Date'])
    const updated = updateLayoutNodes(layout, 'All tables', [{ location: { x: 100.123456, y: 200 }, nodeIndex: 'Sales', size: { height: 300, width: 234 } }, { location: { x: 0, y: 900 }, nodeIndex: 'Customer', nodeLineageTag: 'tag-Customer', size: { height: 120, width: 234 } }])
    writeLayout(m, updated)
    const back = JSON.parse(m.sidecarFiles![LAYOUT_FILE])
    expect(back.futureProp).toEqual({ keep: true })
    expect(back.diagrams[0].zoomValue).toBe(90)
    expect(back.diagrams[0].nodes[0].location).toEqual({ x: 100.123, y: 200 })
    expect(back.diagrams[0].nodes.at(-1)).toMatchObject({ nodeIndex: 'Customer', nodeLineageTag: 'tag-Customer' })
    expect(layout.diagrams[0].nodes[0].location).toEqual({ x: 5, y: 6 }) // input not mutated
  })
  it('creates a layout from scratch and adds custom diagrams', () => {
    const l = updateLayoutNodes(null, 'All tables', autoLayout(model()))
    expect(l.diagrams[0]).toMatchObject({ name: 'All tables', ordinal: 0, zoomValue: 100 })
    const l2 = addDiagram(l, 'Layout 1', [])
    expect(l2.diagrams.map((d) => d.name)).toEqual(['All tables', 'Layout 1'])
    expect(l2.selectedDiagram).toBe('Layout 1')
    const l3 = addDiagram(null, 'Layout 1', [])
    expect(l3.diagrams.map((d) => [d.name, d.ordinal])).toEqual([['All tables', 0], ['Layout 1', 1]])
  })
  it('returns null for invalid JSON', () => {
    const m = model()
    m.sidecarFiles = { [LAYOUT_FILE]: '{not json' }
    expect(readLayout(m)).toBeNull()
  })
})

const CORPUS = process.env['LUMEN_CORPUS_DIR']
describe.skipIf(!CORPUS || !existsSync(CORPUS))('corpus diagram layouts', () => {
  it('parses every diagramLayout.json and round-trips positions', () => {
    const found: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return
      for (const e of readdirSync(dir)) {
        if (e === '.pbi' || e === 'node_modules') continue
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p, depth + 1)
        else if (e === LAYOUT_FILE) found.push(p)
      }
    }
    walk(CORPUS!, 0)
    expect(found.length).toBeGreaterThan(0)
    for (const f of found) {
      const m = emptyModel()
      m.sidecarFiles = { [LAYOUT_FILE]: readFileSync(f, 'utf8') }
      const layout = readLayout(m)
      expect(layout).not.toBeNull()
      const d = layout!.diagrams[0]
      const resolved = resolveNodes(m, layout, d.name)
      expect(resolved.every((n) => Number.isFinite(n.location.x) && Number.isFinite(n.location.y))).toBe(true)
      const again = updateLayoutNodes(layout, d.name, d.nodes)
      expect(again.diagrams[0].nodes.length).toBe(d.nodes.length)
      for (let i = 0; i < d.nodes.length; i++) if (Number.isFinite(d.nodes[i].location?.x)) expect(Math.abs(again.diagrams[0].nodes[i].location.x - d.nodes[i].location.x)).toBeLessThan(0.001)
    }
  })
})
