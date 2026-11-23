// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// commands.ts pulls in the renderer store and the modeling dialogs; keep these tests on the pure helpers.
vi.mock('../dialogs/modeling', () => ({ openModelingDialog: () => false }))

import { parseHash } from './Router'
import { relativeTime } from './RecentList'
import { tablesWithoutData, syntheticTables, blankProject } from './commands'
import { searchCommands } from './commandSearch'
import { createDemoProject } from './demoProject'
import { visibleTabs } from './ribbon/registry'

describe('hash routing', () => {
  it('parses path and query', () => {
    const r = parseHash('#/gallery?x=1&y=two')
    expect(r.path).toBe('/gallery')
    expect(r.params.get('y')).toBe('two')
    expect(parseHash('').path).toBe('/')
    expect(parseHash('#/?sample=1').params.get('sample')).toBe('1')
  })
})

describe('relativeTime', () => {
  const now = Date.UTC(2025, 5, 10, 12)
  it('formats recent times like PBI', () => {
    expect(relativeTime(now - 10_000, now)).toBe('Just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 hours ago')
    expect(relativeTime(now - 26 * 3600_000, now)).toBe('Yesterday')
    expect(relativeTime(now - 3 * 86400_000, now)).toBe('3 days ago')
  })
})

describe('missing data detection', () => {
  it('flags import tables without rows and ignores calculated tables', () => {
    const p = createDemoProject()
    expect(tablesWithoutData(p)).toEqual([])
    p.data.tables.delete('Sales')
    p.data.status.delete('Sales')
    expect(tablesWithoutData(p)).toEqual(['Sales'])
    // Date is a calculated table (DAX CALENDAR) — never reported
    expect(tablesWithoutData(p)).not.toContain('Date')
  })
  it('lists synthetic tables', () => {
    const p = createDemoProject()
    p.data.status.set('Sales', { state: 'loaded', source: 'synthetic', rowCount: 10 })
    expect(syntheticTables(p)).toEqual(['Sales'])
    expect(syntheticTables(null)).toEqual([])
  })
  it('creates a blank project with one page, the two default measure tables and sample data on', () => {
    const p = blankProject('X')
    expect(p.report?.pages).toHaveLength(1)
    expect(p.model.tables.map((t) => t.name)).toEqual(['_measures_kpi', '_measures_format'])
    expect(tablesWithoutData(p)).toEqual([])
    expect(p.report?.report.annotations).toEqual([{ name: 'Lumen_SampleData', value: 'on' }])
    expect(p.dirty).toBe(false)
  })
})

describe('demo project', () => {
  it('is internally consistent', () => {
    const p = createDemoProject()
    const sales = p.data.tables.get('Sales')!
    expect(sales.rowCount).toBe(2400)
    const keys = new Set(p.data.tables.get('Product')!.columns[0].values)
    expect(sales.columns[1].values.every((k) => keys.has(k))).toBe(true)
    for (const v of p.report!.pages[0].visuals) expect(v.json.position.width).toBeGreaterThan(0)
  })
})

describe('command search', () => {
  it('ranks label prefix matches first and searches keywords', () => {
    expect(searchCommands('new')[0].label.toLowerCase().startsWith('new')).toBe(true)
    expect(searchCommands('pptx').map((c) => c.id)).toContain('pptx')
    expect(searchCommands('   ')).toEqual([])
  })
})

describe('ribbon registry', () => {
  it('filters tabs by view and predicate', () => {
    const tabs = [
      { id: 'a', label: 'A', render: () => null },
      { id: 'b', label: 'B', views: ['data' as const], render: () => null },
      { id: 'c', label: 'C', visible: (s: any) => s.selectedVisuals.length > 0, render: () => null }
    ]
    const ids = (s: any) => visibleTabs(tabs, s).map((t) => t.id)
    expect(ids({ view: 'report', selectedVisuals: [] })).toEqual(['a'])
    expect(ids({ view: 'report', selectedVisuals: ['v'] })).toEqual(['a', 'c'])
    expect(ids({ view: 'data', selectedVisuals: [] })).toEqual(['b'])
  })
})
