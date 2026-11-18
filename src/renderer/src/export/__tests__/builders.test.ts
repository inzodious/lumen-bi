// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildHtml, buildPptx, bytesToBase64, type ExportedPage } from '../builders'
import { buildXlsx, toCsv, isoDate } from '../data'
import { describeFilterCards } from '../filterText'
import { inFilter } from '@core/report/sq'

// 1×1 transparent PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
const pages: ExportedPage[] = [
  { name: 'p1', displayName: 'Overview', width: 1280, height: 720, png: PNG, notes: ['Product[Color] is Red'] },
  { name: 'p2', displayName: 'Details <&>', width: 960, height: 720, png: PNG }
]
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

describe('csv', () => {
  it('quotes per RFC 4180 with CRLF', () => {
    const csv = toCsv({ columns: ['Name', 'Amount', 'Date', 'Flag'], rows: [['a,b', 1.5, new Date(Date.UTC(2024, 0, 31)), true], ['say "hi"', null, new Date(Date.UTC(2024, 1, 1, 13, 5, 0)), false], ['line\nbreak', 3, null, null]] })
    expect(csv).toBe('Name,Amount,Date,Flag\r\n"a,b",1.5,2024-01-31,True\r\n"say ""hi""",,2024-02-01T13:05:00,False\r\n"line\nbreak",3,,\r\n')
  })
  it('optional BOM and delimiter', () => {
    expect(toCsv({ columns: ['a;b'], rows: [] }, { bom: true, delimiter: ';' })).toBe('﻿"a;b"\r\n')
  })
  it('iso date uses UTC fields', () => {
    expect(isoDate(new Date(Date.UTC(1999, 11, 31, 23, 59, 59)))).toBe('1999-12-31T23:59:59')
  })
})

describe('xlsx', () => {
  it('is a valid workbook zip with typed cells', async () => {
    const bytes = await buildXlsx({ columns: ['Category', 'Sales', 'Date'], rows: [['A', 10, new Date(Date.UTC(2024, 0, 1))], ['B', 20.5, null]] }, { sheetName: 'Sales by category' })
    expect(isZip(bytes)).toBe(true)
    const files = unzipSync(bytes)
    expect(files['[Content_Types].xml']).toBeDefined()
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('autoFilter')
    expect(sheet).toContain('<v>20.5</v>')
    const shared = strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array())
    expect(shared + sheet).toContain('Category')
  })
})

describe('pptx', () => {
  it('builds a deck with a title slide and one slide per page', async () => {
    const bytes = await buildPptx(pages, { reportName: 'Sales report', exportedAt: new Date(Date.UTC(2025, 0, 2)) })
    expect(isZip(bytes)).toBe(true)
    const files = unzipSync(bytes)
    expect(files['[Content_Types].xml']).toBeDefined()
    expect(files['ppt/slides/slide1.xml']).toBeDefined()
    expect(files['ppt/slides/slide3.xml']).toBeDefined()
    expect(files['ppt/slides/slide4.xml']).toBeUndefined()
    expect(strFromU8(files['ppt/slides/slide1.xml'])).toContain('Sales report')
    const notes = Object.keys(files).filter((f) => f.startsWith('ppt/notesSlides/') && f.endsWith('.xml'))
    expect(notes.map((n) => strFromU8(files[n])).join('')).toContain('Product[Color] is Red')
    expect(Object.keys(files).some((f) => f.startsWith('ppt/media/'))).toBe(true)
  })
})

describe('html', () => {
  it('embeds every page and escapes names', () => {
    const html = buildHtml(pages, { reportName: 'R & D' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html.match(/<section class="pg/g)?.length).toBe(2)
    expect(html).toContain(`data:image/png;base64,${bytesToBase64(PNG)}`)
    expect(html).toContain('Details &lt;&amp;&gt;')
    expect(html).toContain('<title>R &amp; D</title>')
  })
})

describe('filter text', () => {
  it('summarizes basic and advanced filters', () => {
    const cards = [
      { filter: inFilter('Product', 'Color', ['Red', 'Blue']) },
      { filter: inFilter('Product', 'Size', ['XL'], true) },
      { filter: { Version: 2, From: [{ Name: 's', Entity: 'Sales', Type: 0 }], Where: [{ Condition: { Comparison: { ComparisonKind: 1, Left: { Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Qty' } }, Right: { Literal: { Value: '5L' } } } } }] } },
      { field: {} }
    ]
    expect(describeFilterCards(cards)).toEqual(['Product[Color] is Red, Blue', 'Product[Size] is not XL', 'Sales[Qty] is greater than 5'])
  })
})
