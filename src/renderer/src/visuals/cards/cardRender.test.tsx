/**
 * Rendered structure of the card visual (static markup): a KPI card with a data-bound callout icon,
 * the category label above the value and two "tabular" reference labels below — the shape of a
 * typical dashboard KPI tile formatted through a theme rather than on the visual.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { tableFromRows, type DataStore } from '@core/model/data'
import type { SemanticModel } from '@core/model/types'
import { aggregationExpr, measureExpr } from '@core/report/sq'
import { resolveTheme } from '@core/report/theme'
import { createMockHost } from '../common/mockHost'
import { CardVisualView, computeCardVisual } from './CardVisual'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const STAR = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Cpath d=%22M4 0l1 3h3L5.500 5l1 3-2.500-2-2.500 2 1-3L0 3h3z%22/%3E%3C/svg%3E'
const FLAG = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Cpath d=%22M1 0v8M1 1h6L5 3l2 2H1%22/%3E%3C/svg%3E'

function engine() {
  const model: SemanticModel = {
    name: 'Kpi',
    culture: 'en-US',
    tables: [
      {
        name: 'Facts',
        columns: [{ name: 'Score', dataType: 'double', kind: 'data', sourceColumn: 'Score', summarizeBy: 'sum' }],
        measures: [
          { name: 'Score Avg', expression: 'AVERAGE ( Facts[Score] )', formatString: '0' },
          { name: 'Change Pts', expression: '-13.2', formatString: '▲ 0.0;▼ 0.0' },
          { name: 'Change Pct', expression: '-0.5', formatString: '▲ 0.0%;▼ 0.0%' }
        ],
        hierarchies: [],
        partitions: [{ name: 'Facts', sourceType: 'unknown' }]
      },
      {
        // disconnected icon table: one picture per row, picked by a visual-level filter on the name
        name: 'Icons',
        columns: [
          { name: 'Name', dataType: 'string', kind: 'data', sourceColumn: 'Name' },
          { name: 'Picture', dataType: 'string', kind: 'data', sourceColumn: 'Picture', dataCategory: 'ImageUrl' }
        ],
        measures: [],
        hierarchies: [],
        partitions: [{ name: 'Icons', sourceType: 'unknown' }]
      }
    ],
    relationships: [],
    expressions: [],
    roles: []
  }
  const data: DataStore = { tables: new Map(), status: new Map() }
  data.tables.set('Facts', tableFromRows(['Score'], ['double'], [[6], [8], [10]]))
  data.tables.set('Icons', tableFromRows(['Name', 'Picture'], ['string', 'string'], [['flag.png', FLAG], ['star.png', STAR]]))
  data.status.set('Facts', { state: 'loaded', source: 'synthetic', rowCount: 3 })
  data.status.set('Icons', { state: 'loaded', source: 'synthetic', rowCount: 2 })
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}

const QR = 'Facts.Score Avg'
const ref = (id: string, order: number, measure: string) => ({
  properties: { value: { expr: measureExpr('Facts', measure) } },
  selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: QR, id, order }
})

/** KPI card: icon from data (15% of the callout, top), 60% callout, two tabular reference labels, no card chrome. */
function kpiCard(extra: Record<string, any[]> = {}) {
  return {
    name: 'kpi',
    visual: {
      visualType: 'cardVisual',
      query: { queryState: { Data: { projections: [{ field: measureExpr('Facts', 'Score Avg'), queryRef: QR, nativeQueryRef: 'Average score', displayName: 'Average score' }] } } },
      objects: {
        outline: [{ properties: { show: lit('false') }, selector: { id: 'default' } }],
        fillCustom: [{ properties: { show: lit('false') } }],
        divider: [{ properties: { show: lit('false') }, selector: { id: 'default' } }],
        value: [{ properties: { horizontalAlignment: lit("'left'") }, selector: { id: 'default' } }, { properties: { show: lit('true') } }],
        layout: [{ properties: { alignment: lit("'top'"), calloutSize: lit('60D'), autoGrid: lit('true'), columnCount: lit('1L'), cellPadding: lit('0L') } }],
        image: [
          {
            properties: {
              show: lit('true'),
              imageType: lit("'imageData'"),
              imageData: { expr: aggregationExpr('Icons', 'Picture', 3) },
              imageAreaSize: lit('15L'),
              padding: lit('0L'),
              verticalAlignment: lit("'top'")
            },
            selector: { id: 'default' }
          }
        ],
        referenceLabelLayout: [{ properties: { position: lit("'below'"), labelSpace: lit('0D'), arrangement: lit("'rows'"), style: lit("'tabular'") }, selector: { id: 'default' } }],
        referenceLabel: [ref('field-a', 0, 'Change Pts'), ref('field-b', 1, 'Change Pct'), { properties: { backgroundShow: lit('false'), paddingUniform: lit('0L') }, selector: { id: 'default' } }],
        referenceLabelTitle: [
          { properties: { titleContentType: lit("'custom'"), titleText: lit("'Change (pts):'") }, selector: { metadata: QR, id: 'field-a' } },
          { properties: { titleContentType: lit("'custom'"), titleText: lit("'Change (%):'") }, selector: { metadata: QR, id: 'field-b' } }
        ],
        padding: [{ properties: { paddingUniform: lit('5L'), paddingIndividual: lit('false'), topMargin: lit('0L'), bottomMargin: lit('0L') }, selector: { id: 'default' } }],
        ...extra
      }
    }
  }
}

const iconFilter = (name: string) => ({
  Version: 2,
  From: [{ Name: 'i', Entity: 'Icons', Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Name' } }], Values: [[{ Literal: { Value: `'${name}'` } }]] } } }]
})

const brand = resolveTheme(undefined, { textClasses: { callout: { fontFace: 'Segoe UI', fontSize: 16 }, label: { fontFace: 'Segoe UI', fontSize: 12 } } })
const e = engine()
const hostFor = (filters: any[] = []) => createMockHost({ engine: e, theme: brand, filters })
const render = (json: any, filters: any[] = []) => renderToStaticMarkup(createElement(CardVisualView, { visual: { name: 'kpi', json } as any, pageName: 'p', width: 300, height: 120, ctx: hostFor(filters) }))
/** inline style of the first element carrying `className` */
const styleOf = (html: string, className: string) => new RegExp(`class="${className}[^"]*" style="([^"]*)"`).exec(html)?.[1] ?? ''

describe('card visual rendering — KPI tile', () => {
  it('picks the icon selected by the visual-level filter on the icon table', () => {
    const star = computeCardVisual(kpiCard(), hostFor([iconFilter('star.png')])).callouts[0]
    expect(star.image?.src).toBe(STAR)
    expect(star.raw).toBe(8) // the unrelated icon filter does not touch the measure
    expect(computeCardVisual(kpiCard(), hostFor([iconFilter('flag.png')])).callouts[0].image?.src).toBe(FLAG)
    // an icon that is not in the table: no picture, but the image area is kept
    const none = computeCardVisual(kpiCard(), hostFor([iconFilter('missing.png')])).callouts[0]
    expect(none.image).toBeDefined()
    expect(none.image!.src).toBeUndefined()
  })

  it('draws the icon in a 15% area anchored to the top, the label above the value', () => {
    const html = render(kpiCard(), [iconFilter('star.png')])
    expect(styleOf(html, 'wbi-card-image')).toContain('flex:0 0 15%')
    expect(html).toMatch(/<img[^>]*object-fit:contain[^>]*object-position:center top/)
    expect(html.indexOf('class="wbi-card-label"')).toBeGreaterThan(-1)
    expect(html.indexOf('class="wbi-card-label"')).toBeLessThan(html.indexOf('class="wbi-card-value"'))
    expect(html.indexOf('class="wbi-card-image"')).toBeLessThan(html.indexOf('class="wbi-card-label"'))
    // theme callout class: 16pt regular (21.33px), not a bold 28pt default
    const value = styleOf(html, 'wbi-card-value')
    expect(value).toMatch(/font-size:21\.3\d*px/)
    expect(value).not.toMatch(/font-weight:(600|700|bold)/)
    expect(value).toContain('white-space:nowrap')
    // category label: label class + 2pt = 14pt
    expect(styleOf(html, 'wbi-card-label')).toMatch(/font-size:18\.6\d*px/)
    expect(html).toContain('>Average score<')
    expect(html.match(/Average score/g)).toHaveLength(1)
  })

  it('keeps an empty image area when the picture is missing', () => {
    const html = render(kpiCard(), [iconFilter('missing.png')])
    expect(styleOf(html, 'wbi-card-image')).toContain('flex:0 0 15%')
    expect(html).not.toContain('<img')
  })

  it('gives the callout its fixed share and clips both areas', () => {
    const html = render(kpiCard())
    const callout = styleOf(html, 'wbi-card-area wbi-card-area-callout')
    expect(callout).toContain('flex:0 0 60%')
    expect(callout).toContain('overflow:hidden')
    expect(callout).toContain('min-height:0')
    const refs = styleOf(html, 'wbi-card-area wbi-card-area-referenceLabel')
    expect(refs).toContain('flex:1 1 0')
    expect(refs).toContain('overflow:hidden')
    // card padding 5px, no outline / fill
    const tile = styleOf(html, 'wbi-card-tile')
    expect(tile).toContain('padding:5px 5px 5px 5px')
    expect(tile).not.toContain('border:')
  })

  it('lays tabular reference labels out as a full-width table: titles left, values right', () => {
    const html = render(kpiCard())
    const table = styleOf(html, 'wbi-card-ref-table')
    expect(table).toContain('display:grid')
    expect(table).toContain('grid-template-columns:minmax(0, 1fr) minmax(0, max-content)')
    expect(table).not.toContain('justify-content')
    expect(styleOf(html, 'wbi-card-ref-title')).toContain('text-align:left')
    expect(styleOf(html, 'wbi-card-ref-value')).toContain('justify-content:flex-end')
    expect(html).toContain('Change (pts):')
    expect(html).toContain('▼ 13.2')
    expect(html).toContain('▼ 50.0%')
    // reference label fonts follow the theme label class (12pt = 16px)
    expect(styleOf(html, 'wbi-card-ref-title')).toContain('font-size:16px')
  })

  it('honours the value area width and an explicit horizontal alignment', () => {
    const area = render(kpiCard({ referenceLabelLayout: [{ properties: { style: lit("'tabular'"), arrangement: lit("'rows'"), valueArea: lit('66D') }, selector: { id: 'default' } }] }))
    expect(styleOf(area, 'wbi-card-ref-table')).toContain('grid-template-columns:minmax(0, 34fr) minmax(0, 66fr)')
    expect(styleOf(area, 'wbi-card-ref-value')).toContain('justify-content:flex-end')
    const packed = render(kpiCard({ referenceLabelLayout: [{ properties: { style: lit("'tabular'"), horizontalAlignment: lit("'center'") }, selector: { id: 'default' } }] }))
    const table = styleOf(packed, 'wbi-card-ref-table')
    expect(table).toContain('grid-template-columns:max-content minmax(0, max-content)')
    expect(table).toContain('justify-content:center')
  })

  it('puts the label below the value when the visual says so', () => {
    const html = render(kpiCard({ label: [{ properties: { position: lit("'belowValue'") }, selector: { id: 'default' } }] }))
    expect(html.indexOf('class="wbi-card-value"')).toBeLessThan(html.indexOf('class="wbi-card-label"'))
  })
})

