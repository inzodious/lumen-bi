import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { columnExpr } from '@core/report/sq'
import { resolveTheme } from '@core/report/theme'
import { createMockHost, createMockState } from '../common/mockHost'
import { createSampleEngine } from '../common/sampleData'
import { getVisual } from '../registry'
import './index'
import { galleryEntries } from './gallery'
import { clickItem, clickSelectAll, itemSelected, selectAllState, type ListState } from './listLogic'
import { cleanFamily, readSlicerFormat } from './slicerFormat'
import { listFilter, parseListFilter } from './filterModel'

const region = columnExpr('Sales', 'Region')
const plain = { ctrl: false, ctrlMulti: false, strictSingle: false }

describe('list click logic', () => {
  it('multi-select toggles', () => {
    let s: ListState = { field: region, filter: undefined, inverted: false }
    let u = clickItem(s, 'A', 'A', plain)
    s = { ...s, ...u }
    u = clickItem(s, 'B', 'B', plain)
    s = { ...s, ...u }
    expect(parseListFilter(s.filter, region)?.values).toEqual(['A', 'B'])
    u = clickItem(s, 'A', 'A', plain)
    expect(parseListFilter(u.filter, region)?.values).toEqual(['B'])
  })
  it('multi-select with CTRL: plain click replaces, ctrl click adds', () => {
    let s: ListState = { field: region, filter: listFilter(region, { mode: 'include', values: ['A'] }), inverted: false }
    let u = clickItem(s, 'B', 'B', { ctrl: false, ctrlMulti: true, strictSingle: false })
    expect(parseListFilter(u.filter, region)?.values).toEqual(['B'])
    s = { ...s, ...u }
    u = clickItem(s, 'C', 'C', { ctrl: true, ctrlMulti: true, strictSingle: false })
    expect(parseListFilter(u.filter, region)?.values).toEqual(['B', 'C'])
  })
  it('strict single select keeps exactly one', () => {
    const s: ListState = { field: region, filter: listFilter(region, { mode: 'include', values: ['A'] }), inverted: false }
    const opts = { ctrl: true, ctrlMulti: true, strictSingle: true }
    expect(parseListFilter(clickItem(s, 'B', 'B', opts).filter, region)?.values).toEqual(['B'])
    expect(parseListFilter(clickItem(s, 'A', 'A', opts).filter, region)?.values).toEqual(['A'])
  })
  it('select all → inverted mode, deselect writes Not In, reselect returns to all', () => {
    let s: ListState = { field: region, filter: undefined, inverted: false }
    s = { ...s, ...clickSelectAll(s) }
    expect(s.inverted).toBe(true)
    expect(selectAllState(s, ['A', 'B'], ['A', 'B'])).toBe('on')
    s = { ...s, ...clickItem(s, 'A', 'A', plain) }
    expect(parseListFilter(s.filter, region)).toEqual({ mode: 'exclude', values: ['A'] })
    expect(itemSelected(s, 'A', 'A')).toBe(false)
    expect(itemSelected(s, 'B', 'B')).toBe(true)
    expect(selectAllState(s, ['A', 'B'], ['A', 'B'])).toBe('partial')
    s = { ...s, ...clickItem(s, 'A', 'A', plain) }
    expect(s.filter).toBeUndefined()
    expect(s.inverted).toBe(true)
    s = { ...s, ...clickSelectAll(s) }
    expect(s).toMatchObject({ filter: undefined, inverted: false })
  })
  it('field parameter identity column + labels', () => {
    const disp = columnExpr('param', 'param')
    const key = columnExpr('param', 'param Fields')
    const s: ListState = { field: disp, filter: undefined, inverted: false, keyField: key }
    const u = clickItem(s, "'m'[Sales]", 'Sales', plain)
    const f = u.filter!
    expect(JSON.stringify(f.Where[0].Condition)).toContain('param Fields')
    expect((f.Where[0] as any).Annotations.filterExpressionMetadata.valueMap).toEqual([{ '0': 'Sales' }])
    const st2: ListState = { field: disp, filter: f, inverted: false }
    expect(itemSelected(st2, 'Sales', 'Sales')).toBe(true) // label match when the key isn't known
  })
})

describe('slicer format', () => {
  it('cleans PBI font stacks with unbalanced quotes', () => {
    expect(cleanFamily("''Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif'")).toBe('Segoe UI Semibold, wf_segoe-ui_semibold, helvetica, arial, sans-serif')
  })
  it('reads selection flags with PBI naming quirks', () => {
    const f = readSlicerFormat(galleryEntries.find((e) => e.id === 'slicer-dropdown')!.visualJson, resolveTheme())
    expect(f.mode).toBe('Dropdown')
    expect(f.selection).toEqual({ selectAll: true, ctrlMulti: false, strictSingle: false })
    expect(f.header.font.size).toBe(11)
    expect(f.header.font.color).toBe('#12239E')
    expect(f.searchEnabled).toBe(true)
  })
})

describe('slicer rendering (SSR smoke)', () => {
  const engine = createSampleEngine()
  for (const entry of galleryEntries) {
    it(entry.id, () => {
      const json = JSON.parse(JSON.stringify(entry.visualJson))
      const def = getVisual(json.visual.visualType)!
      expect(def).toBeDefined()
      const ctx = createMockHost({ engine, visualJson: json, state: createMockState() })
      const html = renderToStaticMarkup(createElement(def.component, { visual: { name: entry.id, json }, pageName: 'p1', width: entry.width, height: entry.height, ctx }))
      expect(html).toContain('wbi-slicer-root')
      const data = def.getData?.({ name: entry.id, json }, ctx)
      expect(data?.columns.length).toBeGreaterThan(0)
    })
  }
  it('dropdown header text summarises the selection', () => {
    const entry = galleryEntries.find((e) => e.id === 'slicer-dropdown')!
    const json = JSON.parse(JSON.stringify(entry.visualJson))
    const ctx = createMockHost({ engine, visualJson: json })
    const html = renderToStaticMarkup(createElement(getVisual('slicer')!.component, { visual: { name: 'x', json }, pageName: 'p', width: 200, height: 60, ctx }))
    expect(html).toContain('Multiple selections')
    expect(html).toContain('Region')
  })
  it('range slicer shows the persisted bounds', () => {
    const entry = galleryEntries.find((e) => e.id === 'slicer-between-date')!
    const json = JSON.parse(JSON.stringify(entry.visualJson))
    const ctx = createMockHost({ engine, visualJson: json })
    const html = renderToStaticMarkup(createElement(getVisual('slicer')!.component, { visual: { name: 'x', json }, pageName: 'p', width: 260, height: 100, ctx }))
    expect(html).toContain('4/1/2023')
    expect(html).toContain('6/30/2024')
  })
  it('getData lists selected values', () => {
    const entry = galleryEntries.find((e) => e.id === 'slicer-basic')!
    const json = JSON.parse(JSON.stringify(entry.visualJson))
    const ctx = createMockHost({ engine, visualJson: json })
    const d = getVisual('slicer')!.getData!({ name: 'x', json }, ctx)!
    expect(d.rows.filter((r) => r[1] === true).map((r) => r[0])).toEqual(['Canada', 'Germany'])
  })
})

const CORPUS = process.env.LUMEN_CORPUS_DIR ?? ''
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'visual.json') out.push(p)
  }
  return out
}

describe.skipIf(!existsSync(CORPUS))('corpus slicer formats', () => {
  it('every corpus slicer resolves its format and mode', () => {
    const theme = resolveTheme()
    let n = 0
    for (const f of walk(CORPUS)) {
      const json = JSON.parse(readFileSync(f, 'utf8'))
      if (json.visual?.visualType !== 'slicer') continue
      const fmt = readSlicerFormat(json, theme)
      expect(['Basic', 'Dropdown']).toContain(fmt.mode)
      expect(fmt.items.font.size).toBeGreaterThan(5)
      expect(fmt.header.font.family ?? '').not.toContain("'")
      n++
    }
    expect(n).toBeGreaterThan(400)
  })
})
