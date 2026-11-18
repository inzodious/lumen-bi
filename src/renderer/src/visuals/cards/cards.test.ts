import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTheme } from '@core/report/theme'
import { createSampleEngine, S, proj, sampleRows } from '../common/sampleData'
import { createMockHost } from '../common/mockHost'
import { memoryFormat } from '../common/memoryEngine'
import { computeCardVisual } from './CardVisual'
import { computeLegacyCard, computeMultiRow } from './LegacyCards'
import { buildCardVisualModel, cardFields, cardTextDefaults, gridGeometry, planCardQuery, readCardLayout, type CardValues } from './cardVisualModel'
import { CardProps, cardPrecision, legacyAutoUnit } from './cardProps'
import { buildLegacyCardModel, fitFontSize, fitWrappedFontSize, wrapLines, buildMultiRowRecords, multiRowStyle } from './legacyCardModel'
import { imageSrc } from './cardProps'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const color = (hex: string) => ({ solid: { color: lit(`'${hex}'`) } })
const theme = resolveTheme()
const engine = createSampleEngine()
const host = (filters: any[] = []) => createMockHost({ engine, filters })

function card(projections: any[], objects: any = {}) {
  return { name: 'c', visual: { visualType: 'cardVisual', query: { queryState: { Data: { projections } } }, objects } }
}

const total = sampleRows().reduce((s, r) => s + (r.Amount as number), 0)

describe('cardVisual model', () => {
  it('builds one callout per Data projection with auto display units', () => {
    const m = computeCardVisual(card([proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders')]), host())
    expect(m.callouts).toHaveLength(2)
    expect(m.callouts[0].raw).toBeCloseTo(total, 2)
    // integer format strings keep 0 decimals with auto units (PBI: 7,550 → "8K")
    expect(m.callouts[0].value.text).toBe(`$${Math.round(total / 1e6)}M`)
    expect(m.callouts[1].value.text).toBe('2K')
    expect(m.callouts[0].label.text).toBe('Total Sales')
    expect(m.layout.columns).toBe(2)
  })

  it('resolves per-callout overrides (metadata) over default (id: default) entries', () => {
    const json = card([proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders', { displayName: 'Order count' })], {
      value: [
        { properties: { fontSize: lit('20D'), fontColor: color('#12239E'), horizontalAlignment: lit("'left'") }, selector: { id: 'default' } },
        { properties: { labelDisplayUnits: lit('1D'), labelPrecision: lit('1L'), fontSize: lit('14D') }, selector: { metadata: '_m.Total Sales' } }
      ],
      label: [{ properties: { show: lit('false') }, selector: { metadata: '_m.Orders' } }]
    })
    const m = computeCardVisual(json, host())
    const [a, b] = m.callouts
    expect(a.value.font.size).toBe(14)
    expect(a.value.font.color).toBe('#12239E')
    expect(a.value.align).toBe('left')
    // units None; precision 1 overrides the integer currency format's decimals
    expect(a.value.text).toBe('$' + total.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
    expect(b.value.font.size).toBe(20)
    expect(b.label.show).toBe(false)
    expect(a.label.show).toBe(true)
    expect(b.label.text).toBe('Order count')
  })

  it('attaches reference labels only to the callout whose queryRef matches, ordered by `order`', () => {
    const json = card([proj(S.m('Total Sales'), '_m.Total Sales')], {
      referenceLabel: [
        { properties: { value: { expr: S.m('Margin %') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-b', order: 1 } },
        { properties: { value: { expr: S.m('Orders') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-a', order: 0 } },
        { properties: { value: { expr: S.m('Units') } }, selector: { metadata: '_m.Not In Card', id: 'field-x', order: 0 } },
        { properties: { backgroundShow: lit('false') }, selector: { id: 'default' } }
      ],
      referenceLabelTitle: [
        { properties: { titleText: lit("'Orders:'"), titleContentType: lit("'custom'") }, selector: { metadata: '_m.Total Sales', id: 'field-a' } },
        { properties: { titleFontSize: lit('11D') }, selector: { id: 'default' } }
      ],
      referenceLabelValue: [
        { properties: { valueDisplayUnits: lit('1D') }, selector: { metadata: '_m.Total Sales', id: 'field-a' } },
        { properties: { valueFontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Total Sales', id: 'field-b' } }
      ]
    })
    const m = computeCardVisual(json, host())
    const refs = m.callouts[0].refLabels
    expect(refs.map((r) => r.id)).toEqual(['field-a', 'field-b'])
    expect(refs[0].title.text).toBe('Orders:')
    expect(refs[0].title.font.size).toBe(11)
    expect(refs[0].value.text).toBe('2,400')
    expect(refs[1].title.text).toBe('Margin %') // field name (titleContentType default)
    expect(refs[1].value.text).toMatch(/^\d+\.\d%$/)
    expect(['#1AAB40', '#D9B300', '#D64554']).toContain(refs[1].value.font.color) // measure-bound CF
    expect(m.callouts[0].divider).toBeDefined()
  })

  it('evaluates measure-bound callout font color and respects filters', () => {
    const json = card([proj(S.m('Margin %'), '_m.Margin %')], { value: [{ properties: { fontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Margin %' } }] })
    const filters = [{ Version: 2, Where: [{ Condition: { In: { Expressions: [S.col('Region')], Values: [[{ Literal: { Value: "'Europe'" } }]] } } }] }]
    const m = computeCardVisual(json, host(filters))
    const rows = sampleRows().filter((r) => r.Region === 'Europe')
    const s = rows.reduce((a, r) => a + (r.Amount as number), 0)
    const c = rows.reduce((a, r) => a + (r.Cost as number), 0)
    expect(m.callouts[0].raw).toBeCloseTo((s - c) / s, 8)
    const mg = (s - c) / s
    expect(m.callouts[0].value.font.color).toBe(mg >= 0.3 ? '#1AAB40' : mg >= 0.25 ? '#D9B300' : '#D64554')
  })

  it('lays out grids (autoGrid off → columnCount/rowCount), vertical, and horizontal with maxTiles', () => {
    const p = [1, 2, 3, 4, 5].map(() => proj(S.m('Orders'), '_m.Orders'))
    const grid = computeCardVisual(card(p, { layout: [{ properties: { autoGrid: lit('false'), columnCount: lit('4L'), rowCount: lit('3L'), cellPadding: lit('8L') } }] }), host())
    expect(grid.layout).toMatchObject({ columns: 4, rows: 2, fixedRows: 3, gap: 8 })
    const vertical = computeCardVisual(card(p, { layout: [{ properties: { orientation: lit('1D') } }] }), host())
    expect(vertical.layout.columns).toBe(1)
    const horiz = computeCardVisual(card(p), host())
    expect(horiz.layout).toMatchObject({ columns: 3, rows: 2 })
  })

  it('resolves images from data-bound imageData and tile styling', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    const fields = cardFields(card([proj(S.m('Orders'), '_m.Orders')]), () => 'Orders', () => true)
    const json = card([proj(S.m('Orders'), '_m.Orders')], {
      image: [{ properties: { show: lit('true'), imageType: lit("'imageData'"), imageData: { expr: S.m('Sales Html') }, imageAreaSize: lit('15L'), verticalAlignment: lit("'top'") }, selector: { id: 'default' } }],
      cardImage: [{ properties: { show: lit('false') }, selector: { id: 'default' } }],
      accentBar: [{ properties: { show: lit('true') } }],
      fillCustom: [{ properties: { show: lit('true'), fillColor: color('#0F6CBD') }, selector: { id: 'default' } }],
      shapeCustomRectangle: [{ properties: { rectangleRoundedCurve: lit('8L') }, selector: { id: 'default' } }]
    })
    const plan = planCardQuery(json, theme, fields)
    expect(plan.imageValueId).toBeDefined()
    const vals: CardValues = { get: (id) => (id === plan.imageValueId ? { value: svg } : id.startsWith('v0') ? { value: 12, formatString: '0' } : undefined) }
    const m = buildCardVisualModel(json, theme, memoryFormat, plan, vals)
    expect(m.callouts[0].image?.src?.startsWith('data:image/svg+xml')).toBe(true)
    expect(m.callouts[0].image?.areaSize).toBe(15)
    expect(m.callouts[0].image?.verticalAlignment).toBe('top')
    expect(m.callouts[0].tile).toMatchObject({ fill: '#0F6CBD', radius: [8, 8, 8, 8], accentBar: { color: theme.dataColors[0] } })
  })

  it('shows (Blank) for blank values', () => {
    const filters = [{ Version: 2, Where: [{ Condition: { In: { Expressions: [S.col('Region')], Values: [[{ Literal: { Value: "'Nowhere'" } }]] } } }] }]
    const m = computeCardVisual(card([proj(S.m('Total Sales'), '_m.Total Sales')]), host(filters))
    expect(m.callouts[0].value.text).toBe('(Blank)')
  })
})

describe('cardVisual GA features', () => {
  const svgA = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E'
  it('applies GA defaults: left-aligned value, label above, backgroundLight outline, 12px padding, 8px gaps', () => {
    const m = computeCardVisual(card([proj(S.m('Total Sales'), '_m.Total Sales')]), host())
    const c = m.callouts[0]
    expect(c.value.align).toBe('left')
    // classic base theme text classes: callout = DIN 45pt, label = Segoe UI 10pt (+2 for the category label)
    expect(c.value.font).toMatchObject({ family: 'DIN', size: 45, color: theme.foreground })
    expect(c.value.wrap).toBe(false)
    expect(c.label.font).toMatchObject({ family: 'Segoe UI', size: 12, color: theme.foregroundNeutralSecondary })
    expect(c.label.position).toBe('above')
    expect(c.tile.outline).toEqual({ color: theme.backgroundLight, width: 1 })
    expect(c.tile.padding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
    expect(c.tile.radius).toEqual([4, 4, 4, 4])
    expect(m.layout.gap).toBe(8)
    expect(m.layout.calloutSize).toBe(50)
    expect(m.layout.overflow).toEqual({ style: 'scroll', direction: 'vertical' })
  })

  it('takes the default fonts from the report theme text classes (custom theme callout / label)', () => {
    // shape of a brand theme: small regular callout, larger label — no font set on the visual itself
    const brand = resolveTheme(undefined, {
      foreground: '#101060',
      textClasses: { callout: { fontFace: 'Segoe UI', fontSize: 16, color: '#101060' }, label: { fontFace: 'Segoe UI', fontSize: 12, color: '#101060' } }
    })
    const json = card([proj(S.m('Total Sales'), '_m.Total Sales')], {
      // the visual only overrides alignment + colour, like a card formatted through "Apply settings to: All"
      value: [{ properties: { horizontalAlignment: lit("'left'"), fontColor: color('#12239E') }, selector: { id: 'default' } }, { properties: { show: lit('true') } }],
      referenceLabel: [{ properties: { value: { expr: S.m('Orders') } }, selector: { metadata: '_m.Total Sales', id: 'field-a', order: 0 } }]
    })
    const c = computeCardVisual(json, createMockHost({ engine, theme: brand })).callouts[0]
    expect(c.value.font).toMatchObject({ family: 'Segoe UI', size: 16, color: '#12239E' })
    expect(c.value.font.bold).toBe(false)
    // category label: label face, +2pt (large light label), second-level colour — not the label class colour
    expect(c.label.font).toMatchObject({ family: 'Segoe UI', size: 14, color: brand.foregroundNeutralSecondary })
    // reference labels: label class size; value in the semibold label face
    expect(c.refLabels[0].title.font).toMatchObject({ family: 'Segoe UI', size: 12 })
    expect(c.refLabels[0].value.font).toMatchObject({ family: 'Segoe UI Semibold', size: 12 })
    expect(cardTextDefaults(brand)).toEqual({
      value: { family: 'Segoe UI', size: 16 },
      label: { family: 'Segoe UI', size: 14 },
      refTitle: { family: 'Segoe UI', size: 12 },
      refValue: { family: 'Segoe UI Semibold', size: 12 }
    })
    // explicit derived classes in the theme win over the derivation
    const explicit = resolveTheme(undefined, { textClasses: { largeLightLabel: { fontFace: 'Arial', fontSize: 11 }, semiboldLabel: { fontFace: 'Arial Bold', fontSize: 9 } } })
    expect(cardTextDefaults(explicit)).toMatchObject({ label: { family: 'Arial', size: 11 }, refValue: { family: 'Arial Bold', size: 9 } })
  })

  it('explicit fonts and "Below value" on the visual still win over the theme', () => {
    const json = card([proj(S.m('Orders'), '_m.Orders')], {
      value: [{ properties: { fontSize: lit('20D'), fontFamily: lit("'Segoe UI Semibold'"), textWrap: lit('true') }, selector: { id: 'default' } }],
      label: [{ properties: { fontSize: lit('9D'), position: lit("'belowValue'") }, selector: { id: 'default' } }]
    })
    const c = computeCardVisual(json, host()).callouts[0]
    expect(c.value.font).toMatchObject({ family: 'Segoe UI Semibold', size: 20 })
    expect(c.value.wrap).toBe(true)
    expect(c.label.font.size).toBe(9)
    expect(c.label.position).toBe('below')
  })

  it('keeps the callout image area when the bound image value is not an image', () => {
    const fields = cardFields(card([proj(S.m('Orders'), '_m.Orders')]), () => 'Orders', () => true)
    const json = card([proj(S.m('Orders'), '_m.Orders')], {
      image: [{ properties: { show: lit('true'), imageType: lit("'imageData'"), imageData: { expr: { Aggregation: { Expression: S.col('Region'), Function: 3 } } }, imageAreaSize: lit('15L'), padding: lit('0L'), verticalAlignment: lit("'top'") }, selector: { id: 'default' } }]
    })
    const plan = planCardQuery(json, theme, fields)
    const blank: CardValues = { get: (id) => (id.startsWith('v0') ? { value: 12, formatString: '0' } : { value: null }) }
    const noImage = buildCardVisualModel(json, theme, memoryFormat, plan, blank).callouts[0].image
    expect(noImage).toMatchObject({ position: 'left', areaSize: 15, gap: 0, verticalAlignment: 'top' })
    expect(noImage!.src).toBeUndefined()
    const text: CardValues = { get: (id) => (id.startsWith('v0') ? { value: 12, formatString: '0' } : { value: 'not a picture' }) }
    expect(buildCardVisualModel(json, theme, memoryFormat, plan, text).callouts[0].image!.src).toBeUndefined()
    // switched off: no image area at all
    const off = card([proj(S.m('Orders'), '_m.Orders')], { image: [{ properties: { show: lit('false') }, selector: { id: 'default' } }] })
    expect(buildCardVisualModel(off, theme, memoryFormat, planCardQuery(off, theme, fields), blank).callouts[0].image).toBeUndefined()
  })

  it('reads GA padding margins (individual) and divider names', () => {
    const json = card([proj(S.m('Orders'), '_m.Orders')], {
      padding: [{ properties: { paddingSelection: lit("'Custom'"), paddingIndividual: lit('true'), paddingUniform: lit('6L'), topMargin: lit('2L'), leftMargin: lit('20L') }, selector: { id: 'default' } }],
      divider: [{ properties: { show: lit('true'), dividerColor: color('#FF0000'), dividerWidth: lit('3D'), dividerLineStyle: lit("'dashed'") }, selector: { id: 'default' } }],
      referenceLabel: [{ properties: { value: { expr: S.m('Units') } }, selector: { metadata: '_m.Orders', id: 'f1', order: 0 } }]
    })
    const c = computeCardVisual(json, host()).callouts[0]
    expect(c.tile.padding).toEqual({ top: 2, right: 6, bottom: 6, left: 20 })
    expect(c.divider).toEqual({ color: '#FF0000', width: 3, style: 'dashed', ignorePadding: false })
    // reference label area: own area with the default background (GA)
    expect(c.refArea.background).toBe(theme.backgroundLight)
  })

  it('padding presets apply when no explicit uniform padding', () => {
    const wide = computeCardVisual(card([proj(S.m('Orders'), '_m.Orders')], { padding: [{ properties: { paddingSelection: lit("'Wide'") }, selector: { id: 'default' } }] }), host())
    expect(wide.callouts[0].tile.padding.left).toBe(20)
  })

  it('splits into one section per category value with identities (multi-category layout)', () => {
    const json = {
      name: 'c',
      visual: {
        visualType: 'cardVisual',
        query: { queryState: { Data: { projections: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders')] }, Rows: { projections: [proj(S.col('Region'), 'Sales.Region')] } } },
        objects: {}
      }
    }
    const m = computeCardVisual(json, host())
    expect(m.sections).toHaveLength(3)
    const eu = m.sections!.find((s) => s.title === 'Europe')!
    expect(eu.identity.fields[0].value).toBe('Europe')
    const euSales = sampleRows().filter((r) => r.Region === 'Europe').reduce((a, r) => a + (r.Amount as number), 0)
    expect(eu.callouts[0].raw).toBeCloseTo(euSales, 2)
    expect(eu.callouts).toHaveLength(2)
    expect(m.categoryLayout).toMatchObject({ columns: 1, header: { position: 'left', rotate: true, concatenate: true } })
    expect(m.categoryLayout!.fixedRows).toBeUndefined() // 3 sections ≤ 4 rows (Fit to space)
  })

  it('per-callout images (callout image object `image`) and data-bound card images', () => {
    const fields = cardFields(card([proj(S.m('Orders'), '_m.Orders'), proj(S.m('Units'), '_m.Units')]), (p) => p.queryRef, () => true)
    const json = card([proj(S.m('Orders'), '_m.Orders'), proj(S.m('Units'), '_m.Units')], {
      image: [{ properties: { show: lit('true'), imageType: lit("'imageUrl'"), imageUrl: lit(`'${svgA}'`), position: lit("'Top'"), fixedSize: lit('true'), size: lit('40L') }, selector: { metadata: '_m.Units' } }],
      cardImage: [
        { properties: { show: lit('true'), imageType: lit("'imageData'"), imageData: { expr: S.m('Sales Html') }, imageDataFit: lit("'Fill'") }, selector: { metadata: '_m.Orders' } },
        { properties: { imageData: { expr: S.m('Margin Color') } }, selector: { metadata: '_m.Orders', id: 'interaction:hover' } }
      ]
    })
    const plan = planCardQuery(json, theme, fields)
    const ids = plan.values.map((v) => v.id)
    expect(ids.filter((i) => i.startsWith('b|'))).toHaveLength(2)
    const vals: CardValues = {
      get: (id) => (id.includes('Sales Html') ? { value: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } : id.includes('Margin Color') ? { value: 'https://example.com/hover.png' } : { value: 1 })
    }
    const m = buildCardVisualModel(json, theme, memoryFormat, plan, vals)
    const [orders, units] = m.callouts
    expect(orders.image).toBeUndefined()
    expect(units.image).toMatchObject({ src: svgA, position: 'top', size: 40 })
    expect(orders.cardImage?.src).toMatch(/^data:image\/svg\+xml/)
    expect(orders.cardImage?.fit).toBe('fill')
    expect(orders.cardImageHover?.src).toBe('https://example.com/hover.png')
    expect(units.cardImage).toBeUndefined()
    expect(m.layout.areas.image).toBe(true) // reserved on every card
  })

  it('state selectors: hover tile style and per-state corner radius', () => {
    const json = card([proj(S.m('Orders'), '_m.Orders')], {
      shapeCustomRectangle: [
        { properties: { rectangleRoundedCurve: lit('10L') }, selector: { id: 'default' } },
        { properties: { rectangleRoundedCurveCustomStyle: lit('true'), rectangleRoundedCurveLeftTop: lit('0L'), rectangleRoundedCurve: lit('20L') }, selector: { id: 'interaction:hover' } }
      ],
      fillCustom: [{ properties: { fillColor: color('#EEEEEE') }, selector: { id: 'interaction:hover' } }]
    })
    const c = computeCardVisual(json, host()).callouts[0]
    expect(c.tile.radius).toEqual([10, 10, 10, 10])
    expect(c.tile.fill).toBe('#FFFFFF')
    expect(c.tileHover?.radius).toEqual([0, 20, 20, 20])
    expect(c.tileHover?.fill).toBe('#EEEEEE')
  })

  it('reference label detail values come from a bound field, formatted with detail units', () => {
    const json = card([proj(S.m('Total Sales'), '_m.Total Sales')], {
      referenceLabel: [{ properties: { value: { expr: S.m('Orders') } }, selector: { metadata: '_m.Total Sales', id: 'f1', order: 0 } }],
      referenceLabelDetail: [{ properties: { detailValue: { expr: S.m('Units') }, detailDisplayUnits: lit('1000D'), detailPrecision: lit('1L') }, selector: { metadata: '_m.Total Sales', id: 'f1' } }]
    })
    const r = computeCardVisual(json, host()).callouts[0].refLabels[0]
    const units = sampleRows().reduce((a, x) => a + (x.Quantity as number), 0)
    expect(r.detail?.raw).toBe(units)
    expect(r.detail?.text).toBe(`${(units / 1000).toFixed(1)}K`)
  })

  it('custom format string / show blank as on the callout value', () => {
    const filters = [{ Version: 2, Where: [{ Condition: { In: { Expressions: [S.col('Region')], Values: [[{ Literal: { Value: "'Nowhere'" } }]] } } }] }]
    const json = card([proj(S.m('Orders'), '_m.Orders')], { value: [{ properties: { showBlankAs: lit("'–'") }, selector: { id: 'default' } }] })
    expect(computeCardVisual(json, host(filters)).callouts[0].value.text).toBe('–')
    const fmt = card([proj(S.m('Orders'), '_m.Orders')], { value: [{ properties: { customFormatString: lit("'0.00'"), labelDisplayUnits: lit('1D') }, selector: { id: 'default' } }] })
    expect(computeCardVisual(fmt, host()).callouts[0].value.text).toBe('2400.00')
  })

  it('theme "*" wildcard defaults for the card (Learn: paddingUniform / backgroundTransparency)', () => {
    const t = resolveTheme(undefined, { visualStyles: { cardVisual: { '*': { '*': [{ $id: 'default', paddingUniform: 0, backgroundTransparency: 100 }] } } } })
    const fields = cardFields(card([proj(S.m('Orders'), '_m.Orders')]), () => 'Orders', () => true)
    const json = card([proj(S.m('Orders'), '_m.Orders')])
    const m = buildCardVisualModel(json, t, memoryFormat, planCardQuery(json, t, fields), { get: () => ({ value: 3 }) })
    expect(m.callouts[0].tile.padding.top).toBe(0)
  })

  it('grid geometry: fixed rows overflow → pages; fixed size wraps by width', () => {
    const props = new CardProps(card([], { layout: [{ properties: { orientation: lit('2D'), autoGrid: lit('false'), columnCount: lit('3L'), rowCount: lit('1L') } }] }), theme)
    const L = readCardLayout(props, 7, false, false)
    expect(L).toMatchObject({ columns: 3, rows: 3, fixedRows: 1 })
    const g = gridGeometry(L, 7, 300, 100, 20)
    expect(g).toMatchObject({ columns: 3, rowsPerPage: 1, pageSize: 3, pages: 3, overflow: true })
    expect(g.cellWidth).toBeCloseTo((300 - 2 * 8) / 3, 5)
    const fixed = gridGeometry({ ...L, fixedRows: undefined, fixedSize: { width: 100, height: 50 } }, 7, 330, 120)
    expect(fixed).toMatchObject({ columns: 3, rowsPerPage: 2, cellWidth: 100, overflow: true })
    const horiz = gridGeometry({ ...L, fixedSize: { width: 100, height: 50 }, overflow: { style: 'scroll', direction: 'horizontal' } }, 7, 330, 120)
    expect(horiz.columns).toBe(7)
  })
})

describe('imageSrc', () => {
  it('handles data URIs, URLs, svg markup, base64 and binary', () => {
    expect(imageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(imageSrc('https://x/y.png')).toBe('https://x/y.png')
    expect(imageSrc('<svg></svg>')).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(imageSrc('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')).toMatch(/^data:image\/png;base64,/)
    expect(imageSrc(new Uint8Array([60, 115, 118, 103]))).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(imageSrc(null)).toBeUndefined()
    expect(imageSrc('hello')).toBeUndefined()
  })
})

describe('legacy card', () => {
  it('formats with labels display units / precision and category label', () => {
    const json = {
      visual: {
        visualType: 'card',
        query: { queryState: { Values: { projections: [proj(S.m('Total Sales'), '_m.Total Sales')] } } },
        objects: { labels: [{ properties: { labelDisplayUnits: lit('1000D'), labelPrecision: lit('1L'), color: color('#118DFF') } }], categoryLabels: [{ properties: { show: lit('false') } }] }
      }
    }
    const m = computeLegacyCard(json, host())!
    expect(m.text).toBe(`$${(total / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}K`)
    expect(m.font.color).toBe('#118DFF')
    expect(m.font.size).toBe(45)
    expect(m.font.family).toBe('DIN')
    expect(m.category.show).toBe(false)
  })

  it('category label follows the theme label class (+2pt, "large and light")', () => {
    const json = { visual: { visualType: 'card', objects: {} } }
    const classic = buildLegacyCardModel(json, theme, memoryFormat, 'S', { value: 1 })
    expect(classic.category.font).toMatchObject({ family: 'Segoe UI', size: 12, color: theme.foregroundNeutralSecondary })
    const brand = resolveTheme(undefined, { textClasses: { callout: { fontFace: 'Segoe UI', fontSize: 16 }, label: { fontFace: 'Arial', fontSize: 12 } } })
    const m = buildLegacyCardModel(json, brand, memoryFormat, 'S', { value: 1 })
    expect(m.font).toMatchObject({ family: 'Segoe UI', size: 16 })
    expect(m.category.font).toMatchObject({ family: 'Arial', size: 14 })
    // an explicit size on the visual wins
    const set = buildLegacyCardModel({ visual: { visualType: 'card', objects: { categoryLabels: [{ properties: { fontSize: lit('9D') } }] } } }, brand, memoryFormat, 'S', { value: 1 })
    expect(set.category.font.size).toBe(9)
  })

  it('fitFontSize shrinks to width and height, never grows', () => {
    const measure = (t: string, pt: number) => t.length * pt * 0.6 // px
    expect(fitFontSize('123', 20, 500, 500, measure)).toBe(20)
    // 10 chars at 45pt = 270px; width 135 → avail 128.25 → 45*128.25/270 = 21.375 → floor to .25
    expect(fitFontSize('1234567890', 45, 135, 500, measure)).toBe(21.25)
    // height bound: 30px tall → pt = 30/1.25/1.333 = 18
    expect(fitFontSize('1', 45, 1000, 30, measure)).toBe(18)
    expect(fitFontSize('x'.repeat(500), 45, 50, 50, measure)).toBe(6)
  })
})

describe('card display-unit rules', () => {
  it('legacy card Auto leaves values under 10,000 unscaled', () => {
    expect([9262, 31950, 22_400_000, 2_838_948, 999, -12_345].map(legacyAutoUnit)).toEqual([1, 1e3, 1e6, 1e6, 1, 1e3])
    expect(legacyAutoUnit('x')).toBe(1)
  })
  it('legacy card formats 9,262 in full and 31,950 as $32K', () => {
    const v = (value: number) => buildLegacyCardModel({ visual: { visualType: 'card', objects: {} } }, theme, memoryFormat, 'S', { value, formatString: '\\$#,0' }).text
    expect(v(9262)).toBe('$9,262')
    expect(v(31950)).toBe('$32K')
  })
  it('card precision follows the format string decimals unless set', () => {
    expect(cardPrecision(0, undefined, '#,0')).toBe(0)
    expect(cardPrecision(0, undefined, '#,0.00')).toBeUndefined()
    expect(cardPrecision(0, 3, '#,0')).toBe(3)
    expect(cardPrecision(1, undefined, '#,0')).toBeUndefined()
  })
})

describe('legacy card word wrap', () => {
  const measure = (t: string, pt: number) => t.length * pt * 0.6
  it('wraps words greedily', () => {
    expect(wrapLines('aa bb cc', 10, 30, measure)).toEqual(['aa bb', 'cc'])
    expect(wrapLines('single', 10, 5, measure)).toEqual(['single'])
  })
  it('fitWrappedFontSize keeps the size when two lines fit, shrinks otherwise', () => {
    // 'North America' at 20pt = 13*12 = 156px > 120 avail → wraps to 2 lines of ≤ 'America' (84px); 2 lines × 33px fit 80px
    const r = fitWrappedFontSize('North America', 20, 126, 80, measure)
    expect(r.pt).toBe(20)
    expect(r.lines).toEqual(['North', 'America'])
    const tight = fitWrappedFontSize('North America', 20, 126, 40, measure)
    expect(tight.pt).toBeLessThan(20)
    // numbers (no spaces) behave like fitFontSize
    expect(fitWrappedFontSize('1234567890', 45, 135, 500, measure).pt).toBe(fitFontSize('1234567890', 45, 135, 500, measure))
  })
})

describe('multi-row card', () => {
  it('reads the schema outlineStyle enum, string outline and theme bar defaults', () => {
    const mk = (props: any) => ({ visual: { visualType: 'multiRowCard', objects: { card: [{ properties: props }] } } })
    expect(multiRowStyle(mk({ outlineStyle: lit('7L') }), theme).card.outline).toBe('Frame')
    expect(multiRowStyle(mk({ outline: lit("'TopBottom'") }), theme).card.outline).toBe('TopBottom')
    const def = multiRowStyle(mk({}), theme).card
    expect(def.outline).toBe('BottomOnly')
    // CY24SU10 visualStyles.multiRowCard: outlineWeight 2, barShow true, barWeight 2
    expect(def).toMatchObject({ outlineWeight: 2, barShow: true, barWeight: 2 })
  })

  it('builds one record per row with the first text column as card title', () => {
    const json = {
      visual: {
        visualType: 'multiRowCard',
        query: {
          queryState: { Values: { projections: [proj(S.col('Region'), 'Sales.Region'), proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders')] } },
          sortDefinition: { sort: [{ field: S.m('Total Sales'), direction: 'Descending' }] }
        }
      }
    }
    const { records } = computeMultiRow(json, host())
    expect(records).toHaveLength(3)
    expect(records.map((r) => r.title)).toEqual(expect.arrayContaining(['Europe', 'North America', 'Asia Pacific']))
    expect(records[0].items.map((i) => i.label)).toEqual(['Total Sales', 'Orders'])
    const sales = records.map((r) => parseFloat(r.items[0].text.replace(/[$,KM]/g, '')))
    expect(sales[0]).toBeGreaterThanOrEqual(sales[1])
  })

  it('without a leading column every field is an item', () => {
    const recs = buildMultiRowRecords(
      [
        { queryRef: 'a', label: 'A', isMeasure: true },
        { queryRef: 'b', label: 'B', isMeasure: false }
      ],
      [[{ value: 1500, formatString: '#,0' }, { value: 'x' }]],
      memoryFormat,
      true
    )
    expect(recs[0].title).toBeUndefined()
    expect(recs[0].items).toEqual([
      // multi-row cards have no display units: the format string applies as-is
      { label: 'A', text: '1,500' },
      { label: 'B', text: 'x' }
    ])
  })
})

const CORPUS = process.env.LUMEN_CORPUS_DIR ?? ''

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (n === 'visual.json') yield p
  }
}

describe.skipIf(!existsSync(CORPUS))('corpus cardVisual / multiRowCard', () => {
  it('builds a model for every corpus card without throwing', () => {
    let n = 0
    const fakeEngine = {
      ...engine,
      summarize: (req: any) => ({
        columns: req.values.map((v: any) => ({ id: v.id, kind: 'value', dataType: 'double', formatString: '#,0.0', name: v.id })),
        rows: [req.values.map((_: any, i: number) => (i % 3 === 2 ? null : 12345.678 * (i + 1)))]
      }),
      describeField: () => undefined
    }
    const ctx = createMockHost({ engine: fakeEngine as any })
    for (const f of walk(CORPUS)) {
      const json = JSON.parse(readFileSync(f, 'utf8'))
      const vt = json?.visual?.visualType
      if (vt === 'cardVisual') {
        const m = computeCardVisual(json, ctx)
        expect(m.callouts.length).toBe(json.visual.query.queryState.Data.projections.length)
        for (const c of m.callouts) {
          expect(c.value.text).toBeTypeOf('string')
          expect(c.value.font.size).toBeGreaterThan(0)
        }
        n++
      } else if (vt === 'multiRowCard') {
        const m = computeMultiRow(json, ctx)
        expect(m.style.data.size).toBe(10)
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(150)
  })
})

describe('gallery entries render', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { galleryEntries } = await import('./gallery')
  const { getVisual } = await import('../registry')
  await import('./index')
  for (const e of galleryEntries) {
    it(e.id, () => {
      const def = getVisual(e.visualJson.visual.visualType)!
      expect(def).toBeDefined()
      const ctx = createMockHost({ engine, visualJson: e.visualJson })
      const html = renderToStaticMarkup(createElement(def.component, { visual: { name: e.id, json: e.visualJson }, pageName: 'p', width: e.width, height: e.height, ctx }))
      expect(html).not.toContain('wbi-card-error')
      expect(html.length).toBeGreaterThan(100)
      const data = def.getData?.({ name: e.id, json: e.visualJson }, ctx)
      expect(data?.columns.length).toBeGreaterThan(0)
    })
  }
})
