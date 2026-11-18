import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CFIcon, ICON_COLORS, KPI_STATUS_GRAPHICS, PBI_ICONS, PBI_ICON_SETS, kpiIconFor, kpiStatusIcon, kpiTrendIcon, resolveIcon } from './cfIcons'
import { buildCell } from './cellModel'
import { applyKpiIcons, type CardVisualModel, type CalloutModel } from '../cards/cardVisualModel'
import { buildLegacyCardModel, buildMultiRowRecords } from '../cards/legacyCardModel'
import { resolveTheme } from '@core/report/theme'
import { measureExpr } from '@core/report/sq'

/** Generic built-in Power BI icon names used by icon rules in Microsoft's public sample PBIX files. */
const SAMPLE_ICON_NAMES = ['CircleHigh', 'SignMedium', 'SignLow']

/** The documented built-in icon ids (community-published list). */
const BUILT_IN = [
  'SignLow', 'SignMedium', 'CircleHigh', 'CircleMedium', 'CircleLow', '4CircleLow', 'CircleMedium1', '4CircleMedium2',
  'CircleEmpty', 'Circle25', 'CircleHalf', 'Circle75', 'CircleFilled', 'SymbolLow', 'SymbolMedium', 'SymbolHigh',
  'CircleSymbolLow', 'CircleSymbolMedium', 'CircleSymbolHigh', 'TrafficLow', 'TrafficMedium', 'TrafficHigh',
  'TrafficBlackRimmed', 'TrafficLowLight', 'TrafficMediumLight', 'TrafficHighLight', 'TrafficBlackRimmedLight',
  'ColoredArrowDownRight', 'ColoredArrowRight', 'ColoredArrowUpRight', 'ColoredArrowUp', 'ColoredArrowDown',
  'GreyArrowDown', 'GreyArrowDownRight', 'GreyArrowRight', 'GreyArrowUpRight', 'GreyArrowUp',
  'FlagLow', 'FlagMedium', 'FlagHigh', 'FlagBlack', 'StarLow', 'StarMedium', 'StarHigh', 'StarMediumLight', 'StarHighLight',
  'TriangleLow', 'TriangleMedium', 'TriangleHigh', 'SignalBarEmpty', 'SignalBarLow', 'SignalBarMedium', 'SignalBarMedium2',
  'SignalBarFull', 'SignalBarLowColored', 'SignalBarMediumColored', 'SignalBarMedium2Colored', 'SignalBarFullColored',
  'QuadrantEmpty', 'Quadrant25', 'Quadrant50', 'Quadrant75', 'QuadrantFull', 'Quadrant25Colored', 'Quadrant50Colored',
  'Quadrant75Colored', 'QuadrantFullColored'
]

const DEFAULT_GRAY = { shape: 'circle', color: ICON_COLORS.gray }

describe('PBI icon set', () => {
  it('every icon name used in the public samples resolves to a non-default icon', () => {
    for (const n of SAMPLE_ICON_NAMES) {
      const s = resolveIcon(n)
      expect(s, n).toBeDefined()
      expect(s, n).not.toMatchObject(DEFAULT_GRAY)
    }
  })
  it('every built-in icon id is in the exact catalog', () => {
    for (const n of BUILT_IN) expect(PBI_ICONS[n.toLowerCase()], n).toBeDefined()
    for (const set of PBI_ICON_SETS) for (const n of set.icons) expect(PBI_ICONS[n.toLowerCase()], `${set.id}:${n}`).toBeDefined()
  })
  it('signs: High circle green, Medium triangle yellow, Low diamond red', () => {
    expect(resolveIcon('CircleHigh')).toEqual({ shape: 'circle', color: ICON_COLORS.green })
    expect(resolveIcon('SignMedium')).toEqual({ shape: 'triangleUp', color: ICON_COLORS.yellow })
    expect(resolveIcon('SignLow')).toEqual({ shape: 'diamond', color: ICON_COLORS.red })
  })
  it('families', () => {
    expect(resolveIcon('TrafficLow')).toMatchObject({ shape: 'trafficLight', color: ICON_COLORS.red })
    expect(resolveIcon('ColoredArrowDown')).toMatchObject({ shape: 'arrowDown', color: ICON_COLORS.red })
    expect(resolveIcon('GreyArrowUpRight')).toMatchObject({ shape: 'arrowUpRight', color: ICON_COLORS.gray })
    expect(resolveIcon('SymbolHigh')).toMatchObject({ shape: 'check', plain: true })
    expect(resolveIcon('CircleSymbolLow')).toMatchObject({ shape: 'x' })
    expect(resolveIcon('CircleSymbolLow')!.plain).toBeUndefined()
    expect(resolveIcon('StarMedium')!.shape).toBe('starHalf')
    expect(resolveIcon('Circle75')).toMatchObject({ shape: 'quarter', level: 3 })
    expect(resolveIcon('SignalBarMedium2Colored')).toMatchObject({ shape: 'bars', level: 3, color: ICON_COLORS.blue })
    expect(resolveIcon('Quadrant50')).toMatchObject({ shape: 'boxes', level: 2 })
    expect(resolveIcon('FlagBlack')).toMatchObject({ shape: 'flag', color: ICON_COLORS.black })
  })
  it('unknown <Shape><High|Medium|Low> names map the level to KPI colors', () => {
    expect(resolveIcon('DiamondHigh')!.color).toBe(ICON_COLORS.green)
    expect(resolveIcon('SomethingCircleLow')!.color).toBe(ICON_COLORS.red)
  })
  it('legacy keyword spellings still work', () => {
    expect(resolveIcon('TriangleSideYellow')).toMatchObject({ shape: 'dash', color: ICON_COLORS.yellow })
    expect(resolveIcon('XRed')!.shape).toBe('x')
    expect(resolveIcon('Bars3')).toMatchObject({ shape: 'bars', level: 3 })
  })
  it('renders every built-in icon to SVG', () => {
    for (const n of BUILT_IN) expect(renderToStaticMarkup(createElement(CFIcon, { name: n, size: 16 }))).toContain('<svg')
  })
})

describe('KPI status / trend icons', () => {
  it('maps status per graphic like Power BI (SQLBI graphic x value table)', () => {
    const row = (g: string) => [-2, -1, 0, 1, 2].map((v) => kpiStatusIcon(v, g))
    expect(row('Traffic Light - Single')).toEqual(['4CircleLow', 'CircleLow', 'CircleMedium', 'CircleHigh', '4CircleLow'])
    expect(row('Traffic Light')).toEqual(['TrafficBlackRimmed', 'TrafficLow', 'TrafficMedium', 'TrafficHigh', 'TrafficBlackRimmed'])
    expect(row('Shapes')).toEqual(['', 'SignLow', 'SignMedium', 'CircleHigh', ''])
    // Cylinder / Smiley Face / Thermometer render like Shapes in Power BI
    for (const g of ['Cylinder', 'Smiley Face', 'Thermometer']) expect(row(g)).toEqual(row('Shapes'))
    expect(row('Road Signs').slice(1, 4)).toEqual(['CircleSymbolLow', 'CircleSymbolMedium', 'CircleSymbolHigh'])
    expect(row('Three Symbols Uncircled Colored').slice(1, 4)).toEqual(['SymbolLow', 'SymbolMedium', 'SymbolHigh'])
    expect(row('Three Flags Colored')).toEqual(['FlagBlack', 'FlagLow', 'FlagMedium', 'FlagHigh', 'FlagBlack'])
    expect(row('Three Stars Colored')).toEqual(['KpiStarEmpty', 'KpiStarEmpty', 'KpiStarHalf', 'KpiStarFull', 'KpiStarEmpty'])
    expect(row('Three Circles Colored')).toEqual(row('Traffic Light - Single'))
    // five-state gauges are Harvey balls; descending is the mirror
    expect(row('Gauge - Ascending')).toEqual(['CircleEmpty', 'Circle25', 'CircleHalf', 'Circle75', 'CircleFilled'])
    expect(row('Gauge - Descending')).toEqual(['CircleFilled', 'Circle75', 'CircleHalf', 'Circle25', 'CircleEmpty'])
    expect(row('Five Bars Colored')).toEqual(['SignalBarEmpty', 'SignalBarLow', 'SignalBarMedium', 'SignalBarMedium2', 'SignalBarFull'])
    expect(row('Five Boxes Colored')).toEqual(['QuadrantEmpty', 'Quadrant25', 'Quadrant50', 'Quadrant75', 'QuadrantFull'])
    expect(row('Standard Arrow')).toEqual(['KpiArrowDown', 'KpiArrowDownRight', 'KpiArrowRight', 'KpiArrowUpRight', 'KpiArrowUp'])
    expect(row('Status Arrow - Ascending')).toEqual(['KpiArrowDownRed', 'KpiArrowDownRightYellow', 'KpiArrowRightYellow', 'KpiArrowUpRightYellow', 'KpiArrowUpGreen'])
    expect(row('Status Arrow - Descending')).toEqual([...row('Status Arrow - Ascending')].reverse())
    // no graphic → Traffic Light - Single
    expect(kpiStatusIcon(1, undefined)).toBe('CircleHigh')
    expect(kpiStatusIcon(null, 'Shapes')).toBeUndefined()
  })
  it('decimal values and unknown graphics show the number; out-of-range integers show nothing', () => {
    expect(kpiStatusIcon(0.5, 'Shapes')).toBeUndefined()
    expect(kpiStatusIcon(1, 'Variance Arrow')).toBeUndefined()
    expect(kpiStatusIcon(3, 'Five Bars Colored')).toBe('')
  })
  it('every KPI glyph resolves and renders', () => {
    const names = new Set(Object.values(KPI_STATUS_GRAPHICS).flat().filter((n): n is string => !!n))
    for (const n of names) {
      expect(resolveIcon(n), n).toBeDefined()
      expect(renderToStaticMarkup(createElement(CFIcon, { name: n, size: 16 })), n).toContain('<svg')
    }
    expect(resolveIcon('KpiArrowUpRight')).toMatchObject({ shape: 'thinArrow', dir: 'upRight' })
  })
  it('trend arrows (thin Standard Arrow unless the model names a trend graphic)', () => {
    expect([1, 0, -1].map((v) => kpiTrendIcon(v))).toEqual(['KpiArrowUpRight', 'KpiArrowRight', 'KpiArrowDownRight'])
    expect(kpiTrendIcon(1, 'Status Arrow - Ascending')).toBe('KpiArrowUpRightYellow')
    expect(kpiIconFor({ part: 'goal' }, 1)).toBeUndefined()
  })
  it('table/matrix cells show the KPI icon only', () => {
    const host = { format: (v: any) => String(v), theme: resolveTheme(undefined) }
    const c = buildCell(-1, { kpi: { part: 'status', statusGraphic: 'Shapes' } }, host, { get: () => undefined, stats: {}, isTotal: false })
    expect(c.icon).toEqual({ name: 'SignLow', layout: 'only', verticalAlignment: 'middle' })
    expect(buildCell(7, { kpi: { part: 'status', statusGraphic: 'Shapes' } }, host, { get: () => undefined, stats: {}, isTotal: false }).text).toBe('')
    expect(buildCell(5, {}, host, { get: () => undefined, stats: {}, isTotal: false }).icon).toBeUndefined()
  })
  it('cards: new card callouts, legacy card and multi-row card', () => {
    const e = measureExpr('Sales', '_Revenue Status')
    const model = { callouts: [{ queryRef: 'q', raw: 1 } as CalloutModel], layout: {} } as unknown as CardVisualModel
    applyKpiIcons(model, [{ queryRef: 'q', expr: e }], () => ({ part: 'status', statusGraphic: 'Traffic Light - Single' }))
    expect(model.callouts[0].kpiIcon).toBe('CircleHigh')
    const theme = resolveTheme(undefined)
    const lc = buildLegacyCardModel({ visual: { objects: {} } }, theme, (v) => String(v), 'Status', { value: 0, kpi: { part: 'status', statusGraphic: 'Shapes' } })
    expect(lc.kpiIcon).toBe('SignMedium')
    const recs = buildMultiRowRecords([{ queryRef: 'a', label: 'Trend', isMeasure: true }], [[{ value: -1, kpi: { part: 'trend' } }]], (v) => String(v), false)
    expect(recs[0].items[0].kpiIcon).toBe('KpiArrowDownRight')
  })
})
